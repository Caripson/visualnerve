import { unitsCompatible } from './units';
import { validateRuleSemantics } from './rule-semantics';
import { StorageError } from '../model/errors';
import { validateSignal, validateResultContent, validateResultMetadata } from './result-validation';
import {
  ANALYTICS_ENGINE_VERSION,
  analyticsLimits,
  type AnalyticsCode,
  type AnalysisIssue,
  type AnalyticsExtension,
  type AnalyticsRule,
  type SignalExpression,
  type AnalyticsScenario,
  type Observation,
  type AnalyticsSeries,
} from './types';
export class AnalyticsError extends StorageError {
  readonly issues: AnalysisIssue[];
  constructor(
    public code: AnalyticsCode,
    message: string,
    public path?: string,
    issues?: AnalysisIssue[],
  ) {
    super(422, message);
    this.name = 'AnalyticsError';
    this.issues = issues ?? [{ code, message, path, severity: 'error' }];
  }
}
export function requireAnalysis(
  value: unknown,
  message: string,
  path?: string,
  code: AnalyticsCode = 'INVALID_ANALYTICS',
): asserts value {
  if (!value) throw new AnalyticsError(code, message, path);
}
export function strictKeys(
  value: unknown,
  keys: string[],
  path: string,
): asserts value is Record<string, unknown> {
  requireAnalysis(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'Expected an object.',
    path,
  );
  for (const key of Object.keys(value))
    requireAnalysis(keys.includes(key), `Unsupported field ${key}.`, `${path}.${key}`);
}
export function finiteNumber(
  value: unknown,
  path: string,
  min = -1e15,
  max = 1e15,
): asserts value is number {
  requireAnalysis(
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    'Expected a finite number in the supported range.',
    path,
  );
}
export function analyticsId(value: unknown, path: string): asserts value is string {
  requireAnalysis(
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
    'Use a stable ID of 1–128 letters, numbers, dots, colons, underscores or dashes.',
    path,
  );
}
function string(value: unknown, path: string, max = 1000): asserts value is string {
  requireAnalysis(typeof value === 'string' && value.length <= max, 'Invalid bounded text.', path);
}
function enumeration(value: unknown, values: readonly string[], path: string) {
  requireAnalysis(typeof value === 'string' && values.includes(value), 'Unsupported value.', path);
}
function integer(
  value: unknown,
  path: string,
  min: number = 1,
  max: number = analyticsLimits.lookback,
) {
  finiteNumber(value, path, min, max);
  requireAnalysis(Number.isInteger(value), 'Expected a whole number.', path);
}
export function isoTime(value: unknown, path: string): asserts value is string {
  requireAnalysis(
    typeof value === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    'Use a valid UTC ISO timestamp.',
    path,
  );
  const parsed = new Date(value);
  requireAnalysis(
    parsed.toISOString() === value,
    'Use a canonical UTC timestamp with millisecond precision (Date.toISOString()).',
    path,
  );
}
export function dimensions(value: unknown, path: string) {
  strictKeys(value, Object.keys((value as object) || {}), path);
  requireAnalysis(
    Object.keys(value).length <= 10,
    'At most 10 segment dimensions are supported.',
    path,
  );
  for (const [k, v] of Object.entries(value)) {
    string(k, path, 100);
    requireAnalysis(
      !['__proto__', 'constructor', 'prototype'].includes(k),
      'Unsafe dimension name.',
      path,
    );
    string(v, `${path}.${k}`, 300);
  }
}
function unit(value: unknown, path: string) {
  strictKeys(value, ['kind', 'label', 'currency'], path);
  enumeration(value.kind, ['count', 'currency', 'ratio', 'number'], `${path}.kind`);
  string(value.label, path, 100);
  if (value.kind === 'currency')
    requireAnalysis(
      typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency),
      'Currency series require an explicit ISO currency.',
      path,
    );
  else
    requireAnalysis(
      value.currency === undefined,
      'Only currency units may specify a currency.',
      path,
    );
}
export function validateOhlc(value: unknown, path = 'ohlc') {
  strictKeys(value, ['open', 'high', 'low', 'close'], path);
  for (const [k, v] of Object.entries(value)) finiteNumber(v, `${path}.${k}`);
  requireAnalysis(
    Object.keys(value).length === 4 &&
      Number(value.low) <= Math.min(Number(value.open), Number(value.close)) &&
      Number(value.high) >= Math.max(Number(value.open), Number(value.close)) &&
      Number(value.low) <= Number(value.high),
    'OHLC requires finite open/high/low/close and low ≤ min(open, close), high ≥ max(open, close).',
    path,
    'INVALID_OHLC',
  );
}
export function validateObservation(
  observation: Observation,
  path: string,
  series: Map<string, AnalyticsSeries>,
) {
  strictKeys(
    observation,
    [
      'id',
      'seriesId',
      'time',
      'periodEnd',
      'knownAt',
      'value',
      'numerator',
      'denominator',
      'ohlc',
      'dimensions',
      'quality',
      'sourceRow',
    ],
    path,
  );
  analyticsId(observation.id, path);
  requireAnalysis(
    series.has(observation.seriesId),
    'Observation references an unknown series.',
    path,
  );
  isoTime(observation.time, `${path}.time`);
  if (observation.periodEnd !== undefined) {
    isoTime(observation.periodEnd, path);
    requireAnalysis(
      observation.periodEnd >= observation.time,
      'Period end precedes observation time.',
      path,
    );
  }
  if (observation.knownAt !== undefined) isoTime(observation.knownAt, path);
  if (observation.value !== null) finiteNumber(observation.value, `${path}.value`);
  if (observation.numerator !== undefined) finiteNumber(observation.numerator, `${path}.numerator`);
  if (observation.denominator !== undefined)
    finiteNumber(observation.denominator, `${path}.denominator`, 0);
  const s = series.get(observation.seriesId)!;
  if (s.semantics === 'rate' && observation.denominator !== undefined)
    requireAnalysis(
      observation.denominator > 0,
      'A rate requires a positive denominator.',
      `${path}.denominator`,
      'INVALID_RATE_DENOMINATOR',
    );
  if (s.riskPopulation === 'opening-customers') {
    if (observation.value !== null) finiteNumber(observation.value, path, 0, 1);
    if (observation.numerator !== undefined)
      requireAnalysis(
        observation.numerator >= 0 &&
          observation.denominator !== undefined &&
          observation.numerator <= observation.denominator &&
          observation.denominator > 0,
        'Customer churn requires losses no greater than its positive risk population.',
        path,
        'INVALID_RATE_DENOMINATOR',
      );
  }
  if (observation.ohlc !== undefined) validateOhlc(observation.ohlc, `${path}.ohlc`);
  dimensions(observation.dimensions, path);
  enumeration(observation.quality, ['valid', 'missing', 'incomplete'], path);
  if (observation.sourceRow !== undefined)
    integer(observation.sourceRow, path, 1, analyticsLimits.observations + 1);
}
export function validateRule(
  rule: AnalyticsRule,
  series: Set<string>,
  indicators: Set<string>,
  path = 'rule',
) {
  strictKeys(
    rule,
    [
      'id',
      'version',
      'name',
      'enabled',
      'family',
      'seriesId',
      'secondSeriesId',
      'severity',
      'expression',
      'parameters',
    ],
    path,
  );
  analyticsId(rule.id, path);
  if (rule.secondSeriesId !== undefined) analyticsId(rule.secondSeriesId, `${path}.secondSeriesId`);
  integer(rule.version, path, 1, 1e9);
  string(rule.name, path);
  requireAnalysis(typeof rule.enabled === 'boolean', 'Rule enabled must be boolean.', path);
  enumeration(
    rule.family,
    [
      'threshold',
      'sustained',
      'moving-average-crossover',
      'momentum',
      'anomaly',
      'variation-spike',
      'structural-change',
      'seasonality-deviation',
      'kpi-divergence',
      'custom',
    ],
    path,
  );
  requireAnalysis(
    series.has(rule.seriesId) && (!rule.secondSeriesId || series.has(rule.secondSeriesId)),
    'Rule references unknown series.',
    path,
  );
  enumeration(rule.severity, ['info', 'warning', 'critical'], path);
  strictKeys(
    rule.parameters,
    [
      'comparator',
      'threshold',
      'consecutive',
      'cooldown',
      'hysteresis',
      'window',
      'shortWindow',
      'longWindow',
      'average',
      'method',
      'mu0',
      'k',
      'h',
      'reset',
      'seasonLength',
      'tolerance',
      'direction',
    ],
    `${path}.parameters`,
  );
  for (const [k, v] of Object.entries(rule.parameters)) {
    if (['window', 'shortWindow', 'longWindow', 'seasonLength', 'consecutive'].includes(k))
      integer(v, `${path}.${k}`);
    else if (k === 'cooldown') integer(v, path, 0);
    else if (['threshold', 'mu0'].includes(k)) finiteNumber(v, path);
    else if (['hysteresis', 'k', 'h', 'tolerance'].includes(k)) finiteNumber(v, path, 0);
    else if (k === 'comparator') enumeration(v, ['>', '>=', '<', '<=', '==', '!='], path);
    else if (k === 'average') enumeration(v, ['sma', 'ema'], path);
    else if (k === 'method') enumeration(v, ['zscore', 'mad'], path);
    else if (k === 'reset') enumeration(v, ['on-resolve', 'on-detect'], path);
    else if (k === 'direction') enumeration(v, ['up', 'down', 'both'], path);
  }
  if (['threshold', 'sustained'].includes(rule.family))
    requireAnalysis(
      rule.parameters.threshold !== undefined,
      'Threshold rules require an explicit finite threshold.',
      path,
    );
  if (
    ['anomaly', 'variation-spike', 'momentum'].includes(rule.family) &&
    rule.parameters.threshold !== undefined
  )
    finiteNumber(rule.parameters.threshold, path, 0);
  if (['anomaly', 'variation-spike'].includes(rule.family) && rule.parameters.window !== undefined)
    integer(rule.parameters.window, path, 2);
  if (rule.family === 'custom')
    requireAnalysis(rule.expression, 'Custom rules need a validated expression.', path);
  else
    requireAnalysis(
      rule.expression === undefined,
      'Only custom rules may define an expression.',
      `${path}.expression`,
    );
  if (rule.family === 'kpi-divergence')
    requireAnalysis(rule.secondSeriesId, 'KPI divergence needs a second series.', path);
  else
    requireAnalysis(
      rule.secondSeriesId === undefined,
      'Only KPI divergence may reference a second series.',
      `${path}.secondSeriesId`,
    );
  if (rule.family === 'structural-change') {
    requireAnalysis(
      rule.parameters.mu0 !== undefined && rule.parameters.h !== undefined,
      'CUSUM requires an explicit baseline mu0 and threshold h.',
      path,
    );
    finiteNumber(rule.parameters.h, path, Number.MIN_VALUE);
  }
  if (rule.family === 'moving-average-crossover') {
    requireAnalysis(
      rule.parameters.direction !== 'both',
      'Choose up or down for a moving-average crossover.',
      path,
    );
    requireAnalysis(
      (rule.parameters.shortWindow ?? 3) < (rule.parameters.longWindow ?? 12),
      'Short moving average must be shorter than long.',
      path,
    );
  }
  if (rule.expression !== undefined) validateExpression(rule.expression, series, indicators, path);
}
export function validateExpression(
  expression: SignalExpression,
  series: Set<string>,
  indicators: Set<string>,
  path = 'expression',
  historicalReferences = false,
) {
  let count = 0;
  const seen = new Set<object>();
  const visit = (node: SignalExpression, depth: number) => {
    requireAnalysis(
      depth <= analyticsLimits.expressionDepth && ++count <= analyticsLimits.conditions,
      'Expression exceeds supported depth or condition count.',
      path,
    );
    requireAnalysis(
      node && typeof node === 'object' && !seen.has(node),
      'Cyclic expressions are not supported.',
      path,
    );
    seen.add(node);
    if (node.kind === 'and' || node.kind === 'or') {
      strictKeys(node, ['kind', 'children'], path);
      requireAnalysis(
        Array.isArray(node.children) && node.children.length >= 2 && node.children.length <= 16,
        'AND/OR need 2–16 conditions.',
        path,
      );
      for (const child of node.children) visit(child, depth + 1);
    } else if (node.kind === 'sustained') {
      strictKeys(node, ['kind', 'periods', 'child'], path);
      integer(node.periods, path);
      visit(node.child, depth + 1);
    } else if (node.kind === 'window') {
      strictKeys(node, ['kind', 'operand', 'operation', 'periods', 'operator', 'threshold'], path);
      integer(node.periods, path);
      enumeration(node.operation, ['mean', 'min', 'max', 'stddev', 'roc'], path);
      enumeration(node.operator, ['>', '>=', '<', '<=', '==', '!='], path);
      finiteNumber(node.threshold, path);
      const synthetic: SignalExpression = {
        kind: 'comparison',
        left: node.operand,
        operator: node.operator,
        right: { kind: 'constant', value: node.threshold },
      };
      visit(synthetic, depth + 1);
    } else if (node.kind === 'not') {
      strictKeys(node, ['kind', 'child'], path);
      visit(node.child, depth + 1);
    } else {
      requireAnalysis(
        node.kind === 'comparison' || node.kind === 'crossing',
        'Only declarative comparisons and crossings are supported.',
        path,
      );
      strictKeys(
        node,
        node.kind === 'comparison'
          ? ['kind', 'left', 'right', 'operator']
          : ['kind', 'left', 'right', 'direction'],
        path,
      );
      if (node.kind === 'comparison')
        enumeration(node.operator, ['>', '>=', '<', '<=', '==', '!='], path);
      else enumeration(node.direction, ['up', 'down'], path);
      for (const operand of [node.left, node.right]) {
        requireAnalysis(operand && typeof operand === 'object', 'Invalid operand.', path);
        if (operand.kind === 'constant') {
          strictKeys(operand, ['kind', 'value'], path);
          finiteNumber(operand.value, path);
        } else if (operand.kind === 'series') {
          strictKeys(operand, ['kind', 'seriesId'], path);
          analyticsId(operand.seriesId, path);
          requireAnalysis(
            historicalReferences || series.has(operand.seriesId),
            'Unknown operand series.',
            path,
          );
        } else {
          strictKeys(operand, ['kind', 'indicatorId', 'component'], path);
          analyticsId(operand.indicatorId, path);
          requireAnalysis(
            operand.kind === 'indicator' &&
              (historicalReferences || indicators.has(operand.indicatorId)),
            'Unknown operand indicator.',
            path,
          );
          if (operand.component !== undefined)
            enumeration(
              operand.component,
              ['value', 'upper', 'lower', 'signal', 'histogram'],
              path,
            );
        }
      }
    }
    seen.delete(node);
  };
  visit(expression, 1);
}
export function validateScenario(scenario: AnalyticsScenario, path = 'scenario') {
  strictKeys(
    scenario,
    [
      'id',
      'name',
      'version',
      'model',
      'start',
      'periods',
      'resolution',
      'assumptions',
      'sourceSignalId',
      'reviewed',
      'nodeId',
      'processLink',
    ],
    path,
  );
  analyticsId(scenario.id, path);
  for (const key of ['sourceSignalId', 'nodeId'] as const)
    if (scenario[key] !== undefined) analyticsId(scenario[key], `${path}.${key}`);
  string(scenario.name, path);
  integer(scenario.version, path, 1, 1e9);
  requireAnalysis(
    scenario.model === 'growth-churn' && scenario.resolution === 'month',
    'Only the monthly Growth & Churn model is supported.',
    path,
  );
  isoTime(scenario.start, path);
  integer(scenario.periods, path, 1, 120);
  requireAnalysis(
    typeof scenario.reviewed === 'boolean',
    'Scenario review state must be explicit.',
    path,
  );
  const a = scenario.assumptions;
  strictKeys(
    a,
    [
      'openingCustomers',
      'newCustomers',
      'reactivatedCustomers',
      'churnRate',
      'newCustomerGrowth',
      'openingMrc',
      'newMrc',
      'expansionMrc',
      'contractionMrc',
      'churnedMrc',
      'currency',
      'revenuePerCustomer',
      'churnAdjustment',
    ],
    path,
  );
  for (const key of [
    'openingCustomers',
    'newCustomers',
    'reactivatedCustomers',
    'openingMrc',
    'newMrc',
    'expansionMrc',
    'contractionMrc',
    'churnedMrc',
  ] as const)
    finiteNumber(a[key], `${path}.${key}`, 0);
  finiteNumber(a.churnRate, path, 0, 1);
  finiteNumber(a.newCustomerGrowth, path, -1, 10);
  requireAnalysis(/^[A-Z]{3}$/.test(a.currency), 'Use an explicit ISO currency.', path);
  if (a.revenuePerCustomer !== undefined) finiteNumber(a.revenuePerCustomer, path, 0);
  if (a.churnAdjustment !== undefined) {
    strictKeys(a.churnAdjustment, ['kind', 'value'], path);
    enumeration(a.churnAdjustment.kind, ['relative', 'percentage-points'], path);
    finiteNumber(a.churnAdjustment.value, path, -100, 100);
  }
  if (scenario.processLink !== undefined) {
    strictKeys(
      scenario.processLink,
      [
        'diagramId',
        'scenarioId',
        'sourceSeriesId',
        'nodeId',
        'parameter',
        'unit',
        'resolution',
        'reviewed',
      ],
      path,
    );
    for (const key of ['diagramId', 'scenarioId', 'parameter', 'unit'] as const)
      string(scenario.processLink[key], path);
    for (const key of ['sourceSeriesId', 'nodeId'] as const)
      if (scenario.processLink[key] !== undefined) analyticsId(scenario.processLink[key], path);
    enumeration(
      scenario.processLink.resolution,
      ['observation', 'day', 'week', 'month', 'quarter', 'year'],
      path,
    );
    requireAnalysis(
      typeof scenario.processLink.reviewed === 'boolean',
      'A process link requires review state.',
      path,
    );
  }
}
export function blankAnalytics(): AnalyticsExtension {
  return {
    schemaVersion: 1,
    engineVersion: ANALYTICS_ENGINE_VERSION,
    datasets: [],
    series: [],
    charts: [],
    indicators: [],
    measurements: [],
    rules: [],
    signals: [],
    backtests: [],
    scenarios: [],
    results: [],
    retention: { results: 12, dataVersions: 3 },
  };
}
export function validateAnalytics(model: AnalyticsExtension) {
  strictKeys(
    model,
    [
      'schemaVersion',
      'engineVersion',
      'datasets',
      'series',
      'charts',
      'indicators',
      'measurements',
      'rules',
      'signals',
      'backtests',
      'scenarios',
      'results',
      'retention',
    ],
    'analytics',
  );
  requireAnalysis(
    model.schemaVersion === 1,
    'Unsupported analytics schema version.',
    'analytics.schemaVersion',
  );
  string(model.engineVersion, 'analytics.engineVersion', 50);
  requireAnalysis(
    model.engineVersion === ANALYTICS_ENGINE_VERSION,
    'Unsupported analytics engine version; update this client before editing.',
    'analytics.engineVersion',
  );
  const bounds: Record<string, number> = {
    datasets: 8,
    series: 100,
    charts: 20,
    indicators: 100,
    measurements: 200,
    rules: 100,
    signals: 10000,
    backtests: 30,
    scenarios: 30,
    results: 12,
  };
  for (const [key, max] of Object.entries(bounds)) {
    const items = model[key as keyof AnalyticsExtension];
    requireAnalysis(
      Array.isArray(items) && items.length <= max,
      `${key} exceeds its ${max} item limit.`,
      `analytics.${key}`,
    );
    const ids = new Set<string>();
    for (const item of items as { id: string }[]) {
      requireAnalysis(
        item && typeof item === 'object' && !Array.isArray(item),
        'Analytics collection entries must be objects.',
        `analytics.${key}`,
      );
      analyticsId(item.id, `analytics.${key}.id`);
      requireAnalysis(!ids.has(item.id), `Duplicate ${key} ID.`, `analytics.${key}`);
      ids.add(item.id);
    }
  }
  const datasets = new Set(model.datasets.map((d) => d.id));
  const series = new Map(model.series.map((s) => [s.id, s]));
  const seriesIds = new Set(series.keys()),
    indicatorIds = new Set(model.indicators.map((i) => i.id));
  for (const s of model.series) {
    const path = `series.${s.id}`;
    strictKeys(
      s,
      [
        'id',
        'version',
        'name',
        'datasetId',
        'columnId',
        'dimensions',
        'unit',
        'semantics',
        'provenance',
        'resolution',
        'timezone',
        'periodBoundary',
        'aggregation',
        'direction',
        'riskPopulation',
        'definition',
        'derived',
      ],
      path,
    );
    requireAnalysis(datasets.has(s.datasetId), 'Unknown series dataset.', path);
    if (s.version !== undefined) integer(s.version, `${path}.version`, 1, 1e9);
    if (s.columnId !== undefined)
      requireAnalysis(
        typeof s.columnId === 'string' && s.columnId.length > 0 && s.columnId.length <= 300,
        'Column references require 1–300 characters.',
        `${path}.columnId`,
      );
    string(s.name, path);
    unit(s.unit, path);
    dimensions(s.dimensions, path);
    enumeration(s.semantics, ['snapshot', 'flow', 'rate'], path);
    enumeration(s.provenance, ['observed', 'derived'], path);
    enumeration(s.resolution, ['observation', 'day', 'week', 'month', 'quarter', 'year'], path);
    enumeration(s.periodBoundary, ['start', 'end'], path);
    enumeration(s.aggregation, ['sum', 'first', 'last', 'ratio', 'none'], path);
    enumeration(s.direction, ['higher-is-better', 'lower-is-better', 'neutral'], path);
    string(s.definition, path, 4000);
    requireAnalysis(
      typeof s.timezone === 'string' && s.timezone.length > 0 && s.timezone.length <= 100,
      'Specify an IANA time zone explicitly.',
      path,
    );
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: s.timezone });
    } catch {
      throw new AnalyticsError('INVALID_ANALYTICS', 'Unknown IANA time zone.', path);
    }
    requireAnalysis(
      (s.semantics === 'flow' && ['sum', 'none'].includes(s.aggregation)) ||
        (s.semantics === 'snapshot' && ['first', 'last', 'none'].includes(s.aggregation)) ||
        (s.semantics === 'rate' && ['ratio', 'none'].includes(s.aggregation)),
      'Aggregation must respect flow, snapshot or rate semantics.',
      path,
    );
    if (s.riskPopulation !== undefined)
      enumeration(s.riskPopulation, ['opening-customers', 'other'], path);
    requireAnalysis(
      s.riskPopulation !== 'opening-customers' ||
        (s.semantics === 'rate' && s.unit.kind === 'ratio'),
      'Opening-customer churn must use rate semantics and a ratio unit.',
      `${path}.riskPopulation`,
      'INVALID_RATE_DENOMINATOR',
    );
    requireAnalysis(
      s.provenance !== 'derived' || s.derived !== undefined,
      'Derived provenance requires an explicit validated expression.',
      `${path}.derived`,
    );
    if (s.derived !== undefined) {
      strictKeys(s.derived, ['operation', 'seriesIds'], path);
      enumeration(
        s.derived.operation,
        ['difference', 'relative-change', 'sum', 'subtract', 'multiply', 'divide'],
        path,
      );
      requireAnalysis(
        Array.isArray(s.derived.seriesIds) &&
          s.derived.seriesIds.length >= 1 &&
          s.derived.seriesIds.length <= 10 &&
          s.derived.seriesIds.every((id) => seriesIds.has(id)),
        'Invalid derived series references.',
        path,
      );
      requireAnalysis(
        s.provenance === 'derived',
        'A derived expression must be explicitly labeled derived.',
        path,
      );
      const inputs = s.derived.seriesIds.map((id) => series.get(id)!);
      const compatible = (a: AnalyticsSeries, b: AnalyticsSeries) =>
        unitsCompatible(a.unit, b.unit);
      requireAnalysis(
        inputs.every(
          (input) =>
            input.resolution === inputs[0].resolution &&
            input.timezone === inputs[0].timezone &&
            input.periodBoundary === inputs[0].periodBoundary,
        ),
        'Derived inputs require matching resolution, time zone and period boundaries.',
        path,
        'INCOMPATIBLE_UNITS',
      );
      const operation = s.derived.operation;
      requireAnalysis(
        ['difference', 'relative-change'].includes(operation)
          ? inputs.length === 1
          : ['subtract', 'divide'].includes(operation)
            ? inputs.length === 2
            : inputs.length >= 2,
        'Incorrect operand count for the selected derived operation.',
        path,
      );
      if (operation === 'sum' || operation === 'subtract' || operation === 'difference')
        requireAnalysis(
          inputs.every((input) => compatible(input, inputs[0])) && compatible(s, inputs[0]),
          'Addition, subtraction and differences require compatible original units, without currency conversion.',
          path,
          'INCOMPATIBLE_UNITS',
        );
      if (operation === 'relative-change')
        requireAnalysis(
          s.unit.kind === 'ratio' && s.semantics === 'rate' && s.aggregation === 'none',
          'Relative change must be a ratio with no temporal aggregation.',
          path,
          'INCOMPATIBLE_UNITS',
        );
      if (operation === 'divide')
        requireAnalysis(
          compatible(inputs[0], inputs[1])
            ? s.unit.kind === 'ratio'
            : inputs[1].unit.kind === 'ratio' && compatible(s, inputs[0]),
          'Division requires matching input units and ratio output, or division by a dimensionless ratio retaining the first unit.',
          path,
          'INCOMPATIBLE_UNITS',
        );
      if (operation === 'multiply') {
        const dimensional = inputs.filter((input) => input.unit.kind !== 'ratio');
        requireAnalysis(
          dimensional.length <= 1 &&
            (dimensional.length ? compatible(s, dimensional[0]) : s.unit.kind === 'ratio'),
          'Multiply only one dimensional series by dimensionless ratios; composite-unit multiplication is unsupported.',
          path,
          'INCOMPATIBLE_UNITS',
        );
      }
    }
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string, depth = 0) => {
    requireAnalysis(depth <= 8 && !visiting.has(id), 'Cyclic or overly deep derived series.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const child of series.get(id)?.derived?.seriesIds ?? []) visit(child, depth + 1);
    visiting.delete(id);
    done.add(id);
  };
  for (const s of model.series) visit(s.id);
  let observations = 0;
  for (const d of model.datasets) {
    const path = `datasets.${d.id}`;
    strictKeys(
      d,
      [
        'id',
        'name',
        'version',
        'source',
        'observations',
        'transformations',
        'importedAt',
        'revisionHistory',
      ],
      path,
    );
    string(d.name, path);
    integer(d.version, path, 1, 1e9);
    strictKeys(d.source, ['kind', 'name', 'illustrative'], path);
    enumeration(d.source.kind, ['example', 'csv', 'xlsx', 'json'], path);
    string(d.source.name, path);
    if (d.source.illustrative !== undefined)
      requireAnalysis(
        typeof d.source.illustrative === 'boolean',
        'Invalid illustrative flag.',
        path,
      );
    isoTime(d.importedAt, path);
    enumeration(d.revisionHistory, ['unavailable', 'point-in-time'], path);
    requireAnalysis(
      Array.isArray(d.transformations) && d.transformations.length <= 100,
      'Invalid transformation history.',
      path,
    );
    for (const item of d.transformations) string(item, path, 4000);
    requireAnalysis(Array.isArray(d.observations), 'Observations must be an array.', path);
    observations += d.observations.length;
    requireAnalysis(
      observations <= analyticsLimits.observations,
      'Analytics supports at most 200,000 observations.',
      path,
      'IMPORT_LIMIT',
    );
    const ids = new Set<string>();
    for (const o of d.observations) {
      validateObservation(o, path, series);
      requireAnalysis(
        !ids.has(o.id) && series.get(o.seriesId)?.datasetId === d.id,
        'Duplicate observation ID or foreign dataset series.',
        path,
      );
      ids.add(o.id);
    }
  }
  for (const i of model.indicators) {
    strictKeys(
      i,
      [
        'id',
        'name',
        'seriesId',
        'kind',
        'window',
        'alpha',
        'multiplier',
        'shortWindow',
        'longWindow',
        'signalWindow',
      ],
      'indicator',
    );
    requireAnalysis(seriesIds.has(i.seriesId), 'Unknown indicator series.');
    string(i.name, 'indicator.name');
    enumeration(
      i.kind,
      ['sma', 'ema', 'roc', 'rolling-stddev', 'bollinger', 'macd', 'rsi'],
      'indicator',
    );
    integer(i.window, 'indicator.window', ['rolling-stddev', 'bollinger'].includes(i.kind) ? 2 : 1);
    if (i.kind === 'macd')
      requireAnalysis(
        (i.shortWindow ?? 12) < (i.longWindow ?? 26),
        'MACD short window must be shorter than long window.',
        'indicator',
      );
    if (i.alpha !== undefined) finiteNumber(i.alpha, 'indicator.alpha', Number.MIN_VALUE, 1);
    if (i.multiplier !== undefined) finiteNumber(i.multiplier, 'indicator.multiplier', 0, 100);
    for (const key of ['shortWindow', 'longWindow', 'signalWindow'] as const)
      if (i[key] !== undefined) integer(i[key], `indicator.${key}`);
  }
  for (const r of model.rules) {
    validateRule(r, seriesIds, indicatorIds);
    validateRuleSemantics(r, model);
  }
  for (const s of model.scenarios) {
    validateScenario(s);
    if (s.sourceSignalId !== undefined)
      requireAnalysis(
        model.signals.some((signal) => signal.id === s.sourceSignalId),
        'A scenario source signal must remain in retained live history.',
        'scenario.sourceSignalId',
      );
    if (s.processLink?.sourceSeriesId) {
      const source = model.series.find((item) => item.id === s.processLink!.sourceSeriesId);
      requireAnalysis(
        source,
        'Process link references an unknown source series.',
        'scenario.processLink.sourceSeriesId',
      );
      requireAnalysis(
        source.unit.label === s.processLink.unit && source.resolution === s.processLink.resolution,
        'Process link source unit and resolution must match the semantic series.',
        'scenario.processLink',
        'INCOMPATIBLE_UNITS',
      );
    }
  }
  for (const c of model.charts) {
    strictKeys(
      c,
      [
        'id',
        'name',
        'kind',
        'seriesIds',
        'dimensions',
        'resolution',
        'normalized',
        'from',
        'to',
        'waterfall',
      ],
      'chart',
    );
    enumeration(c.kind, ['line', 'area', 'bar', 'candlestick', 'waterfall'], 'chart');
    string(c.name, 'chart.name');
    requireAnalysis(
      Array.isArray(c.seriesIds) &&
        c.seriesIds.length <= 20 &&
        c.seriesIds.every((id) => seriesIds.has(id)),
      'Unknown chart series.',
    );
    requireAnalysis(typeof c.normalized === 'boolean', 'Normalization must be explicit.');
    if (c.dimensions !== undefined) dimensions(c.dimensions, 'chart.dimensions');
    enumeration(c.resolution, ['observation', 'day', 'week', 'month', 'quarter', 'year'], 'chart');
    if (c.from !== undefined) isoTime(c.from, 'chart.from');
    if (c.to !== undefined) isoTime(c.to, 'chart.to');
    if (c.waterfall !== undefined) {
      strictKeys(c.waterfall, ['openingSeriesId', 'closingSeriesId', 'components'], 'waterfall');
      requireAnalysis(
        seriesIds.has(c.waterfall.openingSeriesId) &&
          seriesIds.has(c.waterfall.closingSeriesId) &&
          Array.isArray(c.waterfall.components) &&
          c.waterfall.components.length <= 20,
        'Invalid waterfall references.',
      );
      for (const component of c.waterfall.components) {
        strictKeys(component, ['seriesId', 'sign'], 'waterfall.component');
        requireAnalysis(
          seriesIds.has(component.seriesId) && [1, -1].includes(component.sign),
          'Invalid waterfall component.',
        );
      }
    }
  }
  for (const m of model.measurements) {
    strictKeys(
      m,
      [
        'id',
        'name',
        'kind',
        'seriesIds',
        'dimensions',
        'from',
        'to',
        'comparisonFrom',
        'comparisonTo',
        'points',
        'method',
        'lag',
        'normalized',
        'note',
        'nodeId',
        'resultId',
      ],
      'measurement',
    );
    enumeration(
      m.kind,
      [
        'point-to-point',
        'time-range',
        'range-statistics',
        'trend-line',
        'regression',
        'compare-periods',
        'compare-series',
        'correlation',
        'annotation',
      ],
      'measurement',
    );
    requireAnalysis(
      Array.isArray(m.seriesIds) &&
        m.seriesIds.length >= 1 &&
        m.seriesIds.length <= 20 &&
        m.seriesIds.every((id) => seriesIds.has(id)),
      'Unknown measurement series.',
    );
    string(m.name, 'measurement');
    if (m.nodeId !== undefined) analyticsId(m.nodeId, 'measurement.nodeId');
    if (m.resultId !== undefined) {
      analyticsId(m.resultId, 'measurement.resultId');
      requireAnalysis(
        model.results.some((result) => result.id === m.resultId),
        'Measurement locked result is not retained.',
        'measurement.resultId',
      );
    }
    if (m.normalized !== undefined)
      requireAnalysis(
        typeof m.normalized === 'boolean',
        'Measurement normalization must be explicit boolean.',
        'measurement.normalized',
      );
    if (m.dimensions !== undefined) dimensions(m.dimensions, 'measurement.dimensions');
    isoTime(m.from, 'measurement.from');
    isoTime(m.to, 'measurement.to');
    requireAnalysis(m.from <= m.to, 'Measurement interval is reversed.');
    if (m.comparisonFrom !== undefined) isoTime(m.comparisonFrom, 'measurement.comparisonFrom');
    if (m.comparisonTo !== undefined) isoTime(m.comparisonTo, 'measurement.comparisonTo');
    if (m.lag !== undefined) integer(m.lag, 'measurement.lag', -1000, 1000);
    if (m.points !== undefined) {
      requireAnalysis(
        Array.isArray(m.points) && m.points.length === 2,
        'Trend line requires two data anchors.',
      );
      for (const p of m.points) {
        strictKeys(p, ['time', 'value'], 'measurement.points');
        isoTime(p.time, 'measurement.points.time');
        finiteNumber(p.value, 'measurement.points.value');
      }
    }
    if (m.method !== undefined)
      enumeration(m.method, ['pearson', 'spearman'], 'measurement.method');
    if (m.note !== undefined) string(m.note, 'measurement.note', 10000);
  }
  for (const b of model.backtests) {
    strictKeys(
      b,
      [
        'id',
        'name',
        'ruleIds',
        'from',
        'to',
        'trainEnd',
        'validationEnd',
        'holdoutStart',
        'walkForwardPeriods',
        'trials',
        'baselineRuleId',
        'outcome',
      ],
      'backtest',
    );
    const rules = new Set(model.rules.map((r) => r.id));
    string(b.name, 'backtest.name');
    if (b.baselineRuleId !== undefined) {
      analyticsId(b.baselineRuleId, 'backtest.baselineRuleId');
      requireAnalysis(
        rules.has(b.baselineRuleId),
        'Unknown baseline rule.',
        'backtest.baselineRuleId',
      );
    }
    requireAnalysis(
      Array.isArray(b.ruleIds) &&
        b.ruleIds.length >= 1 &&
        b.ruleIds.length <= 100 &&
        b.ruleIds.every((id) => rules.has(id)),
      'Unknown backtest rules.',
    );
    for (const t of ['from', 'to', 'trainEnd', 'validationEnd', 'holdoutStart'] as const)
      isoTime(b[t], `backtest.${t}`);
    requireAnalysis(
      b.from <= b.trainEnd &&
        b.trainEnd < b.validationEnd &&
        b.validationEnd < b.holdoutStart &&
        b.holdoutStart <= b.to,
      'Train, validation and holdout must be time ordered and disjoint.',
    );
    integer(b.walkForwardPeriods, 'backtest.walkForwardPeriods', 1, 1000);
    integer(b.trials, 'backtest.trials', b.ruleIds.length, 10000);
    if (b.outcome !== undefined) {
      strictKeys(
        b.outcome,
        ['seriesId', 'comparator', 'threshold', 'horizon', 'matching'],
        'backtest.outcome',
      );
      requireAnalysis(seriesIds.has(b.outcome.seriesId), 'Unknown outcome series.');
      enumeration(b.outcome.comparator, ['>', '>=', '<', '<=', '==', '!='], 'backtest.outcome');
      finiteNumber(b.outcome.threshold, 'backtest.outcome');
      integer(b.outcome.horizon, 'backtest.outcome.horizon', 1, 120);
      requireAnalysis(
        b.outcome.matching === 'first-unmatched',
        'Outcomes require one-to-one first-unmatched matching.',
      );
    }
  }
  for (const signal of model.signals) validateSignal(signal, model);
  strictKeys(model.retention, ['results', 'dataVersions'], 'retention');
  integer(model.retention.results, 'retention.results', 1, analyticsLimits.results);
  integer(model.retention.dataVersions, 'retention.dataVersions', 1, analyticsLimits.versions);
  requireAnalysis(
    model.results.length <= model.retention.results,
    'Result archive exceeds chosen retention.',
  );
  const versions = new Map<string, Set<number>>();
  let archivedObservations = 0;
  for (const result of model.results) {
    strictKeys(
      result,
      [
        'id',
        'engineVersion',
        'dataVersions',
        'modelVersion',
        'createdAt',
        'interval',
        'parameters',
        'inputSnapshot',
        'stale',
        'content',
      ],
      'result',
    );
    isoTime(result.createdAt, 'result.createdAt');
    requireAnalysis(typeof result.stale === 'boolean', 'Result stale state must be explicit.');
    strictKeys(
      result.inputSnapshot,
      ['datasets', 'series', 'rules', 'indicators'],
      'result.inputSnapshot',
    );
    const captured = { ...blankAnalytics(), ...result.inputSnapshot };
    validateAnalytics(captured);
    for (const dataset of result.inputSnapshot.datasets) {
      archivedObservations += dataset.observations.length;
      const retained = versions.get(dataset.id) ?? new Set<number>();
      retained.add(dataset.version);
      versions.set(dataset.id, retained);
      requireAnalysis(
        retained.size <= model.retention.dataVersions,
        'Archive references more retained data versions than the configured limit.',
        'results',
        'IMPORT_LIMIT',
      );
    }
    requireAnalysis(
      archivedObservations <= analyticsLimits.observations * analyticsLimits.results,
      'Archived observation retention exceeded.',
      'results',
      'IMPORT_LIMIT',
    );
    validateResultMetadata(result, captured);
    validateResultContent(result.content, captured);
  }
  {
    requireAnalysis(
      new TextEncoder().encode(JSON.stringify(model)).byteLength <= 64 * 1024 * 1024,
      'Analytics document and immutable archives exceed the 64 MiB limit. Delete saved results before importing more data.',
      'analytics',
      'IMPORT_LIMIT',
    );
  }
}
/** Reject non-JSON/cyclic values and non-finite numerics at the publication boundary. */
export function assertFiniteJson(value: unknown, depth = 0, ancestors = new Set<object>()) {
  requireAnalysis(depth <= 64, 'Analysis JSON exceeds nesting limit.');
  if (typeof value === 'number') finiteNumber(value, 'result', -Number.MAX_VALUE, Number.MAX_VALUE);
  else if (value && typeof value === 'object') {
    requireAnalysis(!ancestors.has(value), 'Cyclic analysis JSON is unsupported.');
    ancestors.add(value);
    for (const [k, v] of Object.entries(value)) {
      requireAnalysis(!['__proto__', 'prototype', 'constructor'].includes(k), 'Unsafe JSON key.');
      assertFiniteJson(v, depth + 1, ancestors);
    }
    ancestors.delete(value);
  } else
    requireAnalysis(
      value === null || value === undefined || ['string', 'boolean'].includes(typeof value),
      'Unsupported analysis JSON value.',
    );
}
