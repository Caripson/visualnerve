import { RobloxError } from '../../roblox/errors';
import type { Graph } from '../../model/types';
import { StorageError } from '../../model/errors';
import type { SimulationModel } from '../../simulation/types';
import { validCollaborationId } from '../model/validation';

/** A human chooses disclosure once when creating/joining a room. Never infer consent. */
export interface CollaborationShareScope {
  shareMetadata: boolean;
  shareOwners: boolean;
  shareDatasets: boolean;
}
export const defaultCollaborationShareScope: Readonly<CollaborationShareScope> = Object.freeze({
  shareMetadata: false,
  shareOwners: false,
  shareDatasets: false,
});
export const collaborationDocumentLimits = Object.freeze({
  nodes: 20_000,
  edges: 100_000,
  owners: 20_000,
  jsonBytes: 16 * 1024 * 1024,
  updateBytes: 8 * 1024 * 1024,
  stateBytes: 32 * 1024 * 1024,
  fields: 1_000_000,
  depth: 48,
});

export type SharedGraph = Record<string, unknown>;
const localClocks = new Set(['version', 'createdAt', 'updatedAt']);
const sharedSettings = new Set([
  'grid',
  'snap',
  'timelineScale',
  'drawing',
  'presentation',
  'storyboard',
  'overview',
  'buildSpecification',
]);
const datasetSettings = new Set([
  'csvAnalysis',
  'csvSourceAnalyses',
  'csvRelationships',
  'csvDatasetOrder',
  'csvSuppressedRelationshipEdges',
]);
export const localViewSettings = new Set([
  'viewport',
  'viewportDevice',
  'spatialView',
  'csvEntityFocus',
  'analysisFilters',
  'relationshipExploration',
]);
const csvMetadata = new Set([
  'csv',
  'csvSnapshot',
  'csvGenerated',
  'csvModelGenerated',
  'csvSourceRelationship',
  'csvModelVisible',
]);
const simulationMetadataCollections = ['nodes', 'particleTypes', 'resources'] as const;
const simulationMetadataRoots = new Set<string>(simulationMetadataCollections);
const sharedRoots = new Set([
  'format',
  'formatVersion',
  'diagram',
  'nodes',
  'edges',
  'owners',
  'simulation',
  'dataset',
  'datasets',
]);
const documentFields: Record<string, Set<string>> = {
  profiles: new Set(['id', 'name', 'color', 'avatarDataUrl', 'createdAt', 'updatedAt']),
  comments: new Set([
    'id',
    'nodeId',
    'nodeTitle',
    'authorId',
    'resolved',
    'resolvedBy',
    'resolvedAt',
    'createdAt',
    'updatedAt',
    'messages',
  ]),
  tasks: new Set([
    'id',
    'nodeId',
    'nodeTitle',
    'title',
    'description',
    'authorId',
    'assigneeId',
    'status',
    'dueDate',
    'createdAt',
    'updatedAt',
  ]),
  activity: new Set([
    'id',
    'kind',
    'source',
    'authorId',
    'sequence',
    'timestamp',
    'summary',
    'nodeIds',
    'entityId',
  ]),
};
const messageFields = new Set(['id', 'authorId', 'text', 'sequence', 'createdAt', 'updatedAt']);

