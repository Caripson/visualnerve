/** Versioned semantic analytics payload; chart pixels never identify observations. */
export const ANALYTICS_ENGINE_VERSION = '1.0.0';
export const analyticsLimits = {
  datasets: 8,
  series: 100,
  observations: 200000,
  rules: 100,
  expressionDepth: 8,
  conditions: 64,
  lookback: 10000,
  jobs: 2,
  results: 12,
  versions: 3,
  page: 1000,
  importColumns: 200,
  importCells: 10000000,
  expandedXlsxBytes: 100 * 1024 * 1024,
} as const;
export type AnalyticsCode =
  | 'INVALID_ANALYTICS'
  | 'INSUFFICIENT_DATA'
  | 'INVALID_OHLC'
  | 'INCOMPATIBLE_UNITS'
  | 'INVALID_RATE_DENOMINATOR'
  | 'STALE_ANALYSIS_RESULT'
  | 'AMBIGUOUS_INPUT'
  | 'IMPORT_LIMIT'
  | 'CANCELLED'
  | 'NUMERIC_OVERFLOW';
export interface AnalysisIssue {
  code: AnalyticsCode;
  message: string;
  path?: string;
  row?: number;
  column?: string;
  severity: 'error' | 'warning';
}
export type Resolution = 'observation' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface AnalyticsUnit {
  kind: 'count' | 'currency' | 'ratio' | 'number';
  label: string;
  currency?: string;
}
export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface Observation {
  id: string;
  seriesId: string;
  time: string;
  periodEnd?: string;
  knownAt?: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  ohlc?: Ohlc;
  dimensions: Record<string, string>;
  quality: 'valid' | 'missing' | 'incomplete';
  sourceRow?: number;
}
export interface AnalyticsDataset {
  id: string;
  name: string;
  version: number;
  source: { kind: 'example' | 'csv' | 'xlsx' | 'json'; name: string; illustrative?: boolean };
  observations: Observation[];
  transformations: string[];
  importedAt: string;
  revisionHistory: 'unavailable' | 'point-in-time';
}
export interface DerivedExpression {
  operation: 'difference' | 'relative-change' | 'sum' | 'subtract' | 'multiply' | 'divide';
  seriesIds: string[];
}
export interface AnalyticsSeries {
  id: string;
  /** Semantic definition version; absent legacy values mean version 1. */
  version?: number;
  name: string;
  datasetId: string;
  columnId?: string;
  dimensions: Record<string, string>;
  unit: AnalyticsUnit;
  semantics: 'snapshot' | 'flow' | 'rate';
  provenance: 'observed' | 'derived';
  resolution: Resolution;
  timezone: string;
  periodBoundary: 'start' | 'end';
  aggregation: 'sum' | 'first' | 'last' | 'ratio' | 'none';
  direction: 'higher-is-better' | 'lower-is-better' | 'neutral';
  riskPopulation?: 'opening-customers' | 'other';
  definition: string;
  derived?: DerivedExpression;
}
export interface AnalyticsChart {
  id: string;
  dimensions?: Record<string, string>;
  name: string;
  kind: 'line' | 'area' | 'bar' | 'candlestick' | 'waterfall';
  seriesIds: string[];
  resolution: Resolution;
  normalized: boolean;
  from?: string;
  to?: string;
  waterfall?: {
    openingSeriesId: string;
    closingSeriesId: string;
    components: { seriesId: string; sign: 1 | -1 }[];
  };
}
export type IndicatorKind = 'sma' | 'ema' | 'roc' | 'rolling-stddev' | 'bollinger' | 'macd' | 'rsi';
export interface AnalyticsIndicator {
  id: string;
  name: string;
  seriesId: string;
  kind: IndicatorKind;
  window: number;
  alpha?: number;
  multiplier?: number;
  shortWindow?: number;
  longWindow?: number;
  signalWindow?: number;
}
export type MeasurementKind =
  | 'point-to-point'
  | 'time-range'
  | 'range-statistics'
  | 'trend-line'
  | 'regression'
  | 'compare-periods'
  | 'compare-series'
  | 'correlation'
  | 'annotation';
