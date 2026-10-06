import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { HistoryStore } from '../src/history/store';
import { historyLimits } from '../src/history/types';
import { importHistoryBackup } from '../src/history/backup';
import { base, blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { parseCsv } from '../src/data/csv';
import { setPresentation } from '../src/presentation/definition';
import { setStoryboard, getStoryboard } from '../src/presentation/storyboard';
import { setBuildSpecification, getBuildSpecification } from '../src/export/build-specification';
let db: WorkspaceDatabase, repo: Repository, history: HistoryStore;
const databases: WorkspaceDatabase[] = [];
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  db = new WorkspaceDatabase(`history-${crypto.randomUUID()}`);
  databases.push(db);
  repo = new Repository(db);
  history = repo.history;
  await db.initialize();
});
afterEach(async () => {
  for (const database of databases) await database.delete();
  databases.length = 0;
  vi.unstubAllGlobals();
});
function fixture(withSource = false): Graph {
  const graph = blankGraph('Lifecycle');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build' }),
    newNode(graph.diagram.id, { title: 'Drive' }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'ready' }),
  ];
  if (withSource)
    graph.dataset = {
      ...parseCsv('Id,Value\nA,1\nB,2', 'vehicles.csv'),
      diagramId: graph.diagram.id,
    };
  return graph;
}
const archive = (graph: Graph, name = 'Baseline') =>
  history.create(graph.diagram.id, { name, baseVersion: graph.diagram.version });