/** Validate retained paths even when a deleted ancestor or history retention hides them. */
function validDocumentPath(path: string[], encoded: unknown): boolean {
  if (!Array.isArray(encoded)) return false;
  const container = encoded.length === 1 && encoded[0] === 'object';
  const scalar =
    encoded.length === 2 &&
    encoded[0] === 'value' &&
    (encoded[1] === null ||
      ['string', 'boolean'].includes(typeof encoded[1]) ||
      (typeof encoded[1] === 'number' && Number.isFinite(encoded[1])));
  if (path.length === 2) return container;
  const collection = path[2];
  if (collection === 'schemaVersion') return path.length === 3 && scalar;
  const fields = Object.hasOwn(documentFields, collection) ? documentFields[collection] : undefined;
  if (!fields) return false;
  if (path.length === 3) return container;
  if (!validCollaborationId(path[3])) return false;
  if (path.length === 4) return container;
  const field = path[4];
  if (!fields.has(field)) return false;
  if (collection === 'comments' && field === 'messages') {
    if (path.length === 5) return container;
    if (!validCollaborationId(path[5])) return false;
    if (path.length === 6) return container;
    return path.length === 7 && messageFields.has(path[6]) && scalar;
  }
  if (path.length !== 5) return false;
  if (collection === 'activity' && field === 'nodeIds')
    return (
      encoded.length === 2 &&
      encoded[0] === 'value' &&
      Array.isArray(encoded[1]) &&
      encoded[1].every((id: unknown) => validCollaborationId(id))
    );
  return scalar;
}
function scopedSimulation(model: SimulationModel, scope: CollaborationShareScope) {
  const result = structuredClone(model);
  if (!scope.shareMetadata) {
    for (const collection of simulationMetadataCollections)
      for (const entity of result[collection]) delete entity.metadata;
    for (const scenario of result.scenarios)
      for (const collection of simulationMetadataCollections) {
        const patches = scenario.overrides[collection];
        if (!patches) continue;
        for (const [id, patch] of Object.entries(patches)) {
          delete patch.metadata;
          if (!Object.keys(patch).length) delete patches[id];
        }
        if (!Object.keys(patches).length) delete scenario.overrides[collection];
      }
  }
  return result;
}
function restoreSimulationMetadata(shared: SimulationModel, local: SimulationModel) {
  for (const collection of simulationMetadataCollections) {
    const previous = new Map(local[collection].map((entity) => [entity.id, entity]));
    for (const entity of shared[collection]) {
      const metadata = previous.get(entity.id)?.metadata;
      if (metadata !== undefined) entity.metadata = structuredClone(metadata);
    }
  }
  const previousScenarios = new Map(local.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenario of shared.scenarios) {
    const previous = previousScenarios.get(scenario.id);
    for (const collection of simulationMetadataCollections) {
      const ids = new Set(shared[collection].map((entity) => entity.id));
      for (const [id, patch] of Object.entries(previous?.overrides[collection] ?? {})) {
        if (!ids.has(id) || !Object.hasOwn(patch, 'metadata')) continue;
        const patches = (scenario.overrides[collection] ??= {}) as Record<
          string,
          { metadata?: unknown }
        >;
        (patches[id] ??= {}).metadata = structuredClone(patch.metadata);
      }
    }
  }
}
const entity = (value: object, scope: CollaborationShareScope) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, value]) =>
        !localClocks.has(key) &&
        value !== undefined &&
        (scope.shareMetadata || key !== 'externalId'),
    ),
  );
const metadata = (value: Record<string, unknown>, scope: CollaborationShareScope, node = false) => {
  const result = structuredClone(
    scope.shareMetadata
      ? value
      : Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => (node && key === 'spatial') || (scope.shareDatasets && csvMetadata.has(key)),
          ),
        ),
  );
  if (!scope.shareDatasets) for (const key of csvMetadata) delete result[key];
  return result;
};

