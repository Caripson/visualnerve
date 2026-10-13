import type { Improvement, SimulationModel } from '../types';
export function infrastructureImprovementPolicy(
  model: SimulationModel,
  nodeId?: string,
  resourceId?: string,
) {
  const node = model.nodes.find((value) => value.id === nodeId);
  const pool = model.resources.find((value) => value.id === resourceId);
  const energy =
    pool?.infrastructure?.kind === 'energy' ||
    (node?.type === 'work' && !!node.work.infrastructure?.energy);
  const bandwidth = pool?.infrastructure?.kind === 'bandwidth';
  return {
    explicitActivity: energy || bandwidth,
    bandwidth,
    pool,
    clear: (energy || bandwidth
      ? {
          processingTimeMultiplier: undefined,
          resourceUnitsMultiplier: undefined,
          ...(bandwidth
            ? {
                revenueMultiplier: undefined,
                failureProbability: undefined,
                failureNodeId: undefined,
              }
            : {}),
        }
      : {}) as Partial<Improvement>,
  };
}
