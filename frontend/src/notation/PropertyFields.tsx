import { useEffect, useState } from 'react';
import type { NotationPropertyDefinition } from './types';
import { NotationDraftInput } from './DraftInput';

export type NotationPropertyValue =
  | string
  | number
  | boolean
  | { time: number; state: string }[]
  | undefined;
function TimingStatesField({
  value,
  change,
}: {
  value: unknown;
  change: (value: NotationPropertyValue) => void;
}) {
  const serialize = (input: unknown) =>
    Array.isArray(input) ? input.map((item) => `${item.time} | ${item.state}`).join('\n') : '';
  const [draft, setDraft] = useState(() => serialize(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(serialize(value));
  }, [value]);
  return (
    <div className="notation-compartment-editor">
      <label className="field">
        <span>Timing observations (time | state)</span>
        <textarea
          aria-label="Timing observations"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <p className="muted">
        One observation per line. Times must increase; labels name the actual states.
      </p>
      <button
        onClick={() => {
          const entries = draft.trim()
            ? draft.split('\n').map((line) => {
                const separator = line.indexOf('|');
                return {
                  time: Number(line.slice(0, separator).trim()),
                  state: line.slice(separator + 1).trim(),
                  valid: separator > 0,
                };
              })
            : [];
          if (
            entries.length > 128 ||
            entries.some(
              (entry, index) =>
                !entry.valid ||
                !Number.isFinite(entry.time) ||
                !entry.state ||
                entry.state.length > 300 ||
                (index > 0 && entry.time <= entries[index - 1].time),
            )
          ) {
            setError('Enter at most 128 increasing finite times with nonempty state labels.');
            return;
          }
          setError('');
          change(entries.map(({ time, state }) => ({ time, state })));
        }}
      >
        Apply timing observations
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** Catalog-owned field definitions keep the editor and API capabilities aligned. */
export function NotationPropertyFields({
  definitions,
  value,
  change,
}: {
  definitions: readonly NotationPropertyDefinition[];
  value: object | undefined;
  change: (key: string, value: NotationPropertyValue) => void;
}) {
  const fields = (value ?? {}) as Record<string, unknown>;
  return (
    <>
      {definitions.map((field) =>
        field.type === 'timing-states' ? (
          <TimingStatesField
            key={field.key}
            value={fields[field.key]}
            change={(next) => change(field.key, next)}
          />
        ) : (
          <label className="field" key={field.key}>
            <span>{field.label}</span>
            {field.type === 'boolean' ? (
              <input
                type="checkbox"
                aria-label={field.label}
                checked={fields[field.key] === true}
                onChange={(e) => change(field.key, e.target.checked)}
              />
            ) : field.type === 'enum' ? (
              <select
                aria-label={field.label}
                value={String(fields[field.key] ?? '')}
                onChange={(e) => change(field.key, e.target.value || undefined)}
              >
                <option value="">Default</option>
                {field.values?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <NotationDraftInput
                label={field.label}
                type={field.type === 'text' ? 'text' : 'number'}
                min={field.minimum}
                max={field.maximum}
                step={field.type === 'integer' ? 1 : 'any'}
                value={String(fields[field.key] ?? '')}
                commit={(next) =>
                  change(
                    field.key,
                    next === undefined ? undefined : field.type === 'text' ? next : Number(next),
                  )
                }
              />
            )}
          </label>
        ),
      )}
    </>
  );
}
