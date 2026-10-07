import { newNode, type Graph, type GraphEdge, type GraphNode } from '../model/types';
import { ProcessHierarchy } from './process-hierarchy';
import { logicalNodeId } from './capacity-projection';
import { ProcessViewLayout } from './process-view-layout';
import { ProcessConnections } from './process-connections';
import type { SimulationModel } from './types';
import type { ProcessView } from './process-navigation';

const prefix = 'simulation-process:';
export const simulationProcessCardId = (id: string) => `${prefix}${id}`;
export function getSimulationProcessId(node: GraphNode) {
  return typeof node.metadata.simulationProcessId === 'string'
    ? node.metadata.simulationProcessId
    : undefined;
}
export interface ProcessProjectionResult {
  graph: Graph;
  processId?: string;
  hierarchy: ProcessHierarchy;
  active: boolean;
  focusNodeIds: string[];
}

/** Read-only grouping of genuine process steps. Containers never execute additional work. */
export class ProcessProjection {
  readonly hierarchy: ProcessHierarchy;
  private readonly resourceRepresentatives = new Map<string, string>();
  private readonly semantic: Map<string, NonNullable<Graph['simulation']>['nodes'][number]>;
  constructor(readonly model: SimulationModel) {
    this.hierarchy = new ProcessHierarchy(model);
    this.semantic = new Map(model.nodes.map((node) => [node.id, node]));
    for (const node of model.nodes)
      if (node.type === 'resource' && !this.resourceRepresentatives.has(node.resourceId))
        this.resourceRepresentatives.set(node.resourceId, node.id);
  }
  project(graph: Graph, view: ProcessView): ProcessProjectionResult {
    const processId =
      view.processId && this.hierarchy.processes.has(view.processId) ? view.processId : undefined;
    if (view.mode === 'all' || !this.hierarchy.processes.size)
      return { graph, hierarchy: this.hierarchy, active: false, processId, focusNodeIds: [] };
    const primary = new Set<string>();
    const representatives = new Map<string, string>();
    const cards = new Set<string>();
    const childIds = new Set(this.hierarchy.children(processId));
    const pathToScope = (id?: string) => {
      if (!id) return undefined;
      const path = this.hierarchy.ancestry(id);
      if (!processId) return path.at(-1);
      if (id === processId) return undefined;
      const index = path.indexOf(processId);
      if (index >= 0) return path[index - 1];
      return path.find((entry) => childIds.has(entry)) ?? path.at(-1);
    };
    for (const node of graph.nodes) {
      const logicalId = logicalNodeId(node);
      const semanticNode = this.semantic.get(logicalId);
      // Shared pools stay visible as global resources instead of being cloned inside groups.
      const member = semanticNode?.type === 'resource' ? undefined : semanticNode?.processId;
      const representedProcess = pathToScope(member);
      const representative = representedProcess
        ? simulationProcessCardId(representedProcess)
        : semanticNode?.type === 'resource'
          ? this.resourceRepresentatives.get(semanticNode.resourceId)!
          : node.id;
      representatives.set(node.id, representative);
      if (representedProcess) cards.add(representedProcess);
      if (
        !processId ||
        member === processId ||
        (representedProcess && childIds.has(representedProcess))
      )
        primary.add(representative);
    }
    // Preserve empty processes as editable, openable containers as well.
    for (const id of childIds) {
      cards.add(id);
      primary.add(simulationProcessCardId(id));
    }
    const visible = new Set(primary);
    for (const edge of graph.edges) {
      const source = representatives.get(edge.sourceNodeId),
        target = representatives.get(edge.targetNodeId);
      if (!source || !target || source === target) continue;
      if (primary.has(source) || primary.has(target)) {
        visible.add(source);
        visible.add(target);
      }
    }
    const members = new Map<string, GraphNode[]>();
    for (const node of graph.nodes) {
      const id = representatives.get(node.id)!;
      if (id.startsWith(prefix)) {
        const group = members.get(id) ?? [];
        group.push(node);
        members.set(id, group);
      }
    }
    const projectedNodes: GraphNode[] = graph.nodes
      .filter((node) => visible.has(node.id))
      .map((node) => {
        const config = this.semantic.get(logicalNodeId(node));
        if (config?.type === 'resource')
          return {
            ...node,
            title: config.name,
            metadata: {
              ...node.metadata,
              simulationProjected: true,
              simulationPoolSummary: true,
              simulationLogicalNodeId: config.id,
              simulationResourceId: config.resourceId,
              simulationResourceCapacity: node.metadata.simulationCapacityTotal,
              simulationCapacityUnit: undefined,
              simulationCapacityTotal: undefined,
              simulationCapacityHidden: undefined,
              simulationProcessRole: 'resource',
            },
          };
        const isBoundary = !primary.has(node.id);
        return {
          ...node,
          height: config?.type === 'source' ? 150 : node.height,
          metadata: {
            ...node.metadata,
            simulationProcessRole:
              config?.type === 'source' ? 'source' : isBoundary ? 'context' : 'primary',
          },
        };
      });
    for (const id of cards) {
      const cardId = simulationProcessCardId(id);
      if (!visible.has(cardId)) continue;
      const process = this.hierarchy.processes.get(id)!;
      const shapes = members.get(cardId) ?? [];
      const nodeIds = this.hierarchy.nodeIds(id);
      projectedNodes.push(
        newNode(graph.diagram.id, {
          id: cardId,
          title: process.name,
          description: process.description,
          nodeType: 'process',
          x: shapes.length
            ? Math.min(...shapes.map((node) => node.x))
            : projectedNodes.length * 340,
          y: shapes.length ? Math.min(...shapes.map((node) => node.y)) : 0,
          width: 290,
          height: primary.has(cardId) ? 310 : 210,
          color: '#31766c',
          metadata: {
            simulationProjected: true,
            simulationProcessId: id,
            simulationProcessRole: primary.has(cardId) ? 'primary' : 'context',
            simulationProcessNodeIds: [...nodeIds],
            simulationProcessRepresentedNodeIds: [
              ...new Set(shapes.map((shape) => logicalNodeId(shape))),
            ],
            simulationProcessChildren: this.hierarchy.children(id).length,
            simulationProcessBoundary: !primary.has(cardId),
            simulationProcessBoundaryKind:
              processId && this.hierarchy.ancestry(processId).includes(id)
                ? 'ancestor'
                : 'external',
          },
        }),
      );
    }
    const buckets = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
      const source = representatives.get(edge.sourceNodeId),
        target = representatives.get(edge.targetNodeId);
      if (!source || !target || source === target || !visible.has(source) || !visible.has(target))
        continue;
      if (!primary.has(source) && !primary.has(target)) continue;
      const key = JSON.stringify([
        edge.edgeType === 'simulation-resource' ? 'resource' : 'flow',
        source,
        target,
      ]);
      const bucket = buckets.get(key) ?? [];
      bucket.push(edge);
      buckets.set(key, bucket);
    }
    const edges = [...buckets.values()].map((group) => {
      const first = group[0];
      const sourceNodeId = representatives.get(first.sourceNodeId)!;
      const targetNodeId = representatives.get(first.targetNodeId)!;
      const logicalIds = [
        ...new Set(
          group.map((edge) =>
            typeof edge.metadata.simulationLogicalEdgeId === 'string'
              ? edge.metadata.simulationLogicalEdgeId
              : edge.id,
          ),
        ),
      ];
      if (
        group.length === 1 &&
        sourceNodeId === first.sourceNodeId &&
        targetNodeId === first.targetNodeId
      )
        return first;
      return {
        ...first,
        id: `simulation-process-edge:${JSON.stringify([first.edgeType, sourceNodeId, targetNodeId])}`,
        sourceNodeId,
        targetNodeId,
        label: logicalIds.length > 1 ? `${logicalIds.length} connections` : first.label,
        metadata: {
          ...first.metadata,
          simulationProjected: true,
          simulationProcessEdge: true,
          simulationLogicalEdgeIds: logicalIds,
          simulationConnectionCount: logicalIds.length,
        },
      };
    });
    const nodes = new ProcessViewLayout().arrange(projectedNodes, edges);
    return {
      graph: { ...graph, nodes, edges: new ProcessConnections().project(nodes, edges) },
      processId,
      hierarchy: this.hierarchy,
      active: true,
      focusNodeIds: nodes
        .filter((node) => node.metadata.simulationProcessRole === 'primary')
        .map((node) => node.id),
    };
  }
}
