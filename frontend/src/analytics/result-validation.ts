import type { AnalyticsExtension, AnalyticsResultContent, AnalyticsSignal } from './types';
import { ANALYTICS_ENGINE_VERSION, analyticsLimits } from './types';
import {
  analyticsId,
  assertFiniteJson,
  finiteNumber,
  isoTime,
  requireAnalysis,
  strictKeys,
  validateExpression,
  validateRule,
} from './validation';

function text(value: unknown, path: string, limit = 4000) {
  requireAnalysis(
    typeof value === 'string' && value.length <= limit,
    'Invalid bounded text.',
    path,
  );
}
function whole(value: unknown, path: string, max = 20000000) {
  finiteNumber(value, path, 0, max);
  requireAnalysis(Number.isInteger(value), 'Expected a nonnegative whole number.', path);
}
function array(
  value: unknown,
  path: string,
  max: number = analyticsLimits.observations,
): asserts value is unknown[] {
  requireAnalysis(
    Array.isArray(value) && value.length <= max,
    'Result array exceeds its limit.',
    path,
  );
}
function enumeration(value: unknown, values: readonly string[], path: string) {
  requireAnalysis(
    typeof value === 'string' && values.includes(value),
    'Unsupported result value.',
    path,
  );
}
export function validateInterval(value: unknown, path: string) {
  strictKeys(value, ['from', 'to'], path);
  isoTime(value.from, `${path}.from`);
  isoTime(value.to, `${path}.to`);
  requireAnalysis(value.from <= value.to, 'Result interval is reversed.', path);
}
function nullableNumber(value: unknown, path: string) {
  if (value !== null) finiteNumber(value, path, -Number.MAX_VALUE, Number.MAX_VALUE);
}
function metric(value: unknown, path: string) {
  strictKeys(value, ['value', 'reason', 'explanation'], path);
  nullableNumber(value.value, `${path}.value`);
  if (value.reason !== undefined)
    enumeration(
      value.reason,
      [
        'INVALID_ANALYTICS',
        'INSUFFICIENT_DATA',
        'INVALID_OHLC',
        'INCOMPATIBLE_UNITS',
        'INVALID_RATE_DENOMINATOR',
        'STALE_ANALYSIS_RESULT',
        'AMBIGUOUS_INPUT',
        'IMPORT_LIMIT',
        'CANCELLED',
        'NUMERIC_OVERFLOW',
      ],
      `${path}.reason`,
    );
  if (value.explanation !== undefined) text(value.explanation, `${path}.explanation`);
}
function notes(value: unknown) {
  array(value, 'result.notes', 1000);
  for (const item of value) text(item, 'result.notes');
}

