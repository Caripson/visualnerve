import type { EconomicMetrics, SimulationResult, SimulationComparison, CashPoint } from './types';
export const zeroEconomics = (): EconomicMetrics => ({
  expectedRevenue: 0,
  realizedRevenue: 0,
  operatingCost: 0,
  resourceCost: 0,
  scalingCost: 0,
  investmentCost: 0,
  cost: 0,
  contribution: 0,
  cumulativeCashImpact: 0,
  lostRevenue: 0,
});
export function finishEconomics(v: EconomicMetrics) {
  v.cost = v.operatingCost + v.resourceCost + v.scalingCost;
  v.contribution = v.realizedRevenue - v.cost;
  v.cumulativeCashImpact = v.contribution - v.investmentCost;
  return v;
}

function cashAt(result: SimulationResult, t: number, before = false) {
  const points = result.cashTimeline;
  if (!points.length) return 0;
  const value = (p: CashPoint) =>
    p.revenue - p.operatingCost - p.resourceCost - p.scalingCost - p.investmentCost;
  let previous = points[0];
  for (const point of points) {
    if (point.timeSeconds >= t) {
      if (point.timeSeconds === t && !before) return value(point);
      if (point.timeSeconds === previous.timeSeconds) return value(previous);
      const fraction = Math.max(
        0,
        Math.min(1, (t - previous.timeSeconds) / (point.timeSeconds - previous.timeSeconds)),
      );
      const continuousPrevious =
        previous.operatingCost - (previous.operatingCostFixed ?? 0) + previous.resourceCost;
      const continuousNext =
        point.operatingCost - (point.operatingCostFixed ?? 0) + point.resourceCost;
      return (
        previous.revenue -
        (previous.operatingCostFixed ?? 0) -
        previous.scalingCost -
        previous.investmentCost -
        continuousPrevious -
        (continuousNext - continuousPrevious) * fraction
      );
    }
    previous = point;
  }
  return value(previous);
}
export function compareSimulationResults(
  baseline: SimulationResult,
  scenario: SimulationResult,
): SimulationComparison {
  const warnings: string[] = [];
  if (baseline.seed !== scenario.seed) warnings.push('Different seeds.');
  if (baseline.durationSeconds !== scenario.durationSeconds)
    warnings.push('Different simulation durations.');
  const delta = Object.fromEntries(
    Object.keys(zeroEconomics()).map((k) => [
      k,
      scenario.metrics[k as keyof EconomicMetrics] - baseline.metrics[k as keyof EconomicMetrics],
    ]),
  ) as SimulationComparison['delta'];
  Object.assign(delta, {
    completed: scenario.metrics.completed - baseline.metrics.completed,
    abandoned: scenario.metrics.abandoned - baseline.metrics.abandoned,
    averageWaitSeconds: scenario.metrics.queue.wait.average - baseline.metrics.queue.wait.average,
    averageTtrSeconds: scenario.metrics.ttr.average - baseline.metrics.ttr.average,
    maximumQueue: scenario.metrics.queue.maximum - baseline.metrics.queue.maximum,
  });
  const times = [
    ...new Set([...baseline.cashTimeline, ...scenario.cashTimeline].map((p) => p.timeSeconds)),
  ].sort((a, b) => a - b);
  let payback: number | null = null,
    previous = times[0] ?? 0,
    prior = cashAt(scenario, previous) - cashAt(baseline, previous);
  const investment = scenario.metrics.investmentCost - baseline.metrics.investmentCost;
  if (investment > 0 && prior >= 0) payback = previous;
  for (const time of times.slice(1)) {
    if (payback !== null) break;
    const before = cashAt(scenario, time, true) - cashAt(baseline, time, true);
    const current = cashAt(scenario, time) - cashAt(baseline, time);
    if (investment > 0 && prior < 0 && before >= 0) {
      payback = previous + ((time - previous) * -prior) / (before - prior);
      break;
    }
    if (investment > 0 && before < 0 && current >= 0) {
      payback = time;
      break;
    }
    previous = time;
    prior = current;
  }
  return {
    baselineRunId: baseline.runId,
    scenarioRunId: scenario.runId,
    baseline: baseline.metrics,
    scenario: scenario.metrics,
    delta,
    incrementalCashImpact:
      scenario.metrics.cumulativeCashImpact - baseline.metrics.cumulativeCashImpact,
    paybackTimeSeconds: payback,
    paybackReached: payback !== null,
    comparable: warnings.length === 0,
    warnings,
  };
}
