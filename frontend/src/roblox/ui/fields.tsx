import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { GameVector } from '../types';

export function TextField({
  label,
  value,
  change,
  multiline = false,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="roblox-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <input aria-label={label} value={value} onChange={(event) => change(event.target.value)} />
      )}
    </label>
  );
}
export function NumberField({
  label,
  value,
  change,
  min,
  max,
  step = 'any',
}: {
  label: string;
  value: number;
  change: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
}) {
  const [draft, setDraft] = useState(String(value));
  const [hint, setHint] = useState('');
  const focused = useRef(false);
  const attempted = useRef(value);
  const hintId = useId();
  useEffect(() => {
    if (!focused.current || value !== attempted.current) {
      attempted.current = value;
      setDraft(String(value));
      setHint('');
    }
  }, [value]);
  return (
    <label className="roblox-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-invalid={draft === '' || !Number.isFinite(Number(draft)) || undefined}
        aria-describedby={hint ? hintId : undefined}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) {
            attempted.current = next;
            setHint('');
            change(next);
          } else setHint('Finish this number before leaving the field.');
        }}
        onBlur={(event) => {
          focused.current = false;
          const unfinished = !Number.isFinite(event.target.valueAsNumber);
          attempted.current = value;
          setDraft(String(value));
          if (unfinished) setHint('No new number was applied. The previous value was restored.');
        }}
      />
      {hint && (
        <small id={hintId} role="status">
          {hint}
        </small>
      )}
    </label>
  );
}
export function Toggle({
  label,
  value,
  change,
}: {
  label: string;
  value: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <label className="roblox-toggle">
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        onChange={(event) => change(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function SelectField({
  label,
  value,
  change,
  options,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="roblox-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => change(event.target.value)}>
        {!options.some((option) => option[0] === value) && (
          <option value={value}>{value ? `Missing: ${value}` : 'Choose one…'}</option>
        )}
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function VectorFields({
  label,
  value,
  change,
  min,
}: {
  label: string;
  value: GameVector;
  change: (value: GameVector) => void;
  min?: number;
}) {
  return (
    <fieldset className="roblox-vector">
      <legend>{label}</legend>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <NumberField
          key={axis}
          label={`${label} ${axis.toUpperCase()}`}
          value={value[axis]}
          min={min}
          change={(next) => change({ ...value, [axis]: next })}
        />
      ))}
    </fieldset>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="roblox-empty">{children}</p>;
}
export const objectNames: readonly (readonly [string, string])[] = [
  ['spawn', 'Player start'],
  ['platform', 'Platform'],
  ['checkpoint', 'Checkpoint'],
  ['hazard', 'Hazard'],
  ['collectible', 'Collectible'],
  ['door', 'Door'],
  ['goal', 'Goal'],
  ['npc', 'Character / NPC'],
  ['zone', 'Invisible trigger zone'],
  ['decoration', 'Decoration'],
  ['movingPlatform', 'Moving platform'],
];
