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
import { parseImport } from '../export/semantic';
import { checkExportActive, waitForExport, type ExportGuard } from '../export/guard';
import { loadOptionalCommand } from './optional-command';
import { IMPORT_LIMIT_SETTING, importLimitMb, assertImportLimitMb } from '../imports/limits';
import {
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
  projectSourceFileLimit,
  assertProjectSourceFileLimit,
} from '../code/project/limits';
import type { WorkspaceBackup, WorkspaceDatabase } from './database';
import type { WorkspaceStorage } from './contracts';
import { workspaceStoreNames } from './contracts';
import { asWorkspaceStorage } from './adapter';
import { workspaceStorage } from './runtime';
import { isWorkspaceSecurityDiscovery, workspaceSecurityStatus } from './security-status';
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
import type { AnalysisCommandOptions } from './analysis-commands';
import { codeCapabilities } from '../code/capabilities';
import { codeLanguages } from '../code/catalog';
import { HistoryStore, historyStoreNames } from '../history/store';
import { understandingActions } from './understanding-actions';
import { remapStoryboard, pruneStoryboard } from '../presentation/storyboard';
import { remapBuildSpecification } from '../export/build-specification';
import { remapOverview } from '../overview/copy';
import { importHistoryBackup } from '../history/backup';
import { remapSimulationModel } from '../simulation/copy';
import { reconcileSimulationGraph } from '../simulation/document';
import { SimulationRunStore } from '../simulation/run-store';
import { importSimulationRuns } from '../simulation/backup';
import { simulationCapabilities } from './simulation-capabilities';
import { createSimulationGraph } from '../simulation/document';
import { createEmptySimulationModel } from '../simulation/starter';
import { browserApiVersion } from './api-version';
import { BulkIdentities } from './bulk-identities';
import { collaborationPermissions, type SharedProjectionAuthority } from '../collaboration/access';
import { collaborationDocumentHooks } from '../collaboration/document-hooks';

export type CommandOptions = AnalysisCommandOptions & {
  /** Recheck external grants after queue waits and immediately before dispatch. */
  beforeRequest?: () => Promise<void>;
  /** Recheck external grants inside document transactions before their first write. */
  beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
  /** Recheck external grants after history hashing and before its first write. */
  beforeHistoryWrite?: (scope: WorkspaceStorage) => Promise<void>;
};

