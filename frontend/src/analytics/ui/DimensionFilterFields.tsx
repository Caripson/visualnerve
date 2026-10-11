import { useEffect, useMemo, useState } from 'react';
import type { AnalyticsExtension } from '../types';

function ExactDimensionField({
  name,
  selected,
  disabled,
  onApply,
}: {
  name: string;
  selected?: string;
  disabled?: boolean;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(selected ?? '');
  useEffect(() => setDraft(selected ?? ''), [selected]);
  return (
    <>
      <p className="muted">
        The first 1,000 distinct values are listed. Enter any exact imported value below; matching
        is case-sensitive.
      </p>
      <label>
        Exact segment: {name}
        <input
          aria-label={`Exact measurement segment ${name}`}
          disabled={disabled}
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="analytics-actions">
        <button
          type="button"
          disabled={disabled || draft === (selected ?? '')}
          onClick={() => onApply(draft)}
        >
          Apply exact segment: {name}
        </button>
      </div>
    </>
  );
}

export function DimensionFilterFields({
  model,
  seriesIds,
  value,
  onChange,
  disabled,
}: {
  model: AnalyticsExtension;
  seriesIds: string[];
  value?: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const choices = useMemo(() => {
    const dimensions = new Map<string, { categories: Set<string>; omitted: boolean }>();
    const ids = new Set(seriesIds);
    for (const dataset of model.datasets)
      for (const observation of dataset.observations) {
        if (!ids.has(observation.seriesId)) continue;
        for (const [key, category] of Object.entries(observation.dimensions)) {
          if (!dimensions.has(key)) dimensions.set(key, { categories: new Set(), omitted: false });
          const choice = dimensions.get(key)!;
          if (choice.categories.size < 1000) choice.categories.add(category);
          else if (!choice.categories.has(category)) choice.omitted = true;
        }
      }
    return dimensions;
  }, [model.datasets, seriesIds]);
  if (!choices.size) return null;
  return (
    <fieldset>
      <legend>Measurement segment</legend>
      <div className="analytics-fields">
        {[...choices].map(([key, { categories, omitted }]) => {
          const selected = value && key in value ? value[key] : undefined;
          const listed = new Set(categories);
          if (selected !== undefined) listed.add(selected);
          return (
            <div key={key}>
              <label>
                Segment: {key}
                <select
                  aria-label={`Measurement segment ${key}`}
                  disabled={disabled}
                  value={selected === undefined ? 'all' : `selected:${selected}`}
                  onChange={(event) => {
                    const next = { ...value };
                    if (event.target.value === 'all') delete next[key];
                    else next[key] = event.target.value.slice(9);
                    onChange(next);
                  }}
                >
                  <option value="all">Choose one segment before numeric analysis</option>
                  {[...listed].sort().map((category) => (
                    <option key={category} value={`selected:${category}`}>
                      {category || '(empty value)'}
                    </option>
                  ))}
                </select>
              </label>
              {omitted && (
                <ExactDimensionField
                  name={key}
                  selected={selected}
                  disabled={disabled}
                  onApply={(category) => {
                    const next = { ...value };
                    if (category === '') delete next[key];
                    else next[key] = category;
                    onChange(next);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="muted">
        Filters are saved in the measurement definition. Distinct segments are never silently
        combined into one curve or numeric measurement.
      </p>
    </fieldset>
  );
}
