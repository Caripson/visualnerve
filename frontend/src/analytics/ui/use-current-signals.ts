import { useMemo } from 'react';
import type { AnalyticsExtension, AnalyticsSignal } from '../types';
import { isCurrentSignal } from '../identity';

/** Reuse the canonical provenance check across repeated active events in a bounded history. */
export function useCurrentSignals(model: AnalyticsExtension) {
  return useMemo(() => {
    const provenance = new Map<string, boolean>();
    const currentIds = new Set<string>();
    for (const signal of model.signals) {
      const key = JSON.stringify([
        signal.ruleId,
        signal.ruleVersion,
        signal.seriesId,
        signal.seriesVersion ?? 1,
        signal.dataVersion,
        signal.definitionFingerprint,
        signal.unit,
      ]);
      let current = provenance.get(key);
      if (current === undefined) {
        current = isCurrentSignal(model, signal);
        provenance.set(key, current);
      }
      if (current) currentIds.add(signal.id);
    }
    return {
      current: model.signals.filter((signal) => currentIds.has(signal.id)),
      historical: (signal: AnalyticsSignal) => !currentIds.has(signal.id),
    };
  }, [model]);
}
