import { useEffect, useId, useState } from 'react';

/** Keep incomplete numeric/semantic input local until the user commits it. */
export function NotationDraftInput({
  label,
  value,
  type = 'text',
  min,
  max,
  step,
  commit,
}: {
  label: string;
  value: string | number | undefined;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number | 'any';
  commit: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [error, setError] = useState('');
  const id = useId();
  useEffect(() => {
    setDraft(String(value ?? ''));
    setError('');
  }, [value]);
  const apply = (input: HTMLInputElement) => {
    if (draft === String(value ?? '')) return;
    if (
      !input.validity.valid ||
      (type === 'number' && draft !== '' && !Number.isFinite(Number(draft)))
    ) {
      setError(input.validationMessage || 'Enter a finite value within the allowed range.');
      return;
    }
    try {
      commit(draft || undefined);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This value is invalid.');
    }
  };
  return (
    <>
      <input
        aria-label={label}
        type={type}
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        onBlur={(event) => apply(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply(event.currentTarget);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(value ?? ''));
            setError('');
          }
        }}
      />
      {error && (
        <span id={id} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
