import type { AnalyticsExtension, AnalyticsSignal } from './types';
import { validateAnalytics } from './validation';
import { signalEpisodeIdentity, signalEventIdentity } from './identity';

/** Remap portable semantic identities, including archived inputs, without changing numerical results. */
export function remapAnalytics(
  source: AnalyticsExtension,
  nodeIds = new Map<string, string>(),
  diagramIds = new Map<string, string>(),
): AnalyticsExtension {
  validateAnalytics(source);
  const result = structuredClone(source);
  const ids = new Map<string, string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && !ids.has(record.id))
      ids.set(record.id, crypto.randomUUID());
    if (typeof record.episodeId === 'string' && !ids.has(record.episodeId))
      ids.set(record.episodeId, crypto.randomUUID());
    Object.values(record).forEach(collect);
  };
  collect(result);
  // Semantic signal identities must match a rerun of the copied rule. Random
  // remapping would disconnect acknowledgements and signal-linked scenarios.
  const captured: AnalyticsSignal[] = [];
  const findSignals = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(findSignals);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.episodeId === 'string' &&
      typeof record.observationTime === 'string' &&
      typeof record.ruleId === 'string'
    )
      captured.push(value as AnalyticsSignal);
    Object.values(record).forEach(findSignals);
  };
  findSignals(result);
  const onsetByEpisode = new Map<string, string>();
  for (const signal of captured) {
    const onset =
      signal.onsetTime ?? (signal.state === 'onset' ? signal.observationTime : undefined);
    if (onset) onsetByEpisode.set(signal.episodeId, onset);
  }
  for (const signal of captured) {
    const onsetTime = signal.onsetTime ?? onsetByEpisode.get(signal.episodeId);
    if (!onsetTime) continue;
    const episodeId = signalEpisodeIdentity({
      ...signal,
      ruleId: ids.get(signal.ruleId) ?? signal.ruleId,
      onsetTime,
    });
    ids.set(signal.episodeId, episodeId);
    ids.set(signal.id, signalEventIdentity(episodeId, signal.state, signal.observationTime));
    signal.onsetTime = onsetTime;
  }
  const references = new Set([
    'id',
    'episodeId',
    'datasetId',
    'seriesId',
    'measurementId',
    'indicatorId',
    'ruleId',
    'configId',
    'resultId',
    'scenarioId',
    'sourceSignalId',
    'annotationId',
    'selectedRuleId',
    'baselineRuleId',
    'openingSeriesId',
    'closingSeriesId',
    'secondSeriesId',
  ]);
  const walk = (value: unknown, parentKey?: string): unknown => {
    if (Array.isArray(value))
      return value.map((entry) =>
        ['seriesIds', 'ruleIds'].includes(parentKey ?? '') && typeof entry === 'string'
          ? (ids.get(entry) ?? entry)
          : walk(entry),
      );
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'processLink' && entry && typeof entry === 'object') {
        // A reference to another document keeps that document's semantic IDs.
        const link = entry as Record<string, unknown>;
        const copied =
          typeof link.diagramId === 'string' && diagramIds.has(link.diagramId)
            ? walk(entry, key)
            : structuredClone(entry);
        if (typeof link.sourceSeriesId === 'string')
          (copied as Record<string, unknown>).sourceSeriesId =
            ids.get(link.sourceSeriesId) ?? link.sourceSeriesId;
        output[key] = copied;
      } else if (key === 'dataVersions' && entry && typeof entry === 'object') {
        output[key] = Object.fromEntries(
          Object.entries(entry).map(([id, version]) => [ids.get(id) ?? id, version]),
        );
      } else if (typeof entry === 'string' && key === 'nodeId') {
        // Missing links in a copied/imported graph are explicitly detached.
        if (nodeIds.has(entry)) output[key] = nodeIds.get(entry);
      } else if (typeof entry === 'string' && key === 'diagramId') {
        output[key] = diagramIds.get(entry) ?? entry;
      } else if (typeof entry === 'string' && references.has(key))
        output[key] = ids.get(entry) ?? entry;
      else output[key] = walk(entry, key);
    }
    return output;
  };
  const remapped = walk(result) as AnalyticsExtension;
  validateAnalytics(remapped);
  return remapped;
}
