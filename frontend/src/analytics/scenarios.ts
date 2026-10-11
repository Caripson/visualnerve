import type { AnalyticsScenario, ScenarioResult, AnalysisContext } from './types';
import { validateScenario, requireAnalysis, finiteNumber } from './validation';
import { checkAnalysis } from './series';
export function adjustedChurn(
  rate: number,
  adjustment?: { kind: 'relative' | 'percentage-points'; value: number },
) {
  const value = adjustment
    ? adjustment.kind === 'relative'
      ? rate * (1 + adjustment.value)
      : rate + adjustment.value / 100
    : rate;
  finiteNumber(value, 'churnRate', 0, 1);
  return value;
}
export function runScenario(
  scenario: AnalyticsScenario,
  context?: AnalysisContext,
): ScenarioResult {
  validateScenario(scenario);
  requireAnalysis(
    scenario.reviewed,
    'Review the scenario assumptions before calculating its projection.',
  );
  checkAnalysis(context);
  const a = scenario.assumptions,
    rate = adjustedChurn(a.churnRate, a.churnAdjustment);
  let customers = a.openingCustomers,
    mrc = a.openingMrc;
  const start = new Date(scenario.start);
  requireAnalysis(
    start.getUTCDate() === 1 && start.getUTCHours() === 0 && start.getUTCMinutes() === 0,
    'Monthly scenario boundaries must be the first day at 00:00 UTC.',
  );
  const points: ScenarioResult['points'] = [];
  for (let period = 0; period < scenario.periods; period++) {
    checkAnalysis(context);
    const openingCustomers = customers,
      newCustomers = a.newCustomers * (1 + a.newCustomerGrowth) ** period,
      reactivatedCustomers = a.reactivatedCustomers,
      lostCustomers = openingCustomers * rate;
    customers = openingCustomers + newCustomers + reactivatedCustomers - lostCustomers;
    requireAnalysis(customers >= 0, 'Scenario would produce a negative customer population.');
    const openingMrc = mrc,
      newMrc = a.newMrc * (1 + a.newCustomerGrowth) ** period,
      expansionMrc = a.expansionMrc,
      contractionMrc = a.contractionMrc;
    const churnedMrc =
      a.revenuePerCustomer !== undefined ? lostCustomers * a.revenuePerCustomer : a.churnedMrc;
    mrc = openingMrc + newMrc + expansionMrc - contractionMrc - churnedMrc;
    requireAnalysis(
      mrc >= 0,
      'Scenario would produce a negative MRC balance. Reduce explicit MRC outflows.',
    );
    finiteNumber(customers, 'closingCustomers');
    finiteNumber(mrc, 'closingMrc');
    points.push({
      time: new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + period, 1),
      ).toISOString(),
      openingCustomers,
      newCustomers,
      reactivatedCustomers,
      lostCustomers,
      closingCustomers: customers,
      openingMrc,
      newMrc,
      expansionMrc,
      contractionMrc,
      churnedMrc,
      closingMrc: mrc,
      provenance: 'scenario',
      expectedCounts: true,
    });
    context?.progress?.(period + 1, scenario.periods);
  }
  return {
    kind: 'scenario',
    scenarioId: scenario.id,
    currency: a.currency,
    points,
    notes: [
      'Assumption-based monthly projection, not a guaranteed forecast or statistical interval. Customer churn uses the opening customer population; new/reactivated customers enter after that loss. Counts are expected values, with no per-period rounding.',
      'MRC is a recurring balance, not recognized revenue or cash flow. Customer churn affects MRC only when an explicit revenue-per-customer assumption is supplied; otherwise churned MRC is its independent configured outflow.',
    ],
  };
}
export function compareScenarios(results: ScenarioResult[]) {
  requireAnalysis(results.length >= 2, 'Choose at least two scenario results.');
  requireAnalysis(
    results.every((r) => r.currency === results[0].currency),
    'Scenario comparison cannot convert or mix currencies.',
    undefined,
    'INCOMPATIBLE_UNITS',
  );
  requireAnalysis(
    results.every(
      (r) =>
        r.points.length === results[0].points.length &&
        r.points.every((p, i) => p.time === results[0].points[i].time),
    ),
    'Compare the same scenario horizon and start boundaries.',
  );
  return results.map((r) => ({
    scenarioId: r.scenarioId,
    currency: r.currency,
    closingCustomers: r.points.at(-1)?.closingCustomers ?? null,
    closingMrc: r.points.at(-1)?.closingMrc ?? null,
    lostCustomers: r.points.reduce((sum, p) => sum + p.lostCustomers, 0),
    customerDifference:
      (r.points.at(-1)?.closingCustomers ?? 0) - (results[0].points.at(-1)?.closingCustomers ?? 0),
    mrcDifference: (r.points.at(-1)?.closingMrc ?? 0) - (results[0].points.at(-1)?.closingMrc ?? 0),
  }));
}