const copy = (graph: Graph) => structuredClone(graph);
describe('explicit local diagram history', () => {
  it('persists named snapshots across reopen without creating snapshots on autosave', async () => {
    const original = await repo.importGraph(fixture()),
      snapshot = await archive(original);
    const edit = copy(original);
    edit.nodes[0].title = 'Modified';
    await repo.saveGraph(edit, original.diagram.version);
    db.close();
    await db.open();
    expect((await history.list(original.diagram.id)).map((item) => item.name)).toEqual([
      'Baseline',
    ]);
    expect((await history.read(original.diagram.id, snapshot.id)).graph.nodes[0].title).toBe(
      'Build',
    );
  });
  it('shares 100,000 raw rows across source rename revisions and repeated snapshots', async () => {
    const graph = fixture(true);
    graph.dataset!.rows = Array.from({ length: 100000 }, (_, index) => [String(index), '1']);
    const first = await repo.importGraph(graph);
    await archive(first);
    await archive(first, 'Same data');
    const next = await repo.saveGraph(
      { ...first, dataset: { ...first.dataset!, name: 'Renamed source' } },
      first.diagram.version,
    );
    await archive(next, 'Rename only');
    expect(await db.historyContents.count()).toBe(2);
    expect(await db.historySources.count()).toBe(2);
    expect(await db.historyRows.count()).toBe(1);
    const backup = await db.backup();
    expect(backup.history!.rows[0].rows).toBeUndefined();
    expect(backup.history!.rows[0].datasetRef).toEqual({
      id: next.dataset!.id,
      version: next.dataset!.version,
    });
  });
  it('restores stable IDs and increasing versions while checkpointing current graph and rows', async () => {
    const original = await repo.importGraph(fixture(true)),
      snapshot = await archive(original);
    const edit = copy(original);
    edit.nodes = [edit.nodes[0]];
    edit.nodes[0].title = 'New draft';
    edit.edges = [];
    edit.dataset!.rows[0][1] = '9';
    const current = await repo.saveGraph(edit, original.diagram.version);
    const result = await history.restore(original.diagram.id, snapshot.id, {
      baseVersion: current.diagram.version,
    });
    expect(result.graph.nodes.map((node) => node.id)).toEqual(
      original.nodes.map((node) => node.id),
    );
    expect(result.graph.edges[0].id).toBe(original.edges[0].id);
    expect(result.graph.nodes[0].version).toBeGreaterThan(current.nodes[0].version);
    expect(result.graph.nodes[1].version).toBeGreaterThan(original.nodes[1].version);
    expect(result.graph.diagram.version).toBe(current.diagram.version + 1);
    expect(result.graph.dataset!.rows[0][1]).toBe('1');
    const safety = await history.read(original.diagram.id, result.safetySnapshot.id);
    expect(safety.graph.nodes[0].title).toBe('New draft');
    expect(safety.graph.dataset!.rows[0][1]).toBe('9');
    expect(safety.snapshot.kind).toBe('pre-restore');
  });
  it('restores canonical 2D and 3D positions without applying a second inferred movement', async () => {
    const graph = fixture();
    graph.nodes[0].metadata.spatial = { version: 1, position: { x: 0, y: 0, z: 2 } };
    const original = await repo.importGraph(graph),
      snapshot = await archive(original);
    const moved = await repo.saveGraph(
      {
        ...original,
        nodes: [
          {
            ...original.nodes[0],
            x: 100,
            metadata: { spatial: { version: 1, position: { x: 1, y: 0, z: 2 } } },
          },
          original.nodes[1],
        ],
      },
      original.diagram.version,
    );
    const current = await repo.saveGraph(
      {
        ...moved,
        nodes: [
          {
            ...moved.nodes[0],
            metadata: { spatial: { version: 1, position: { x: 0, y: 0, z: 2 } } },
          },
          moved.nodes[1],
        ],
      },
      moved.diagram.version,
    );
    const result = await history.restore(original.diagram.id, snapshot.id, {
      baseVersion: current.diagram.version,
    });
    expect(result.graph.nodes[0].x).toBe(0);
    expect(result.graph.nodes[0].metadata.spatial).toEqual(original.nodes[0].metadata.spatial);
  });
  it('restores a source-free graph and keeps the removed source in its safety checkpoint', async () => {
    const original = await repo.importGraph(fixture()),
      snapshot = await archive(original);
    const edit = copy(original);
    edit.dataset = { ...parseCsv('A\n1', 'new.csv'), diagramId: original.diagram.id };
    const current = await repo.saveGraph(edit, original.diagram.version);
    const result = await history.restore(original.diagram.id, snapshot.id, {
      baseVersion: current.diagram.version,
    });
    expect(result.graph.dataset).toBeUndefined();
    expect(await db.datasets.count()).toBe(0);
    expect(
      (await history.read(original.diagram.id, result.safetySnapshot.id)).graph.dataset!.rows,
    ).toEqual([['1']]);
  });
  it('gives a revived CSV source a fresh revision instead of reusing an archived version key', async () => {
    const original = await repo.importGraph(fixture(true)),
      snapshot = await archive(original);
    const renamed = await repo.saveGraph(
      { ...original, dataset: { ...original.dataset!, name: 'Changed source' } },
      original.diagram.version,
    );
    await archive(renamed, 'Renamed');
    const removed = await repo.saveGraph(
      { ...renamed, dataset: undefined, datasets: [] },
      renamed.diagram.version,
    );
    const restored = await history.restore(original.diagram.id, snapshot.id, {
      baseVersion: removed.diagram.version,
    });
    expect(restored.graph.dataset!.id).toBe(original.dataset!.id);
    expect(restored.graph.dataset!.version).toBeGreaterThan(renamed.dataset!.version);
    await archive(restored.graph, 'Revived');
    const archives = await db.historySources
      .where('diagramId')
      .equals(original.diagram.id)
      .toArray();
    expect(new Set(archives.map((source) => source.datasetVersion)).size).toBe(3);
    expect(
      (
        await history.read(
          original.diagram.id,
          (await history.list(original.diagram.id)).find((entry) => entry.name === 'Renamed')!.id,
        )
      ).graph.dataset!.name,
    ).toBe('Changed source');
  });
  it('keeps shared registry profiles current while restoring owner assignments', async () => {
    const graph = fixture(),
      owner = {
        ...base(),
        name: 'Original owner',
        kind: 'person' as const,
        color: '#23664d',
        metadata: {},
      };
    graph.owners = [owner];
    graph.nodes[0].ownerIds = [owner.id];
    const original = await repo.importGraph(graph),
      snapshot = await archive(original);
    await repo.owner({ version: owner.version, name: 'Current registry name' }, owner.id);
    const current = await repo.getGraph(original.diagram.id),
      restored = await history.restore(original.diagram.id, snapshot.id, {
        baseVersion: current.diagram.version,
      });
    expect(restored.graph.nodes[0].ownerIds).toEqual([owner.id]);
    expect(restored.graph.owners[0].name).toBe('Current registry name');
  });
  it('rejects stale creates/restores from another tab without changing history or current work', async () => {
    const original = await repo.importGraph(fixture()),
      snapshot = await archive(original),
      tab = new WorkspaceDatabase(db.name);
    await tab.open();
    try {
      const edit = copy(original);
      edit.nodes[0].title = 'Other tab';
      await new Repository(tab).saveGraph(edit, original.diagram.version);
      await expect(
        history.restore(original.diagram.id, snapshot.id, {
          baseVersion: original.diagram.version,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(archive(original, 'Stale snapshot')).rejects.toMatchObject({ status: 409 });
      expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Other tab');
      expect(await db.historySnapshots.count()).toBe(1);
    } finally {
      tab.close();
    }
  });
  it('rechecks the diagram version when another tab writes during snapshot preparation', async () => {
    const original = await repo.importGraph(fixture()),
      tab = new WorkspaceDatabase(db.name);
    await tab.open();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return digest(...args);
    });
    try {
      const pending = archive(original);
      await started;
      const edit = copy(original);
      edit.nodes[0].title = 'Changed during hash';
      await new Repository(tab).saveGraph(edit, original.diagram.version);
      release();
      await expect(pending).rejects.toMatchObject({ status: 409 });
      expect(await db.historySnapshots.count()).toBe(0);
      expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Changed during hash');
    } finally {
      release();
      spy.mockRestore();
      tab.close();
    }
  });
  it('rolls back the safety checkpoint when the graph saver fails', async () => {
    const original = await repo.importGraph(fixture()),
      snapshot = await archive(original);
    const edit = copy(original);
    edit.nodes[0].title = 'Keep this work';
    const current = await repo.saveGraph(edit, original.diagram.version);
    const failing = new HistoryStore(db, async () => {
      throw new Error('Write failed');
    });
    await expect(
      failing.restore(original.diagram.id, snapshot.id, { baseVersion: current.diagram.version }),
    ).rejects.toThrow('Write failed');
    expect(await db.historySnapshots.count()).toBe(1);
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Keep this work');
  });
  it('fails explicitly at capacity without evicting named snapshots or replacing current work', async () => {
    const original = await repo.importGraph(fixture()),
      snapshot = await archive(original),
      bounded = new HistoryStore(db, (graph, version) => repo.saveGraph(graph, version), {
        ...historyLimits,
        snapshotsPerDiagram: 1,
      });
    await expect(
      bounded.restore(original.diagram.id, snapshot.id, { baseVersion: original.diagram.version }),
    ).rejects.toMatchObject({ status: 413 });
    expect(await db.historySnapshots.count()).toBe(1);
    expect((await repo.getGraph(original.diagram.id)).diagram.version).toBe(
      original.diagram.version,
    );
    const tiny = new HistoryStore(db, undefined, { ...historyLimits, graphBytes: 64 });
    await expect(
      tiny.create(original.diagram.id, {
        name: 'Too large',
        baseVersion: original.diagram.version,
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(await db.historyContents.count()).toBe(1);
  });
  it('collects shared archived rows/content only after their last snapshot is removed', async () => {
    const original = await repo.importGraph(fixture(true)),
      a = await archive(original, 'A'),
      b = await archive(original, 'B');
    await history.remove(original.diagram.id, a.id);
    expect(await db.historyRows.count()).toBe(1);
    expect(await db.historyContents.count()).toBe(1);
    await history.remove(original.diagram.id, b.id);
    for (const table of [
      db.historySnapshots,
      db.historyContents,
      db.historySources,
      db.historyRows,
    ])
      expect(await table.count()).toBe(0);
    expect((await repo.getGraph(original.diagram.id)).nodes.length).toBe(2);
  });
  it('checks diagram ownership and returns the current version with comparisons', async () => {
    const first = await repo.importGraph(fixture()),
      second = await repo.importGraph(fixture()),
      snapshot = await archive(first);
    await expect(history.read(second.diagram.id, snapshot.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(history.remove(second.diagram.id, snapshot.id)).rejects.toMatchObject({
      status: 404,
    });
    const comparison = await history.compare(first.diagram.id, snapshot.id);
    expect(comparison.currentVersion).toBe(first.diagram.version);
    expect(comparison.totalChanges).toBe(0);
  });
});
describe('portable history backups', () => {
  it('remaps historical-only IDs, scenes, numbering, app decision keys and shared CSV rows consistently', async () => {
    let graph = fixture(true);
    graph = setPresentation(graph, {
      version: 1,
      nodeIds: graph.nodes.map((node) => node.id),
      secondsPerNode: 8,
      transitionMs: 1200,
    });
    graph = setStoryboard(graph, {
      version: 1,
      scenes: [
        {
          id: crypto.randomUUID(),
          name: 'Before',
          nodeIds: graph.nodes.map((node) => node.id),
          edgeIds: graph.edges.map((edge) => edge.id),
          narration: 'A lifecycle',
          seconds: 8,
          transitionMs: 1200,
        },
      ],
    });
    graph = setBuildSpecification(graph, {
      version: 1,
      sections: { screens: 'Truck app' },
      answers: {
        [`entity:${graph.nodes[1].id}`]: 'A record',
        [`relation:${graph.edges[0].id}`]: 'Confirmed',
        [`csv:${graph.dataset!.id}`]: 'Truck ID',
        audience: 'Drivers',
      },
    });
    const original = await repo.importGraph(graph);
    await archive(original);
    const edit = copy(original);
    edit.nodes = [edit.nodes[0]];
    edit.edges = [];
    edit.diagram.settings.presentation = undefined;
    edit.diagram.settings.storyboard = undefined;
    const current = await repo.saveGraph(edit, original.diagram.version);
    await archive(current, 'After');
    const backup = await db.backup(),
      imported = await repo.importGraph(current);
    await db.transaction('rw', db.tables, () =>
      importHistoryBackup(db, backup.history, backup.datasets!, [
        { sourceGraph: current, importedGraph: imported },
      ]),
    );
    const snapshots = await history.list(imported.diagram.id);
    const before = (
        await history.read(
          imported.diagram.id,
          snapshots.find((item) => item.name === 'Baseline')!.id,
        )
      ).graph,
      after = (
        await history.read(imported.diagram.id, snapshots.find((item) => item.name === 'After')!.id)
      ).graph;
    expect(before.nodes[0].id).toBe(imported.nodes[0].id);
    expect(before.nodes[1].id).not.toBe(original.nodes[1].id);
    expect(after.nodes[0].id).toBe(before.nodes[0].id);
    expect(before.edges[0].sourceNodeId).toBe(before.nodes[0].id);
    expect(before.edges[0].targetNodeId).toBe(before.nodes[1].id);
    expect(before.diagram.settings.presentation!.nodeIds).toEqual(
      before.nodes.map((node) => node.id),
    );
    expect(getStoryboard(before).scenes[0].nodeIds).toEqual(before.nodes.map((node) => node.id));
    expect(getStoryboard(before).scenes[0].edgeIds).toEqual([before.edges[0].id]);
    const draft = getBuildSpecification(before);
    expect(draft.answers[`entity:${before.nodes[1].id}`]).toBe('A record');
    expect(draft.answers[`relation:${before.edges[0].id}`]).toBe('Confirmed');
    expect(draft.answers[`csv:${before.dataset!.id}`]).toBe('Truck ID');
    expect(draft.answers.audience).toBe('Drivers');
    expect(await db.historyRows.where('diagramId').equals(imported.diagram.id).count()).toBe(1);
  });
  it('round trips history through the repository workspace merge and replacement paths', async () => {
    const original = await repo.importGraph(fixture(true));
    await archive(original);
    const edit = copy(original);
    edit.nodes[0].title = 'Present';
    edit.dataset!.rows[0][1] = '20';
    const current = await repo.saveGraph(edit, original.diagram.version);
    await archive(current, 'After');
    const backup = await db.backup(),
      merged = (await repo.restore(backup, 'merge'))[0];
    expect(merged.diagram.id).not.toBe(original.diagram.id);
    const restoredSnapshot = (await history.list(merged.diagram.id)).find(
      (item) => item.name === 'Baseline',
    )!;
    const historic = (await history.read(merged.diagram.id, restoredSnapshot.id)).graph;
    expect(historic.nodes[0].id).toBe(merged.nodes[0].id);
    expect(historic.nodes[0].title).toBe('Build');
    expect(historic.dataset!.id).toBe(merged.dataset!.id);
    expect(historic.dataset!.rows[0][1]).toBe('1');
    const replaced = (await repo.restore(backup, 'replace'))[0];
    expect(replaced.diagram.id).toBe(original.diagram.id);
    expect(await db.diagrams.count()).toBe(1);
    expect((await history.list(replaced.diagram.id)).map((item) => item.name).sort()).toEqual([
      'After',
      'Baseline',
    ]);
    expect(await db.historyRows.count()).toBe(2);
  });
  it('rejects forged cross-diagram references and tampered content atomically', async () => {
    const original = await repo.importGraph(fixture(true));
    await archive(original);
    const backup = await db.backup(),
      fresh = new WorkspaceDatabase(`history-import-${crypto.randomUUID()}`);
    databases.push(fresh);
    await fresh.initialize();
    const freshRepo = new Repository(fresh),
      forged = structuredClone(backup.history!);
    forged.rows[0].diagramId = crypto.randomUUID();
    await expect(
      fresh.transaction('rw', fresh.tables, async () => {
        const imported = await freshRepo.importGraph(original);
        await importHistoryBackup(fresh, forged, backup.datasets!, [
          { sourceGraph: original, importedGraph: imported },
        ]);
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await fresh.diagrams.count()).toBe(0);
    expect(await fresh.historyRows.count()).toBe(0);
    const tampered = structuredClone(backup.history!);
    tampered.contents[0].graph.nodes[0].title = 'Forged title';
    await expect(
      fresh.transaction('rw', fresh.tables, () =>
        importHistoryBackup(fresh, tampered, backup.datasets!, [
          { sourceGraph: original, importedGraph: original },
        ]),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await fresh.historySnapshots.count()).toBe(0);
  });
  it('rejects malformed headers and unaccounted archive payload before allocating row-shaped arrays', async () => {
    const original = await repo.importGraph(fixture(true));
    await archive(original);
    const backup = await db.backup();
    for (const mutate of [
      (value: typeof backup.history) => {
        value!.sources[0].dataset.columns = { length: 1_000_000_000 } as unknown as NonNullable<
          typeof original.dataset
        >['columns'];
      },
      (value: typeof backup.history) => {
        Object.assign(value!.rows[0], { hiddenPayload: 'unaccounted' });
      },
      (value: typeof backup.history) => {
        value!.sources[0].dataset = null as unknown as NonNullable<
          typeof backup.history
        >['sources'][number]['dataset'];
      },
      (value: typeof backup.history) => {
        value!.rows[0].rows = null as unknown as string[][];
        delete value!.rows[0].datasetRef;
      },
    ]) {
      const malformed = structuredClone(backup.history);
      mutate(malformed);
      await expect(
        db.transaction('rw', db.tables, () =>
          importHistoryBackup(db, malformed, backup.datasets!, [
            { sourceGraph: original, importedGraph: original },
          ]),
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(await db.historySnapshots.count()).toBe(1);
  });
  it('preserves historical-only IDs when a backup replaces an empty workspace', async () => {
    const original = await repo.importGraph(fixture());
    await archive(original);
    const edit = copy(original);
    edit.nodes = [edit.nodes[0]];
    edit.edges = [];
    const current = await repo.saveGraph(edit, original.diagram.version),
      backup = await db.backup(),
      fresh = new WorkspaceDatabase(`history-replace-${crypto.randomUUID()}`);
    databases.push(fresh);
    await fresh.initialize();
    const freshRepo = new Repository(fresh),
      imported = await freshRepo.importGraph(current);
    await fresh.transaction('rw', fresh.tables, () =>
      importHistoryBackup(fresh, backup.history, backup.datasets!, [
        { sourceGraph: current, importedGraph: imported },
      ]),
    );
    const snapshot = (await freshRepo.history.list(imported.diagram.id))[0];
    expect(
      (await freshRepo.history.read(imported.diagram.id, snapshot.id)).graph.nodes.map(
        (node) => node.id,
      ),
    ).toEqual(original.nodes.map((node) => node.id));
  });
});