export interface AnalyticsMeasurement {
  id: string;
  dimensions?: Record<string, string>;
  name: string;
  kind: MeasurementKind;
  seriesIds: string[];
  from: string;
  to: string;
  comparisonFrom?: string;
  comparisonTo?: string;
  points?: { time: string; value: number }[];
  method?: 'pearson' | 'spearman';
  lag?: number;
  normalized?: boolean;
  note?: string;
  nodeId?: string;
  resultId?: string;
}
export type Comparator = '>' | '>=' | '<' | '<=' | '==' | '!=';
export type SignalOperand =
  | { kind: 'series'; seriesId: string }
  | {
      kind: 'indicator';
      indicatorId: string;
      component?: 'value' | 'upper' | 'lower' | 'signal' | 'histogram';
    }
  | { kind: 'constant'; value: number };
export type SignalExpression =
  | { kind: 'comparison'; left: SignalOperand; operator: Comparator; right: SignalOperand }
  | { kind: 'and'; children: SignalExpression[] }
  | { kind: 'or'; children: SignalExpression[] }
  | { kind: 'not'; child: SignalExpression }
  | { kind: 'sustained'; periods: number; child: SignalExpression }
  | {
      kind: 'window';
      operand: SignalOperand;
      operation: 'mean' | 'min' | 'max' | 'stddev' | 'roc';
      periods: number;
      operator: Comparator;
      threshold: number;
    }
  | { kind: 'crossing'; direction: 'up' | 'down'; left: SignalOperand; right: SignalOperand };
export type SignalFamily =
  | 'threshold'
  | 'sustained'
  | 'moving-average-crossover'
  | 'momentum'
  | 'anomaly'
  | 'variation-spike'
  | 'structural-change'
  | 'seasonality-deviation'
  | 'kpi-divergence'
  | 'custom';
