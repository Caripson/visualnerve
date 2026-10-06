import type { Graph, GraphEdge } from '../model/types';
import type { CanvasNode } from '../canvas/projection';
import type { Edge } from '@xyflow/react';

export const overviewGroupings = ['auto', 'groups', 'tags', 'source'] as const;
export type OverviewGrouping = (typeof overviewGroupings)[number];
export interface OverviewConfig {
  version: 1;
  enabled: boolean;
  grouping: OverviewGrouping;
  expanded: string[];
}
export const overviewLimits = {
  expanded: 2000,
  visible: 2000,
  branch: 32,
  leaf: 32,
  depth: 12,
} as const;
export const OVERVIEW_GROUP_PREFIX = 'overview-group:';
export const OVERVIEW_EDGE_PREFIX = 'overview-edge:';
export const defaultOverview = (): OverviewConfig => ({
  version: 1,
  enabled: false,
  grouping: 'auto',
  expanded: [],
});
export function validateOverviewConfig(value: unknown): asserts value is OverviewConfig {
  const config = value as Partial<OverviewConfig> | null;
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (key) => !['version', 'enabled', 'grouping', 'expanded'].includes(key),
    ) ||
    config.version !== 1 ||
    typeof config.enabled !== 'boolean' ||
    !overviewGroupings.includes(config.grouping as OverviewGrouping) ||
    !Array.isArray(config.expanded) ||
    config.expanded.length > overviewLimits.expanded ||
    config.expanded.some(
      (id) => typeof id !== 'string' || !/^overview-group:[a-f0-9]{16}$/.test(id),
    ) ||
    new Set(config.expanded).size !== config.expanded.length
  )
    throw new Error('Invalid semantic overview configuration.');
}
export function getOverviewConfig(graph: Graph): OverviewConfig {
  const config = graph.diagram.settings.overview;
  if (config === undefined) return defaultOverview();
  validateOverviewConfig(config);
  return { ...config, expanded: [...config.expanded] };
}
export function setOverviewConfig(graph: Graph, config: OverviewConfig): Graph {
  validateOverviewConfig(config);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        overview: { ...config, expanded: [...config.expanded] },
      },
    },
  };
}
export interface OverviewGroup {
  id: string;
  label: string;
  reason: 'hierarchy' | 'tag' | 'source' | 'kind' | 'area' | 'partition';
  parentId?: string;
  depth: number;
  nodeIds: string[];
  childGroupIds: string[];
  statusCounts: Record<string, number>;
  nodeTypeCounts: Record<string, number>;
  matchingNodeCount: number;
  internalEdgeCount: number;
  expanded: boolean;
}
export interface OverviewRelationship {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  direction: GraphEdge['direction'];
  style: GraphEdge['style'];
  edgeIds: string[];
  labels: string[];
  internal: boolean;
}
export interface OverviewProjection {
  active: boolean;
  nodes: CanvasNode[];
  edges: Edge[];
  groups: OverviewGroup[];
  relationships: OverviewRelationship[];
  /** Every currently visible original maps to exactly one original or summary card. */
  nodeMap: Record<string, string>;
  edgeMap: Record<string, string>;
  counts: {
    originalNodes: number;
    originalEdges: number;
    representedNodes: number;
    representedEdges: number;
    groups: number;
  };
  bounded: boolean;
  zoomLevel: number;
}
export function overviewZoomLevel(zoom = 0.1) {
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom > 10)
    throw new Error('Overview zoom must be greater than zero and at most ten.');
  return zoom < 0.2 ? 0 : zoom < 0.55 ? 1 : zoom < 1.2 ? 2 : 3;
}
export function isOverviewGroupId(id: string) {
  return id.startsWith(OVERVIEW_GROUP_PREFIX);
}
export function isOverviewEdgeId(id: string) {
  return id.startsWith(OVERVIEW_EDGE_PREFIX);
}
export function overviewNodeGroup(view: CanvasNode): OverviewGroup | undefined {
  return view.data.node.metadata.overviewGroup as OverviewGroup | undefined;
}

/** Two independent 32-bit accumulators keep IDs stable across input order and counts. */
export function overviewId(prefix: string, key: string) {
  let first = 2166136261,
    second = 0x9e3779b9;
  for (let index = 0; index < key.length; index++) {
    const code = key.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
    second ^= second >>> 13;
  }
  return `${prefix}${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
