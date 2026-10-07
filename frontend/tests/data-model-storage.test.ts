import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import {
  analysisForDataset,
  graphDatasets,
  reanalyzeDataModel,
  setAnalysisForDataset,
  removeDataModelSource,
  suppressDataModelEdge,
} from '../src/data/model';
import { base, type Graph } from '../src/model/types';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { emptyFilters } from '../src/model/types';
import { saveAnalysisView } from '../src/analysis/views';
let db: WorkspaceDatabase, repo: Repository;
const controllers: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`model-storage-${crypto.randomUUID()}`);
  repo = new Repository(db);
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  await db.initialize();
});
afterEach(async () => {
  controllers.forEach((w) => w.stop());
  controllers.length = 0;
  vi.restoreAllMocks();
  await db.delete();
});
function fixture(): Graph {
  const a = parseCsv('Customer,Budget\nA,100\nB,200\n', 'Customers.csv'),
    b = parseCsv('Customer,Amount\nA,10\nA,20\nB,40\n', 'Orders.csv');
  b.diagramId = a.diagramId;
  const analysis = defaultAnalysis(b);
  analysis.metrics.push({ id: 'amount', operation: 'sum', columnId: 'c1' });
  let graph = setAnalysisForDataset(
    { ...csvGraph(a, defaultAnalysis(a)), datasets: [b] },
    b.id,
    analysis,
  );
  graph.diagram.settings.csvRelationships = [
    {
      id: base().id,
      sourceDatasetId: a.id,
      sourceColumnId: 'c0',
      targetDatasetId: b.id,
      targetColumnId: 'c0',
    },
  ];
  return reanalyzeDataModel(graph);
}
function light(graph: Graph) {
  const { dataset: _primary, datasets: _secondary, ...result } = graph;
  return result;
}
it('upgrades version 5 in place, preserving the source while removing the unique diagram index', async () => {
  const name = `model-migration-${crypto.randomUUID()}`,
    old = new Dexie(name),
    graph = fixture();
  old.version(5).stores({
    diagrams: 'id,name,type,updatedAt,folder,*tags',
    nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
    edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
    owners: 'id,&externalId,name,kind,team,updatedAt',
    settings: 'key',
    templates: 'id,name',
    datasets: 'id,&diagramId,updatedAt',
  });
  const single = csvGraph(graph.dataset!, defaultAnalysis(graph.dataset!));
  await old.table('diagrams').put(single.diagram);
  await old.table('nodes').bulkPut(single.nodes);
  await old.table('edges').bulkPut(single.edges);
  await old.table('datasets').put(single.dataset);
  await old.table('settings').put({ key: 'theme', value: 'dark' });
  old.close();
  const upgraded = new WorkspaceDatabase(name);
  try {
    await upgraded.open();
    const saved = await upgraded.graph(single.diagram.id);
    expect(saved!.dataset!.rows).toEqual(single.dataset!.rows);
    expect(saved!.nodes).toHaveLength(single.nodes.length);
    expect(upgraded.datasets.schema.indexes.find((i) => i.name === 'diagramId')!.unique).toBe(
      false,
    );
    expect((await upgraded.settings.get('theme'))!.value).toBe('dark');
    await upgraded.datasets.put(graph.datasets![0]);
    expect(await upgraded.datasets.where('diagramId').equals(single.diagram.id).count()).toBe(2);
  } finally {
    await upgraded.delete();
  }
});
it('roundtrips all sources, source analyses, entity focus and real relationships in JSON and backup merge', async () => {
  let graph = fixture();
  graph.diagram.settings.csvEntityFocus = {
    datasetId: graph.dataset!.id,
    path: [{ columnId: 'c0', value: 'A' }],
  };
  graph = reanalyzeDataModel(graph);
  const generated = graph.edges.find((e) => e.metadata.csvModelGenerated === true)!;
  graph = suppressDataModelEdge(
    { ...graph, edges: graph.edges.filter((e) => e.id !== generated.id) },
    generated,
  );
  graph = saveAnalysisView(graph, emptyFilters, 'Related A');
  const original = await repo.importGraph(graph),
    copy = await repo.importGraph(JSON.parse(JSON.stringify(original)) as Graph);
  expect(copy.diagram.id).not.toBe(original.diagram.id);
  expect(graphDatasets(copy).map((s) => s.rows)).toEqual(
    graphDatasets(original).map((s) => s.rows),
  );
  expect(graphDatasets(copy).every((s) => s.diagramId === copy.diagram.id)).toBe(true);
  expect(
    graphDatasets(copy).every((s) => !graphDatasets(original).some((o) => o.id === s.id)),
  ).toBe(true);
  const relation = copy.diagram.settings.csvRelationships![0];
  expect(relation.sourceDatasetId).toBe(copy.dataset!.id);
  expect(relation.targetDatasetId).toBe(copy.datasets![0].id);
  expect(
    copy.nodes.every(
      (n) => !getCsvNode(n) || graphDatasets(copy).some((s) => s.id === getCsvNode(n)!.datasetId),
    ),
  ).toBe(true);
  expect(Object.keys(copy.diagram.settings.csvSourceAnalyses!)).toContain(copy.datasets![0].id);
  expect(copy.diagram.settings.csvEntityFocus!.datasetId).toBe(copy.dataset!.id);
  const view = (
    copy.diagram.settings.namedAnalysisViews as {
      views: { csvRelationships: { sourceDatasetId: string }[]; layout: { id: string }[] }[];
    }
  ).views[0];
  expect(view.csvRelationships[0].sourceDatasetId).toBe(copy.dataset!.id);
  expect(view.layout.every((p) => copy.nodes.some((n) => n.id === p.id))).toBe(true);
  expect(
    reanalyzeDataModel(copy).edges.filter(
      (e) => e.metadata.csvModelGenerated === true && e.metadata.csvModelVisible !== false,
    ),
  ).toHaveLength(0);
  const backup = await db.backup();
  expect(backup.schemaVersion).toBe(8);
  const merged = await repo.restore(backup, 'merge');
  expect(merged).toHaveLength(2);
  expect(await db.datasets.count()).toBe(8);
  for (const restored of merged) expect(graphDatasets(restored)).toHaveLength(2);
});
it('preserves source cache identities on light saves and commits only an explicitly changed source', async () => {
  const graph = await repo.importGraph(fixture()),
    read = vi.spyOn(db.datasets, 'where'),
    write = vi.spyOn(db.datasets, 'put');
  const edited = { ...light(graph), nodes: graph.nodes.map((n) => ({ ...n, x: n.x + 20 })) };
  const saved = await repo.saveGraph(edited, graph.diagram.version);
  expect(saved.dataset).toBe(graph.dataset);
  expect(saved.datasets![0]).toBe(graph.datasets![0]);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  const refreshed = {
    ...saved,
    datasets: [
      {
        ...saved.datasets![0],
        rows: [
          ['A', '90'],
          ['B', '110'],
        ],
      },
    ],
  };
  const updated = await repo.saveGraph(reanalyzeDataModel(refreshed), saved.diagram.version);
  expect(write).toHaveBeenCalledTimes(1);
  expect(updated.dataset).toBe(graph.dataset);
  expect(updated.datasets![0].rows).toEqual(refreshed.datasets[0].rows);
  expect(updated.datasets![0].version).toBe(graph.datasets![0].version + 1);
  await expect(repo.saveGraph(refreshed, saved.diagram.version)).rejects.toMatchObject({
    status: 409,
  });
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].rows).toEqual(
    refreshed.datasets[0].rows,
  );
});
it('atomically autosaves refreshed raw rows with source-only history and undo/redo, then cascades all sources', async () => {
  const saved = await repo.importGraph(fixture()),
    workspace = new Workspace(repo);
  controllers.push(workspace);
  await workspace.acceptStorage();
  await workspace.open(saved.diagram.id);
  const before = useEditor.getState().graph!,
    second = before.datasets![0];
  useEditor.getState().command('Rename source file', (g) => ({
    ...g,
    datasets: [{ ...second, fileName: 'Updated orders.csv' }],
  }));
  await workspace.settled();
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].fileName).toBe('Updated orders.csv');
  useEditor.getState().undo();
  await workspace.settled();
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].fileName).toBe(second.fileName);
  useEditor.getState().command('Refresh source', (g) =>
    reanalyzeDataModel({
      ...g,
      datasets: [
        {
          ...g.datasets![0],
          rows: [
            ['A', '777'],
            ['B', '888'],
          ],
        },
      ],
    }),
  );
  await workspace.settled();
  expect(useEditor.getState().status).toBe('saved');
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].rows[0]).toEqual(['A', '777']);
  useEditor.getState().undo();
  await workspace.settled();
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].rows).toEqual(second.rows);
  useEditor.getState().redo();
  await workspace.settled();
  expect((await repo.getGraph(saved.diagram.id)).datasets![0].rows[1]).toEqual(['B', '888']);
  const write = vi.spyOn(db.datasets, 'put');
  useEditor.getState().updateNode(useEditor.getState().graph!.nodes[0].id, { status: 'done' });
  await workspace.settled();
  expect(write).not.toHaveBeenCalled();
  await repo.removeDiagram(saved.diagram.id);
  expect(await db.datasets.count()).toBe(0);
});
it('rolls back malformed multi-source Replace and keeps manual copied cards when removing a source', async () => {
  const graph = await repo.importGraph(fixture());
  const backup = await db.backup(),
    bad = structuredClone(backup);
  bad.diagrams[0].settings.csvRelationships![0].targetColumnId = 'not-a-column';
  await expect(repo.restore(bad, 'replace')).rejects.toMatchObject({ status: 422 });
  expect(await db.backup()).toMatchObject({ diagrams: backup.diagrams, datasets: backup.datasets });
  const card = graph.nodes.find((n) => getCsvNode(n)?.datasetId === graph.datasets![0].id)!;
  const clip = copySelection(graph, [card.id]);
  const copied = pasteSelection(clip, graph).nodes[0];
  expect(copied.metadata.csv).toBeDefined();
  graph.nodes.push(copied);
  const removed = await repo.saveGraph(
    removeDataModelSource(graph, graph.datasets![0].id),
    graph.diagram.version,
  );
  expect(await db.datasets.count()).toBe(1);
  expect(removed.nodes.find((n) => n.id === copied.id)!.metadata.csvSnapshot).toBeDefined();
  expect(removed.nodes.find((n) => n.id === copied.id)!.metadata.csv).toBeUndefined();
});
it('preserves an additional 100,000-row source on ordinary movement without raw reads/writes or copying', async () => {
  let graph = fixture();
  const additional = graph.datasets![0];
  graph = {
    ...graph,
    datasets: [
      {
        ...additional,
        rows: Array.from({ length: 100000 }, (_, i) => [
          String(i % 2000).padStart(5, '0'),
          String(i),
        ]),
      },
    ],
  };
  graph.diagram.settings.csvRelationships = [];
  graph = reanalyzeDataModel(graph);
  const saved = await repo.importGraph(graph);
  const read = vi.spyOn(db.datasets, 'where'),
    write = vi.spyOn(db.datasets, 'put');
  const stored = await repo.saveGraph(
    { ...light(saved), nodes: saved.nodes.map((n) => ({ ...n, x: n.x + 10 })) },
    saved.diagram.version,
  );
  expect(stored.datasets![0]).toBe(saved.datasets![0]);
  expect(stored.datasets![0].rows[99999]).toEqual(['01999', '99999']);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
}, 15000);
