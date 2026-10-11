import type { AnalyticsExtension, AnalyticsSignal, SignalExpression, SignalOperand } from './types';

/** Stable non-cryptographic ID digest; it is never an integrity proof or access credential. */
export function analyticsIdentity(text: string) {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489917);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export const observationIdentityKey = (
  seriesId: string,
  time: string,
  dimensions: Record<string, string>,
) =>
  JSON.stringify([
    seriesId,
    time,
    Object.entries(dimensions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);

/** Episode provenance survives document copies and filtered active-only histories. */
export function signalEpisodeIdentity(input: {
  ruleId: string;
  ruleVersion: number;
  dataVersion: number;
  seriesVersion?: number;
  definitionFingerprint?: string;
  dimensions: Record<string, string>;
  onsetTime: string;
}) {
  const dimensions = Object.fromEntries(
    Object.entries(input.dimensions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const semanticVersion =
    (input.seriesVersion ?? 1) === 1 ? '' : `|series-version:${input.seriesVersion}`;
  const fingerprint = input.definitionFingerprint
    ? `|definition:${input.definitionFingerprint}`
    : '';
  return `episode-${analyticsIdentity(`${input.ruleId}|${input.ruleVersion}|${input.dataVersion}${semanticVersion}${fingerprint}|${JSON.stringify(dimensions)}|${input.onsetTime}`)}`;
}

function canonicalDefinition(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDefinition).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalDefinition(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Identify calculation dependencies without document-local IDs. Nested inputs are
 * represented by their semantic digest to keep even branching derived DAGs bounded.
 * This detects changed definitions; reproduction still requires retained raw input.
 */
export function signalDefinitionFingerprint(
  model: AnalyticsExtension,
  ruleId: string,
): string | undefined {
  const rule = model.rules.find((entry) => entry.id === ruleId);
  if (!rule) return undefined;
  const seriesById = new Map(model.series.map((entry) => [entry.id, entry]));
  const datasetsById = new Map(model.datasets.map((entry) => [entry.id, entry]));
  const indicatorsById = new Map(model.indicators.map((entry) => [entry.id, entry]));
  const memo = new Map<string, string>();
  const visiting = new Set<string>();
  let unresolved = false;
  const seriesDefinition = (id: string): string | undefined => {
    if (memo.has(id)) return memo.get(id);
    const series = seriesById.get(id);
    const dataset = series && datasetsById.get(series.datasetId);
    if (!series || !dataset || visiting.has(id)) {
      unresolved = true;
      return undefined;
    }
    visiting.add(id);
    const definition = {
      version: series.version ?? 1,
      name: series.name,
      dataVersion: dataset.version,
      revisionHistory: dataset.revisionHistory,
      column: series.columnId,
      dimensions: series.dimensions,
      unit: series.unit,
      semantics: series.semantics,
      provenance: series.provenance,
      resolution: series.resolution,
      timezone: series.timezone,
      periodBoundary: series.periodBoundary,
      aggregation: series.aggregation,
      direction: series.direction,
      riskPopulation: series.riskPopulation,
      definition: series.definition,
      derived: series.derived && {
        operation: series.derived.operation,
        inputs: series.derived.seriesIds.map(seriesDefinition),
      },
    };
    const fingerprint = analyticsIdentity(canonicalDefinition(definition));
    visiting.delete(id);
    memo.set(id, fingerprint);
    return fingerprint;
  };
  const operand = (value: SignalOperand): unknown => {
    if (value.kind === 'constant') return { kind: value.kind, value: value.value };
    if (value.kind === 'series')
      return { kind: value.kind, source: seriesDefinition(value.seriesId) };
    const indicator = indicatorsById.get(value.indicatorId);
    if (!indicator) {
      unresolved = true;
      return undefined;
    }
    return {
      kind: value.kind,
      component: value.component ?? 'value',
      indicator: {
        kind: indicator.kind,
        window: indicator.window,
        alpha: indicator.alpha,
        multiplier: indicator.multiplier,
        shortWindow: indicator.shortWindow,
        longWindow: indicator.longWindow,
        signalWindow: indicator.signalWindow,
        source: seriesDefinition(indicator.seriesId),
      },
    };
  };
  const expression = (node: SignalExpression): unknown => {
    if (node.kind === 'and' || node.kind === 'or')
      return { kind: node.kind, children: node.children.map(expression) };
    if (node.kind === 'not') return { kind: node.kind, child: expression(node.child) };
    if (node.kind === 'sustained')
      return { kind: node.kind, periods: node.periods, child: expression(node.child) };
    if (node.kind === 'window') return { ...node, operand: operand(node.operand) };
    return { ...node, left: operand(node.left), right: operand(node.right) };
  };
  const definition = {
    engineVersion: model.engineVersion,
    family: rule.family,
    source: seriesDefinition(rule.seriesId),
    secondary: rule.secondSeriesId && seriesDefinition(rule.secondSeriesId),
    parameters: rule.parameters,
    expression: rule.expression && expression(rule.expression),
  };
  return unresolved ? undefined : analyticsIdentity(canonicalDefinition(definition));
}

/** Legacy evidence without captured dependency metadata is retained, never guessed current. */
export function isCurrentSignal(model: AnalyticsExtension, signal: AnalyticsSignal): boolean {
  const rule = model.rules.find((entry) => entry.id === signal.ruleId);
  const series = model.series.find((entry) => entry.id === signal.seriesId);
  const dataset = series && model.datasets.find((entry) => entry.id === series.datasetId);
  return !!(
    rule &&
    series &&
    dataset &&
    signal.definitionFingerprint &&
    rule.seriesId === series.id &&
    rule.version === signal.ruleVersion &&
    dataset.version === signal.dataVersion &&
    (series.version ?? 1) === (signal.seriesVersion ?? 1) &&
    signal.definitionFingerprint === signalDefinitionFingerprint(model, rule.id)
  );
}

export function signalEventIdentity(
  episodeId: string,
  state: 'onset' | 'active' | 'resolved',
  observationTime: string,
) {
  return `signal-${analyticsIdentity(`${episodeId}|${state}|${observationTime}`)}`;
}
