import type { ScenarioPatch, SimulationEdge, SimulationNode } from '../types';
import type { InfrastructureEdge, InfrastructureWork } from './types';

/** Dependencies are semantic resource IDs; layout never participates in this lookup. */
export function infrastructureWorkResources(work: InfrastructureWork | undefined): string[] {
  return [
    ...(work?.cpu ? [work.cpu.resourceId] : []),
    ...(work?.energy ? [work.energy.resourceId] : []),
    ...(work?.memory ?? []).map((lease) => lease.resourceId),
    ...(work?.releaseMemoryResourceIds ?? []),
  ];
}

export function simulationResourceReferences(
  nodes: readonly SimulationNode[],
  edges: readonly SimulationEdge[],
): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'resource') ids.add(node.resourceId);
    if (node.type === 'work') {
      for (const requirement of node.work.resourceRequirements ?? [])
        ids.add(requirement.resourceId);
      for (const id of infrastructureWorkResources(node.work.infrastructure)) ids.add(id);
    }
    if (node.type === 'router')
      for (const rule of node.router.rules ?? [])
        if (rule.condition && 'resourceId' in rule.condition && rule.condition.resourceId)
          ids.add(rule.condition.resourceId);
  }
  for (const edge of edges)
    if (edge.infrastructure) ids.add(edge.infrastructure.transfer.resourceId);
  return ids;
}

/** Preserve partial patches and explicit null removals while remapping dependencies. */
export function remapInfrastructureWork<
  T extends InfrastructureWork | ScenarioPatch<InfrastructureWork> | null | undefined,
>(input: T, resourceId: (id: string) => string): T {
  if (input == null) return input;
  const result = structuredClone(input) as InfrastructureWork | ScenarioPatch<InfrastructureWork>;
  if (typeof result.cpu?.resourceId === 'string')
    result.cpu.resourceId = resourceId(result.cpu.resourceId);
  if (typeof result.energy?.resourceId === 'string')
    result.energy.resourceId = resourceId(result.energy.resourceId);
  if (result.memory)
    result.memory = result.memory.map((lease) => ({
      ...lease,
      resourceId: resourceId(lease.resourceId),
    }));
  if (result.releaseMemoryResourceIds)
    result.releaseMemoryResourceIds = result.releaseMemoryResourceIds.map(resourceId);
  return result as T;
}

export function remapInfrastructureEdge<
  T extends InfrastructureEdge | ScenarioPatch<InfrastructureEdge> | null | undefined,
>(input: T, resourceId: (id: string) => string): T {
  if (input == null) return input;
  const result = structuredClone(input) as InfrastructureEdge | ScenarioPatch<InfrastructureEdge>;
  if (typeof result.transfer?.resourceId === 'string')
    result.transfer.resourceId = resourceId(result.transfer.resourceId);
  return result as T;
}
