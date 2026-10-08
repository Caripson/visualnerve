import {
  base,
  blankGraph,
  diagramTypes,
  descendantIds,
  newEdge,
  newNode,
  type Base,
  type Diagram,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
import {
  StorageError,
  validateGraph,
  validateGraphFields,
  validateOwner,
} from '../model/validation';
import { getCsvNode } from '../data/csv';
import { remapAnalysisReferences } from '../analysis/views';
import {
  graphDatasets,
  remapDataModelSources,
  suppressDataModelEdge,
  reconnectedDataModelEdge,
} from '../data/model';
import { reconnectedAnalysisEdge } from '../model/relationships';
import { markdown, parseImport } from '../export/semantic';
import { diagramFileCommand } from './diagram-file-commands';
import { IMPORT_LIMIT_SETTING, importLimitMb, assertImportLimitMb } from '../imports/limits';
import { database, type WorkspaceBackup, type WorkspaceDatabase } from './database';
import { setSpatialView } from '../spatial/types';
import { syncSpatialPositions } from '../spatial/movement';
import {
  getPresentation,
  setPresentation,
  prunePresentation,
  remapPresentation,
} from '../presentation/definition';
import {
  validatePresentation,
  defaultPresentationVoiceId,
  isPresentationVoiceId,
} from '../presentation/types';
import { analysisCommand, type AnalysisCommandOptions } from './analysis-commands';
import { HistoryStore, historyTables } from '../history/store';
import { understandingActions, understandingCommand } from './understanding-commands';
import { remapStoryboard, pruneStoryboard } from '../presentation/storyboard';
import { remapBuildSpecification } from '../export/build-specification';
import { remapOverview } from '../overview/copy';
import { importHistoryBackup } from '../history/backup';
import { remapSimulationModel } from '../simulation/copy';
import { reconcileSimulationGraph } from '../simulation/document';
import { SimulationRunStore } from '../simulation/run-store';
import { importSimulationRuns } from '../simulation/backup';
import { simulationCommand, simulationCapabilities } from './simulation-commands';
import { createSimulationGraph } from '../simulation/document';

export type CommandOptions = AnalysisCommandOptions & {
  /** Recheck external grants after queue waits and immediately before dispatch. */
  beforeRequest?: () => Promise<void>;
  /** Recheck external grants inside document transactions before their first write. */
  beforeWrite?: () => Promise<void>;
  /** Recheck external grants after history hashing and before its first write. */
  beforeHistoryWrite?: () => Promise<void>;
};

type Patch = Record<string, unknown>;
export interface SearchResult {
  diagramId: string;
  nodeId?: string;
  title: string;
  kind: 'diagram' | 'node';
}
const sameContent = (a: Base, b: Base) => {
  if (a === b) return true;
  const content = ({
    version: _version,
    updatedAt: _updatedAt,
    createdAt: _createdAt,
    ...rest
  }: Base) => rest;
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
};
function stamp<T extends Base>(value: T, old?: T): T {
  if (!old) return value;
  if (sameContent(value, old)) return old;
  return {
    ...value,
    version: old.version + 1,
    createdAt: old.createdAt,
    updatedAt: new Date().toISOString(),
  };
}
function patch<T extends Base>(value: T, data: Patch): T {
  const {
    id: _id,
    diagramId: _diagramId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    version: _version,
    ...fields
  } = data;
  const result = { ...value, ...fields } as T;
  if ('metadata' in data) {
    if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata))
      throw new StorageError(422, 'Metadata must be an object.');
    const current = (value as T & { metadata?: Patch }).metadata ?? {};
    (result as T & { metadata: Patch }).metadata = { ...current, ...(data.metadata as Patch) };
  }
  return result;
}
function requireVersion(actual: number, expected: unknown) {
  if (expected === undefined) throw new StorageError(428, 'The current version is required.');
  if (actual !== expected)
    throw new StorageError(
      409,
      'Another tab changed this project. Your local changes are preserved.',
    );
}
function suppressCsvParentConnection(graph: Graph, edge: GraphEdge) {
  Object.assign(graph, suppressDataModelEdge(graph, edge));
  if (edge.metadata?.csvGenerated !== true) return;
  graph.nodes = graph.nodes.map((node) => {
    const csv =
      node.id === edge.targetNodeId && node.metadata?.csv !== undefined
        ? getCsvNode(node)
        : undefined;
    return csv
      ? {
          ...node,
          metadata: { ...node.metadata, csv: { ...csv, suppressParentConnection: true } },
        }
      : node;
  });
}
function reconnectedEdge(graph: Graph, previous: GraphEdge, next: GraphEdge): GraphEdge {
  const endpointsChanged =
    previous.sourceNodeId !== next.sourceNodeId || previous.targetNodeId !== next.targetNodeId;
  if (endpointsChanged) Object.assign(graph, suppressDataModelEdge(graph, previous));
  const reconnected = reconnectedDataModelEdge(previous, reconnectedAnalysisEdge(previous, next));
  if (
    previous.metadata?.csvGenerated !== true ||
    (previous.sourceNodeId === next.sourceNodeId && previous.targetNodeId === next.targetNodeId)
  )
    return reconnected;
  suppressCsvParentConnection(graph, previous);
  return { ...reconnected, metadata: { ...reconnected.metadata, csvGenerated: false } };
}
function object(data: unknown): Patch {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new StorageError(400, 'Expected an object.');
  return data as Patch;
}

