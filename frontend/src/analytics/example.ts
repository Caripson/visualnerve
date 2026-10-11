import type { AnalyticsExtension, AnalyticsSeries, AnalyticsScenario, Observation } from './types';
import { blankAnalytics, validateAnalytics } from './validation';
import { archiveResult } from './document';

const count = { kind: 'count', label: 'customers' } as const;
const currency = { kind: 'currency', label: 'SEK MRC', currency: 'SEK' } as const;
const ratio = { kind: 'ratio', label: 'customer churn' } as const;
const datasetId = 'illustrative-growth-history';
const timestamp = (month: number, day = 1) => new Date(Date.UTC(2020, month, day)).toISOString();
const fixedNow = () => '2025-01-01T00:00:00.000Z';

/** Synthetic observations have explicit accounting identities and real intraperiod timestamps. */
export function growthChurnInput(): AnalyticsExtension {
  const model = blankAnalytics();
  const definitions: [
    string,
    string,
    AnalyticsSeries['unit'],
    AnalyticsSeries['semantics'],
    AnalyticsSeries['aggregation'],
    AnalyticsSeries['direction'],
  ][] = [
    ['opening-customers', 'Opening customers', count, 'snapshot', 'first', 'neutral'],
    ['new-customers', 'New customers', count, 'flow', 'sum', 'higher-is-better'],
    ['reactivated-customers', 'Reactivated customers', count, 'flow', 'sum', 'higher-is-better'],
    ['lost-customers', 'Lost customers', count, 'flow', 'sum', 'lower-is-better'],
    ['closing-customers', 'Closing customers', count, 'snapshot', 'last', 'higher-is-better'],
    ['churn-rate', 'Customer churn', ratio, 'rate', 'ratio', 'lower-is-better'],
    ['net-growth', 'Net customer growth', count, 'flow', 'sum', 'higher-is-better'],
    ['opening-mrc', 'Opening MRC', currency, 'snapshot', 'first', 'neutral'],
    ['new-mrc', 'New MRC', currency, 'flow', 'sum', 'higher-is-better'],
    ['expansion-mrc', 'Expansion MRC', currency, 'flow', 'sum', 'higher-is-better'],
    ['contraction-mrc', 'Contraction MRC', currency, 'flow', 'sum', 'lower-is-better'],
    ['churned-mrc', 'Churned MRC', currency, 'flow', 'sum', 'lower-is-better'],
    ['closing-mrc', 'Closing MRC', currency, 'snapshot', 'last', 'higher-is-better'],
    [
      'daily-customers',
      'Daily customer-base snapshots',
      count,
      'snapshot',
      'last',
      'higher-is-better',
    ],
  ];
  model.series = definitions.map(([id, name, unit, semantics, aggregation, direction]) => ({
    id,
    name,
    datasetId,
    columnId: id,
    dimensions: {},
    unit,
    semantics,
    aggregation,
    direction,
    provenance: 'observed',
    resolution: id === 'daily-customers' ? 'day' : 'month',
    timezone: 'UTC',
    periodBoundary: 'start',
    ...(id === 'churn-rate' ? { riskPopulation: 'opening-customers' as const } : {}),
    definition:
      id === 'churn-rate'
        ? 'Lost customers / opening customers. New and reactivated customers are outside this period risk population.'
        : id === 'daily-customers'
          ? 'Synthetic daily snapshots, including an opening and closing observation in each month. OHLC uses these actual timestamped observations.'
          : 'Illustrative example data. Month-start timestamp labels a complete calendar month; published at next month start.',
  }));
  const observations: Observation[] = [];
  let customers = 1000,
    mrc = 100000;
  let final: Record<string, number> = {};
  for (let month = 0; month < 60; month++) {
    const opening = customers;
    const seasonal = Math.sin(((month % 12) / 12) * Math.PI * 2);
    const rate = (month >= 42 ? 0.027 : 0.018) + seasonal * 0.002 + (month === 29 ? 0.021 : 0);
    const added = Math.round((month >= 42 ? 24 : 36) + 7 * seasonal);
    const reactivated = 3;
    const lost = Math.round(opening * rate);
    customers = opening + added + reactivated - lost;
    const newMrc = added * 110,
      expansion = 600,
      contraction = 350,
      churned = lost * 95;
    const openingMrc = mrc;
    mrc = openingMrc + newMrc + expansion - contraction - churned;
    const values: Record<string, number> = {
      'opening-customers': opening,
      'new-customers': added,
      'reactivated-customers': reactivated,
      'lost-customers': lost,
      'closing-customers': customers,
      'churn-rate': lost / opening,
      'net-growth': customers - opening,
      'opening-mrc': openingMrc,
      'new-mrc': newMrc,
      'expansion-mrc': expansion,
      'contraction-mrc': contraction,
      'churned-mrc': churned,
      'closing-mrc': mrc,
    };
    final = values;
    for (const [seriesId, value] of Object.entries(values))
      observations.push({
        id: `${seriesId}-${month}`,
        seriesId,
        time: timestamp(month),
        periodEnd: timestamp(month + 1),
        knownAt: timestamp(month + 1),
        value,
        dimensions: {},
        quality: 'valid',
        ...(seriesId === 'churn-rate' ? { numerator: lost, denominator: opening } : {}),
      });
    const days = new Date(Date.UTC(2020, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const fraction = (day - 1) / (days - 1);
      observations.push({
        id: `daily-${month}-${day}`,
        seriesId: 'daily-customers',
        time: timestamp(month, day),
        value: Math.round(
          opening + fraction * (customers - opening) + Math.sin(fraction * Math.PI * 4) * 5,
        ),
        knownAt: timestamp(month, day + 1),
        dimensions: {},
        quality: 'valid',
      });
    }
  }
  model.datasets = [
    {
      id: datasetId,
      name: 'Illustrative example data — Growth & Churn',
      version: 1,
      source: { kind: 'example', name: 'Bundled synthetic business history', illustrative: true },
      observations,
      importedAt: fixedNow(),
      revisionHistory: 'point-in-time',
      transformations: [
        '60 complete UTC calendar months, January 2020–December 2024.',
        'Seasonal acquisition and churn cycle: 12 months.',
        'One isolated churn anomaly: June 2022.',
        'Persistent retention pressure and lower acquisition: July 2023 onward.',
        'Customer loss uses opening customers; monthly customer and MRC balances reconcile exactly.',
        'Daily synthetic snapshots are independently timestamped, not fabricated OHLC from monthly churn.',
        'All observations and publication timestamps are illustrative; no external source is implied.',
      ],
    },
  ];
  model.charts = [
    {
      id: 'growth-chart',
      name: 'Growth and losses',
      kind: 'line',
      seriesIds: ['new-customers', 'lost-customers', 'net-growth'],
      resolution: 'month',
      normalized: false,
    },
    {
      id: 'retention-chart',
      name: 'Customer churn',
      kind: 'line',
      seriesIds: ['churn-rate'],
      resolution: 'month',
      normalized: false,
    },
    {
      id: 'daily-candles',
      name: 'Customer-base OHLC from daily observations',
      kind: 'candlestick',
      seriesIds: ['daily-customers'],
      resolution: 'month',
      normalized: false,
    },
    {
      id: 'customer-waterfall',
      name: 'Customer balance reconciliation',
      kind: 'waterfall',
      seriesIds: ['new-customers', 'reactivated-customers', 'lost-customers'],
      resolution: 'month',
      normalized: false,
      waterfall: {
        openingSeriesId: 'opening-customers',
        closingSeriesId: 'closing-customers',
        components: [
          { seriesId: 'new-customers', sign: 1 },
          { seriesId: 'reactivated-customers', sign: 1 },
          { seriesId: 'lost-customers', sign: -1 },
        ],
      },
    },
  ];
  model.indicators = [
    {
      id: 'churn-sma',
      name: 'Churn SMA (3 months)',
      seriesId: 'churn-rate',
      kind: 'sma',
      window: 3,
    },
  ];
  model.measurements = [
    {
      id: 'retention-measurement',
      name: 'Retention shift',
      kind: 'point-to-point',
      seriesIds: ['churn-rate'],
      from: timestamp(36),
      to: timestamp(54),
      note: 'Compare the pre-shift and post-shift churn; lower is better.',
    },
  ];
  model.rules = [
    {
      id: 'retention-pressure',
      name: 'Retention pressure',
      version: 1,
      enabled: true,
      family: 'custom',
      seriesId: 'churn-rate',
      severity: 'warning',
      parameters: { consecutive: 3, cooldown: 0, hysteresis: 0 },
      expression: {
        kind: 'and',
        children: [
          {
            kind: 'comparison',
            left: { kind: 'series', seriesId: 'churn-rate' },
            operator: '>',
            right: { kind: 'constant', value: 0.02 },
          },
          {
            kind: 'comparison',
            left: { kind: 'series', seriesId: 'net-growth' },
            operator: '<',
            right: { kind: 'constant', value: 0 },
          },
        ],
      },
    },
  ];
  model.scenarios = [
    { id: 'baseline', name: 'Baseline', churnRate: 0.018, newCustomers: 36 },
    {
      id: 'current-trend',
      name: 'Current trend',
      churnRate: final['churn-rate'],
      newCustomers: final['new-customers'],
    },
    { id: 'stress', name: 'Stress scenario', churnRate: 0.04, newCustomers: 20 },
  ].map(
    ({ id, name, churnRate, newCustomers }): AnalyticsScenario => ({
      id,
      name,
      version: 1,
      model: 'growth-churn',
      start: timestamp(60),
      periods: 12,
      resolution: 'month',
      reviewed: true,
      assumptions: {
        openingCustomers: customers,
        newCustomers,
        reactivatedCustomers: 3,
        churnRate,
        newCustomerGrowth: 0,
        openingMrc: mrc,
        newMrc: newCustomers * 110,
        expansionMrc: 600,
        contractionMrc: 350,
        churnedMrc: final['churned-mrc'],
        currency: 'SEK',
      },
    }),
  );
  validateAnalytics(model);
  return model;
}

/** The example uses the same worker service as imported data; no result markers are hard-coded. */
export async function createAnalyticsExample(signal?: AbortSignal): Promise<AnalyticsExtension> {
  let model = growthChurnInput();
  const { analyticsService } = await import('./service');
  const signals = await analyticsService.run({ kind: 'signals', model }, { signal });
  if (!Array.isArray(signals) && 'kind' in signals && signals.kind === 'signals')
    model.signals = signals.signals;
  for (const measurement of model.measurements) {
    const result = await analyticsService.run(
      { kind: 'measurement', model, measurement },
      { signal },
    );
    if (!Array.isArray(result) && 'kind' in result && result.kind === 'measurement') {
      model = archiveResult(model, result, { measurement }, 1, { now: fixedNow, signal });
      model.measurements.find((entry) => entry.id === measurement.id)!.resultId =
        model.results.at(-1)!.id;
    }
  }
  for (const scenario of model.scenarios) {
    const result = await analyticsService.run({ kind: 'scenario', scenario }, { signal });
    if (!Array.isArray(result) && 'kind' in result && result.kind === 'scenario')
      model = archiveResult(model, result, { scenario }, 1, { now: fixedNow, signal });
  }
  validateAnalytics(model);
  return model;
}
