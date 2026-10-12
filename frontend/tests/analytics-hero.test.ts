// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { growthChurnInput } from '../src/analytics/example';
import { aggregateOHLC, evaluateSignals } from '../src/analytics/engine';
import { ANALYTICS_ENGINE_VERSION, type AnalyticsRule } from '../src/analytics/types';

interface HeroSource {
  from: string;
  to: string;
  seriesId: string;
  engineVersion: string;
  unit: string;
  threshold: number;
  rule: AnalyticsRule;
  candles: { time: string; open: number; high: number; low: number; close: number }[];
  signal: { observationTime: string; detectedAt: string; close: number };
}

function source(): HeroSource {
  return JSON.parse(
    readFileSync(new URL('../../hugo/data/analytics_hero.json', import.meta.url), 'utf8'),
  );
}

describe('homepage candlestick illustration provenance', () => {
  it('uses actual intraperiod synthetic snapshots and canonical monthly OHLC', () => {
    const hero = source();
    const model = growthChurnInput();
    expect(hero.from).toBe('2023-01-01T00:00:00.000Z');
    expect(hero.to).toBe('2024-04-30T23:59:59.999Z');
    expect(hero.seriesId).toBe('daily-customers');
    expect(hero.engineVersion).toBe(ANALYTICS_ENGINE_VERSION);
    expect(hero.unit).toBe(model.series.find((series) => series.id === hero.seriesId)?.unit.label);
    expect(model.datasets.every((dataset) => dataset.source.illustrative)).toBe(true);
    const candles = aggregateOHLC(model, hero.seriesId, 'month', {
      from: hero.from,
      to: hero.to,
    });
    expect(candles).toHaveLength(16);
    expect(hero.candles).toEqual(
      candles.map((observation) => ({ time: observation.time, ...observation.ohlc! })),
    );
    expect(hero.candles.some((candle) => candle.close > candle.open)).toBe(true);
    expect(hero.candles.some((candle) => candle.close < candle.open)).toBe(true);
  });

  it('anchors the threshold marker to an engine-produced signal and its publication time', () => {
    const hero = source();
    const model = growthChurnInput();
    expect(hero.threshold).toBe(1500);
    expect(hero.rule).toMatchObject({
      family: 'threshold',
      seriesId: 'closing-customers',
      parameters: { comparator: '<', threshold: hero.threshold },
    });
    model.rules = [hero.rule];
    const result = evaluateSignals(model, { from: hero.from, to: hero.to });
    const onset = result.signals.find((signal) => signal.state === 'onset');
    expect(onset).toBeDefined();
    expect(hero.signal).toEqual({
      observationTime: onset!.observationTime,
      detectedAt: onset!.detectedAt,
      close: onset!.value,
    });
    expect(onset!.quality).toBe('valid');
    expect(onset!.value).toBeLessThan(hero.threshold);
    expect(new Date(onset!.detectedAt).getTime()).toBeGreaterThan(
      new Date(onset!.observationTime).getTime(),
    );
    expect(hero.candles.find((candle) => candle.time === onset!.observationTime)?.close).toBe(
      onset!.value,
    );
  });
});
