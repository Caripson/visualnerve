import type { AnalyticsExtension, AnalyticsSignal } from './types';
import { requireAnalysis } from './validation';

export interface SignalHistoryReconciliation {
  signals: AnalyticsSignal[];
  notes: string[];
  evictedHistorical: number;
  omittedCurrent: number;
  protectedEvents: number;
}
const handling = [
  'acknowledged',
  'muted',
  'measurementId',
  'annotationId',
  'nodeId',
  'scenarioId',
] as const;
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const chronological = (a: AnalyticsSignal, b: AnalyticsSignal) =>
  lexical(a.observationTime, b.observationTime) ||
  lexical(a.detectedAt, b.detectedAt) ||
  lexical(a.id, b.id);

/** UI and API apply the same explicit, bounded retention policy to semantic history. */
export function reconcileSignalHistory(
  model: AnalyticsExtension,
  incoming: AnalyticsSignal[],
  limit = 10000,
): SignalHistoryReconciliation {
  requireAnalysis(
    Array.isArray(incoming) &&
      incoming.length <= 10000 &&
      Array.isArray(model.signals) &&
      model.signals.length <= 10000,
    'Signal history inputs exceed their 10,000-event bounds.',
    'signals',
    'IMPORT_LIMIT',
  );
  requireAnalysis(
    Number.isInteger(limit) && limit >= 1 && limit <= 10000,
    'Signal history retention must be between 1 and 10,000 events.',
    'signals',
    'IMPORT_LIMIT',
  );
  const previous = new Map(model.signals.map((signal) => [signal.id, signal]));
  const linked = new Set(
    model.scenarios
      .map((scenario) => scenario.sourceSignalId)
      .filter((id): id is string => typeof id === 'string'),
  );
  // A retained result can restore explicitly linked provenance if a former
  // client replaced its live history. It does not restore unbounded archives.
  for (const id of linked)
    if (!previous.has(id)) {
      for (let i = model.results.length - 1; i >= 0; i--) {
        const content = model.results[i].content;
        const signal =
          content.kind === 'signals' ? content.signals.find((entry) => entry.id === id) : undefined;
        if (signal) {
          previous.set(id, signal);
          break;
        }
      }
    }
  const current = new Map<string, AnalyticsSignal>();
  for (const signal of incoming) {
    const retained = previous.get(signal.id);
    current.set(signal.id, {
      ...signal,
      ...Object.fromEntries(
        handling.filter((key) => retained?.[key] !== undefined).map((key) => [key, retained![key]]),
      ),
    });
  }
  const all = new Map([...previous, ...current]);
  const protectedIds = new Set(
    [...all.values()]
      .filter(
        (signal) =>
          linked.has(signal.id) ||
          signal.acknowledged === true ||
          signal.muted === true ||
          handling.slice(2).some((key) => signal[key] !== undefined),
      )
      .map((signal) => signal.id),
  );
  requireAnalysis(
    protectedIds.size <= limit,
    'Protected signal history exceeds its retention limit. Remove obsolete scenario links or explicitly clear handled signal records before saving another batch.',
    'signals',
    'IMPORT_LIMIT',
  );
  const selected = new Map<string, AnalyticsSignal>();
  const take = (values: AnalyticsSignal[]) => {
    for (const signal of values.sort((a, b) => chronological(b, a))) {
      if (selected.size >= limit) break;
      if (!selected.has(signal.id)) selected.set(signal.id, signal);
    }
  };
  take([...all.values()].filter((signal) => protectedIds.has(signal.id)));
  take([...current.values()]);
  take([...previous.values()]);
  const omittedCurrent = [...current.keys()].filter((id) => !selected.has(id)).length;
  const evictedHistorical = [...previous.keys()].filter(
    (id) => !current.has(id) && !selected.has(id),
  ).length;
  const missingLinked = [...linked].filter((id) => !all.has(id)).length;
  const notes = [
    ...(evictedHistorical
      ? [
          `Signal history retention removed ${evictedHistorical} unprotected historical event(s). Their retained analysis archives are unchanged.`,
        ]
      : []),
    ...(omittedCurrent
      ? [
          `Signal history retained protected originals and omitted ${omittedCurrent} current event(s) from the live history. The new analysis archive retains its full bounded published batch.`,
        ]
      : []),
    ...(missingLinked
      ? [
          `${missingLinked} linked signal(s) are unavailable in live history or retained archives. Restore their original backup or explicitly remove the expired scenario link.`,
        ]
      : []),
  ];
  return {
    signals: structuredClone([...selected.values()].sort(chronological)),
    notes,
    evictedHistorical,
    omittedCurrent,
    protectedEvents: protectedIds.size,
  };
}

/** Numeric jobs do not need retained archives, presentation links or user handling. */
export function compactAnalysisModel(model: AnalyticsExtension): AnalyticsExtension {
  return {
    ...model,
    results: [],
    signals: [],
    measurements: model.measurements.map(({ resultId: _locked, ...definition }) => definition),
    scenarios: model.scenarios.map(({ sourceSignalId: _source, ...definition }) => definition),
  };
}
