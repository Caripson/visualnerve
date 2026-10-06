import Dexie from 'dexie';
import type { CsvDataset } from '../data/types';
import { csvLimits, validateDataset } from '../data/csv';
import { dataModelLimits, graphDatasets, remapDataModelSources } from '../data/model';
import { remapAnalysisReferences } from '../analysis/views';
import { remapPresentation } from '../presentation/definition';
import { getStoryboard, setStoryboard } from '../presentation/storyboard';
import { remapBuildSpecification } from '../export/build-specification';
import { StorageError, validateGraph } from '../model/validation';
import type { Graph } from '../model/types';
import type { WorkspaceDatabase } from '../storage/database';
import { historyDigest, historyJsonBytes, historyGraph, historyStorageFailure } from './codec';
import { historyLimits, type HistoryBackup, type HistoryRows, type HistorySource } from './types';

export async function exportHistoryBackup(
  db: WorkspaceDatabase,
  datasets: CsvDataset[],
): Promise<HistoryBackup | undefined> {
  const snapshots = await db.historySnapshots.toArray();
  if (!snapshots.length) return;
  const contents = await db.historyContents.toArray();
  const sources = await db.historySources.toArray();
  const active = new Map(
    datasets.map((source) => [`${source.diagramId}:${source.id}:${source.version}`, source]),
  );
  const references = new Map(
    sources.flatMap((source) => {
      const dataset = active.get(
        `${source.diagramId}:${source.datasetId}:${source.datasetVersion}`,
      );
      return dataset ? [[source.rowId, { id: dataset.id, version: dataset.version }] as const] : [];
    }),
  );
  const metadata: { id: string; bytes: number }[] = [];
  // The index avoids loading a second large row array when it already exists in datasets.
  await db.historyRows.orderBy('bytes').eachKey((bytes, cursor) => {
    metadata.push({ id: String(cursor.primaryKey), bytes: Number(bytes) });
  });
  const rows = await Promise.all(
    metadata.map(async ({ id, bytes }) => {
      const datasetRef = references.get(id);
      const [diagramId, digest] = id.split(':');
      return datasetRef
        ? { id, diagramId, digest, bytes, datasetRef }
        : (await db.historyRows.get(id))!;
    }),
  );
  return { version: 1, snapshots, contents, sources, rows };
}
export interface HistoryImportMapping {
  sourceGraph: Graph;
  importedGraph: Graph;
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const bad = () => {
  throw new StorageError(422, 'Invalid workspace history content or references.');
};
const record = (value: unknown, keys: string[]) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const invalidDataset = (value: CsvDataset) => {
  try {
    validateDataset(value);
  } catch (error) {
    throw new StorageError(422, (error as Error).message);
  }
};
export async function importHistoryBackup(
  db: WorkspaceDatabase,
  history: HistoryBackup | undefined,
  datasets: CsvDataset[],
  mappings: HistoryImportMapping[],
  existingOwnerIds: Map<string, string> = new Map(),
): Promise<void> {
  return importHistoryBackupData(db, history, datasets, mappings, existingOwnerIds).catch(
    historyStorageFailure,
  );
}
async function importHistoryBackupData(
  db: WorkspaceDatabase,
  history: HistoryBackup | undefined,
  datasets: CsvDataset[],
  mappings: HistoryImportMapping[],
  existingOwnerIds: Map<string, string>,
): Promise<void> {
  if (history === undefined) return;
  if (
    !history ||
    !record(history, ['version', 'snapshots', 'contents', 'sources', 'rows']) ||
    history.version !== 1 ||
    ![history.snapshots, history.contents, history.sources, history.rows].every(Array.isArray) ||
    history.snapshots.length > historyLimits.snapshots ||
    history.contents.length > historyLimits.snapshots ||
    history.sources.length > 10000 ||
    history.rows.length > 10000
  )
    bad();
  const unique = <T extends { id: string }>(items: T[], keys: string[]) => {
    if (
      items.some((item) => !record(item, keys) || typeof item.id !== 'string') ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      bad();
    return new Map(items.map((item) => [item.id, item]));
  };
  const contents = unique(history.contents, ['id', 'diagramId', 'digest', 'bytes', 'graph']),
    sources = unique(history.sources, [
      'id',
      'diagramId',
      'datasetId',
      'datasetVersion',
      'rowId',
      'bytes',
      'dataset',
    ]),
    rows = unique(history.rows, ['id', 'diagramId', 'digest', 'bytes', 'rows', 'datasetRef']);
  unique(history.snapshots, [
    'id',
    'diagramId',
    'name',
    'kind',
    'createdAt',
    'graphVersion',
    'contentId',
    'sourceIds',
    'nodes',
    'edges',
    'rows',
  ]);
  const byDiagram = new Map(mappings.map((item) => [item.sourceGraph.diagram.id, item]));
  const rawRows = new Map<string, HistoryRows>();
  const active = new Map(datasets.map((source) => [source.id, source]));
  const previousBytes = (
    await Promise.all([
      db.historyContents.orderBy('bytes').keys(),
      db.historySources.orderBy('bytes').keys(),
      db.historyRows.orderBy('bytes').keys(),
    ])
  )
    .flat()
    .reduce<number>((sum, value) => sum + Number(value), 0);
  let payloadBytes = 0;
  const capacity = (bytes: number) => {
    payloadBytes += bytes;
    if (payloadBytes + previousBytes > historyLimits.bytes)
      throw new StorageError(
        413,
        'Imported history exceeds the workspace history capacity. Nothing was restored.',
      );
  };
  if (history.snapshots.length + (await db.historySnapshots.count()) > historyLimits.snapshots)
    throw new StorageError(
      413,
      'Imported history exceeds the workspace snapshot limit. Nothing was restored.',
    );
  for (const row of rows.values()) {
    if (
      !byDiagram.has(row.diagramId) ||
      !/^[a-f0-9]{64}$/.test(row.digest) ||
      row.id !== `${row.diagramId}:${row.digest}` ||
      (row.rows !== undefined) === (row.datasetRef !== undefined)
    )
      bad();
    if (row.datasetRef !== undefined && !record(row.datasetRef, ['id', 'version'])) bad();
    const ref = row.datasetRef && active.get(row.datasetRef.id);
    if (
      row.datasetRef &&
      (!ref || ref.version !== row.datasetRef.version || ref.diagramId !== row.diagramId)
    )
      bad();
    const values = row.rows !== undefined ? row.rows : ref!.rows;
    if (!Array.isArray(values) || !values.length || values.length > csvLimits.rows) bad();
    let cells = 0;
    for (const value of values) {
      if (
        !Array.isArray(value) ||
        value.length > csvLimits.columns ||
        value.some((cell) => typeof cell !== 'string')
      )
        bad();
      cells += value.length;
      if (cells > csvLimits.cells) bad();
    }
    const bytes = historyJsonBytes(values, historyLimits.bytes);
    capacity(bytes);
    if (bytes !== row.bytes || (await Dexie.waitFor(historyDigest(values))) !== row.digest) bad();
    rawRows.set(row.id, {
      id: row.id,
      diagramId: row.diagramId,
      digest: row.digest,
      bytes,
      rows: values,
    });
  }
  const data = new Map<string, CsvDataset>();
  const checked = new Set<string>();
  const sourceKeys = new Set<string>();
  for (const source of sources.values()) {
    const row = rawRows.get(source.rowId);
    if (
      !uuid.test(source.id) ||
      !row ||
      row.diagramId !== source.diagramId ||
      source.dataset?.diagramId !== source.diagramId ||
      source.dataset.id !== source.datasetId ||
      source.dataset.version !== source.datasetVersion ||
      'rows' in source.dataset ||
      historyJsonBytes(source.dataset, historyLimits.bytes) !== source.bytes
    )
      bad();
    const key = `${source.diagramId}:${source.datasetId}:${source.datasetVersion}`;
    if (sourceKeys.has(key)) bad();
    sourceKeys.add(key);
    const value: CsvDataset = { ...source.dataset, rows: row!.rows };
    if (
      !Array.isArray(value.columns) ||
      !value.columns.length ||
      value.columns.length > csvLimits.columns
    )
      bad();
    capacity(source.bytes);
    // Validate headers for every version, and shared raw cell/column shapes once.
    invalidDataset({
      ...value,
      rows: [Array.from({ length: value.columns?.length ?? 0 }, () => '')],
    });
    const shape = `${source.rowId}:${JSON.stringify(value.columns)}`;
    if (!checked.has(shape)) {
      invalidDataset(value);
      checked.add(shape);
    }
    data.set(source.id, value);
  }
  for (const item of contents.values()) {
    const bytes = historyJsonBytes(item.graph, historyLimits.graphBytes);
    capacity(bytes);
    if (
      !byDiagram.has(item.diagramId) ||
      item.graph?.diagram?.id !== item.diagramId ||
      item.id !== `${item.diagramId}:${item.digest}` ||
      !/^[a-f0-9]{64}$/.test(item.digest) ||
      bytes !== item.bytes ||
      (await Dexie.waitFor(historyDigest(item.graph))) !== item.digest ||
      'dataset' in item.graph ||
      'datasets' in item.graph
    )
      bad();
  }
  const referenced = {
    contents: new Set<string>(),
    sources: new Set<string>(),
    rows: new Set<string>(),
  };
  const counts = new Map<string, number>();
  for (const snapshot of history.snapshots) {
    const item = contents.get(snapshot.contentId);
    if (
      !uuid.test(snapshot.id) ||
      !byDiagram.has(snapshot.diagramId) ||
      item?.diagramId !== snapshot.diagramId ||
      typeof snapshot.name !== 'string' ||
      !snapshot.name.trim() ||
      snapshot.name.length > 200 ||
      !['named', 'source-refresh', 'pre-restore'].includes(snapshot.kind) ||
      !Number.isFinite(Date.parse(snapshot.createdAt)) ||
      !Number.isSafeInteger(snapshot.graphVersion) ||
      snapshot.graphVersion < 1 ||
      !Array.isArray(snapshot.sourceIds) ||
      snapshot.sourceIds.length > dataModelLimits.sources ||
      new Set(snapshot.sourceIds).size !== snapshot.sourceIds.length
    )
      bad();
    const sourceRecords = snapshot.sourceIds.map((id) => sources.get(id));
    if (sourceRecords.some((source) => !source || source.diagramId !== snapshot.diagramId)) bad();
    const datasetValues = snapshot.sourceIds.map((id) => data.get(id)!);
    const graph: Graph = {
      ...item!.graph,
      dataset: datasetValues[0],
      datasets: datasetValues.slice(1),
    };
    validateGraph(graph, datasetValues);
    if (
      graph.nodes.length !== snapshot.nodes ||
      graph.edges.length !== snapshot.edges ||
      datasetValues.reduce((sum, source) => sum + source.rows.length, 0) !== snapshot.rows ||
      item!.graph.diagram.version !== snapshot.graphVersion
    )
      bad();
    const count = (counts.get(snapshot.diagramId) ?? 0) + 1;
    if (count > historyLimits.snapshotsPerDiagram) bad();
    counts.set(snapshot.diagramId, count);
    referenced.contents.add(item!.id);
    for (const source of sourceRecords) {
      referenced.sources.add(source!.id);
      referenced.rows.add(source!.rowId);
    }
  }
  if (
    referenced.contents.size !== contents.size ||
    referenced.sources.size !== sources.size ||
    referenced.rows.size !== rows.size
  )
    bad();
  for (const mapping of mappings) {
    const oldId = mapping.sourceGraph.diagram.id,
      diagramId = mapping.importedGraph.diagram.id;
    const snapshots = history.snapshots.filter((item) => item.diagramId === oldId);
    if (!snapshots.length) continue;
    if (
      snapshots.length + (await db.historySnapshots.where('diagramId').equals(diagramId).count()) >
      historyLimits.snapshotsPerDiagram
    )
      throw new StorageError(
        413,
        'Imported history exceeds the diagram snapshot limit. Nothing was restored.',
      );
    const nodes = new Map(
      mapping.sourceGraph.nodes.map((node, index) => [
        node.id,
        mapping.importedGraph.nodes[index]?.id,
      ]),
    );
    const edges = new Map(
      mapping.sourceGraph.edges.map((edge, index) => [
        edge.id,
        mapping.importedGraph.edges[index]?.id,
      ]),
    );
    const sourceIds = new Map(
      graphDatasets(mapping.sourceGraph).map((source, index) => [
        source.id,
        graphDatasets(mapping.importedGraph)[index]?.id,
      ]),
    );
    const owners = new Map(existingOwnerIds);
    mapping.sourceGraph.nodes.forEach((node, index) =>
      node.ownerIds.forEach((id, owner) => {
        const next = mapping.importedGraph.nodes[index]?.ownerIds[owner];
        if (next) owners.set(id, next);
      }),
    );
    const sameDiagram = oldId === diagramId;
    const reserved = new Set<string>();
    for (const table of [db.nodes, db.edges, db.datasets])
      for (const id of await table.where('diagramId').notEqual(diagramId).primaryKeys())
        reserved.add(String(id));
    const identity = (ids: Map<string, string | undefined>, id: string) => {
      let value = ids.get(id);
      if (!value) {
        value = sameDiagram && !reserved.has(id) ? id : crypto.randomUUID();
        ids.set(id, value);
      }
      return value;
    };
    const scenes = new Map<string, string | undefined>(
      getStoryboard(mapping.sourceGraph).scenes.map((scene, index) => [
        scene.id,
        getStoryboard(mapping.importedGraph).scenes[index]?.id,
      ]),
    );
    const storedRows = new Set<string>();
    const sourceArchiveIds = new Map<string, string>();
    for (const source of sources.values())
      if (source.diagramId === oldId) {
        const datasetId = identity(sourceIds, source.datasetId);
        const row = rawRows.get(source.rowId)!;
        const rowId = `${diagramId}:${row.digest}`;
        if (!storedRows.has(rowId)) {
          await db.historyRows.put({ ...row, id: rowId, diagramId });
          storedRows.add(rowId);
        }
        const dataset = { ...source.dataset, id: datasetId, diagramId };
        const id = crypto.randomUUID();
        sourceArchiveIds.set(source.id, id);
        await db.historySources.add({
          ...source,
          id,
          diagramId,
          datasetId,
          rowId,
          dataset,
          bytes: historyJsonBytes(dataset),
        });
      }
    const contentIds = new Map<string, string>();
    for (const item of contents.values())
      if (item.diagramId === oldId) {
        const original = item.graph;
        let graph: Graph = {
          ...original,
          diagram: { ...original.diagram, id: diagramId },
          nodes: original.nodes.map((node) => ({
            ...node,
            id: identity(nodes, node.id),
            diagramId,
            parentId: node.parentId ? identity(nodes, node.parentId) : undefined,
            ownerIds: node.ownerIds.map((id) => identity(owners, id)),
            ownerId: node.ownerIds[0] ? identity(owners, node.ownerIds[0]) : undefined,
          })),
          edges: original.edges.map((edge) => ({
            ...edge,
            id: identity(edges, edge.id),
            diagramId,
            sourceNodeId: identity(nodes, edge.sourceNodeId),
            targetNodeId: identity(nodes, edge.targetNodeId),
          })),
          owners: original.owners.map((owner) => ({ ...owner, id: identity(owners, owner.id) })),
        };
        graph = remapDataModelSources(
          graph,
          new Map([...sourceIds].map(([id, value]) => [id, value!])),
        );
        graph = remapAnalysisReferences(
          graph,
          new Map([...nodes].map(([id, value]) => [id, value!])),
        );
        const nodeMap = new Map([...nodes].map(([id, value]) => [id, value!]));
        const edgeMap = new Map([...edges].map(([id, value]) => [id, value!]));
        const datasetMap = new Map([...sourceIds].map(([id, value]) => [id, value!]));
        graph = remapPresentation(graph, nodeMap);
        if (original.diagram.settings.storyboard)
          graph = setStoryboard(graph, {
            ...getStoryboard(original),
            scenes: getStoryboard(original).scenes.map((scene) => ({
              ...scene,
              id: identity(scenes, scene.id),
              nodeIds: scene.nodeIds.map((id) => identity(nodes, id)),
              edgeIds: scene.edgeIds.map((id) => identity(edges, id)),
            })),
          });
        graph = remapBuildSpecification(graph, nodeMap, edgeMap, datasetMap);
        graph.edges = graph.edges.map((edge) => {
          const relationship = edge.metadata.csvSourceRelationship as
            | { relationshipId?: string }
            | undefined;
          return edge.metadata.csvModelGenerated && relationship?.relationshipId
            ? {
                ...edge,
                externalId: `csv-rel:${relationship.relationshipId}:${edge.sourceNodeId}:${edge.targetNodeId}`,
              }
            : edge;
        });
        const suppressed = original.diagram.settings.csvSuppressedRelationshipEdges;
        if (suppressed)
          graph.diagram.settings = {
            ...graph.diagram.settings,
            csvSuppressedRelationshipEdges: suppressed.map((key) => {
              const parts = key.split(':');
              return parts.length === 4 && parts[0] === 'csv-rel'
                ? `csv-rel:${parts[1]}:${identity(nodes, parts[2])}:${identity(nodes, parts[3])}`
                : key;
            }),
          };
        graph.diagram.settings = {
          ...graph.diagram.settings,
          entityOrder: {
            nodes: graph.nodes.map((node) => node.id),
            edges: graph.edges.map((edge) => edge.id),
          },
        };
        const content = historyGraph(graph),
          digest = await Dexie.waitFor(historyDigest(content)),
          id = `${diagramId}:${digest}`;
        contentIds.set(item.id, id);
        await db.historyContents.put({
          id,
          diagramId,
          digest,
          bytes: historyJsonBytes(content, historyLimits.graphBytes),
          graph: content,
        });
      }
    for (const snapshot of snapshots)
      await db.historySnapshots.add({
        ...snapshot,
        id: crypto.randomUUID(),
        diagramId,
        contentId: contentIds.get(snapshot.contentId)!,
        sourceIds: snapshot.sourceIds.map((id) => sourceArchiveIds.get(id)!),
      });
  }
  const finalBytes = (
    await Promise.all([
      db.historyContents.orderBy('bytes').keys(),
      db.historySources.orderBy('bytes').keys(),
      db.historyRows.orderBy('bytes').keys(),
    ])
  )
    .flat()
    .reduce<number>((sum, value) => sum + Number(value), 0);
  if (finalBytes > historyLimits.bytes)
    throw new StorageError(
      413,
      'Imported history exceeds the workspace history capacity. Nothing was restored.',
    );
}