export class Repository {
  history: HistoryStore;
  constructor(public db: WorkspaceDatabase = database) {
    this.history = new HistoryStore(db, (graph, baseVersion) =>
      this.persistGraph(graph, baseVersion, true),
    );
  }
  async getGraph(id: string): Promise<Graph> {
    const graph = await this.db.graph(id);
    if (!graph) throw new StorageError(404, 'Project does not exist in this browser.');
    return graph;
  }
  async saveGraph(
    input: Graph,
    expectedVersion?: number,
    beforeWrite?: () => Promise<void>,
  ): Promise<Graph> {
    return this.persistGraph(input, expectedVersion, false, beforeWrite);
  }
  private async persistGraph(
    input: Graph,
    expectedVersion?: number,
    canonicalPositions = false,
    beforeWrite?: () => Promise<void>,
  ): Promise<Graph> {
    validateGraphFields(input);
    const saved = await this.db.transaction(
      'rw',
      [
        this.db.diagrams,
        this.db.nodes,
        this.db.edges,
        this.db.owners,
        this.db.datasets,
        this.db.simulationModels,
        ...(beforeWrite ? [this.db.settings] : []),
      ],
      async () => {
        const old = await this.db.graph(input.diagram.id);
        if (old) requireVersion(old.diagram.version, expectedVersion);
        else if (expectedVersion !== undefined && expectedVersion !== 0)
          throw new StorageError(409, 'This project was deleted by another tab.');
        input = reconcileSimulationGraph(old, input);
        // Apply API/graph-replacement 2D moves in the same transaction as their 3D placement.
        // Editor commands that already updated both positions are unchanged by this helper.
        if (old && !canonicalPositions) input = syncSpatialPositions(old, input);
        const owners = await this.db.owners.toArray();
        const registry = new Map(owners.map((owner) => [owner.id, owner]));
        for (const owner of input.owners) {
          validateOwner(owner);
          if (!registry.has(owner.id)) registry.set(owner.id, owner);
        }
        const referenced = new Set(input.nodes.flatMap((node) => node.ownerIds));
        const graph: Graph = {
          ...input,
          dataset: input.dataset ?? (input.datasets === undefined ? old?.dataset : undefined),
          datasets: input.datasets ?? old?.datasets,
          nodes: input.nodes.map((node) => ({ ...node, ownerId: node.ownerIds[0] })),
          owners: [...registry.values()].filter((owner) => referenced.has(owner.id)),
        };
        const sources = graphDatasets(graph);
        graph.diagram = {
          ...graph.diagram,
          settings: {
            ...graph.diagram.settings,
            csvDatasetOrder: sources.map((source) => source.id),
          },
        };
        const oldSources = new Map(
          (old ? graphDatasets(old) : []).map((source) => [source.id, source]),
        );
        validateGraph(graph, [...oldSources.values()]);
        const stamped = [] as typeof sources;
        for (const source of sources) {
          if (!oldSources.has(source.id)) {
            const record = await this.db.datasets.get(source.id);
            if (record && record.diagramId !== graph.diagram.id)
              throw new StorageError(409, 'Dataset id belongs to another project.');
          }
          const previous = oldSources.get(source.id);
          const sameRaw =
            previous &&
            source.rows === previous.rows &&
            source.columns === previous.columns &&
            source.name === previous.name &&
            source.fileName === previous.fileName &&
            source.diagramId === previous.diagramId &&
            source.formatVersion === previous.formatVersion;
          stamped.push(sameRaw ? previous : stamp(source, previous));
        }
        graph.dataset = stamped[0];
        graph.datasets =
          stamped.length > 1 || input.datasets !== undefined ? stamped.slice(1) : undefined;
        const otherNodes = await this.db.nodes.bulkGet(graph.nodes.map((node) => node.id));
        const otherEdges = await this.db.edges.bulkGet(graph.edges.map((edge) => edge.id));
        if (
          [...otherNodes, ...otherEdges].some(
            (entity) => entity && entity.diagramId !== graph.diagram.id,
          )
        )
          throw new StorageError(409, 'Entity id belongs to another project.');
        const nodeIndex = new Map(old?.nodes.map((node) => [node.id, node]) ?? []);
        const edgeIndex = new Map(old?.edges.map((edge) => [edge.id, edge]) ?? []);
        graph.nodes = graph.nodes.map((node) => stamp(node, nodeIndex.get(node.id)));
        graph.edges = graph.edges.map((edge) => stamp(edge, edgeIndex.get(edge.id)));
        graph.diagram = {
          ...graph.diagram,
          ...(old
            ? {
                version: old.diagram.version + 1,
                createdAt: old.diagram.createdAt,
                updatedAt: new Date().toISOString(),
              }
            : {}),
          settings: {
            ...graph.diagram.settings,
            entityOrder: {
              nodes: graph.nodes.map((node) => node.id),
              edges: graph.edges.map((edge) => edge.id),
            },
          },
        };
        const ids = new Set(graph.nodes.map((node) => node.id)),
          edges = new Set(graph.edges.map((edge) => edge.id));
        await beforeWrite?.();
        await this.db.nodes.bulkDelete(
          old?.nodes.filter((node) => !ids.has(node.id)).map((node) => node.id) ?? [],
        );
        await this.db.edges.bulkDelete(
          old?.edges.filter((edge) => !edges.has(edge.id)).map((edge) => edge.id) ?? [],
        );
        await this.db.nodes.bulkPut(graph.nodes.filter((node) => node !== nodeIndex.get(node.id)));
        await this.db.edges.bulkPut(graph.edges.filter((edge) => edge !== edgeIndex.get(edge.id)));
        await this.db.owners.bulkPut(
          [...registry.values()].filter((owner) => !owners.some((old) => old.id === owner.id)),
        );
        await this.db.diagrams.put(graph.diagram);
        if (graph.simulation)
          await this.db.simulationModels.put({
            diagramId: graph.diagram.id,
            diagramVersion: graph.diagram.version,
            model: graph.simulation,
          });
        else await this.db.simulationModels.delete(graph.diagram.id);
        const sourceIds = new Set(stamped.map((source) => source.id));
        await this.db.datasets.bulkDelete(
          [...oldSources.keys()].filter((id) => !sourceIds.has(id)),
        );
        for (const source of stamped)
          if (source !== oldSources.get(source.id)) await this.db.datasets.put(source);
        return graph;
      },
    );
    this.db.rememberDataset(saved.diagram, saved.dataset, saved.datasets);
    return saved;
  }
  async removeDiagram(id: string, beforeWrite?: () => Promise<void>) {
    await this.db.transaction(
      'rw',
      [
        this.db.diagrams,
        this.db.nodes,
        this.db.edges,
        this.db.datasets,
        this.db.simulationModels,
        this.db.simulationRuns,
        this.db.simulationCheckpoints,
        ...historyTables(this.db),
        ...(beforeWrite ? [this.db.settings] : []),
      ],
      async () => {
        await beforeWrite?.();
        this.db.forgetDatasets();
        await this.db.nodes.where('diagramId').equals(id).delete();
        await this.db.edges.where('diagramId').equals(id).delete();
        await this.db.diagrams.delete(id);
        await this.db.datasets.where('diagramId').equals(id).delete();
        await this.db.simulationModels.delete(id);
        await new SimulationRunStore(this.db).deleteDiagram(id);
        await this.history.removeDiagram(id);
      },
    );
  }
  async importGraph(source: Graph, beforeWrite?: () => Promise<void>): Promise<Graph> {
    const imported = await this.db.transaction(
      'rw',
      [
        this.db.diagrams,
        this.db.nodes,
        this.db.edges,
        this.db.owners,
        this.db.datasets,
        this.db.simulationModels,
        ...(beforeWrite ? [this.db.settings] : []),
      ],
      async () => {
        const graph = structuredClone(source);
        validateGraph(graph);
        const oldOwners = await this.db.owners.bulkGet(graph.owners.map((owner) => owner.id));
        const ownerIds = new Map<string, string>();
        graph.owners = graph.owners.map((owner, index) => {
          const old = oldOwners[index];
          const id = old && !sameContent(old, owner) ? crypto.randomUUID() : owner.id;
          ownerIds.set(owner.id, id);
          const imported = { ...owner, id };
          return imported;
        });
        for (const owner of graph.owners) {
          if (!owner.externalId) continue;
          const external = await this.db.owners
            .where('externalId')
            .equals(owner.externalId)
            .first();
          if (external && external.id !== owner.id) {
            owner.metadata = { ...owner.metadata, importedExternalId: owner.externalId };
            delete owner.externalId;
          }
        }
        const collision =
          !!(await this.db.diagrams.get(graph.diagram.id)) ||
          (await this.db.nodes.bulkGet(graph.nodes.map((node) => node.id))).some(Boolean) ||
          (await this.db.edges.bulkGet(graph.edges.map((edge) => edge.id))).some(Boolean);
        const nodeIds = new Map(
          graph.nodes.map((node) => [node.id, collision ? crypto.randomUUID() : node.id]),
        );
        if (collision) graph.diagram.id = crypto.randomUUID();
        const sourceIds = new Map<string, string>();
        for (const source of graphDatasets(graph)) {
          const datasetCollision = !!(await this.db.datasets.get(source.id));
          sourceIds.set(source.id, collision || datasetCollision ? crypto.randomUUID() : source.id);
        }
        Object.assign(graph, remapDataModelSources(graph, sourceIds));
        graph.nodes = graph.nodes.map((node) => ({
          ...node,
          id: nodeIds.get(node.id)!,
          diagramId: graph.diagram.id,
          parentId: node.parentId ? nodeIds.get(node.parentId) : undefined,
          ownerIds: node.ownerIds.map((id) => ownerIds.get(id)!),
          ownerId: node.ownerIds[0] ? ownerIds.get(node.ownerIds[0]) : undefined,
        }));
        const edgeIds = new Map(
          graph.edges.map((edge) => [edge.id, collision ? crypto.randomUUID() : edge.id]),
        );
        graph.edges = graph.edges.map((edge) => ({
          ...edge,
          id: edgeIds.get(edge.id)!,
          diagramId: graph.diagram.id,
          sourceNodeId: nodeIds.get(edge.sourceNodeId)!,
          targetNodeId: nodeIds.get(edge.targetNodeId)!,
          ...(edge.metadata.csvModelGenerated === true && edge.externalId
            ? {
                externalId: `csv-rel:${(edge.metadata.csvSourceRelationship as { relationshipId: string }).relationshipId}:${nodeIds.get(edge.sourceNodeId)!}:${nodeIds.get(edge.targetNodeId)!}`,
              }
            : {}),
        }));
        Object.assign(graph, remapAnalysisReferences(graph, nodeIds));
        Object.assign(graph, remapPresentation(graph, nodeIds));
        Object.assign(graph, remapStoryboard(graph, nodeIds, edgeIds));
        Object.assign(graph, remapBuildSpecification(graph, nodeIds, edgeIds, sourceIds));
        Object.assign(graph, remapOverview(graph, source, nodeIds));
        if (graph.simulation)
          graph.simulation = remapSimulationModel(graph.simulation, nodeIds, edgeIds);
        if (graph.diagram.settings.csvSuppressedRelationshipEdges)
          graph.diagram.settings.csvSuppressedRelationshipEdges =
            graph.diagram.settings.csvSuppressedRelationshipEdges.map((id) =>
              id.replace(
                /^csv-rel:([^:]+):([^:]+):([^:]+)$/,
                (_whole, relationship, source, target) =>
                  `csv-rel:${relationship}:${nodeIds.get(source) ?? source}:${nodeIds.get(target) ?? target}`,
              ),
            );
        return this.saveGraph(graph, 0, beforeWrite);
      },
    );
    this.db.rememberDataset(imported.diagram, imported.dataset, imported.datasets);
    return imported;
  }
  async restore(backup: WorkspaceBackup, mode: 'merge' | 'replace' = 'merge'): Promise<Graph[]> {
    if (
      backup?.format !== 'visual-nerve-workspace' ||
      backup.formatVersion !== 1 ||
      (backup.schemaVersion !== undefined &&
        (!Number.isInteger(backup.schemaVersion) ||
          backup.schemaVersion < 1 ||
          backup.schemaVersion > this.db.verno)) ||
      ![
        backup.diagrams,
        backup.nodes,
        backup.edges,
        backup.owners,
        backup.settings,
        backup.templates,
      ].every(Array.isArray) ||
      (backup.datasets !== undefined && !Array.isArray(backup.datasets)) ||
      ['simulationModels', 'simulationRuns', 'simulationCheckpoints'].some(
        (key) =>
          backup[key as keyof WorkspaceBackup] !== undefined &&
          !Array.isArray(backup[key as keyof WorkspaceBackup]),
      )
    )
      throw new StorageError(422, 'Invalid workspace backup.');
    const restored = await this.db.transaction('rw', this.db.tables, async () => {
      const acknowledgement = await this.db.settings.get('storage-consent');
      const importLimitPreference = await this.db.settings.get(IMPORT_LIMIT_SETTING);
      if (mode === 'replace') {
        this.db.forgetDatasets();
        for (const table of this.db.tables) await table.clear();
      }
      const diagrams = new Set(backup.diagrams.map((diagram) => diagram.id));
      const datasets = backup.datasets ?? [];
      const simulationModels = backup.simulationModels ?? [];
      if (
        diagrams.size !== backup.diagrams.length ||
        backup.nodes.some((node) => !diagrams.has(node.diagramId)) ||
        backup.edges.some((edge) => !diagrams.has(edge.diagramId)) ||
        new Set(backup.nodes.map((node) => node.id)).size !== backup.nodes.length ||
        new Set(backup.edges.map((edge) => edge.id)).size !== backup.edges.length ||
        new Set(backup.owners.map((owner) => owner.id)).size !== backup.owners.length ||
        datasets.some(
          (dataset) => !dataset || typeof dataset !== 'object' || !diagrams.has(dataset.diagramId),
        ) ||
        new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length ||
        simulationModels.some(
          (record) =>
            !record ||
            !diagrams.has(record.diagramId) ||
            !Number.isSafeInteger(record.diagramVersion) ||
            record.diagramVersion < 1,
        ) ||
        new Set(simulationModels.map((record) => record.diagramId)).size !== simulationModels.length
      )
        throw new StorageError(422, 'Invalid or duplicate workspace references.');
      const ownerIds = new Map<string, string>();
      const owners: Owner[] = [];
      for (const input of backup.owners) {
        validateOwner(input);
        const previous = await this.db.owners.get(input.id);
        const owner =
          previous && sameContent(previous, input)
            ? { ...previous }
            : { ...input, id: previous ? crypto.randomUUID() : input.id };
        const external = owner.externalId
          ? await this.db.owners.where('externalId').equals(owner.externalId).first()
          : undefined;
        if (external && external.id !== owner.id) {
          owner.metadata = { ...owner.metadata, importedExternalId: owner.externalId };
          delete owner.externalId;
        }
        ownerIds.set(input.id, owner.id);
        owners.push(owner);
      }
      await this.db.owners.bulkPut(owners);
      const graphs: Graph[] = [];
      const historyMappings: { sourceGraph: Graph; importedGraph: Graph }[] = [];
      for (const diagram of backup.diagrams) {
        const sources = datasets.filter((dataset) => dataset.diagramId === diagram.id);
        const sourceOrder = new Map(
          diagram.settings.csvDatasetOrder?.map((id, index) => [id, index]) ?? [],
        );
        sources.sort(
          (a, b) =>
            (sourceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (sourceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
        const [dataset, ...additional] = sources;
        const nodes = backup.nodes
          .filter((node) => node.diagramId === diagram.id)
          .map((node) => ({
            ...node,
            ownerIds: node.ownerIds.map((id) => ownerIds.get(id) ?? id),
            ownerId: node.ownerId ? ownerIds.get(node.ownerId) : undefined,
          }));
        const order = diagram.settings.entityOrder as
          | { nodes?: string[]; edges?: string[] }
          | undefined;
        const sort = <T extends { id: string }>(values: T[], ids?: string[]) => {
          const index = new Map(ids?.map((id, position) => [id, position]) ?? []);
          return values.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
        };
        const sourceGraph: Graph = {
          format: 'visual-nerve',
          formatVersion: 1,
          diagram,
          nodes: sort(nodes, order?.nodes),
          edges: sort(
            backup.edges.filter((edge) => edge.diagramId === diagram.id),
            order?.edges,
          ),
          owners,
          ...(simulationModels.find((record) => record.diagramId === diagram.id)?.model
            ? {
                simulation: simulationModels.find((record) => record.diagramId === diagram.id)!
                  .model,
              }
            : {}),
          ...(dataset ? { dataset } : {}),
          ...(additional.length ? { datasets: additional } : {}),
        };
        const importedGraph = await this.importGraph(sourceGraph);
        graphs.push(importedGraph);
        historyMappings.push({ sourceGraph, importedGraph });
      }
      await importHistoryBackup(this.db, backup.history, datasets, historyMappings, ownerIds);
      await importSimulationRuns(this.db, backup, historyMappings);
      for (const template of backup.templates) {
        if (typeof template.id !== 'string' || !template.id || typeof template.name !== 'string')
          throw new StorageError(422, 'Invalid template.');
        validateGraph(template.graph);
      }
      for (const setting of backup.settings)
        if (typeof setting.key !== 'string' || !setting.key)
          throw new StorageError(422, 'Invalid setting.');
      await this.db.settings.bulkPut(
        backup.settings.filter(
          (setting) =>
            ![
              'workspace-id',
              'last-diagram',
              'integration-enabled',
              'mcp-access',
              'bridge-url',
              'privacy-acknowledged',
              'storage-consent',
              'last-export',
              'backup-nudge-dismissed',
              IMPORT_LIMIT_SETTING,
            ].includes(setting.key),
        ),
      );
      await this.db.templates.bulkPut(backup.templates);
      if (acknowledgement) await this.db.settings.put(acknowledgement);
      if (importLimitPreference) await this.db.settings.put(importLimitPreference);
      await this.db.initialize();
      return graphs;
    });
    for (const graph of restored)
      this.db.rememberDataset(graph.diagram, graph.dataset, graph.datasets);
    return restored;
  }
  async clearAll() {
    await this.db.transaction('rw', this.db.tables, async () => {
      this.db.forgetDatasets();
      for (const table of this.db.tables) await table.clear();
      await this.db.initialize();
    });
  }
  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return this.db.transaction('r', this.db.diagrams, this.db.nodes, this.db.owners, async () => {
      const owners = new Map((await this.db.owners.toArray()).map((owner) => [owner.id, owner]));
      const diagrams = await this.db.diagrams
        .filter((diagram) => JSON.stringify(diagram).toLocaleLowerCase().includes(q))
        .limit(100)
        .toArray();
      const nodes = await this.db.nodes
        .filter((node) =>
          `${JSON.stringify(node)} ${node.ownerIds.map((id) => JSON.stringify(owners.get(id))).join(' ')}`
            .toLocaleLowerCase()
            .includes(q),
        )
        .limit(200)
        .toArray();
      return [
        ...diagrams.map(
          (diagram): SearchResult => ({
            diagramId: diagram.id,
            title: diagram.name,
            kind: 'diagram',
          }),
        ),
        ...nodes.map(
          (node): SearchResult => ({
            diagramId: node.diagramId,
            nodeId: node.id,
            title: node.title,
            kind: 'node',
          }),
        ),
      ];
    });
  }
  async owner(data: Patch, id?: string, beforeWrite?: () => Promise<void>): Promise<Owner> {
    return this.db.transaction(
      'rw',
      [this.db.owners, this.db.nodes, this.db.diagrams, ...(beforeWrite ? [this.db.settings] : [])],
      async () => {
        const old = id ? await this.db.owners.get(id) : undefined;
        if (id && !old) throw new StorageError(404, 'Owner does not exist.');
        if (old) requireVersion(old.version, data.version);
        const input = old
          ? patch(old, data)
          : ({
              ...base(),
              name: '',
              kind: 'person',
              color: '#23664d',
              metadata: {},
              ...data,
            } as Owner);
        if (!old && (await this.db.owners.get(input.id)))
          throw new StorageError(409, 'Owner id already exists.');
        if (input.externalId) {
          const external = await this.db.owners
            .where('externalId')
            .equals(input.externalId)
            .first();
          if (external && external.id !== input.id)
            throw new StorageError(409, 'External owner id already exists.');
        }
        validateOwner(input);
        const owner = stamp(input, old);
        await beforeWrite?.();
        await this.db.owners.put(owner);
        if (old) {
          const ids = [
            ...new Set(
              (await this.db.nodes.where('ownerIds').equals(old.id).toArray()).map(
                (node) => node.diagramId,
              ),
            ),
          ];
          const diagrams = (await this.db.diagrams.bulkGet(ids)).filter(
            (diagram): diagram is Diagram => !!diagram,
          );
          await this.db.diagrams.bulkPut(
            diagrams.map((diagram) => ({
              ...diagram,
              version: diagram.version + 1,
              updatedAt: new Date().toISOString(),
            })),
          );
        }
        return owner;
      },
    );
  }
  async request<T>(
    path: string,
    method = 'GET',
    payload?: unknown,
    options: CommandOptions = {},
  ): Promise<T> {
    const url = new URL(path.replace(/^\/api\/v1/, ''), 'http://browser.local');
    const parts = url.pathname.split('/').filter(Boolean),
      [collection, id, action] = parts;
    const read = method === 'GET',
      remove = method === 'DELETE';
    if (collection === 'simulation') {
      if (parts.length !== 2 || id !== 'capabilities' || url.search || url.hash)
        throw new StorageError(404, 'Unknown simulation discovery endpoint.');
      if (!read) throw new StorageError(405, 'Simulation capabilities require GET.');
      return structuredClone(simulationCapabilities) as T;
    }
    if (method === 'POST' && ['diagram-files', 'sql', 'code', 'import'].includes(collection)) {
      const setting = await this.db.settings.get(IMPORT_LIMIT_SETTING);
      options = { ...options, byteLimit: importLimitMb(setting?.value) * 1024 * 1024 };
    }
    if (collection === 'diagram-files') {
      if (path.replace(/^\/api\/v1/, '') !== '/diagram-files/preview')
        throw new StorageError(404, 'Unknown diagram file endpoint.');
      if (method !== 'POST') throw new StorageError(405, 'Diagram file preview requires POST.');
      return (await diagramFileCommand(payload, false, options, (graph) =>
        this.importGraph(graph, options.beforeWrite),
      )) as T;
    }
    if (collection === 'sql' || collection === 'code')
      return (await analysisCommand(
        path.replace(/^\/api\/v1/, ''),
        method,
        payload,
        options,
        (graph) => this.importGraph(graph, options.beforeWrite),
      )) as T;
    if (collection === 'spatial-diagrams') {
      if (
        !['/spatial-diagrams', '/api/v1/spatial-diagrams'].includes(path) ||
        url.search ||
        url.hash ||
        parts.length !== 1
      )
        throw new StorageError(404, 'Unknown 3D diagram endpoint.');
      if (method !== 'POST') throw new StorageError(405, '3D diagrams are created with POST.');
      const data = object(payload);
      if (
        Object.keys(data).some((key) => !['name', 'type'].includes(key)) ||
        typeof data.name !== 'string' ||
        !data.name.trim() ||
        data.name.length > 500 ||
        (data.type !== undefined && !diagramTypes.includes(data.type as Diagram['type']))
      )
        throw new StorageError(422, 'Choose a name and supported diagram type.');
      const graph = setSpatialView(
        blankGraph(data.name, (data.type ?? 'mindmap') as Diagram['type']),
        { mode: '3d' },
      );
      return (await this.saveGraph(graph, 0)) as T;
    }
    if (collection === 'health')
      return { status: 'ok', storage: 'indexeddb', version: '0.3.0' } as T;
    if (collection === 'search' && read)
      return (await this.search(url.searchParams.get('q') ?? '')) as T;
    if (collection === 'settings') {
      if (read && id === 'presentation-voice') {
        const value = (await this.db.settings.get(id))?.value;
        return (isPresentationVoiceId(value) ? value : defaultPresentationVoiceId) as T;
      }
      if (read && id === IMPORT_LIMIT_SETTING)
        return importLimitMb((await this.db.settings.get(id))?.value) as T;
      if (read)
        return (
          id ? (await this.db.settings.get(id))?.value : await this.db.settings.toArray()
        ) as T;
      if (!id) throw new StorageError(400, 'Setting key is required.');
      if (id === 'presentation-voice') {
        const setting = object(payload);
        if (
          Object.keys(setting).some((key) => key !== 'value') ||
          !isPresentationVoiceId(setting.value)
        )
          throw new StorageError(422, 'Choose a supported presentation voice.');
      }
      if (id === IMPORT_LIMIT_SETTING) {
        const setting = object(payload);
        if (Object.keys(setting).some((key) => key !== 'value'))
          throw new StorageError(422, 'Import limit setting accepts only value.');
        assertImportLimitMb(setting.value);
      }
      await this.db.settings.put({ key: id, value: object(payload).value });
      return undefined as T;
    }
    if (collection === 'templates' && read)
      return (id ? await this.db.templates.get(id) : await this.db.templates.toArray()) as T;
    if (collection === 'workspace' && action === undefined && id === 'export' && read)
      return (await this.db.backup()) as T;
    if (collection === 'workspace' && id === 'import' && method === 'POST')
      return (await this.restore(payload as WorkspaceBackup)) as T;
    if (collection === 'owners') {
      if (read) return (id ? await this.db.owners.get(id) : await this.db.owners.toArray()) as T;
      if (!remove) return (await this.owner(object(payload), id, options.beforeWrite)) as T;
      return await this.db.transaction(
        'rw',
        this.db.owners,
        this.db.nodes,
        this.db.diagrams,
        this.db.settings,
        async () => {
          const nodes = await this.db.nodes.where('ownerIds').equals(id).toArray();
          await options.beforeWrite?.();
          await this.db.nodes.bulkPut(
            nodes.map((node) => {
              const ownerIds = node.ownerIds.filter((owner) => owner !== id);
              return stamp({ ...node, ownerIds, ownerId: ownerIds[0] }, node);
            }),
          );
          const diagrams = (
            await this.db.diagrams.bulkGet([...new Set(nodes.map((node) => node.diagramId))])
          ).filter((diagram): diagram is Diagram => !!diagram);
          await this.db.diagrams.bulkPut(
            diagrams.map((diagram) => ({
              ...diagram,
              version: diagram.version + 1,
              updatedAt: new Date().toISOString(),
            })),
          );
          await this.db.owners.delete(id);
          return undefined as T;
        },
      );
    }
    if (collection === 'import' && method === 'POST') {
      const data = object(payload);
      if (data.format === 'drawio' || data.format === 'vsdx') {
        if (path.replace(/^\/api\/v1/, '') !== '/import')
          throw new StorageError(404, 'Unknown diagram import endpoint.');
        return (await diagramFileCommand(data, true, options, (graph) =>
          this.importGraph(graph, options.beforeWrite),
        )) as T;
      }
      return (await this.importGraph(
        typeof data.data === 'string'
          ? parseImport(data.format as 'json' | 'markdown' | 'csv', data.data, options.byteLimit)
          : (data.data as Graph),
        options.beforeWrite,
      )) as T;
    }
    if (collection === 'export' && method === 'POST') {
      const data = object(payload),
        graph = await this.getGraph(data.diagramId as string);
      return (data.format === 'markdown' ? markdown(graph) : graph) as T;
    }
    if (collection === 'diagrams') {
      if (id && action === 'simulation')
        return (await simulationCommand(
          {
            getGraph: (id) => this.getGraph(id),
            saveGraph: (graph, version) => this.saveGraph(graph, version, options.beforeWrite),
          },
          id,
          parts,
          url,
          method,
          payload,
          options.beforeHistoryWrite,
        )) as T;
      if (id && understandingActions.includes(action))
        return (await understandingCommand(
          {
            getGraph: (id) => this.getGraph(id),
            saveGraph: (graph, version) => this.saveGraph(graph, version, options.beforeWrite),
            history: this.history,
          },
          id,
          parts,
          url,
          method,
          payload,
          options.beforeHistoryWrite,
        )) as T;
      if (!id) {
        if (read) {
          const diagrams = await this.db.diagrams.orderBy('updatedAt').reverse().toArray();
          const type = url.searchParams.get('type');
          if (type !== null && !diagramTypes.includes(type as Diagram['type']))
            throw new StorageError(422, 'Choose a supported diagram type.');
          return (type ? diagrams.filter((diagram) => diagram.type === type) : diagrams) as T;
        }
        const data = object(payload),
          graph =
            data.type === 'process-simulator'
              ? createSimulationGraph(data.name as string)
              : blankGraph(data.name as string, (data.type ?? 'blank') as Diagram['type']);
        graph.diagram = { ...graph.diagram, ...data } as Diagram;
        return (await this.saveGraph(graph, 0, options.beforeWrite)).diagram as T;
      }
      if (action === 'presentation') {
        if (parts.length !== 3) throw new StorageError(404, 'Unknown presentation endpoint.');
        if (read) return getPresentation(await this.getGraph(id)) as T;
        if (method !== 'PUT')
          throw new StorageError(405, 'Use GET or PUT for a diagram presentation.');
        const data = object(payload);
        if (
          Object.keys(data).some((key) => !['baseVersion', 'presentation'].includes(key)) ||
          !Number.isSafeInteger(data.baseVersion) ||
          (data.baseVersion as number) < 1
        )
          throw new StorageError(
            422,
            'Presentation update requires baseVersion and presentation only.',
          );
        return await this.db.transaction(
          'rw',
          [
            this.db.diagrams,
            this.db.nodes,
            this.db.edges,
            this.db.owners,
            this.db.datasets,
            this.db.simulationModels,
            this.db.settings,
          ],
          async () => {
            const graph = await this.getGraph(id);
            validatePresentation(data.presentation, graph);
            return (await this.saveGraph(
              setPresentation(graph, data.presentation),
              data.baseVersion as number,
              options.beforeWrite,
            )) as T;
          },
        );
      }
      if (read) {
        const graph = await this.getGraph(id);
        return (action === 'nodes' ? graph.nodes : action === 'edges' ? graph.edges : graph) as T;
      }
      if (remove && !action) {
        await this.removeDiagram(id, options.beforeWrite);
        return undefined as T;
      }
      if (action === 'graph') {
        const data = object(payload);
        const graph = data.graph as Graph;
        validateGraphFields(graph);
        if (graph.diagram.id !== id) throw new StorageError(422, 'Diagram id mismatch.');
        return (await this.saveGraph(graph, data.baseVersion as number, options.beforeWrite)) as T;
      }
      if (action === 'bulk')
        return (await this.bulk(id, object(payload), options.beforeWrite)) as T;
      return await this.db.transaction(
        'rw',
        [
          this.db.diagrams,
          this.db.nodes,
          this.db.edges,
          this.db.owners,
          this.db.datasets,
          this.db.simulationModels,
          this.db.settings,
        ],
        async () => {
          const graph = await this.getGraph(id),
            data = object(payload),
            version = graph.diagram.version;
          if (action === 'nodes') {
            const node = newNode(id, {
              x: (graph.nodes.length % 5) * 250,
              y: Math.floor(graph.nodes.length / 5) * 140,
              ...data,
            } as Partial<GraphNode>);
            if (data.ownerId !== undefined && data.ownerIds === undefined)
              node.ownerIds = data.ownerId ? [data.ownerId as string] : [];
            graph.nodes.push(node);
            const saved = await this.saveGraph(graph, version, options.beforeWrite);
            return saved.nodes.find((value) => value.id === node.id) as T;
          }
          if (action === 'edges') {
            const edge = newEdge(
              id,
              data.sourceNodeId as string,
              data.targetNodeId as string,
              data as Partial<GraphEdge>,
            );
            graph.edges.push(edge);
            const saved = await this.saveGraph(graph, version, options.beforeWrite);
            return saved.edges.find((value) => value.id === edge.id) as T;
          }
          requireVersion(version, data.version);
          graph.diagram = patch(graph.diagram, data);
          return (await this.saveGraph(graph, version, options.beforeWrite)).diagram as T;
        },
      );
    }
    if (collection === 'nodes' || collection === 'edges') {
      const table = collection === 'nodes' ? this.db.nodes : this.db.edges;
      const entity = await table.get(id);
      if (!entity) throw new StorageError(404, 'Object does not exist.');
      if (read) return entity as T;
      return await this.db.transaction(
        'rw',
        [
          this.db.diagrams,
          this.db.nodes,
          this.db.edges,
          this.db.owners,
          this.db.datasets,
          this.db.simulationModels,
          this.db.settings,
        ],
        async () => {
          const graph = await this.getGraph(entity.diagramId),
            version = graph.diagram.version;
          const data = remove ? {} : object(payload);
          if (action === 'children' && collection === 'nodes') {
            const parent = graph.nodes.find((node) => node.id === id)!;
            const child = newNode(graph.diagram.id, {
              title: 'New child',
              x: parent.x + 260,
              y: parent.y,
              ...data,
              parentId: id,
            } as Partial<GraphNode>);
            if (data.ownerId !== undefined && data.ownerIds === undefined)
              child.ownerIds = data.ownerId ? [data.ownerId as string] : [];
            graph.nodes.push(child);
            graph.edges.push(newEdge(graph.diagram.id, id, child.id, { edgeType: 'hierarchy' }));
            const stored = await this.saveGraph(graph, version, options.beforeWrite);
            return stored.nodes.find((node) => node.id === child.id) as T;
          }
          const currentEntity =
            collection === 'nodes'
              ? graph.nodes.find((node) => node.id === id)
              : graph.edges.find((edge) => edge.id === id);
          if (!currentEntity) throw new StorageError(404, 'Object was deleted.');
          if (!remove) requireVersion(currentEntity.version, data.version);
          if (collection === 'nodes') {
            const node = graph.nodes.find((node) => node.id === id)!;
            if (remove) {
              const removed =
                node.nodeType === 'group' || url.searchParams.get('branch') === 'true'
                  ? new Set([id, ...descendantIds(graph.nodes, id)])
                  : new Set([id]);
              graph.nodes = graph.nodes
                .filter((node) => !removed.has(node.id))
                .map((node) =>
                  removed.has(node.parentId ?? '') ? { ...node, parentId: undefined } : node,
                );
              graph.edges = graph.edges.filter(
                (edge) => !removed.has(edge.sourceNodeId) && !removed.has(edge.targetNodeId),
              );
              Object.assign(graph, pruneStoryboard(prunePresentation(graph)));
            } else {
              const next = patch(node, data);
              if (data.ownerId !== undefined && data.ownerIds === undefined)
                next.ownerIds = data.ownerId ? [data.ownerId as string] : [];
              const descendants =
                node.nodeType === 'group' ? descendantIds(graph.nodes, id) : new Set<string>();
              graph.nodes = graph.nodes.map((value) =>
                value.id === id
                  ? next
                  : descendants.has(value.id)
                    ? { ...value, x: value.x + next.x - node.x, y: value.y + next.y - node.y }
                    : value,
              );
            }
          } else {
            const edge = currentEntity as GraphEdge;
            if (remove) {
              suppressCsvParentConnection(graph, edge);
              graph.edges = graph.edges.filter((edge) => edge.id !== id);
              Object.assign(graph, pruneStoryboard(graph));
            } else {
              const next = reconnectedEdge(graph, edge, patch(edge, data));
              graph.edges = graph.edges.map((edge) => (edge.id === id ? next : edge));
            }
          }
          const stored = await this.saveGraph(graph, version, options.beforeWrite);
          return (
            remove
              ? undefined
              : collection === 'nodes'
                ? stored.nodes.find((node) => node.id === id)
                : stored.edges.find((edge) => edge.id === id)
          ) as T;
        },
      );
    }
    throw new StorageError(404, 'Unknown browser command.');
  }
  async bulk(id: string, data: Patch, beforeWrite?: () => Promise<void>): Promise<Graph> {
    const saved = await this.db.transaction(
      'rw',
      [
        this.db.diagrams,
        this.db.nodes,
        this.db.edges,
        this.db.owners,
        this.db.datasets,
        this.db.simulationModels,
        ...(beforeWrite ? [this.db.settings] : []),
      ],
      async () => {
        const graph = await this.getGraph(id),
          version = graph.diagram.version;
        if (data.baseVersion !== undefined) requireVersion(version, data.baseVersion);
        const ownerExternal = new Map(
          (await this.db.owners.toArray())
            .filter((owner) => owner.externalId)
            .map((owner) => [owner.externalId!, owner]),
        );
        for (const values of (data.owners ?? []) as Patch[]) {
          const previous = values.externalId
            ? ownerExternal.get(values.externalId as string)
            : undefined;
          if (previous && !data.upsert)
            throw new StorageError(409, 'External owner id already exists.');
          const owner = await this.owner(
            { ...values, ...(previous ? { version: previous.version } : {}) },
            previous?.id,
            beforeWrite,
          );
          if (owner.externalId) ownerExternal.set(owner.externalId, owner);
        }
        const nodeExternal = new Map(
          graph.nodes.filter((node) => node.externalId).map((node) => [node.externalId!, node]),
        );
        const pendingParents = new Map<string, string>();
        for (const values of (data.nodes ?? []) as Patch[]) {
          const previous = values.externalId
            ? nodeExternal.get(values.externalId as string)
            : undefined;
          if (previous && !data.upsert)
            throw new StorageError(409, 'External node id already exists.');
          if (previous && values.version !== undefined)
            requireVersion(previous.version, values.version);
          const fields = { ...values };
          delete fields.ownerExternalId;
          delete fields.parentExternalId;
          const node = previous
            ? patch(previous, fields)
            : newNode(id, {
                x: (graph.nodes.length % 5) * 250,
                y: Math.floor(graph.nodes.length / 5) * 140,
                ...fields,
              } as Partial<GraphNode>);
          if (values.ownerId !== undefined && values.ownerIds === undefined)
            node.ownerIds = values.ownerId ? [values.ownerId as string] : [];
          if (values.ownerExternalId) {
            const owner = ownerExternal.get(values.ownerExternalId as string);
            if (!owner) throw new StorageError(422, 'Unknown external owner.');
            node.ownerIds = [owner.id];
          }
          if (values.parentExternalId)
            pendingParents.set(node.id, values.parentExternalId as string);
          const descendants =
            previous?.nodeType === 'group'
              ? descendantIds(graph.nodes, previous.id)
              : new Set<string>();
          if (previous)
            graph.nodes = graph.nodes.map((value) =>
              value.id === previous.id
                ? node
                : descendants.has(value.id)
                  ? { ...value, x: value.x + node.x - previous.x, y: value.y + node.y - previous.y }
                  : value,
            );
          else graph.nodes.push(node);
          if (descendants.size)
            for (const value of graph.nodes)
              if (value.externalId) nodeExternal.set(value.externalId, value);
          if (node.externalId) nodeExternal.set(node.externalId, node);
        }
        graph.nodes = graph.nodes.map((node) => {
          const parent = pendingParents.get(node.id);
          if (!parent) return node;
          const found = nodeExternal.get(parent);
          if (!found) throw new StorageError(422, 'Unknown external parent.');
          return { ...node, parentId: found.id };
        });
        const edgeExternal = new Map(
          graph.edges.filter((edge) => edge.externalId).map((edge) => [edge.externalId!, edge]),
        );
        for (const values of (data.edges ?? []) as Patch[]) {
          const previous = values.externalId
            ? edgeExternal.get(values.externalId as string)
            : undefined;
          if (previous && !data.upsert)
            throw new StorageError(409, 'External connection id already exists.');
          if (previous && values.version !== undefined)
            requireVersion(previous.version, values.version);
          const source = values.sourceExternalId
            ? nodeExternal.get(values.sourceExternalId as string)?.id
            : values.sourceNodeId;
          const target = values.targetExternalId
            ? nodeExternal.get(values.targetExternalId as string)?.id
            : values.targetNodeId;
          if ((values.sourceExternalId && !source) || (values.targetExternalId && !target))
            throw new StorageError(422, 'Unknown external connection endpoint.');
          const fields = { ...values };
          delete fields.sourceExternalId;
          delete fields.targetExternalId;
          let edge = previous
            ? patch(previous, fields)
            : newEdge(id, source as string, target as string, fields as Partial<GraphEdge>);
          if (source) edge.sourceNodeId = source as string;
          if (target) edge.targetNodeId = target as string;
          if (previous) edge = reconnectedEdge(graph, previous, edge);
          if (previous)
            graph.edges = graph.edges.map((value) => (value.id === previous.id ? edge : value));
          else graph.edges.push(edge);
          if (edge.externalId) edgeExternal.set(edge.externalId, edge);
        }
        // Owner updates may have advanced the diagram version inside this same transaction.
        const current = (await this.db.diagrams.get(id))!;
        return this.saveGraph(graph, current.version, beforeWrite);
      },
    );
    this.db.rememberDataset(saved.diagram, saved.dataset, saved.datasets);
    return saved;
  }
}
export const repository = new Repository();
