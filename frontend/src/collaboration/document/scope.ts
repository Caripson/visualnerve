import type { Graph } from '../../model/types';
import { StorageError } from '../../model/errors';

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
const entity = (value: object) =>
  Object.fromEntries(
    Object.entries(value).filter(([key, value]) => !localClocks.has(key) && value !== undefined),
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
    if (root === 'dataset' || root === 'datasets') {
      if (!scope.shareDatasets) fail();
    }
    if (root === 'owners' && path.length > 1 && !scope.shareOwners) fail();
    if (root === 'diagram') {
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
  const diagram = entity(graph.diagram);
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
    const value = entity(node);
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
          ...entity(owner),
          metadata: scope.shareMetadata ? owner.metadata : {},
        }))
    : [];
  return {
    format: graph.format,
    formatVersion: graph.formatVersion,
    diagram,
    nodes,
    edges: graph.edges.map((edge) => ({
      ...entity(edge),
      metadata: metadata(edge.metadata, scope),
    })),
    owners,
    ...(graph.simulation ? { simulation: graph.simulation } : {}),
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
  // Remove shared settings which were explicitly deleted, preserving private/custom settings.
  for (const key of [...sharedSettings, ...(scope.shareDatasets ? datasetSettings : [])])
    if (!(key in (shared.diagram as Graph['diagram']).settings))
      delete result.diagram.settings[key];
  result.nodes = result.nodes.map((node) => {
    const previous = nodes.get(node.id);
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
    const privateMetadata = structuredClone(edges.get(edge.id)?.metadata ?? {});
    if (scope.shareDatasets) for (const key of csvMetadata) delete privateMetadata[key];
    return {
      ...edge,
      ...clocks(edges.get(edge.id)),
      ...(!scope.shareMetadata ? { metadata: { ...privateMetadata, ...edge.metadata } } : {}),
    };
  });
  result.owners = scope.shareOwners
    ? result.owners.map((owner) => ({ ...owner, ...clocks(owners.get(owner.id)) }))
    : structuredClone(local.owners);
  if (!scope.shareDatasets) {
    if (local.dataset) result.dataset = local.dataset;
    if (local.datasets) result.datasets = local.datasets;
  }
  return result;
}
