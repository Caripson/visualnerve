import type {
  AnalyticsExtension,
  AnalyticsScenario,
  AnalyticsScenarioView,
  AnalyticsUnit,
  AnalysisJobRequest,
  AnalysisJobValue,
  Observation,
} from './types';
import { analyticsService, type AnalysisRunOptions } from './service';
import { AnalyticsError, strictKeys, validateScenarioHistorySource } from './validation';
import { contiguous } from './series';
import type { AnalyticsSvgSeries } from './vector-renderer';

/** UI and API select historical balances explicitly; numerical assumptions never infer a source. */
export async function prepareScenarioHistory(
  model: AnalyticsExtension,
  scenarios: AnalyticsScenario[],
  view: AnalyticsScenarioView = model.scenarioView ?? {},
  controls: AnalysisRunOptions = {},
  queryRunner?: (
    request: Extract<AnalysisJobRequest, { kind: 'query' }>,
  ) => Promise<AnalysisJobValue>,
): Promise<{
  history: AnalyticsSvgSeries[];
  customerUnit: AnalyticsUnit;
  mrcUnit: AnalyticsUnit;
}> {
  strictKeys(view as unknown, ['customerHistorySeriesId', 'mrcHistorySeriesId'], 'scenarioView');
  const scenario = scenarios[0];
  if (
    !scenario ||
    scenarios.some(
      (item) =>
        item.start !== scenario.start ||
        item.assumptions.currency !== scenario.assumptions.currency,
    )
  )
    throw new AnalyticsError(
      'INCOMPATIBLE_UNITS',
      'Historical scenario comparison requires a common start and currency.',
    );
  await controls.guard?.();
  controls.signal?.throwIfAborted();
  const end = new Date(Date.parse(scenario.start) - 1).toISOString();
  const history: AnalyticsSvgSeries[] = [];
  let customerUnit: AnalyticsUnit = { kind: 'count', label: 'customers' };
  let mrcUnit: AnalyticsUnit = {
    kind: 'currency',
    label: 'MRC',
    currency: scenario.assumptions.currency,
  };
  for (const [key, kind] of [
    ['customerHistorySeriesId', 'count'],
    ['mrcHistorySeriesId', 'currency'],
  ] as const) {
    const id = view[key];
    if (id === undefined) continue;
    const source = validateScenarioHistorySource(
      model.series.find((item) => item.id === id),
      kind,
      `scenarioView.${key}`,
      scenario.assumptions.currency,
    );
    await controls.guard?.();
    controls.signal?.throwIfAborted();
    const request: Extract<AnalysisJobRequest, { kind: 'query' }> = {
      kind: 'query',
      model,
      seriesId: id,
      query: { to: end, resolution: 'month' },
    };
    const points = (await (queryRunner
      ? queryRunner(request)
      : analyticsService.run(request, controls))) as Observation[];
    await controls.guard?.();
    controls.signal?.throwIfAborted();
    if (!points.length)
      throw new AnalyticsError(
        'INSUFFICIENT_DATA',
        'Selected history has no observations before the scenario start.',
        `scenarioView.${key}`,
      );
    if (new Set(points.map((point) => point.time)).size !== points.length)
      throw new AnalyticsError(
        'INCOMPATIBLE_UNITS',
        'Choose one explicit historical segment before comparing a scenario.',
        `scenarioView.${key}`,
      );
    history.push({
      id,
      name: `${source.name} (observed)`,
      unit: source.unit,
      provenance: 'observed',
      color: kind === 'count' ? '#426b9e' : '#408c8c',
      dimensions: source.dimensions,
      sourceDimensions: source.dimensions,
      dataVersion: model.datasets.find((dataset) => dataset.id === source.datasetId)?.version,
      seriesVersion: source.version ?? 1,
      points: points.map((point, index) => ({
        time: Date.parse(point.time),
        value: point.value,
        quality: point.quality,
        breakBefore:
          index > 0 && !contiguous(points[index - 1], point, { ...source, resolution: 'month' }),
      })),
    });
    if (kind === 'count') customerUnit = source.unit;
    else mrcUnit = source.unit;
  }
  await controls.guard?.();
  controls.signal?.throwIfAborted();
  return { history, customerUnit, mrcUnit };
}
