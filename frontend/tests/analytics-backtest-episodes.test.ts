import { expect, it } from 'vitest';
import { growthChurnInput } from '../src/analytics/example';
import { backtest, evaluateSignals } from '../src/analytics/engine';
import type { BacktestConfig } from '../src/analytics/types';

it('Signal Lab counts the same sustained Growth & Churn episode across prefix folds', () => {
  const model = growthChurnInput();
  const times = [
    ...new Set(
      model.datasets.flatMap((dataset) => dataset.observations.map((point) => point.time)),
    ),
  ].sort();
  const config: BacktestConfig = {
    id: 'episode-lab',
    name: 'Historical rule validation',
    ruleIds: model.rules.filter((rule) => rule.enabled).map((rule) => rule.id),
    from: times[0],
    to: times.at(-1)!,
    trainEnd: times[Math.floor(times.length / 3)],
    validationEnd: times[Math.floor((times.length * 2) / 3)],
    holdoutStart: times[Math.min(times.length - 1, Math.floor((times.length * 2) / 3) + 1)],
    walkForwardPeriods: 12,
    trials: 1,
  };
  const history = evaluateSignals(model, {}, { cutoff: config.to }).signals;
  const holdout = history.filter(
    (signal) => signal.detectedAt >= config.holdoutStart && signal.detectedAt <= config.to,
  );
  expect(new Set(holdout.map((signal) => signal.episodeId)).size).toBe(1);
  expect(holdout.filter((signal) => signal.state === 'onset')).toHaveLength(1);
  for (const walkForwardPeriods of [1, 3, 12]) {
    const actual = backtest(model, { ...config, walkForwardPeriods });
    expect(actual.results.find((result) => result.split === 'holdout')).toMatchObject({
      signals: 15,
      episodes: 1,
      activePeriods: 15,
      exposedPeriods: 19,
      evaluablePeriods: 19,
    });
  }
});
