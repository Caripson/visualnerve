import type { InfrastructureComparison, InfrastructureMetrics } from './types';
/** Dimension-aware subtraction: absent/new pools remain visible in each result, never become fake zeros. */
export function compareInfrastructure(
  baseline?: InfrastructureMetrics,
  scenario?: InfrastructureMetrics,
): InfrastructureComparison | undefined {
  if (!baseline || !scenario) return undefined;
  const delta = {
    cpu: {},
    memory: {},
    bandwidth: {},
    energy: {},
  } as InfrastructureComparison['delta'];
  for (const family of ['cpu', 'memory', 'bandwidth', 'energy'] as const) {
    const left = baseline[family] as unknown as Record<string, Record<string, number>>;
    const right = scenario[family] as unknown as Record<string, Record<string, number>>;
    const out = delta[family] as unknown as Record<string, Record<string, number>>;
    for (const [id, values] of Object.entries(right)) {
      if (!Object.hasOwn(left, id)) continue;
      out[id] = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, value - left[id][key]]),
      );
    }
  }
  return { baseline: structuredClone(baseline), scenario: structuredClone(scenario), delta };
}