export interface AnalyticsRule {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  family: SignalFamily;
  seriesId: string;
  secondSeriesId?: string;
  severity: 'info' | 'warning' | 'critical';
  expression?: SignalExpression;
  parameters: {
    comparator?: Comparator;
    threshold?: number;
    consecutive?: number;
    cooldown?: number;
    hysteresis?: number;
    window?: number;
    shortWindow?: number;
    longWindow?: number;
    average?: 'sma' | 'ema';
    method?: 'zscore' | 'mad';
    mu0?: number;
    k?: number;
    h?: number;
    reset?: 'on-resolve' | 'on-detect';
    seasonLength?: number;
    tolerance?: number;
    direction?: 'up' | 'down' | 'both';
  };
}
export interface AnalyticsSignal {
  id: string;
  episodeId: string;
  ruleId: string;
  ruleVersion: number;
  seriesId: string;
  /** Captured semantic series version; absent legacy values mean version 1. */
  seriesVersion?: number;
  /** ID-neutral dependency identity, not a substitute for retained analysis input. */
  definitionFingerprint?: string;
  dimensions: Record<string, string>;
  dataVersion: number;
  interval: { from: string; to: string };
  observationTime: string;
  onsetTime?: string;
  detectedAt: string;
  state: 'onset' | 'active' | 'resolved';
  value: number | null;
  deviationMagnitude: number | null;
  deviationUnit: string;
  thresholdUnit: string;
  baseline: number | null;
  threshold: number | null;
  unit: AnalyticsUnit;
  method: SignalFamily;
  parameters: AnalyticsRule['parameters'];
  /** Captured declarative rule for explaining a historical custom signal. */
  expression?: SignalExpression;
  secondSeriesId?: string;
  evidence: { observations: number; missing: number; exposure?: number };
  quality: 'valid' | 'insufficient';
  explanation: string;
  severity: AnalyticsRule['severity'];
  acknowledged?: boolean;
  muted?: boolean;
  measurementId?: string;
  annotationId?: string;
  nodeId?: string;
  scenarioId?: string;
}
export interface BacktestConfig {
  id: string;
  name: string;
  ruleIds: string[];
  from: string;
  to: string;
  trainEnd: string;
  validationEnd: string;
  holdoutStart: string;
  walkForwardPeriods: number;
  trials: number;
  baselineRuleId?: string;
  outcome?: {
    seriesId: string;
    comparator: Comparator;
    threshold: number;
    horizon: number;
    matching: 'first-unmatched';
  };
}
export interface GrowthAssumptions {
  openingCustomers: number;
  newCustomers: number;
  reactivatedCustomers: number;
  churnRate: number;
  newCustomerGrowth: number;
  openingMrc: number;
  newMrc: number;
  expansionMrc: number;
  contractionMrc: number;
  churnedMrc: number;
  currency: string;
  revenuePerCustomer?: number;
  churnAdjustment?: { kind: 'relative' | 'percentage-points'; value: number };
}
export interface AnalyticsScenario {
  id: string;
  name: string;
  version: number;
  model: 'growth-churn';
  start: string;
  periods: number;
  resolution: 'month';
  assumptions: GrowthAssumptions;
  sourceSignalId?: string;
  reviewed: boolean;
  nodeId?: string;
  processLink?: {
    diagramId: string;
    scenarioId: string;
    sourceSeriesId?: string;
    nodeId?: string;
    parameter: string;
    unit: string;
    resolution: Resolution;
    reviewed: boolean;
  };
}
export interface ScenarioPoint {
  time: string;
  openingCustomers: number;
  newCustomers: number;
  reactivatedCustomers: number;
  lostCustomers: number;
  closingCustomers: number;
  openingMrc: number;
  newMrc: number;
  expansionMrc: number;
  contractionMrc: number;
  churnedMrc: number;
  closingMrc: number;
  provenance: 'scenario';
  expectedCounts: true;
}
export interface MetricValue {
  value: number | null;
  reason?: AnalyticsCode;
  explanation?: string;
}
export interface MeasurementResult {
  kind: 'measurement';
  measurementId: string;
  metrics: Record<string, MetricValue>;
  values?: { time: string; value: number | null }[];
  residuals?: { time: string; value: number }[];
  notes: string[];
}
export interface IndicatorPoint {
  time: string;
  value: number | null;
  upper?: number | null;
  lower?: number | null;
  signal?: number | null;
  histogram?: number | null;
  reason?: AnalyticsCode;
}
export interface IndicatorResult {
  kind: 'indicator';
  indicatorId: string;
  points: IndicatorPoint[];
  notes: string[];
}
export interface SignalResult {
  kind: 'signals';
  signals: AnalyticsSignal[];
  totalEvents: number;
  omittedEvents: number;
  episodeCount: number;
  evaluated: number;
  unknown: number;
  notes: string[];
}
export interface BacktestRuleResult {
  ruleId: string;
  split: 'train' | 'validation' | 'holdout';
  signals: number;
  episodes: number;
  activePeriods: number;
  exposedPeriods: number;
  evaluablePeriods: number;
  matchedSignals?: number;
  matchedOutcomes?: number;
  outcomeCount?: number;
  precision?: MetricValue;
  recall?: MetricValue;
  falseAlarms?: number;
  detectionDelay?: MetricValue;
}
export interface BacktestResult {
  kind: 'backtest';
  configId: string;
  results: BacktestRuleResult[];
  selectedRuleId?: string;
  trials: number;
  retrospective: boolean;
  notes: string[];
}
export interface ScenarioResult {
  kind: 'scenario';
  scenarioId: string;
  currency: string;
  points: ScenarioPoint[];
  notes: string[];
}
export type AnalyticsResultContent =
  | MeasurementResult
  | IndicatorResult
  | SignalResult
  | BacktestResult
  | ScenarioResult;
