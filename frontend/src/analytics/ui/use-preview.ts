import { useRef, useState } from 'react';
import type { AnalyticsExtension, AnalyticsResult } from '../types';

function key(definition: object): string {
  const { resultId: _link, ...parameters } = definition as { resultId?: string };
  return JSON.stringify(parameters);
}

/** A preview always belongs to the definition and data that actually produced it. */
export function usePreview<T, Definition extends object>(
  definition: Definition,
  model: AnalyticsExtension,
) {
  const definitionKey = key(definition);
  const dataKey = JSON.stringify({
    engine: model.engineVersion,
    datasets: model.datasets.map((dataset) => [dataset.id, dataset.version]),
    series: model.series,
    indicators: model.indicators,
  });
  const current = useRef({ definitionKey, dataKey });
  current.current = { definitionKey, dataKey };
  const [stored, setStored] = useState<{
    value: T;
    definitionKey: string;
    dataKey: string;
    archive?: AnalyticsResult;
  }>();
  const applicable =
    stored?.definitionKey === definitionKey && (stored.archive || stored.dataKey === dataKey);
  return {
    value: applicable ? stored!.value : undefined,
    archive: applicable ? stored!.archive : undefined,
    setValue(value: T | undefined, captured: Definition = definition, archive?: AnalyticsResult) {
      setStored(
        value === undefined ? undefined : { value, definitionKey: key(captured), dataKey, archive },
      );
    },
    matches(captured: Definition): boolean {
      return current.current.definitionKey === key(captured) && current.current.dataKey === dataKey;
    },
  };
}
