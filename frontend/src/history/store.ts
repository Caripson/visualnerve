import { StorageError, validateGraph } from '../model/validation';
import type { Graph } from '../model/types';
import type { CsvDataset } from '../data/types';
import { graphDatasets } from '../data/model';
import type { WorkspaceDatabase } from '../storage/database';
import { asWorkspaceStorage } from '../storage/adapter';
import { type WorkspaceStorage } from '../storage/contracts';
import { historyDigest, historyGraph, historyJsonBytes, historyStorageFailure } from './codec';
import { compareHistoryGraphs } from './compare';
import {
  historyLimits,
  type HistoryLimits,
  type HistoryKind,
  type HistorySnapshot,
  type HistoryRestoreResult,
  type HistoryComparison,
} from './types';

const rowsCache = new WeakMap<CsvDataset['rows'], Promise<{ digest: string; bytes: number }>>();
async function rowContent(rows: CsvDataset['rows'], limit: number) {
  let pending = rowsCache.get(rows);
  if (!pending) {
    const bytes = historyJsonBytes(rows, limit);
    pending = historyDigest(rows).then((digest) => ({ digest, bytes }));
    if (Object.isFrozen(rows)) {
      rowsCache.set(rows, pending);
      pending.catch(() => rowsCache.delete(rows));
    }
  }
  const value = await pending;
  if (value.bytes > limit) throw new StorageError(413, 'This source exceeds the history capacity.');
  return value;
}
export const historyStoreNames = [
  'historySnapshots',
  'historyContents',
  'historySources',
  'historyRows',
] as const;
const historyGraphStoreNames = [
  'diagrams',
  'nodes',
  'edges',
  'owners',
  'datasets',
  'simulationModels',
  ...historyStoreNames,
] as const;
export const historyTables = (input: WorkspaceStorage | WorkspaceDatabase) => {
  const db = asWorkspaceStorage(input);
  return [db.historySnapshots, db.historyContents, db.historySources, db.historyRows] as const;
};
function version(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1)
    throw new StorageError(422, 'History requires a positive baseVersion.');
  if (actual !== expected)
    throw new StorageError(
      409,
      'Another tab changed this diagram. Review its current version before continuing.',
    );
}
export class HistoryStore {
  public db: WorkspaceStorage;
  constructor(
    input: WorkspaceStorage | WorkspaceDatabase,
    private saveGraph?: (
      graph: Graph,
      baseVersion: number,
      scope: WorkspaceStorage,
    ) => Promise<Graph>,
    public limits: HistoryLimits = historyLimits,
  ) {
    this.db = asWorkspaceStorage(input);
  }
  private scoped(scope: WorkspaceStorage) {
    return new HistoryStore(scope, this.saveGraph, this.limits);
  }
  private async withOperation<T>(work: (db: WorkspaceStorage) => Promise<T>): Promise<T> {
    if (this.db.inTransaction) return work(this.db);
    const operation = await this.db.captureOperation();
    try {
      const result = await work(operation.storage);
      await operation.check();
      return result;
    } catch (error) {
      await operation.check();
      throw error;
    } finally {
      operation.dispose();
    }
  }
  current(diagramId: string): Promise<Graph> {
    return this.db.graph(diagramId).then((graph) => {
      if (!graph) throw new StorageError(404, 'Diagram does not exist.');
      return graph;
    });
  }
  async list(diagramId: string) {
    return this.db.atomic('r', ['diagrams', 'historySnapshots'], async (scope) => {
      if (!(await scope.diagrams.get(diagramId)))
        throw new StorageError(404, 'Diagram does not exist.');
      const entries = await scope.historySnapshots.where('diagramId').equals(diagramId).toArray();
      return entries.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
    });
  }
  private async prepared(graph: Graph) {
    const content = historyGraph(graph);
    const bytes = historyJsonBytes(content, this.limits.graphBytes);
    const digest = await historyDigest(content);
    const sources: Array<{
      dataset: CsvDataset;
      header: Omit<CsvDataset, 'rows'>;
      headerBytes: number;
      digest: string;
      bytes: number;
    }> = [];
    for (const dataset of graphDatasets(graph)) {
      const { rows, ...header } = dataset;
      const data = await rowContent(rows, this.limits.bytes);
      sources.push({
        dataset,
        header,
        headerBytes: historyJsonBytes(header, this.limits.bytes),
        ...data,
      });
    }
    return { graph, content, bytes, digest, sources };
  }
  async create(
    diagramId: string,
    options: {
      name: string;
      baseVersion: number;
      kind?: HistoryKind;
      beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
    },
  ): Promise<HistorySnapshot> {
    return this.withOperation(async (db) => {
      const store = this.scoped(db);
      const graph = await store.current(diagramId);
      version(graph.diagram.version, options.baseVersion);
      // Legacy readers must not hold the native write lock while hashing: a
      // concurrent tab can finish its save, and the final version check wins.
      const prepared = await store.prepared(graph);
      return db.atomic(
        'rw',
        ['diagrams', ...historyStoreNames, ...(options.beforeWrite ? ['settings' as const] : [])],
        async (scope) => {
          await options.beforeWrite?.(scope);
          const diagram = await scope.diagrams.get(diagramId);
          if (!diagram) throw new StorageError(404, 'Diagram does not exist.');
          version(diagram.version, options.baseVersion);
          return this.scoped(scope).insert(prepared, options.name, options.kind ?? 'named');
        },
      );
    }).catch(historyStorageFailure);
  }
  private async insert(
    prepared: Awaited<ReturnType<HistoryStore['prepared']>>,
    name: string,
    kind: HistoryKind,
  ): Promise<HistorySnapshot> {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 200 ||
      !['named', 'source-refresh', 'pre-restore'].includes(kind)
    )
      throw new StorageError(
        422,
        'Choose a snapshot name of 1–200 characters and a supported kind.',
      );
    const { graph, content, bytes, digest, sources } = prepared;
    const diagramId = graph.diagram.id;
    if (
      (await this.db.historySnapshots.count()) >= this.limits.snapshots ||
      (await this.db.historySnapshots.where('diagramId').equals(diagramId).count()) >=
        this.limits.snapshotsPerDiagram
    )
      throw new StorageError(
        413,
        'History snapshot limit reached. Delete a snapshot before continuing; nothing was replaced.',
      );
    const contentId = `${diagramId}:${digest}`;
    const oldContent = await this.db.historyContents.get(contentId);
    let extra = oldContent ? 0 : bytes;
    const newRows = new Map<string, (typeof sources)[number]>();
    const newSources = new Map<string, (typeof sources)[number]>();
    const sourceIds: string[] = [];
    for (const source of sources) {
      const existing = await this.db.historySources
        .where('[diagramId+datasetId+datasetVersion]')
        .equals([diagramId, source.dataset.id, source.dataset.version])
        .first();
      if (existing) {
        sourceIds.push(existing.id);
        continue;
      }
      const sourceKey = `${source.dataset.id}:${source.dataset.version}`;
      newSources.set(sourceKey, source);
      extra += source.headerBytes;
      const rowId = `${diagramId}:${source.digest}`;
      if (!newRows.has(rowId) && !(await this.db.historyRows.where('id').equals(rowId).count())) {
        newRows.set(rowId, source);
        extra += source.bytes;
      }
    }
    const stored = (
      await Promise.all([
        this.db.historyContents.metadata('bytes'),
        this.db.historySources.metadata('bytes'),
        this.db.historyRows.metadata('bytes'),
      ])
    )
      .flat()
      .reduce<number>((sum, entry) => sum + Number(entry.value), 0);
    if (stored + extra > this.limits.bytes)
      throw new StorageError(
        413,
        'History storage capacity reached. Delete snapshots before continuing; current work is unchanged.',
      );
    if (!oldContent)
      await this.db.historyContents.add({
        id: contentId,
        diagramId,
        digest,
        bytes,
        graph: content,
      });
    for (const [id, source] of newRows)
      await this.db.historyRows.add({
        id,
        diagramId,
        digest: source.digest,
        bytes: source.bytes,
        rows: source.dataset.rows,
      });
    for (const source of newSources.values()) {
      const id = crypto.randomUUID();
      sourceIds.push(id);
      await this.db.historySources.add({
        id,
        diagramId,
        datasetId: source.dataset.id,
        datasetVersion: source.dataset.version,
        rowId: `${diagramId}:${source.digest}`,
        bytes: source.headerBytes,
        dataset: source.header,
      });
    }
    // Preserve source order even when only some revisions needed a new archive.
    const ordered = await Promise.all(
      sources.map((source) =>
        this.db.historySources
          .where('[diagramId+datasetId+datasetVersion]')
          .equals([diagramId, source.dataset.id, source.dataset.version])
          .first(),
      ),
    );
    const snapshot: HistorySnapshot = {
      id: crypto.randomUUID(),
      diagramId,
      name: name.trim(),
      kind,
      createdAt: new Date().toISOString(),
      graphVersion: graph.diagram.version,
      contentId,
      sourceIds: ordered.map((source) => source!.id),
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      rows: sources.reduce((sum, source) => sum + source.dataset.rows.length, 0),
    };
    await this.db.historySnapshots.add(snapshot);
    return snapshot;
  }
  async read(diagramId: string, id: string): Promise<{ snapshot: HistorySnapshot; graph: Graph }> {
    return this.db.atomic('r', historyStoreNames, (scope) =>
      this.scoped(scope).readScoped(diagramId, id),
    );
  }
  private async readScoped(
    diagramId: string,
    id: string,
  ): Promise<{ snapshot: HistorySnapshot; graph: Graph }> {
    const snapshot = await this.db.historySnapshots.get(id);
    if (!snapshot || snapshot.diagramId !== diagramId)
      throw new StorageError(404, 'Snapshot does not exist in this diagram.');
    const content = await this.db.historyContents.get(snapshot.contentId);
    if (!content || content.diagramId !== diagramId)
      throw new StorageError(422, 'Snapshot content is missing.');
    const sources: CsvDataset[] = [];
    for (const id of snapshot.sourceIds) {
      const source = await this.db.historySources.get(id);
      const rows = source ? await this.db.historyRows.get(source.rowId) : undefined;
      if (!source || !rows || source.diagramId !== diagramId || rows.diagramId !== diagramId)
        throw new StorageError(422, 'Snapshot source content is missing.');
      sources.push({ ...source.dataset, rows: rows.rows });
    }
    const graph: Graph = {
      ...content.graph,
      ...(sources.length ? { dataset: sources[0], datasets: sources.slice(1) } : { datasets: [] }),
    };
    validateGraph(graph, sources);
    return { snapshot, graph };
  }
  async compare(diagramId: string, id: string, to: string = 'current'): Promise<HistoryComparison> {
    return this.db.atomic('r', historyGraphStoreNames, async (scope) => {
      const store = this.scoped(scope);
      const current = await store.current(diagramId);
      const before = await store.readScoped(diagramId, id);
      const after = to === 'current' ? current : (await store.readScoped(diagramId, to)).graph;
      return compareHistoryGraphs(before.graph, after, {
        fromSnapshotId: id,
        toSnapshotId: to,
        currentVersion: current.diagram.version,
      });
    });
  }
  async restore(
    diagramId: string,
    id: string,
    options: { baseVersion: number; beforeWrite?: (scope: WorkspaceStorage) => Promise<void> },
  ): Promise<HistoryRestoreResult> {
    if (!this.saveGraph) throw new StorageError(500, 'History restore requires a graph saver.');
    return this.withOperation(async (db) => {
      const baseline = await this.scoped(db).current(diagramId);
      version(baseline.diagram.version, options.baseVersion);
      const prepared = await this.scoped(db).prepared(baseline);
      return db.atomic(
        'rw',
        [...historyGraphStoreNames, ...(options.beforeWrite ? ['settings' as const] : [])],
        async (scope) => {
          const store = this.scoped(scope);
          const current = await store.current(diagramId);
          version(current.diagram.version, options.baseVersion);
          await options.beforeWrite?.(scope);
          const target = await store.readScoped(diagramId, id);
          const safetySnapshot = await store.insert(
            prepared,
            `Before restoring ${target.snapshot.name}`.slice(0, 200),
            'pre-restore',
          );
          const currentNodes = new Set(current.nodes.map((node) => node.id)),
            currentEdges = new Set(current.edges.map((edge) => edge.id));
          const currentSources = new Set(graphDatasets(current).map((source) => source.id));
          const archivedSources = await scope.historySources
            .where('diagramId')
            .equals(diagramId)
            .toArray();
          const datasets = graphDatasets(target.graph).map((source) => {
            if (currentSources.has(source.id)) return source;
            const latest = archivedSources
              .filter((archive) => archive.datasetId === source.id)
              .reduce((max, archive) => Math.max(max, archive.datasetVersion), source.version);
            return { ...source, version: Math.max(latest, current.diagram.version) + 1 };
          });
          const restored: Graph = {
            ...target.graph,
            dataset: datasets[0],
            datasets: datasets.slice(1),
            nodes: target.graph.nodes.map((node) =>
              currentNodes.has(node.id)
                ? node
                : { ...node, version: Math.max(node.version, current.diagram.version) + 1 },
            ),
            edges: target.graph.edges.map((edge) =>
              currentEdges.has(edge.id)
                ? edge
                : { ...edge, version: Math.max(edge.version, current.diagram.version) + 1 },
            ),
          };
          const graph = await this.saveGraph!(
            {
              ...restored,
              diagram: {
                ...target.graph.diagram,
                version: current.diagram.version,
                createdAt: current.diagram.createdAt,
              },
            },
            current.diagram.version,
            scope,
          );
          return { graph, safetySnapshot };
        },
      );
    }).catch(historyStorageFailure);
  }
  async remove(
    diagramId: string,
    id: string,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ) {
    await this.db.atomic(
      'rw',
      [...historyStoreNames, ...(beforeWrite ? ['settings' as const] : [])],
      async (scope) => {
        const snapshot = await scope.historySnapshots.get(id);
        if (!snapshot || snapshot.diagramId !== diagramId)
          throw new StorageError(404, 'Snapshot does not exist in this diagram.');
        await beforeWrite?.(scope);
        await scope.historySnapshots.delete(id);
        if (!(await scope.historySnapshots.where('contentId').equals(snapshot.contentId).count()))
          await scope.historyContents.delete(snapshot.contentId);
        for (const id of snapshot.sourceIds)
          if (!(await scope.historySnapshots.where('sourceIds').equals(id).count())) {
            const source = await scope.historySources.get(id);
            await scope.historySources.delete(id);
            if (source && !(await scope.historySources.where('rowId').equals(source.rowId).count()))
              await scope.historyRows.delete(source.rowId);
          }
      },
    );
  }
  async removeDiagram(diagramId: string) {
    await this.db.atomic('rw', historyStoreNames, async (scope) => {
      for (const name of historyStoreNames)
        await scope[name].where('diagramId').equals(diagramId).delete();
    });
  }
}