/** Deleted ancestors suppress rendering, but every retained path must still obey disclosure policy. */
export function assertCollaborationFieldScope(
  entries: Iterable<[string, unknown]>,
  scope: CollaborationShareScope,
  allowWorkflow = true,
) {
  const fail = (): never => {
    throw new StorageError(
      422,
      'This update includes a private field outside the agreed sharing scope.',
    );
  };
  for (const [key, value] of entries) {
    let path: unknown;
    try {
      path = JSON.parse(key);
    } catch {
      continue;
    } // The structural decoder rejects malformed paths.
    if (!Array.isArray(path) || path.some((part) => typeof part !== 'string')) continue;
    const [root, entityId, property, child] = path;
    if (path.length && !sharedRoots.has(root)) fail();
    if (root === 'dataset' || root === 'datasets') {
      if (!scope.shareDatasets) fail();
    }
    if (root === 'owners' && path.length > 1 && !scope.shareOwners) fail();
    if (
      root === 'simulation' &&
      !scope.shareMetadata &&
      ((simulationMetadataRoots.has(entityId) && child === 'metadata') ||
        (entityId === 'scenarios' &&
          child === 'overrides' &&
          simulationMetadataRoots.has(path[4]) &&
          path[6] === 'metadata'))
    )
      fail();
    if (root === 'diagram') {
      if (entityId === 'collaboration' && (!allowWorkflow || !validDocumentPath(path, value)))
        fail();
      if (entityId === 'externalId' && !scope.shareMetadata) fail();
      if (['version', 'createdAt', 'updatedAt', 'favorite', 'folder'].includes(entityId)) fail();
      if (entityId === 'metadata' && path.length > 2 && !scope.shareMetadata) fail();
      if (
        entityId === 'settings' &&
        path.length > 2 &&
        !sharedSettings.has(property) &&
        !(scope.shareDatasets && datasetSettings.has(property))
      )
        fail();
    }
    if (['nodes', 'edges', 'owners'].includes(root)) {
      if (property === 'externalId' && !scope.shareMetadata) fail();
      if (['version', 'createdAt', 'updatedAt'].includes(property)) fail();
      if (root === 'nodes' && !scope.shareOwners) {
        if (property === 'ownerId') fail();
        if (
          property === 'ownerIds' &&
          (!Array.isArray(value) ||
            value[0] !== 'value' ||
            !Array.isArray(value[1]) ||
            value[1].length)
        )
          fail();
      }
      if (property === 'metadata') {
        if (path.length === 3 && (!Array.isArray(value) || value[0] !== 'object')) fail();
        if (
          path.length > 3 &&
          !scope.shareMetadata &&
          !(root === 'nodes' && child === 'spatial') &&
          !(scope.shareDatasets && csvMetadata.has(child))
        )
          fail();
        if (path.length > 3 && !scope.shareDatasets && csvMetadata.has(child)) fail();
      }
    }
    if (
      root === 'diagram' &&
      entityId === 'metadata' &&
      path.length === 2 &&
      (!Array.isArray(value) || value[0] !== 'object')
    )
      fail();
  }
}

/** The CRDT contains this projection only, never the local workspace/setting tables. */
export function sharedGraph(graph: Graph, scope: CollaborationShareScope): SharedGraph {
  if (graph.diagram.game)
    throw new RobloxError(
      422,
      'Live rooms do not yet support Roblox game blueprints. Use a deliberate native JSON export or encrypted backup to share the complete game.',
      'COLLABORATION_GAME_UNSUPPORTED',
    );
  if (graph.simulation?.infrastructure)
    throw new StorageError(
      422,
      'Live rooms do not yet support infrastructure capacity models. Use an explicit encrypted backup or native JSON export to share this model.',
    );
  if (graph.diagram.analytics)
    throw new StorageError(
      422,
      'Live rooms do not yet support the analytics extension. Use an explicit encrypted backup or native JSON export to share this analysis.',
    );
  const diagram = entity(graph.diagram, scope);
  delete diagram.favorite;
  delete diagram.folder;
  diagram.metadata = scope.shareMetadata ? structuredClone(graph.diagram.metadata) : {};
  diagram.settings = Object.fromEntries(
    Object.entries(graph.diagram.settings).filter(
      ([key]) =>
        !localViewSettings.has(key) &&
        (sharedSettings.has(key) || (scope.shareDatasets && datasetSettings.has(key))),
    ),
  );
  const nodes = graph.nodes.map((node) => {
    const value = entity(node, scope);
    value.metadata = metadata(node.metadata, scope, true);
    if (!scope.shareOwners) {
      delete value.ownerId;
      value.ownerIds = [];
    }
    return value;
  });
  const referencedOwners = new Set(
    graph.nodes.flatMap((node) => [...node.ownerIds, ...(node.ownerId ? [node.ownerId] : [])]),
  );
  const owners = scope.shareOwners
    ? graph.owners
        .filter((owner) => referencedOwners.has(owner.id))
        .map((owner) => ({
          ...entity(owner, scope),
          metadata: scope.shareMetadata ? owner.metadata : {},
        }))
    : [];
  return {
    format: graph.format,
    formatVersion: graph.formatVersion,
    diagram,
    nodes,
    edges: graph.edges.map((edge) => ({
      ...entity(edge, scope),
      metadata: metadata(edge.metadata, scope),
    })),
    owners,
    ...(graph.simulation ? { simulation: scopedSimulation(graph.simulation, scope) } : {}),
    ...(scope.shareDatasets && graph.dataset ? { dataset: graph.dataset } : {}),
    ...(scope.shareDatasets && graph.datasets ? { datasets: graph.datasets } : {}),
  };
}

