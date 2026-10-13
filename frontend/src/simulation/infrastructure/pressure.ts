import type { Bottleneck, InfrastructureMetrics, ResourceMetrics } from '../types';

/** Current resource pressure, distinct from historical queues at all referencing Work nodes. */
export function infrastructureResourcePressure(
  resource: ResourceMetrics,
  infrastructure: InfrastructureMetrics,
): Pick<Bottleneck, 'score' | 'reason' | 'methodology'> | undefined {
  const blocked = resource.blockedNodeIds?.length ?? 0;
  if (blocked)
    return {
      score: blocked * (1 + resource.currentUtilization),
      methodology: 'blocked-admission',
      reason: 'Current Work admission is blocked by this resource pool.',
    };
  const link = infrastructure.bandwidth[resource.id];
  if (link && link.activeTransfers > 1 && link.usedMbps > 0 && resource.capacity > 0)
    return {
      score: (link.activeTransfers - 1) * (link.usedMbps / resource.capacity),
      methodology: 'bandwidth-sharing',
      reason: 'Concurrent transfers share the available bandwidth.',
    };
  const energy = infrastructure.energy[resource.id];
  if (energy && energy.unmetKW > 0)
    return {
      score: energy.unmetKW / (energy.suppliedKW + energy.unmetKW),
      methodology: 'energy-shortfall',
      reason: 'Requested energy power exceeds the currently available supply.',
    };
  return undefined;
}