export interface AnalyticsResult {
  id: string;
  engineVersion: string;
  dataVersions: Record<string, number>;
  modelVersion: number;
  createdAt: string;
  interval: { from: string; to: string };
  parameters: Record<string, unknown>;
  inputSnapshot: {
    datasets: AnalyticsDataset[];
    series: AnalyticsSeries[];
    rules: AnalyticsRule[];
    indicators: AnalyticsIndicator[];
  };
  stale: boolean;
  content: AnalyticsResultContent;
}
export interface AnalyticsExtension {
  schemaVersion: 1;
  engineVersion: string;
  datasets: AnalyticsDataset[];
  series: AnalyticsSeries[];
  charts: AnalyticsChart[];
  indicators: AnalyticsIndicator[];
  measurements: AnalyticsMeasurement[];
  rules: AnalyticsRule[];
  signals: AnalyticsSignal[];
  backtests: BacktestConfig[];
  scenarios: AnalyticsScenario[];
  results: AnalyticsResult[];
  retention: { results: number; dataVersions: number };
}
export interface WaterfallResult {
  opening: number;
  closing: number;
  components: { seriesId: string; name: string; value: number }[];
  residual: number;
  reconciled: boolean;
  unit: AnalyticsUnit;
}
export interface ImportMapping {
  format: 'wide' | 'long';
  timeColumn: string;
  valueColumns?: {
    column: string;
    seriesId: string;
    name: string;
    unit: AnalyticsUnit;
    semantics: AnalyticsSeries['semantics'];
    aggregation: AnalyticsSeries['aggregation'];
    direction: AnalyticsSeries['direction'];
    riskPopulation?: AnalyticsSeries['riskPopulation'];
  }[];
  valueColumn?: string;
  seriesColumn?: string;
  dimensions: string[];
  knownAtColumn?: string;
  numeratorColumn?: string;
  denominatorColumn?: string;
  ohlcColumns?: { open: string; high: string; low: string; close: string };
  decimal: '.' | ',';
  percent: 'ratio' | 'percent';
  dateFormat: 'iso' | 'dmy' | 'mdy' | 'excel-1900' | 'excel-1904';
  timezone: string;
  resolution: Resolution;
  duplicatePolicy: 'reject' | 'first' | 'last' | 'keep';
  invalidRows: 'reject' | 'skip';
  missingValues: 'preserve' | 'reject';
  longSeries?: {
    name: string;
    id: string;
    unit: AnalyticsUnit;
    semantics: AnalyticsSeries['semantics'];
    aggregation: AnalyticsSeries['aggregation'];
    direction: AnalyticsSeries['direction'];
    riskPopulation?: AnalyticsSeries['riskPopulation'];
  }[];
}
export interface ImportSource {
  kind: 'csv' | 'xlsx' | 'json';
  name: string;
  text?: string;
  bytes?: Uint8Array;
  sheet?: string;
}
export interface ImportPreview {
  dataset: AnalyticsDataset;
  series: AnalyticsSeries[];
  issues: AnalysisIssue[];
  columns: string[];
  sample: Record<string, string | number | null>[];
  valid: boolean;
  rows: number;
  skippedRows: number;
}
export interface AnalysisContext {
  signal?: AbortSignal;
  progress?: (completed: number, total: number) => void;
  now?: () => string;
  cutoff?: string;
}
export interface ImportInspection {
  columns: string[];
  sample: Record<string, string | number | null>[];
  rows: number;
  sheets: string[];
  seriesNames?: string[];
}
export type AnalysisJobRequest =
  | {
      kind: 'commit-import';
      model: AnalyticsExtension;
      preview: ImportPreview;
      mode: 'create' | 'replace' | 'update';
      targetDatasetId?: string;
    }
  | { kind: 'validate'; model: AnalyticsExtension }
  | {
      kind: 'archive';
      model: AnalyticsExtension;
      content: AnalyticsResultContent;
      parameters: Record<string, unknown>;
      modelVersion: number;
    }
  | { kind: 'reconcile'; previous: AnalyticsExtension; model: AnalyticsExtension }
  | { kind: 'inspect-import'; source: ImportSource; byteLimit?: number; seriesColumn?: string }
  | {
      kind: 'query';
      model: AnalyticsExtension;
      seriesId: string;
      query?: {
        from?: string;
        to?: string;
        resolution?: Resolution;
        dimensions?: Record<string, string>;
        cutoff?: string;
      };
      ohlc?: boolean;
    }
  | {
      kind: 'import';
      source: ImportSource;
      mapping: ImportMapping;
      datasetId: string;
      byteLimit?: number;
    }
  | { kind: 'waterfall'; model: AnalyticsExtension; chart: AnalyticsChart; time: string }
  | { kind: 'measurement'; model: AnalyticsExtension; measurement: AnalyticsMeasurement }
  | { kind: 'indicator'; model: AnalyticsExtension; indicator: AnalyticsIndicator }
  | { kind: 'signals'; model: AnalyticsExtension; ruleIds?: string[]; from?: string; to?: string }
  | { kind: 'backtest'; model: AnalyticsExtension; config: BacktestConfig }
  | { kind: 'scenario'; scenario: AnalyticsScenario };
export type AnalysisJobValue =
  | AnalyticsExtension
  | ImportPreview
  | ImportInspection
  | Observation[]
  | WaterfallResult
  | AnalyticsResultContent;