const fallbackClock = {
  version: 1,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};
/** Reapply local clocks and private view/assignments without putting them on the wire. */
export function localGraph(
  shared: SharedGraph,
  local: Graph,
  scope: CollaborationShareScope,
): Graph {
  const result = structuredClone(shared) as unknown as Graph;
  const nodes = new Map(local.nodes.map((node) => [node.id, node]));
  const edges = new Map(local.edges.map((edge) => [edge.id, edge]));
  const owners = new Map(local.owners.map((owner) => [owner.id, owner]));
  const restoreExternalId = (shared: object, previous?: object) => {
    if (scope.shareMetadata) return;
    const result = shared as { externalId?: unknown };
    delete result.externalId;
    const value = (previous as { externalId?: unknown } | undefined)?.externalId;
    if (value !== undefined) result.externalId = structuredClone(value);
  };
  const clocks = (value: { version: number; createdAt: string; updatedAt: string } | undefined) =>
    value
      ? { version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt }
      : fallbackClock;
  result.diagram = {
    ...result.diagram,
    ...clocks(local.diagram),
    favorite: local.diagram.favorite,
    ...(local.diagram.folder !== undefined ? { folder: local.diagram.folder } : {}),
    metadata: scope.shareMetadata
      ? result.diagram.metadata
      : structuredClone(local.diagram.metadata),
    settings: {
      ...structuredClone(local.diagram.settings),
      ...result.diagram.settings,
    },
  };
  restoreExternalId(result.diagram, local.diagram);
  // Remove shared settings which were explicitly deleted, preserving private/custom settings.
  for (const key of [...sharedSettings, ...(scope.shareDatasets ? datasetSettings : [])])
    if (!(key in (shared.diagram as Graph['diagram']).settings))
      delete result.diagram.settings[key];
  result.nodes = result.nodes.map((node) => {
    const previous = nodes.get(node.id);
    restoreExternalId(node, previous);
    const privateMetadata = previous ? structuredClone(previous.metadata) : {};
    delete privateMetadata.spatial;
    if (scope.shareDatasets) for (const key of csvMetadata) delete privateMetadata[key];
    return {
      ...node,
      ...clocks(previous),
      ...(!scope.shareMetadata && previous
        ? { metadata: { ...privateMetadata, ...node.metadata } }
        : {}),
      ...(!scope.shareOwners
        ? { ownerIds: previous?.ownerIds ?? [], ownerId: previous?.ownerId }
        : {}),
    };
  });
  result.edges = result.edges.map((edge) => {
    restoreExternalId(edge, edges.get(edge.id));
    const privateMetadata = structuredClone(edges.get(edge.id)?.metadata ?? {});
    if (scope.shareDatasets) for (const key of csvMetadata) delete privateMetadata[key];
    return {
      ...edge,
      ...clocks(edges.get(edge.id)),
      ...(!scope.shareMetadata ? { metadata: { ...privateMetadata, ...edge.metadata } } : {}),
    };
  });
  result.owners = scope.shareOwners
    ? result.owners.map((owner) => {
        const previous = owners.get(owner.id);
        restoreExternalId(owner, previous);
        return {
          ...owner,
          ...clocks(previous),
          ...(!scope.shareMetadata && previous
            ? { metadata: structuredClone(previous.metadata) }
            : {}),
        };
      })
    : structuredClone(local.owners);
  if (!scope.shareDatasets) {
    if (local.dataset) result.dataset = local.dataset;
    if (local.datasets) result.datasets = local.datasets;
  }
  if (!scope.shareMetadata && result.simulation) {
    result.simulation = scopedSimulation(result.simulation, scope);
    if (local.simulation) restoreSimulationMetadata(result.simulation, local.simulation);
  }
  return result;
}