type Patch = Record<string, unknown>;
type WriteGuard = (scope: WorkspaceStorage) => Promise<void>;
function writeGuards(...guards: Array<WriteGuard | undefined>): WriteGuard | undefined {
  const selected = [...new Set(guards.filter((guard): guard is WriteGuard => !!guard))];
  return selected.length
    ? async (scope) => {
        for (const guard of selected) await guard(scope);
      }
    : undefined;
}
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
  public db: WorkspaceStorage;
  constructor(db: WorkspaceStorage | WorkspaceDatabase = workspaceStorage) {
    this.db = asWorkspaceStorage(db);
    this.history = new HistoryStore(this.db, (graph, baseVersion, scope) =>
      new Repository(scope).persistGraph(graph, baseVersion, true),
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
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
    projection?: SharedProjectionAuthority,
    changeBase?: Graph,
  ): Promise<Graph> {
    return this.persistGraph(input, expectedVersion, false, beforeWrite, projection, changeBase);
  }
  private async persistGraph(
    input: Graph,
    expectedVersion?: number,
    canonicalPositions = false,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
    projection?: SharedProjectionAuthority,
    changeBase?: Graph,
  ): Promise<Graph> {
    const shared = projection ? undefined : collaborationDocumentHooks.get(input.diagram.id);
    if (shared && !this.db.inTransaction) {
      return this.db.atomic(
        'rw',
        ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels', 'settings'],
        (scope) =>
          new Repository(scope).persistGraph(
            input,
            expectedVersion,
            canonicalPositions,
            beforeWrite,
            projection,
            changeBase,
          ),
      );
    }
    const before = shared ? (changeBase ?? (await this.db.graph(input.diagram.id))) : undefined;
    // Ordinary drawing saves intentionally omit raw CSV sources. Apply the
    // same inheritance as writeGraph before calculating their shared delta,
    // using the edit's baseline so a concurrent peer source change stays a
    // peer change. An explicit datasets: [] still requests source removal.
    if (shared && before)
      input = {
        ...input,
        dataset: input.dataset ?? (input.datasets === undefined ? before.dataset : undefined),
        datasets: input.datasets ?? before.datasets,
      };
    const prepared =
      shared && before ? await shared.prepareLocal(before, input, this.db) : undefined;
    try {
      const saved = await this.writeGraph(
        prepared?.graph ?? input,
        expectedVersion,
        canonicalPositions,
        beforeWrite,
        projection,
      );
      if (prepared && this.db.inTransaction)
        (this.db as import('./contracts').WorkspaceScope).afterCommit(() =>
          prepared.committed(saved),
        );
      else prepared?.committed(saved);
      return saved;
    } catch (error) {
      prepared?.cancelled?.();
      throw error;
    }
  }
  private async writeGraph(
    input: Graph,
    expectedVersion?: number,
    canonicalPositions = false,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
    projection?: SharedProjectionAuthority,
  ): Promise<Graph> {
    validateGraphFields(input);
    const saved = await this.db.atomic(
      'rw',
      [
        'diagrams',
        'nodes',
        'edges',
        'owners',
        'datasets',
        'simulationModels',
        ...(beforeWrite ? ['settings' as const] : []),
      ],
      async (scope) => {
        const old = await scope.graph(input.diagram.id);
        if (old) requireVersion(old.diagram.version, expectedVersion);
        else if (expectedVersion !== undefined && expectedVersion !== 0)
          throw new StorageError(409, 'This project was deleted by another tab.');
        input = reconcileSimulationGraph(old, input);
        // Apply API/graph-replacement 2D moves in the same transaction as their 3D placement.
        // Editor commands that already updated both positions are unchanged by this helper.
        if (old && !canonicalPositions) input = syncSpatialPositions(old, input);
        const owners = await scope.owners.toArray();
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
            const record = await scope.datasets.get(source.id);
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
        const otherNodes = await scope.nodes.bulkGet(graph.nodes.map((node) => node.id));
        const otherEdges = await scope.edges.bulkGet(graph.edges.map((edge) => edge.id));
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
        await beforeWrite?.(scope);
        collaborationPermissions.assertWrite(input.diagram.id, old, graph, projection);
        await scope.nodes.bulkDelete(
          old?.nodes.filter((node) => !ids.has(node.id)).map((node) => node.id) ?? [],
        );
        await scope.edges.bulkDelete(
          old?.edges.filter((edge) => !edges.has(edge.id)).map((edge) => edge.id) ?? [],
        );
        await scope.nodes.bulkPut(graph.nodes.filter((node) => node !== nodeIndex.get(node.id)));
        await scope.edges.bulkPut(graph.edges.filter((edge) => edge !== edgeIndex.get(edge.id)));
        await scope.owners.bulkPut(
          [...registry.values()].filter((owner) => !owners.some((old) => old.id === owner.id)),
        );
        await scope.diagrams.put(graph.diagram);
        if (graph.simulation)
          await scope.simulationModels.put({
            diagramId: graph.diagram.id,
            diagramVersion: graph.diagram.version,
            model: graph.simulation,
          });
        else await scope.simulationModels.delete(graph.diagram.id);
        const sourceIds = new Set(stamped.map((source) => source.id));
        await scope.datasets.bulkDelete([...oldSources.keys()].filter((id) => !sourceIds.has(id)));
        for (const source of stamped)
          if (source !== oldSources.get(source.id)) await scope.datasets.put(source);
        scope.rememberDataset(graph.diagram, graph.dataset, graph.datasets);
        return graph;
      },
    );
    return saved;
  }
  async removeDiagram(id: string, beforeWrite?: (scope: WorkspaceStorage) => Promise<void>) {
    await this.db.atomic(
      'rw',
      [
        'diagrams',
        'nodes',
        'edges',
        'datasets',
        'simulationModels',
        'simulationRuns',
        'simulationCheckpoints',
        ...historyStoreNames,
        ...(beforeWrite ? ['settings' as const] : []),
      ],
      async (scope) => {
        const scoped = new Repository(scope);
        await beforeWrite?.(scope);
        collaborationPermissions.assertDetached(id);
        scope.forgetDatasets();
        await scope.nodes.where('diagramId').equals(id).delete();
        await scope.edges.where('diagramId').equals(id).delete();
        await scope.diagrams.delete(id);
        await scope.datasets.where('diagramId').equals(id).delete();
        await scope.simulationModels.delete(id);
        await new SimulationRunStore(scope).deleteDiagram(id);
        await scoped.history.removeDiagram(id);
      },
    );
  }
  async importGraph(
    source: Graph,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ): Promise<Graph> {
    const imported = await this.db.atomic(
      'rw',
      [
        'diagrams',
        'nodes',
        'edges',
        'owners',
        'datasets',
        'simulationModels',
        ...(beforeWrite ? ['settings' as const] : []),
      ],
      async (scope) => {
        const scoped = new Repository(scope);
        const graph = structuredClone(source);
        validateGraph(graph);
        const oldOwners = await scope.owners.bulkGet(graph.owners.map((owner) => owner.id));
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
          const external = await scope.owners.where('externalId').equals(owner.externalId).first();
          if (external && external.id !== owner.id) {
            owner.metadata = { ...owner.metadata, importedExternalId: owner.externalId };
            delete owner.externalId;
          }
        }
        const collision =
          !!(await scope.diagrams.get(graph.diagram.id)) ||
          (await scope.nodes.bulkGet(graph.nodes.map((node) => node.id))).some(Boolean) ||
          (await scope.edges.bulkGet(graph.edges.map((edge) => edge.id))).some(Boolean);
        const nodeIds = new Map(
          graph.nodes.map((node) => [node.id, collision ? crypto.randomUUID() : node.id]),
        );
        if (collision) graph.diagram.id = crypto.randomUUID();
        const sourceIds = new Map<string, string>();
        for (const source of graphDatasets(graph)) {
          const datasetCollision = !!(await scope.datasets.get(source.id));
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
        return scoped.saveGraph(graph, 0, beforeWrite);
      },
    );
    return imported;
  }
  async restore(
    backup: WorkspaceBackup,
    mode: 'merge' | 'replace' = 'merge',
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ): Promise<Graph[]> {
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
    const restored = await this.db.atomic('rw', workspaceStoreNames, async (scope) => {
      const scoped = new Repository(scope);
      const acknowledgement = await scope.settings.get('storage-consent');
      const importLimitPreference = await scope.settings.get(IMPORT_LIMIT_SETTING);
      const projectFileLimitPreference = await scope.settings.get(
        PROJECT_SOURCE_FILE_LIMIT_SETTING,
      );
      await beforeWrite?.(scope);
      if (mode === 'replace') {
        collaborationPermissions.assertDetached();
        scope.forgetDatasets();
        for (const table of scope.tables) await table.clear();
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
        const previous = await scope.owners.get(input.id);
        const owner =
          previous && sameContent(previous, input)
            ? { ...previous }
            : { ...input, id: previous ? crypto.randomUUID() : input.id };
        const external = owner.externalId
          ? await scope.owners.where('externalId').equals(owner.externalId).first()
          : undefined;
        if (external && external.id !== owner.id) {
          owner.metadata = { ...owner.metadata, importedExternalId: owner.externalId };
          delete owner.externalId;
        }
        ownerIds.set(input.id, owner.id);
        owners.push(owner);
      }
      await scope.owners.bulkPut(owners);
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
        const importedGraph = await scoped.importGraph(sourceGraph);
        graphs.push(importedGraph);
        historyMappings.push({ sourceGraph, importedGraph });
      }
      await importHistoryBackup(scope, backup.history, datasets, historyMappings, ownerIds);
      await importSimulationRuns(scope, backup, historyMappings);
      for (const template of backup.templates) {
        if (typeof template.id !== 'string' || !template.id || typeof template.name !== 'string')
          throw new StorageError(422, 'Invalid template.');
        validateGraph(template.graph);
      }
      for (const setting of backup.settings)
        if (typeof setting.key !== 'string' || !setting.key)
          throw new StorageError(422, 'Invalid setting.');
      await scope.settings.bulkPut(
        backup.settings.filter(
          (setting) =>
            !setting.key.startsWith('vault-') &&
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
              PROJECT_SOURCE_FILE_LIMIT_SETTING,
            ].includes(setting.key),
        ),
      );
      await scope.templates.bulkPut(backup.templates);
      if (acknowledgement) await scope.settings.put(acknowledgement);
      if (importLimitPreference) await scope.settings.put(importLimitPreference);
      if (projectFileLimitPreference) await scope.settings.put(projectFileLimitPreference);
      await scope.initialize();
      return graphs;
    });
    return restored;
  }
  async clearAll() {
    collaborationPermissions.assertDetached();
    await this.db.atomic('rw', workspaceStoreNames, async (scope) => {
      scope.forgetDatasets();
      for (const table of scope.tables) await table.clear();
      await scope.initialize();
    });
  }
  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return this.db.atomic('r', ['diagrams', 'nodes', 'owners'], async (scope) => {
      const owners = new Map((await scope.owners.toArray()).map((owner) => [owner.id, owner]));
      const diagrams = await scope.diagrams
        .filter((diagram) => JSON.stringify(diagram).toLocaleLowerCase().includes(q))
        .limit(100)
        .toArray();
      const nodes = await scope.nodes
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
  async owner(
    data: Patch,
    id?: string,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ): Promise<Owner> {
    return this.db.atomic(
      'rw',
      ['owners', 'nodes', 'diagrams', ...(beforeWrite ? ['settings' as const] : [])],
      async (scope) => {
        const old = id ? await scope.owners.get(id) : undefined;
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
        if (!old && (await scope.owners.get(input.id)))
          throw new StorageError(409, 'Owner id already exists.');
        if (input.externalId) {
          const external = await scope.owners.where('externalId').equals(input.externalId).first();
          if (external && external.id !== input.id)
            throw new StorageError(409, 'External owner id already exists.');
        }
        validateOwner(input);
        if (old)
          for (const node of await scope.nodes.where('ownerIds').equals(old.id).toArray())
            collaborationPermissions.assertDetached(node.diagramId);
        const owner = stamp(input, old);
        await beforeWrite?.(scope);
        await scope.owners.put(owner);
        if (old) {
          const ids = [
            ...new Set(
              (await scope.nodes.where('ownerIds').equals(old.id).toArray()).map(
                (node) => node.diagramId,
              ),
            ),
          ];
          const diagrams = (await scope.diagrams.bulkGet(ids)).filter(
            (diagram): diagram is Diagram => !!diagram,
          );
          await scope.diagrams.bulkPut(
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
    const endpoint = path.replace(/^\/api\/v1/, '');
    if (
      ['/health', '/simulation/capabilities', '/code/capabilities', '/code/languages'].includes(
        endpoint,
      ) ||
      isWorkspaceSecurityDiscovery(path, method)
    )
      return this.dispatchRequest(path, method, payload, options);
    const operation = await this.db.captureOperation();
    const controller = new AbortController();
    const removeListeners: Array<() => void> = [];
    for (const signal of [operation.signal, options.signal]) {
      if (!signal) continue;
      if (signal.aborted) controller.abort(signal.reason);
      else {
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        removeListeners.push(() => signal.removeEventListener('abort', abort));
      }
    }
    try {
      await options.beforeRequest?.();
      await operation.check();
      const result = await new Repository(operation.storage).dispatchRequest<T>(
        path,
        method,
        payload,
        { ...options, signal: controller.signal },
        {
          signal: controller.signal,
          assertCurrent: () => controller.signal.throwIfAborted(),
          check: async () => {
            await operation.check();
            await options.beforeRequest?.();
            controller.signal.throwIfAborted();
          },
        },
      );
      await operation.check();
      return result;
    } catch (error) {
      // A late worker error after lock must report the revoked capability, not
      // publish private diagnostics or restart the request in a later session.
      await operation.check();
      throw error;
    } finally {
      for (const remove of removeListeners) remove();
      operation.dispose();
    }
  }
  /** Module loading is outside native transactions; authorization may change while it waits. */
  private async commandReady(options: CommandOptions) {
    options.signal?.throwIfAborted();
    await options.beforeRequest?.();
    options.signal?.throwIfAborted();
  }
  private async dispatchRequest<T>(
    path: string,
    method: string,
    payload: unknown,
    options: CommandOptions,
    exportGuard?: ExportGuard,
  ): Promise<T> {
    const url = new URL(path.replace(/^\/api\/v1/, ''), 'http://browser.local');
    const parts = url.pathname.split('/').filter(Boolean),
      [collection, id, action] = parts;
    const read = method === 'GET',
      remove = method === 'DELETE';
    if (collection === 'workspace' && id === 'security') {
      if (parts.length !== 2 || url.search || url.hash)
        throw new StorageError(404, 'Unknown workspace security discovery endpoint.');
      if (!read) throw new StorageError(405, 'Workspace security discovery accepts GET only.');
      return workspaceSecurityStatus(this.db) as T;
    }
    if (collection === 'simulation') {
      if (parts.length !== 2 || id !== 'capabilities' || url.search || url.hash)
        throw new StorageError(404, 'Unknown simulation discovery endpoint.');
      if (!read) throw new StorageError(405, 'Simulation capabilities require GET.');
      return structuredClone(simulationCapabilities) as T;
    }
    if (method === 'POST' && ['diagram-files', 'sql', 'code', 'import'].includes(collection)) {
      const limits = await this.db.atomic('r', ['settings'], async (scope) => {
        const setting = await scope.settings.get(IMPORT_LIMIT_SETTING);
        const sourceFiles = await scope.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING);
        return {
          byteLimit: importLimitMb(setting?.value) * 1024 * 1024,
          ...(['/code/project/preview', '/code/project/diagrams'].includes(
            path.replace(/^\/api\/v1/, ''),
          )
            ? { projectFileLimit: projectSourceFileLimit(sourceFiles?.value) }
            : {}),
        };
      });
      options = { ...options, ...limits };
    }
    if (collection === 'diagram-files') {
      if (path.replace(/^\/api\/v1/, '') !== '/diagram-files/preview')
        throw new StorageError(404, 'Unknown diagram file endpoint.');
      if (method !== 'POST') throw new StorageError(405, 'Diagram file preview requires POST.');
      const { diagramFileCommand } = await loadOptionalCommand('diagram-file');
      await this.commandReady(options);
      return (await diagramFileCommand(payload, false, options, (graph) =>
        this.importGraph(graph, options.beforeWrite),
      )) as T;
    }
    if (collection === 'code' && ['capabilities', 'languages'].includes(id)) {
      if (
        !['/code/capabilities', '/code/languages'].includes(path.replace(/^\/api\/v1/, '')) ||
        parts.length !== 2 ||
        url.search ||
        url.hash
      )
        throw new StorageError(404, 'Unknown analysis endpoint.');
      if (!read)
        throw new StorageError(
          405,
          id === 'capabilities'
            ? 'Code capabilities require GET.'
            : 'Language discovery requires GET.',
        );
      return structuredClone(id === 'capabilities' ? codeCapabilities : codeLanguages) as T;
    }
    if (collection === 'sql' || collection === 'code') {
      const { analysisCommand } = await loadOptionalCommand('analysis');
      await this.commandReady(options);
      return (await analysisCommand(
        path.replace(/^\/api\/v1/, ''),
        method,
        payload,
        options,
        (graph) => this.importGraph(graph, options.beforeWrite),
      )) as T;
    }
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
        data.type === 'process-simulator'
          ? createSimulationGraph(data.name, createEmptySimulationModel())
          : blankGraph(data.name, (data.type ?? 'mindmap') as Diagram['type']),
        { mode: '3d' },
      );
      return (await this.saveGraph(graph, 0, options.beforeWrite)) as T;
    }
    if (collection === 'health')
      return {
        status: 'ok',
        storage: 'indexeddb',
        version: browserApiVersion,
        workspaceSecurity: workspaceSecurityStatus(this.db),
      } as T;
    if (collection === 'search' && read)
      return (await this.search(url.searchParams.get('q') ?? '')) as T;
    if (collection === 'settings') {
      if (id === PROJECT_SOURCE_FILE_LIMIT_SETTING) {
        if (parts.length !== 2 || url.search || url.hash)
          throw new StorageError(404, 'Unknown ZIP project source-file limit endpoint.');
        if (!['GET', 'PUT'].includes(method))
          throw new StorageError(405, 'ZIP project source-file limit accepts GET or PUT.');
      }
      if (read && id === 'presentation-voice') {
        const value = (await this.db.settings.get(id))?.value;
        return (isPresentationVoiceId(value) ? value : defaultPresentationVoiceId) as T;
      }
      if (read && id === IMPORT_LIMIT_SETTING)
        return importLimitMb((await this.db.settings.get(id))?.value) as T;
      if (read && id === PROJECT_SOURCE_FILE_LIMIT_SETTING)
        return projectSourceFileLimit((await this.db.settings.get(id))?.value) as T;
      if (read)
        return (
          id ? (await this.db.settings.get(id))?.value : await this.db.settings.toArray()
        ) as T;
      if (!id) throw new StorageError(400, 'Setting key is required.');
      if (id.startsWith('vault-'))
        throw new StorageError(
          422,
          'Workspace security controls are available only in the browser.',
        );
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
      if (id === PROJECT_SOURCE_FILE_LIMIT_SETTING) {
        const setting = object(payload);
        if (Object.keys(setting).some((key) => key !== 'value'))
          throw new StorageError(422, 'ZIP project source-file limit setting accepts only value.');
        assertProjectSourceFileLimit(setting.value);
        return await this.db.atomic('rw', ['settings'], async (scope) => {
          // An external grant can change while this write waits for IndexedDB.
          // Check it inside the transaction, immediately before its first write.
          await options.beforeWrite?.(scope);
          await scope.settings.put({ key: id, value: setting.value });
          return undefined as T;
        });
      }
      const value = object(payload).value;
      return this.db.atomic('rw', ['settings'], async (scope) => {
        await options.beforeWrite?.(scope);
        await scope.settings.put({ key: id, value });
        return undefined as T;
      });
    }
    if (collection === 'templates' && read)
      return (id ? await this.db.templates.get(id) : await this.db.templates.toArray()) as T;
    if (collection === 'workspace' && action === undefined && id === 'export' && read)
      return (await this.db.backup()) as T;
    if (collection === 'workspace' && id === 'import' && method === 'POST')
      return (await this.restore(payload as WorkspaceBackup, 'merge', options.beforeWrite)) as T;
    if (collection === 'owners') {
      if (read) return (id ? await this.db.owners.get(id) : await this.db.owners.toArray()) as T;
      if (!remove) return (await this.owner(object(payload), id, options.beforeWrite)) as T;
      return await this.db.atomic(
        'rw',
        ['owners', 'nodes', 'diagrams', 'settings'],
        async (scope) => {
          const nodes = await scope.nodes.where('ownerIds').equals(id).toArray();
          for (const node of nodes) collaborationPermissions.assertDetached(node.diagramId);
          await options.beforeWrite?.(scope);
          await scope.nodes.bulkPut(
            nodes.map((node) => {
              const ownerIds = node.ownerIds.filter((owner) => owner !== id);
              return stamp({ ...node, ownerIds, ownerId: ownerIds[0] }, node);
            }),
          );
          const diagrams = (
            await scope.diagrams.bulkGet([...new Set(nodes.map((node) => node.diagramId))])
          ).filter((diagram): diagram is Diagram => !!diagram);
          await scope.diagrams.bulkPut(
            diagrams.map((diagram) => ({
              ...diagram,
              version: diagram.version + 1,
              updatedAt: new Date().toISOString(),
            })),
          );
          await scope.owners.delete(id);
          return undefined as T;
        },
      );
    }
    if (collection === 'import' && method === 'POST') {
      const data = object(payload);
      if (data.format === 'drawio' || data.format === 'vsdx') {
        if (path.replace(/^\/api\/v1/, '') !== '/import')
          throw new StorageError(404, 'Unknown diagram import endpoint.');
        const { diagramFileCommand } = await loadOptionalCommand('diagram-file');
        await this.commandReady(options);
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
      const { exportCommand } = await waitForExport(import('../export/command'), exportGuard);
      await this.commandReady(options);
      await checkExportActive(exportGuard);
      return (await exportCommand(graph, data, exportGuard)) as T;
    }
    if (collection === 'diagrams') {
      if (id && action === 'simulation') {
        const { simulationCommand } = await loadOptionalCommand('simulation');
        await this.commandReady(options);
        return (await simulationCommand(
          {
            getGraph: (id) => this.getGraph(id),
            saveGraph: (graph, version, beforeWrite) =>
              this.saveGraph(graph, version, writeGuards(options.beforeWrite, beforeWrite)),
          },
          id,
          parts,
          url,
          method,
          payload,
          options.beforeHistoryWrite,
        )) as T;
      }
      if (id && understandingActions.includes(action)) {
        const { understandingCommand } = await loadOptionalCommand('understanding');
        await this.commandReady(options);
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
      }
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
        return await this.db.atomic(
          'rw',
          ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels', 'settings'],
          async (scope) => {
            const scoped = new Repository(scope);
            const graph = await scoped.getGraph(id);
            validatePresentation(data.presentation, graph);
            return (await scoped.saveGraph(
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
      return await this.db.atomic(
        'rw',
        ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels', 'settings'],
        async (scope) => {
          const scoped = new Repository(scope);
          const graph = await scoped.getGraph(id),
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
            const saved = await scoped.saveGraph(graph, version, options.beforeWrite);
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
            const saved = await scoped.saveGraph(graph, version, options.beforeWrite);
            return saved.edges.find((value) => value.id === edge.id) as T;
          }
          requireVersion(version, data.version);
          graph.diagram = patch(graph.diagram, data);
          return (await scoped.saveGraph(graph, version, options.beforeWrite)).diagram as T;
        },
      );
    }
    if (collection === 'nodes' || collection === 'edges') {
      if (read) {
        const table = collection === 'nodes' ? this.db.nodes : this.db.edges;
        const entity = await table.get(id);
        if (!entity) throw new StorageError(404, 'Object does not exist.');
        return entity as T;
      }
      return await this.db.atomic(
        'rw',
        ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels', 'settings'],
        async (scope) => {
          const scoped = new Repository(scope);
          const table = collection === 'nodes' ? scope.nodes : scope.edges;
          const entity = await table.get(id);
          if (!entity) throw new StorageError(404, 'Object does not exist.');
          const graph = await scoped.getGraph(entity.diagramId),
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
            const stored = await scoped.saveGraph(graph, version, options.beforeWrite);
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
          const stored = await scoped.saveGraph(graph, version, options.beforeWrite);
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
  async bulk(
    id: string,
    data: Patch,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ): Promise<Graph> {
    const saved = await this.db.atomic(
      'rw',
      [
        'diagrams',
        'nodes',
        'edges',
        'owners',
        'datasets',
        'simulationModels',
        ...(beforeWrite ? ['settings' as const] : []),
      ],
      async (scope) => {
        const scoped = new Repository(scope);
        const graph = await scoped.getGraph(id),
          version = graph.diagram.version;
        if (data.baseVersion !== undefined) requireVersion(version, data.baseVersion);
        const existingOwners = await scope.owners.toArray();
        const ownerInputs = new BulkIdentities('owner', data.owners, existingOwners, !!data.upsert);
        const nodeInputs = new BulkIdentities('node', data.nodes, graph.nodes, !!data.upsert);
        const edgeInputs = new BulkIdentities('connection', data.edges, graph.edges, !!data.upsert);
        // Validate identities before simulation projection can collapse duplicate canonical IDs.
        // Owners and graph records share this transaction, so any later failure also rolls back.
        ownerInputs.validate();
        nodeInputs.validate(
          nodeInputs.canonicalIds.length ? await scope.nodes.bulkGet(nodeInputs.canonicalIds) : [],
        );
        edgeInputs.validate(
          edgeInputs.canonicalIds.length ? await scope.edges.bulkGet(edgeInputs.canonicalIds) : [],
        );
        const ownerExternal = new Map(
          existingOwners
            .filter((owner) => owner.externalId)
            .map((owner) => [owner.externalId!, owner]),
        );
        for (const values of ownerInputs.entries) {
          const previous = values.externalId
            ? ownerExternal.get(values.externalId as string)
            : undefined;
          if (previous && !data.upsert)
            throw new StorageError(409, 'External owner id already exists.');
          if (previous && values.version !== undefined)
            requireVersion(previous.version, values.version);
          const owner = await scoped.owner(
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
        for (const values of nodeInputs.entries) {
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
        for (const values of edgeInputs.entries) {
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
        const current = (await scope.diagrams.get(id))!;
        return scoped.saveGraph(graph, current.version, beforeWrite);
      },
    );
    return saved;
  }
}
export const repository = new Repository();