/** Semantic signal records are validated independently of their rendered marker. */
export function validateSignal(signal: AnalyticsSignal, model: AnalyticsExtension) {
  strictKeys(
    signal as unknown,
    [
      'id',
      'episodeId',
      'ruleId',
      'ruleVersion',
      'seriesId',
      'seriesVersion',
      'definitionFingerprint',
      'dimensions',
      'dataVersion',
      'interval',
      'observationTime',
      'onsetTime',
      'detectedAt',
      'state',
      'value',
      'deviationMagnitude',
      'deviationUnit',
      'thresholdUnit',
      'baseline',
      'threshold',
      'unit',
      'method',
      'parameters',
      'expression',
      'secondSeriesId',
      'evidence',
      'quality',
      'explanation',
      'severity',
      'acknowledged',
      'muted',
      'measurementId',
      'annotationId',
      'nodeId',
      'scenarioId',
    ],
    'signal',
  );
  for (const key of ['id', 'episodeId', 'ruleId', 'seriesId'] as const)
    analyticsId(signal[key], `signal.${key}`);
  whole(signal.ruleVersion, 'signal.ruleVersion', 1e9);
  whole(signal.dataVersion, 'signal.dataVersion', 1e9);
  if (signal.seriesVersion !== undefined) {
    whole(signal.seriesVersion, 'signal.seriesVersion', 1e9);
    requireAnalysis(
      signal.seriesVersion > 0,
      'Signal series versions must be positive.',
      'signal.seriesVersion',
    );
  }
  if (signal.definitionFingerprint !== undefined)
    requireAnalysis(
      typeof signal.definitionFingerprint === 'string' &&
        /^[0-9a-f]{16}$/.test(signal.definitionFingerprint),
      'Invalid captured semantic dependency fingerprint.',
      'signal.definitionFingerprint',
    );
  requireAnalysis(
    signal.ruleVersion > 0 && signal.dataVersion > 0,
    'Signal versions must be positive.',
  );
  const series = model.series.find((item) => item.id === signal.seriesId);
  requireAnalysis(series, 'Signal references an unknown series.');
  validateInterval(signal.interval, 'signal.interval');
  isoTime(signal.observationTime, 'signal.observationTime');
  if (signal.onsetTime !== undefined) {
    isoTime(signal.onsetTime, 'signal.onsetTime');
    requireAnalysis(
      signal.onsetTime <= signal.observationTime,
      'Episode onset cannot follow its lifecycle event.',
      'signal.onsetTime',
    );
    if (signal.state === 'onset')
      requireAnalysis(
        signal.onsetTime === signal.observationTime,
        'An onset event identifies its own observation time.',
        'signal.onsetTime',
      );
  }
  isoTime(signal.detectedAt, 'signal.detectedAt');
  requireAnalysis(
    signal.detectedAt >= signal.observationTime,
    'Detection cannot precede its observation.',
  );
  enumeration(signal.state, ['onset', 'active', 'resolved'], 'signal.state');
  enumeration(signal.quality, ['valid', 'insufficient'], 'signal.quality');
  for (const key of ['value', 'deviationMagnitude', 'baseline', 'threshold'] as const)
    nullableNumber(signal[key], `signal.${key}`);
  for (const key of ['deviationUnit', 'thresholdUnit'] as const)
    text(signal[key], `signal.${key}`, 120);
  text(signal.explanation, 'signal.explanation');
  strictKeys(
    signal.evidence as unknown,
    ['observations', 'missing', 'exposure'],
    'signal.evidence',
  );
  whole(signal.evidence.observations, 'signal.evidence.observations', analyticsLimits.observations);
  whole(signal.evidence.missing, 'signal.evidence.missing', analyticsLimits.observations);
  if (signal.evidence.exposure !== undefined)
    finiteNumber(signal.evidence.exposure, 'signal.evidence.exposure', 0);
  strictKeys(
    signal.dimensions as unknown,
    Object.keys(signal.dimensions ?? {}),
    'signal.dimensions',
  );
  requireAnalysis(Object.keys(signal.dimensions).length <= 10, 'Too many signal dimensions.');
  for (const [key, value] of Object.entries(signal.dimensions)) {
    requireAnalysis(
      !['__proto__', 'prototype', 'constructor'].includes(key),
      'Unsafe signal dimension.',
    );
    text(key, 'signal.dimensions.key', 100);
    text(value, 'signal.dimensions.value', 1000);
  }
  strictKeys(signal.unit as unknown, ['kind', 'label', 'currency'], 'signal.unit');
  enumeration(signal.unit.kind, ['count', 'currency', 'ratio', 'number'], 'signal.unit.kind');
  text(signal.unit.label, 'signal.unit.label', 120);
  if (signal.unit.kind === 'currency')
    requireAnalysis(
      typeof signal.unit.currency === 'string' && /^[A-Z]{3}$/.test(signal.unit.currency),
      'Historical currency requires its captured ISO currency.',
      'signal.unit.currency',
    );
  else
    requireAnalysis(
      signal.unit.currency === undefined,
      'Only currency units specify a currency.',
      'signal.unit.currency',
    );
  if (signal.expression !== undefined)
    validateExpression(signal.expression, new Set(), new Set(), 'signal.expression', true);
  if (signal.method === 'custom')
    requireAnalysis(
      signal.expression && signal.threshold === null && signal.deviationMagnitude === null,
      'A custom signal requires its captured expression and has no single numeric threshold or deviation.',
      'signal.expression',
    );
  else
    requireAnalysis(
      signal.expression === undefined,
      'Only custom signals capture an expression.',
      'signal.expression',
    );
  if (signal.secondSeriesId !== undefined)
    analyticsId(signal.secondSeriesId, 'signal.secondSeriesId');
  if (signal.method === 'kpi-divergence')
    requireAnalysis(
      signal.secondSeriesId,
      'Divergence history requires its second series identifier.',
      'signal.secondSeriesId',
    );
  else
    requireAnalysis(
      signal.secondSeriesId === undefined,
      'Only divergence signals identify a second series.',
      'signal.secondSeriesId',
    );
  // Captured parameters remain valid even after the original rule is edited or removed.
  validateRule(
    {
      id: signal.ruleId,
      version: signal.ruleVersion,
      name: '',
      enabled: true,
      family: signal.method,
      seriesId: signal.seriesId,
      severity: signal.severity,
      parameters: signal.parameters,
      ...(signal.method === 'custom'
        ? {
            expression: {
              kind: 'comparison',
              left: { kind: 'constant', value: 0 },
              operator: '==',
              right: { kind: 'constant', value: 0 },
            } as const,
          }
        : {}),
      ...(signal.method === 'kpi-divergence' ? { secondSeriesId: signal.secondSeriesId } : {}),
    },
    new Set([
      ...model.series.map((item) => item.id),
      ...(signal.secondSeriesId ? [signal.secondSeriesId] : []),
    ]),
    new Set(model.indicators.map((item) => item.id)),
    'signal.parameters',
  );
  for (const key of ['acknowledged', 'muted'] as const)
    if (signal[key] !== undefined)
      requireAnalysis(typeof signal[key] === 'boolean', 'Signal user state must be boolean.');
  for (const key of ['measurementId', 'annotationId', 'nodeId', 'scenarioId'] as const)
    if (signal[key] !== undefined) analyticsId(signal[key], `signal.${key}`);
}

