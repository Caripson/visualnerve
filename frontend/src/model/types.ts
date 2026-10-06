import type { CsvAnalysis, CsvDataset } from '../data/types';
import type { CsvEntityFocus, CsvSourceRelationship } from '../data/model';
import type { DrawingLayer } from '../drawing/types';
export type { DrawingLayer, DrawingStroke } from '../drawing/types';

export const diagramTypes = [
  'blank',
  'mindmap',
  'flowchart',
  'timeline',
  'process',
  'dependency',
  'responsibility',
  'freeform',
] as const;
export type DiagramType = (typeof diagramTypes)[number];
export const nodeKinds = [
  'generic',
  'process',
  'decision',
  'start',
  'end',
  'milestone',
  'timeline',
  'person',
  'team',
  'system',
  'external',
  'input',
  'output',
  'document',
  'database',
  'note',
  'group',
] as const;
export type NodeKind = (typeof nodeKinds)[number];
export type Metadata = Record<string, unknown>;
export interface Base {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type TimelineScale = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface Diagram extends Base {
  name: string;
  description?: string;
  type: DiagramType;
  folder?: string;
  favorite: boolean;
  tags: string[];
  metadata: Metadata;
  settings: {
    viewport?: { x: number; y: number; zoom: number };
    grid?: boolean;
    snap?: boolean;
    timelineScale?: TimelineScale;
    csvAnalysis?: CsvAnalysis;
    csvSourceAnalyses?: Record<string, CsvAnalysis>;
    csvRelationships?: CsvSourceRelationship[];
    csvEntityFocus?: CsvEntityFocus;
    csvDatasetOrder?: string[];
    csvSuppressedRelationshipEdges?: string[];
    drawing?: DrawingLayer;
    [key: string]: unknown;
  };
}
export interface GraphNode extends Base {
  diagramId: string;
  externalId?: string;
  nodeType: NodeKind;
  title: string;
  description?: string;
  notes?: string;
  url?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ownerId?: string;
  ownerIds: string[];
  status?: string;
  color?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  tags: string[];
  parentId?: string;
  collapsed: boolean;
  metadata: Metadata;
}
export interface GraphEdge extends Base {
  diagramId: string;
  externalId?: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  edgeType: string;
  direction: 'forward' | 'backward' | 'both' | 'none';
  style: 'solid' | 'dashed' | 'dotted';
  description?: string;
  metadata: Metadata;
}
export interface Owner extends Base {
  externalId?: string;
  name: string;
  email?: string;
  team?: string;
  role?: string;
  kind: 'person' | 'team' | 'department' | 'system' | 'organization' | 'external';
  color: string;
  metadata: Metadata;
}
export interface Graph {
  format: 'visual-nerve';
  formatVersion: 1;
  diagram: Diagram;
  nodes: GraphNode[];
  edges: GraphEdge[];
  owners: Owner[];
  dataset?: CsvDataset;
  /** Additional immutable sources; dataset remains the primary legacy source. */
  datasets?: CsvDataset[];
}
export interface Filters {
  owner: string;
  status: string;
  kind: string;
  tag: string;
  from: string;
  to: string;
  mode: 'dim' | 'hide';
}
export const emptyFilters: Filters = {
  owner: '',
  status: '',
  kind: '',
  tag: '',
  from: '',
  to: '',
  mode: 'dim',
};
export function base(): Base {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), version: 1, createdAt: now, updatedAt: now };
}
export function newNode(diagramId: string, partial: Partial<GraphNode> = {}): GraphNode {
  return {
    ...base(),
    diagramId,
    title: 'Untitled node',
    nodeType: 'generic',
    x: 0,
    y: 0,
    width: 200,
    height: 86,
    tags: [],
    ownerIds: [],
    collapsed: false,
    metadata: {},
    ...partial,
  };
}
export function newEdge(
  diagramId: string,
  sourceNodeId: string,
  targetNodeId: string,
  partial: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    ...base(),
    diagramId,
    sourceNodeId,
    targetNodeId,
    edgeType: 'relationship',
    direction: 'forward',
    style: 'solid',
    metadata: {},
    ...partial,
  };
}
export function blankGraph(name: string, type: DiagramType = 'blank'): Graph {
  return {
    format: 'visual-nerve',
    formatVersion: 1,
    diagram: {
      ...base(),
      name,
      type,
      favorite: false,
      tags: [],
      metadata: {},
      settings: { grid: true, snap: false },
    },
    nodes: [],
    edges: [],
    owners: [],
  };
}
export function descendantIds(nodes: GraphNode[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes)
    if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const result = new Set<string>();
  const queue = [...(children.get(id) ?? [])];
  for (let i = 0; i < queue.length; i++)
    if (!result.has(queue[i])) {
      result.add(queue[i]);
      queue.push(...(children.get(queue[i]) ?? []));
    }
  return result;
}
export function ownersFor(graph: Graph, owners: Owner[]): Graph {
  const ids = new Set(graph.nodes.flatMap((n) => n.ownerIds));
  return { ...graph, owners: owners.filter((o) => ids.has(o.id)) };
}
