import { describe, expect, it } from 'vitest';
import { growthChurnInput } from '../src/analytics/example';
import { measure, evaluateSignals, aggregateOHLC } from '../src/analytics/engine';
import { archiveResult, applyImport } from '../src/analytics/document';
import { remapAnalytics } from '../src/analytics/remap';
import { reconcileAnalytics } from '../src/analytics/reconcile';
import { validateAnalytics } from '../src/analytics/validation';

describe('portable analytics document semantics', () => {
  it('bundles 60 reconciled complete months and real intraperiod observations', () => {
    const model = growthChurnInput();
    validateAnalytics(model);
    const points = model.datasets[0].observations;
    const values = (id: string) => points.filter((point) => point.seriesId === id);
    expect(values('opening-customers')).toHaveLength(60);
    expect(model.datasets[0].source.illustrative).toBe(true);
    for (let index = 0; index < 60; index++) {
      const value = (id: string) => values(id)[index].value!;
      expect(
        value('opening-customers') +
          value('new-customers') +
          value('reactivated-customers') -
          value('lost-customers'),
      ).toBe(value('closing-customers'));
      expect(
        value('opening-mrc') +
          value('new-mrc') +
          value('expansion-mrc') -
          value('contraction-mrc') -
          value('churned-mrc'),
      ).toBe(value('closing-mrc'));
      if (index)
        expect(value('opening-customers')).toBe(values('closing-customers')[index - 1].value);
    }
    expect(aggregateOHLC(model, 'daily-customers', 'month')).toHaveLength(60);
    expect(() => aggregateOHLC(model, 'churn-rate', 'month')).toThrow();
    expect(evaluateSignals(model).signals.some((signal) => signal.state === 'onset')).toBe(true);
  });

  it('keeps immutable input snapshots and remaps every portable reference without changing results', () => {
    let model = growthChurnInput();
    const content = measure(model, model.measurements[0]);
    model = archiveResult(model, content, { measurement: model.measurements[0] }, 1, {
      now: () => '2025-01-01T00:00:00.000Z',
    });
    model.measurements[0].resultId = model.results[0].id;
    const copy = remapAnalytics(model);
    expect(copy.datasets[0].id).not.toBe(model.datasets[0].id);
    expect(copy.series[0].datasetId).toBe(copy.datasets[0].id);
    expect(copy.datasets[0].observations[0].seriesId).toBe(copy.series[0].id);
    expect(copy.measurements[0].resultId).toBe(copy.results[0].id);
    expect(copy.results[0].inputSnapshot.datasets[0].id).toBe(copy.datasets[0].id);
    expect(copy.results[0].dataVersions[copy.datasets[0].id]).toBe(1);
    expect(
      copy.results[0].content.kind === 'measurement' && copy.results[0].content.metrics,
    ).toEqual(content.metrics);
    const changed = structuredClone(model);
    changed.datasets[0].observations[0].value = 999;
    const updated = reconcileAnalytics(model, changed);
    expect(updated.datasets[0].version).toBe(2);
    expect(updated.results[0].stale).toBe(true);
    expect(updated.results[0].inputSnapshot.datasets[0].observations[0].value).toBe(1000);
  });

  it('retains long-format series identities and notes when replacing observations', () => {
    const previous = growthChurnInput();
    const dataset = structuredClone(previous.datasets[0]);
    const selected = previous.series
      .slice(0, 2)
      .map((series) => ({ ...series, columnId: 'value' }));
    previous.series[0].columnId = 'value';
    previous.series[1].columnId = 'value';
    previous.series[0].version = 3;
    dataset.observations = dataset.observations.filter((point) =>
      selected.some((series) => series.id === point.seriesId),
    );
    const series = selected.map((entry) => ({ ...entry, id: `new-${entry.id}` }));
    dataset.observations = dataset.observations.map((point) => ({
      ...point,
      seriesId: `new-${point.seriesId}`,
    }));
    const next = applyImport(
      previous,
      {
        dataset,
        series,
        issues: [],
        columns: [],
        sample: [],
        valid: true,
        rows: 120,
        skippedRows: 0,
      },
      'replace',
    );
    expect(
      next.series.filter((entry) => entry.columnId === 'value').map((entry) => entry.id),
    ).toEqual(selected.map((entry) => entry.id));
    expect(next.measurements).toEqual(previous.measurements);
    expect(next.rules).toEqual(previous.rules);
    expect(next.datasets[0].version).toBe(2);
    expect(previous.datasets[0].version).toBe(1);
    expect(next.series.find((entry) => entry.id === previous.series[0].id)?.version).toBe(3);
  });

  it('expires locked results without deleting definitions and preserves external process references', () => {
    let model = growthChurnInput();
    model.retention.results = 1;
    model = archiveResult(model, measure(model, model.measurements[0]), {}, 1);
    model.measurements[0].resultId = model.results[0].id;
    model.scenarios[0].processLink = {
      diagramId: 'external-process',
      scenarioId: model.scenarios[0].id,
      parameter: 'arrivalRate',
      unit: 'customers/month',
      resolution: 'month',
      reviewed: true,
    };
    const copied = remapAnalytics(model);
    expect(copied.scenarios[0].processLink).toEqual(model.scenarios[0].processLink);
    const next = archiveResult(model, measure(model, model.measurements[0]), {}, 1);
    expect(next.results).toHaveLength(1);
    expect(next.measurements[0].resultId).toBeUndefined();
    expect(next.measurements[0].name).toBe('Retention shift');
    expect(model.measurements[0].resultId).toBeDefined();
  });

  it('remaps captured compound-rule evidence and local mapping sources while preserving external targets', () => {
    const model = growthChurnInput();
    model.signals = evaluateSignals(model).signals;
    model.scenarios[0].processLink = {
      diagramId: 'external-process',
      scenarioId: 'external-scenario',
      nodeId: 'external-source',
      sourceSeriesId: 'new-customers',
      parameter: 'source.ratePerHour',
      unit: 'customers',
      resolution: 'month',
      reviewed: true,
    };
    const copy = remapAnalytics(model);
    expect(copy.scenarios[0].processLink).toMatchObject({
      diagramId: 'external-process',
      scenarioId: 'external-scenario',
      nodeId: 'external-source',
      sourceSeriesId: copy.series.find((series) => series.name === 'New customers')!.id,
    });
    expect(copy.signals[0].expression).toEqual(copy.rules[0].expression);
    expect(copy.signals[0].threshold).toBeNull();
    expect(copy.signals[0].value).toBe(model.signals[0].value);
  });
});