/** Persisted results use a closed discriminated contract rather than arbitrary JSON blobs. */
export function validateResultContent(
  content: AnalyticsResultContent,
  captured: AnalyticsExtension,
) {
  requireAnalysis(content && typeof content === 'object', 'Missing analysis result content.');
  notes(content.notes);
  switch (content.kind) {
    case 'measurement': {
      strictKeys(
        content as unknown,
        ['kind', 'measurementId', 'metrics', 'values', 'residuals', 'notes'],
        'result.content',
      );
      analyticsId(content.measurementId, 'result.measurementId');
      strictKeys(content.metrics as unknown, Object.keys(content.metrics ?? {}), 'result.metrics');
      requireAnalysis(Object.keys(content.metrics).length <= 100, 'Too many measurement metrics.');
      for (const [key, value] of Object.entries(content.metrics)) {
        text(key, 'result.metrics.key', 100);
        metric(value, `result.metrics.${key}`);
      }
      for (const key of ['values', 'residuals'] as const) {
        if (content[key] === undefined) continue;
        array(content[key], `result.${key}`);
        for (const point of content[key]!) {
          strictKeys(point as unknown, ['time', 'value'], `result.${key}`);
          isoTime(point.time, `result.${key}.time`);
          nullableNumber(point.value, `result.${key}.value`);
        }
      }
      break;
    }
    case 'indicator': {
      strictKeys(content as unknown, ['kind', 'indicatorId', 'points', 'notes'], 'result.content');
      analyticsId(content.indicatorId, 'result.indicatorId');
      array(content.points, 'result.points');
      for (const point of content.points) {
        strictKeys(
          point as unknown,
          ['time', 'value', 'upper', 'lower', 'signal', 'histogram', 'reason'],
          'result.point',
        );
        isoTime(point.time, 'result.point.time');
        nullableNumber(point.value, 'result.point.value');
        for (const key of ['upper', 'lower', 'signal', 'histogram'] as const)
          if (point[key] !== undefined) nullableNumber(point[key], `result.point.${key}`);
        if (point.reason !== undefined)
          metric({ value: null, reason: point.reason }, 'result.point.reason');
      }
      break;
    }
    case 'signals': {
      strictKeys(
        content as unknown,
        [
          'kind',
          'signals',
          'totalEvents',
          'omittedEvents',
          'episodeCount',
          'evaluated',
          'unknown',
          'notes',
        ],
        'result.content',
      );
      array(content.signals, 'result.signals', 10000);
      for (const key of [
        'totalEvents',
        'omittedEvents',
        'episodeCount',
        'evaluated',
        'unknown',
      ] as const)
        whole(content[key], `result.${key}`);
      requireAnalysis(
        content.totalEvents === content.signals.length + content.omittedEvents &&
          content.episodeCount <= content.totalEvents &&
          content.totalEvents <= content.evaluated &&
          content.episodeCount <= content.evaluated,
        'Signal result counters are inconsistent.',
      );
      for (const item of content.signals) validateSignal(item, captured);
      break;
    }
    case 'backtest': {
      strictKeys(
        content as unknown,
        ['kind', 'configId', 'results', 'selectedRuleId', 'trials', 'retrospective', 'notes'],
        'result.content',
      );
      analyticsId(content.configId, 'result.configId');
      if (content.selectedRuleId !== undefined)
        analyticsId(content.selectedRuleId, 'result.selectedRuleId');
      whole(content.trials, 'result.trials', 10000);
      requireAnalysis(
        content.trials > 0 && typeof content.retrospective === 'boolean',
        'Invalid backtest metadata.',
      );
      array(content.results, 'result.results', 300);
      for (const item of content.results) {
        strictKeys(
          item as unknown,
          [
            'ruleId',
            'split',
            'signals',
            'episodes',
            'activePeriods',
            'exposedPeriods',
            'evaluablePeriods',
            'matchedSignals',
            'matchedOutcomes',
            'outcomeCount',
            'precision',
            'recall',
            'falseAlarms',
            'detectionDelay',
          ],
          'result.backtest',
        );
        analyticsId(item.ruleId, 'result.ruleId');
        enumeration(item.split, ['train', 'validation', 'holdout'], 'result.split');
        for (const key of [
          'signals',
          'episodes',
          'activePeriods',
          'exposedPeriods',
          'evaluablePeriods',
        ] as const)
          whole(item[key], `result.${key}`);
        for (const key of [
          'matchedSignals',
          'matchedOutcomes',
          'outcomeCount',
          'falseAlarms',
        ] as const)
          if (item[key] !== undefined) whole(item[key], `result.${key}`);
        for (const key of ['precision', 'recall', 'detectionDelay'] as const)
          if (item[key] !== undefined) metric(item[key], `result.${key}`);
      }
      break;
    }
    case 'scenario': {
      strictKeys(
        content as unknown,
        ['kind', 'scenarioId', 'currency', 'points', 'notes'],
        'result.content',
      );
      analyticsId(content.scenarioId, 'result.scenarioId');
      requireAnalysis(
        /^[A-Z]{3}$/.test(content.currency),
        'Scenario result currency must be explicit.',
      );
      array(content.points, 'result.points', 120);
      for (const point of content.points) {
        strictKeys(
          point as unknown,
          [
            'time',
            'openingCustomers',
            'newCustomers',
            'reactivatedCustomers',
            'lostCustomers',
            'closingCustomers',
            'openingMrc',
            'newMrc',
            'expansionMrc',
            'contractionMrc',
            'churnedMrc',
            'closingMrc',
            'provenance',
            'expectedCounts',
          ],
          'result.scenario',
        );
        isoTime(point.time, 'result.scenario.time');
        for (const key of [
          'openingCustomers',
          'newCustomers',
          'reactivatedCustomers',
          'lostCustomers',
          'closingCustomers',
          'openingMrc',
          'newMrc',
          'expansionMrc',
          'contractionMrc',
          'churnedMrc',
          'closingMrc',
        ] as const)
          finiteNumber(point[key], `result.scenario.${key}`, 0);
        requireAnalysis(
          point.provenance === 'scenario' && point.expectedCounts === true,
          'Scenario points must remain explicitly hypothetical expected counts.',
        );
      }
      break;
    }
    default:
      requireAnalysis(false, 'Unsupported result kind.');
  }
  assertFiniteJson(content);
}

export function validateResultMetadata(
  result: {
    engineVersion: string;
    modelVersion: number;
    interval: unknown;
    dataVersions: Record<string, number>;
    parameters: Record<string, unknown>;
  },
  captured: AnalyticsExtension,
) {
  requireAnalysis(
    result.engineVersion === ANALYTICS_ENGINE_VERSION,
    'Unsupported result engine version.',
  );
  whole(result.modelVersion, 'result.modelVersion', 1e9);
  requireAnalysis(result.modelVersion > 0, 'Result model version must be positive.');
  validateInterval(result.interval, 'result.interval');
  strictKeys(
    result.dataVersions as unknown,
    captured.datasets.map((item) => item.id),
    'result.dataVersions',
  );
  requireAnalysis(
    Object.keys(result.dataVersions).length === captured.datasets.length &&
      captured.datasets.every((item) => result.dataVersions[item.id] === item.version),
    'Archived data versions must match the retained immutable inputs.',
  );
  strictKeys(
    result.parameters as unknown,
    Object.keys(result.parameters ?? {}),
    'result.parameters',
  );
  assertFiniteJson(result.parameters);
}
