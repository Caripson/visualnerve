import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as csv from '../src/data/csv';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { markdown, parseImport } from '../src/export/semantic';
import { blankGraph, newNode, type Graph, type GraphEdge } from '../src/model/types';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';

let db: WorkspaceDatabase;
let repo: Repository;
const controllers: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`csv-storage-${crypto.randomUUID()}`);
  repo = new Repository(db);
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  await db.initialize();
});
afterEach(async () => {
  controllers.forEach((controller) => controller.stop());
  controllers.length = 0;
  vi.restoreAllMocks();
  await db.delete();
});
function source() {
  const dataset = parseCsv(
    'Region,Amount,Code\n North ,10,00123\nNorth,20,00456\nSouth,,00789\n',
    'Sales.csv',
  );
  const analysis = defaultAnalysis(dataset);
  analysis.metrics.push({ id: 'amount', operation: 'sum', columnId: 'c1' });
  return csvGraph(dataset, analysis);
}
function drawing(graph: Graph): Graph {
  const { dataset: _dataset, ...result } = graph;
  return result;
}
async function snapshot() {
  return db.transaction('r', db.tables, async () =>
    Object.fromEntries(
      await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
    ),
  );
}

describe('diagram-owned CSV source storage', () => {
  it('autosaves object statuses and preserves them through reload, JSON import and backup restore', async () => {
    const graph = source();
    const statuses = ['done', 'planned', 'in-progress'];
    graph.nodes = graph.nodes.map((node, index) => ({ ...node, status: statuses[index] }));
    graph.nodes.push(
      newNode(graph.diagram.id, { title: 'Manual blocker', status: 'blocked' }),
      newNode(graph.diagram.id, { title: 'Manual review', status: 'Väntar på kundens svar' }),
      newNode(graph.diagram.id, { title: 'Without status' }),
    );
    const original = await repo.importGraph(graph);
    const workspace = new Workspace(repo);
    controllers.push(workspace);
    await workspace.acceptStorage();
    await workspace.open(original.diagram.id);
    const editor = useEditor.getState();
    const target = original.nodes[1];
    const rawWrite = vi.spyOn(db.datasets, 'put');
    editor.updateNode(target.id, { status: 'blocked' });
    await workspace.settled();
    expect(
      (await repo.getGraph(original.diagram.id)).nodes.find((node) => node.id === target.id)!
        .status,
    ).toBe('blocked');
    editor.undo();
    await workspace.settled();
    expect(
      (await repo.getGraph(original.diagram.id)).nodes.find((node) => node.id === target.id)!
        .status,
    ).toBe('planned');
    editor.redo();
    await workspace.settled();
    editor.updateNode(target.id, { title: 'Renamed North', x: target.x + 80 });
    await workspace.settled();
    editor.command('Filter CSV groups', (current) =>
      csvGraph(
        current.dataset!,
        {
          ...current.diagram.settings.csvAnalysis!,
          filters: [{ id: 'south', columnId: 'c0', operation: 'equals', value: 'South' }],
        },
        current,
      ),
    );
    await workspace.settled();
    expect(rawWrite).not.toHaveBeenCalled();
    workspace.stop();
    const saved = await repo.getGraph(original.diagram.id);
    const expected = saved.nodes.map(({ title, status }) => ({ title, status }));
    expect(saved.nodes.find((node) => node.id === target.id)!.status).toBe('blocked');
    expect(getCsvNode(saved.nodes.find((node) => node.id === target.id)!)!.visible).toBe(false);
    const renamed = await repo.request<Graph['nodes'][number]>(`/nodes/${target.id}`, 'PATCH', {
      version: saved.nodes.find((node) => node.id === target.id)!.version,
      description: 'Ordinary API edit',
    });
    expect(renamed.status).toBe('blocked');
    db.close();
    await db.open();
    const reopened = await repo.getGraph(original.diagram.id);
    expect(reopened.nodes.map(({ title, status }) => ({ title, status }))).toEqual(expected);
    const exported = await repo.request<Graph>('/export', 'POST', {
      diagramId: reopened.diagram.id,
      format: 'json',
    });
    const imported = await repo.importGraph(parseImport('json', JSON.stringify(exported)));
    expect(imported.nodes.map(({ title, status }) => ({ title, status }))).toEqual(expected);
    expect(imported.nodes.map((node) => node.id)).not.toEqual(
      reopened.nodes.map((node) => node.id),
    );
    expect(imported.dataset!.id).not.toBe(reopened.dataset!.id);
    const restored = await repo.restore(await db.backup(), 'replace');
    for (const current of restored) {
      expect(current.nodes.map(({ title, status }) => ({ title, status }))).toEqual(expected);
      expect(current.dataset!.rows).toEqual(original.dataset!.rows);
      expect(markdown(current)).toContain('Status: Väntar på kundens svar');
      const unfiltered = csvGraph(
        current.dataset!,
        { ...current.diagram.settings.csvAnalysis!, filters: [] },
        current,
      );
      const north = unfiltered.nodes.find((node) => node.title === 'Renamed North')!;
      expect(north.status).toBe('blocked');
      expect(getCsvNode(north)!.visible).toBe(true);
    }
  });

  it.each(['DELETE', 'PATCH', 'bulk'] as const)(
    'keeps source-free CSV snapshots unchanged when a generically marked edge is changed through %s',
    async (method) => {
      const initial = source();
      const plain = blankGraph('Snapshot-only drawing');
      const pasted = pasteSelection(
        copySelection(
          initial,
          initial.nodes.map((node) => node.id),
        ),
        plain,
      );
      plain.nodes = pasted.nodes;
      plain.edges = pasted.edges;
      // Edge metadata is freeform; this flag alone does not bind snapshots to a source.
      plain.edges[0].metadata.csvGenerated = true;
      const original = await repo.importGraph(plain);
      const edge = original.edges[0];
      const replacement = original.nodes.find(
        (node) => node.id !== edge.sourceNodeId && node.id !== edge.targetNodeId,
      )!;
      const metadata = new Map(original.nodes.map((node) => [node.id, node.metadata]));
      expect(
        getCsvNode(original.nodes.find((node) => node.id === edge.targetNodeId)!),
      ).toBeDefined();
      if (method === 'bulk') {
        const identified = await repo.request<GraphEdge>(`/edges/${edge.id}`, 'PATCH', {
          version: edge.version,
          externalId: 'snapshot-link',
        });
        await repo.bulk(original.diagram.id, {
          upsert: true,
          edges: [
            {
              externalId: identified.externalId,
              version: identified.version,
              sourceNodeId: replacement.id,
            },
          ],
        });
      } else {
        await repo.request(
          `/edges/${edge.id}`,
          method,
          method === 'PATCH' ? { version: edge.version, targetNodeId: replacement.id } : undefined,
        );
      }
      db.close();
      await db.open();
      const saved = await repo.getGraph(original.diagram.id);
      expect(saved.dataset).toBeUndefined();
      expect(saved.diagram.settings.csvAnalysis).toBeUndefined();
      expect(await db.datasets.count()).toBe(0);
      for (const node of saved.nodes) {
        expect(node.metadata).toEqual(metadata.get(node.id));
        expect(node.metadata.csvSnapshot).toBeDefined();
        expect(node.metadata.csv).toBeUndefined();
      }
      const changed = saved.edges.find((item) => item.id === edge.id);
      if (method === 'DELETE') expect(changed).toBeUndefined();
      else {
        expect(changed!.metadata.csvGenerated).toBe(false);
        expect(method === 'PATCH' ? changed!.targetNodeId : changed!.sourceNodeId).toBe(
          replacement.id,
        );
      }
    },
  );

  it('preserves legacy freeform metadata.csv without treating it as a CSV data binding', async () => {
    const legacy = blankGraph('Existing metadata');
    const metadata = { csv: { whatever: 'Keep this', importedColumns: ['A', 'B'] } };
    legacy.nodes.push(newNode(legacy.diagram.id, { title: 'Existing node', metadata }));
    const saved = await repo.importGraph(legacy);
    const edited = await repo.request<Graph['nodes'][number]>(
      `/nodes/${saved.nodes[0].id}`,
      'PATCH',
      {
        version: saved.nodes[0].version,
        title: 'Edited title',
      },
    );
    expect(edited.metadata).toEqual(metadata);
    db.close();
    await db.open();
    const reopened = await repo.getGraph(saved.diagram.id);
    expect(reopened.nodes[0].metadata).toEqual(metadata);
    expect(reopened.dataset).toBeUndefined();
    const restored = await repo.restore(await db.backup());
    expect(restored[0].nodes[0].metadata).toEqual(metadata);
    expect(restored[0].dataset).toBeUndefined();
    const genuine = source();
    delete genuine.dataset;
    delete genuine.diagram.settings.csvAnalysis;
    await expect(repo.importGraph(genuine)).rejects.toMatchObject({ status: 422 });
    const malformed = source();
    malformed.nodes[0].metadata.csv = { whatever: 'Not a source binding' };
    await expect(repo.importGraph(malformed)).rejects.toMatchObject({ status: 422 });
  });

  it('upgrades version 4 in place without changing existing graphs or user settings', async () => {
    const name = `csv-upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    const graph = blankGraph('Existing work');
    graph.nodes.push(newNode(graph.diagram.id, { title: 'Keep my node' }));
    old.version(4).stores({
      diagrams: 'id,name,type,updatedAt,folder,*tags',
      nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
      edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
      owners: 'id,&externalId,name,kind,team,updatedAt',
      settings: 'key',
      templates: 'id,name',
    });
    await old.table('diagrams').put(graph.diagram);
    await old.table('nodes').bulkPut(graph.nodes);
    await old.table('settings').bulkPut([
      { key: 'storage-consent', value: true },
      { key: 'workspace-id', value: 'existing-workspace' },
      { key: 'theme', value: 'dark' },
      { key: 'mcp-access', value: 'read' },
    ]);
    await old.table('templates').put({
      id: 'custom',
      name: 'My template',
      builtin: false,
      graph,
    });
    old.close();
    const upgraded = new WorkspaceDatabase(name);
    try {
      await upgraded.initialize();
      expect(upgraded.verno).toBe(8);
      expect(await upgraded.graph(graph.diagram.id)).toEqual(graph);
      expect(await upgraded.datasets.count()).toBe(0);
      expect((await upgraded.settings.get('workspace-id'))!.value).toBe('existing-workspace');
      expect((await upgraded.settings.get('storage-consent'))!.value).toBe(true);
      expect((await upgraded.settings.get('theme'))!.value).toBe('dark');
      expect((await upgraded.settings.get('mcp-access'))!.value).toBe('read');
      expect((await upgraded.templates.get('custom'))!.graph).toEqual(graph);
      expect(
        upgraded.datasets.schema.indexes.find((index) => index.name === 'diagramId')!.unique,
      ).toBe(false);
    } finally {
      await upgraded.delete();
    }
  });

  it('roundtrips exact cells, analysis and node bindings across reopen and both JSON exports', async () => {
    const original = await repo.importGraph(source());
    db.close();
    await db.open();
    const restored = await repo.getGraph(original.diagram.id);
    expect(restored).toEqual(original);
    expect(restored.dataset!.rows[0]).toEqual([' North ', '10', '00123']);
    expect(getCsvNode(restored.nodes[1])!.path[0].value).toBe('North');
    expect(Object.isFrozen(restored.dataset!.rows[0])).toBe(true);
    const exported = await repo.request<Graph>('/export', 'POST', {
      diagramId: restored.diagram.id,
      format: 'json',
    });
    expect(exported.dataset).toEqual(restored.dataset);
    expect((await db.backup()).datasets).toEqual([restored.dataset]);
  });

  it('stores 100,000 rows and edits the drawing without reloading, validating or rewriting them', async () => {
    const dataset = parseCsv('Customer,Amount\n00001,10\n', 'Large.csv');
    dataset.rows = Array.from({ length: 100000 }, (_, index) => [
      String(index % 2000).padStart(5, '0'),
      String(index),
    ]);
    const analysis = { ...defaultAnalysis(dataset), levels: [] };
    const saved = await repo.importGraph(csvGraph(dataset, analysis));
    db.close();
    await db.open();
    const graph = await repo.getGraph(saved.diagram.id);
    expect(graph.dataset!.rows).toHaveLength(100000);
    expect(graph.dataset!.rows[99999]).toEqual(['01999', '99999']);
    const query = vi.spyOn(db.datasets, 'where');
    const read = vi.spyOn(db.datasets, 'get');
    const write = vi.spyOn(db.datasets, 'put');
    const bulk = vi.spyOn(db.datasets, 'bulkPut');
    const rawValidation = vi.spyOn(csv, 'validateDataset');
    const edited = drawing(graph);
    edited.nodes = edited.nodes.map((node) => ({ ...node, x: node.x + 40 }));
    const first = await repo.saveGraph(edited, graph.diagram.version);
    const second = await repo.saveGraph(drawing(first), first.diagram.version);
    expect(second.dataset).toBe(graph.dataset);
    expect(query).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
    expect(rawValidation).not.toHaveBeenCalled();
    expect((await repo.getGraph(saved.diagram.id)).dataset!.rows[99999]).toEqual([
      '01999',
      '99999',
    ]);
  }, 15000);

  it('remaps a copied source and all CSV node bindings without changing the original', async () => {
    const original = await repo.importGraph(source());
    const imported = await repo.importGraph(original);
    expect(imported.diagram.id).not.toBe(original.diagram.id);
    expect(imported.dataset!.id).not.toBe(original.dataset!.id);
    expect(imported.dataset!.diagramId).toBe(imported.diagram.id);
    expect(
      imported.nodes.every((node) => getCsvNode(node)!.datasetId === imported.dataset!.id),
    ).toBe(true);
    expect(imported.dataset!.rows).toEqual(original.dataset!.rows);
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    const merged = await repo.restore(await db.backup());
    expect(merged).toHaveLength(2);
    for (const graph of merged) {
      expect(graph.dataset!.diagramId).toBe(graph.diagram.id);
      expect(graph.nodes.every((node) => getCsvNode(node)!.datasetId === graph.dataset!.id)).toBe(
        true,
      );
    }
    expect(await db.datasets.count()).toBe(4);
  });

  it('accepts a pre-dataset backup while preserving existing CSV work', async () => {
    const csv = await repo.importGraph(source());
    const plain = await repo.importGraph(blankGraph('Old diagram'));
    const backup = await db.backup();
    delete backup.datasets;
    backup.schemaVersion = 4;
    backup.diagrams = [plain.diagram];
    backup.nodes = [];
    backup.edges = [];
    const imported = await repo.restore(backup);
    expect(imported).toHaveLength(1);
    expect(imported[0].dataset).toBeUndefined();
    expect(await repo.getGraph(csv.diagram.id)).toEqual(csv);
  });

  it('persists filtered counts and retained groups after switching grouping columns', async () => {
    const original = await repo.importGraph(source());
    const copied = newNode(original.diagram.id, {
      title: 'Copied North card',
      metadata: structuredClone(original.nodes[1].metadata),
    });
    const analysis = {
      ...original.diagram.settings.csvAnalysis!,
      levels: ['c2'],
      filters: [{ id: 'large', columnId: 'c1', operation: 'gt' as const, value: '15' }],
    };
    const next = csvGraph(original.dataset!, analysis, {
      ...original,
      nodes: [...original.nodes, copied],
    });
    const saved = await repo.saveGraph(drawing(next), original.diagram.version);
    const root = saved.nodes.find((node) => getCsvNode(node)?.groupKey === '[]')!;
    expect(getCsvNode(root)!.rowCount).toBe(1);
    const former = saved.nodes.find((node) => node.id === original.nodes[1].id)!;
    expect(getCsvNode(former)!.visible).toBe(false);
    expect(getCsvNode(former)!.path[0].columnId).toBe('c0');
    expect(saved.nodes.find((node) => node.id === copied.id)!.metadata).toEqual(copied.metadata);
    expect(saved.dataset).toBe(original.dataset);
    expect((await repo.getGraph(saved.diagram.id)).diagram.settings.csvAnalysis).toEqual(analysis);
  });

  it('replaces source data atomically and rolls back every store on an invalid late source', async () => {
    const original = await repo.importGraph(source());
    const backup = await db.backup();
    await repo.importGraph(source());
    await db.settings.put({ key: 'storage-consent', value: true });
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    const restored = await repo.restore(backup, 'replace');
    expect(restored[0].dataset).toEqual(original.dataset);
    expect(await db.datasets.count()).toBe(1);
    expect((await db.settings.get('storage-consent'))!.value).toBe(true);
    expect(await db.settings.get('mcp-access')).toBeUndefined();
    const invalid = structuredClone(await db.backup());
    invalid.datasets![0].rows[0][1] = '99';
    const staged = csvGraph(
      invalid.datasets![0],
      restored[0].diagram.settings.csvAnalysis!,
      restored[0],
    );
    invalid.diagrams = [staged.diagram];
    invalid.nodes = staged.nodes;
    invalid.edges = staged.edges;
    const late = source();
    invalid.diagrams.push(late.diagram);
    invalid.nodes.push(...late.nodes);
    invalid.edges.push(...late.edges);
    invalid.datasets!.push(late.dataset!);
    invalid.datasets![1].rows[0].pop();
    const before = await snapshot();
    await expect(repo.restore(invalid, 'replace')).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    expect(await repo.getGraph(original.diagram.id)).toEqual(restored[0]);
  });

  it('rejects foreign or duplicate source references before leaving any partial writes', async () => {
    const graph = source();
    getCsvNode(graph.nodes[0])!.datasetId = crypto.randomUUID();
    const before = await snapshot();
    await expect(repo.importGraph(graph)).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    const saved = await repo.importGraph(source());
    const duplicate = await db.backup();
    duplicate.datasets!.push(structuredClone(saved.dataset!));
    const savedBefore = await snapshot();
    await expect(repo.restore(duplicate, 'replace')).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(savedBefore);
    const collision = source();
    collision.dataset!.id = saved.dataset!.id;
    for (const node of collision.nodes) getCsvNode(node)!.datasetId = saved.dataset!.id;
    await expect(repo.saveGraph(collision, 0)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(savedBefore);
    const imported = await repo.importGraph(collision);
    expect(imported.diagram.id).toBe(collision.diagram.id);
    expect(imported.dataset!.id).not.toBe(saved.dataset!.id);
    expect(
      imported.nodes.every((node) => getCsvNode(node)!.datasetId === imported.dataset!.id),
    ).toBe(true);
    expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  });

  it('detects another tab replacing source data and rejects a stale drawing save', async () => {
    const original = await repo.importGraph(source());
    await repo.getGraph(original.diagram.id);
    const otherDb = new WorkspaceDatabase(db.name);
    try {
      const other = new Repository(otherDb);
      const replacement = structuredClone(await other.getGraph(original.diagram.id));
      replacement.dataset!.rows[0][1] = '90';
      const updated = csvGraph(
        replacement.dataset!,
        replacement.diagram.settings.csvAnalysis!,
        replacement,
      );
      const committed = await other.saveGraph(updated, original.diagram.version);
      const actual = await repo.getGraph(original.diagram.id);
      expect(actual.dataset!.rows[0][1]).toBe('90');
      expect(actual.dataset!.version).toBe(2);
      expect(actual.dataset!.createdAt).toBe(original.dataset!.createdAt);
      expect(actual.diagram.version).toBe(committed.diagram.version);
      await expect(
        repo.saveGraph(drawing(original), original.diagram.version),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect(original.dataset!.rows[0][1]).toBe('10');
      expect((await repo.getGraph(original.diagram.id)).dataset!.rows[0][1]).toBe('90');
    } finally {
      otherDb.close();
    }
  });

  it('undoes and redoes small analysis settings while retaining source identity and raw data', async () => {
    const workspace = new Workspace(repo);
    controllers.push(workspace);
    await workspace.acceptStorage();
    await workspace.create(source());
    const original = useEditor.getState().graph!;
    const put = vi.spyOn(db.datasets, 'put');
    useEditor.getState().command('Choose visible columns', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: {
          ...graph.diagram.settings,
          csvAnalysis: { ...graph.diagram.settings.csvAnalysis!, displayColumns: ['c2'] },
        },
      },
    }));
    await workspace.settled();
    expect(
      (await repo.getGraph(original.diagram.id)).diagram.settings.csvAnalysis!.displayColumns,
    ).toEqual(['c2']);
    useEditor.getState().undo();
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.csvAnalysis).toEqual(
      original.diagram.settings.csvAnalysis,
    );
    useEditor.getState().redo();
    await workspace.settled();
    expect(
      (await repo.getGraph(original.diagram.id)).diagram.settings.csvAnalysis!.displayColumns,
    ).toEqual(['c2']);
    expect(useEditor.getState().graph!.dataset).toBe(original.dataset);
    expect(put).not.toHaveBeenCalled();
    expect((await db.datasets.get(original.dataset!.id))!.rows).toEqual(original.dataset!.rows);
  });

  it('cascades diagram deletion and clear-all into datasets while keeping other diagrams intact', async () => {
    const first = await repo.importGraph(source());
    const second = await repo.importGraph(source());
    await repo.removeDiagram(first.diagram.id);
    expect(await db.datasets.get(first.dataset!.id)).toBeUndefined();
    expect(await repo.getGraph(second.diagram.id)).toEqual(second);
    await repo.clearAll();
    expect(await db.datasets.count()).toBe(0);
    expect(await db.diagrams.count()).toBe(0);
  });

  it('keeps an API-deleted CSV parent connection suppressed after regroup, import and restore', async () => {
    const original = await repo.importGraph(source());
    const child = original.nodes[1];
    const edge = original.edges.find((edge) => edge.targetNodeId === child.id)!;
    await repo.request(`/edges/${edge.id}`, 'DELETE');
    const disconnected = await repo.getGraph(original.diagram.id);
    expect(
      getCsvNode(disconnected.nodes.find((node) => node.id === child.id)!)!
        .suppressParentConnection,
    ).toBe(true);
    expect(disconnected.edges.some((item) => item.id === edge.id)).toBe(false);
    const regenerated = csvGraph(
      disconnected.dataset!,
      disconnected.diagram.settings.csvAnalysis!,
      disconnected,
    );
    expect(regenerated.edges.some((item) => item.targetNodeId === child.id)).toBe(false);
    const saved = await repo.saveGraph(drawing(regenerated), disconnected.diagram.version);
    const copied = await repo.importGraph(saved);
    const copiedChild = copied.nodes.find(
      (node) => getCsvNode(node)?.groupKey === getCsvNode(child)!.groupKey,
    )!;
    expect(getCsvNode(copiedChild)!.datasetId).toBe(copied.dataset!.id);
    expect(getCsvNode(copiedChild)!.suppressParentConnection).toBe(true);
    expect(
      csvGraph(copied.dataset!, copied.diagram.settings.csvAnalysis!, copied).edges.some(
        (item) => item.targetNodeId === copiedChild.id,
      ),
    ).toBe(false);
    const restored = await repo.restore(await db.backup());
    for (const graph of restored) {
      const restoredChild = graph.nodes.find(
        (node) => getCsvNode(node)?.groupKey === getCsvNode(child)!.groupKey,
      )!;
      expect(getCsvNode(restoredChild)!.datasetId).toBe(graph.dataset!.id);
      expect(getCsvNode(restoredChild)!.suppressParentConnection).toBe(true);
      expect(
        csvGraph(graph.dataset!, graph.diagram.settings.csvAnalysis!, graph).edges.some(
          (item) => item.targetNodeId === restoredChild.id,
        ),
      ).toBe(false);
    }
  });

  it.each(['sourceNodeId', 'targetNodeId'] as const)(
    'atomically reconnects a CSV parent edge through API %s without restoring the old link',
    async (endpoint) => {
      const original = await repo.importGraph(source());
      const north = original.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
      const south = original.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
      const edge = original.edges.find((edge) => edge.targetNodeId === north.id)!;
      const before = await snapshot();
      await expect(
        repo.request(`/edges/${edge.id}`, 'PATCH', {
          version: edge.version - 1,
          [endpoint]: south.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        repo.request(`/edges/${edge.id}`, 'PATCH', {
          version: edge.version,
          [endpoint]: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await snapshot()).toEqual(before);
      const changed = await repo.request<GraphEdge>(`/edges/${edge.id}`, 'PATCH', {
        version: edge.version,
        [endpoint]: south.id,
        label: 'My reconnected link',
        direction: 'both',
        style: 'dotted',
      });
      expect(changed.metadata.csvGenerated).toBe(false);
      const saved = await repo.getGraph(original.diagram.id);
      expect(
        getCsvNode(saved.nodes.find((node) => node.id === north.id)!)!.suppressParentConnection,
      ).toBe(true);
      expect(
        getCsvNode(saved.nodes.find((node) => node.id === south.id)!)!.suppressParentConnection,
      ).not.toBe(true);
      const filtered = csvGraph(
        saved.dataset!,
        {
          ...saved.diagram.settings.csvAnalysis!,
          filters: [{ id: 'south', columnId: 'c0', operation: 'equals', value: 'South' }],
        },
        saved,
      );
      const restored = csvGraph(saved.dataset!, saved.diagram.settings.csvAnalysis!, filtered);
      expect(restored.edges.find((item) => item.id === edge.id)).toEqual(changed);
      expect(
        restored.edges.some(
          (item) => item.metadata.csvGenerated === true && item.targetNodeId === north.id,
        ),
      ).toBe(false);
    },
  );

  it('applies the same suppression to bulk external-id reconnects and rolls back invalid batches', async () => {
    const original = await repo.importGraph(source());
    const north = original.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
    const south = original.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
    const edge = original.edges.find((edge) => edge.targetNodeId === north.id)!;
    const identified = await repo.request<GraphEdge>(`/edges/${edge.id}`, 'PATCH', {
      version: edge.version,
      externalId: 'generated-parent',
    });
    expect(identified.metadata.csvGenerated).toBe(true);
    const update = {
      externalId: identified.externalId,
      version: identified.version,
      sourceExternalId: south.externalId,
      label: 'Manual bulk link',
    };
    const before = await snapshot();
    await expect(
      repo.bulk(original.diagram.id, {
        upsert: true,
        edges: [update, { sourceExternalId: 'missing', targetExternalId: north.externalId }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    const saved = await repo.bulk(original.diagram.id, { upsert: true, edges: [update] });
    const changed = saved.edges.find((item) => item.id === edge.id)!;
    expect(changed.sourceNodeId).toBe(south.id);
    expect(changed.metadata.csvGenerated).toBe(false);
    expect(
      getCsvNode(saved.nodes.find((node) => node.id === north.id)!)!.suppressParentConnection,
    ).toBe(true);
    const regenerated = csvGraph(saved.dataset!, saved.diagram.settings.csvAnalysis!, saved);
    expect(regenerated.edges.find((item) => item.id === changed.id)).toEqual(changed);
    expect(
      regenerated.edges.some(
        (item) => item.metadata.csvGenerated === true && item.targetNodeId === north.id,
      ),
    ).toBe(false);
  });
});
