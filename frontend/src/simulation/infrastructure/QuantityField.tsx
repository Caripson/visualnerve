import { useEffect, useId, useState } from 'react';
import { useEditorFieldValidation } from '../editor/JsonField';
import { quantityValue, type QuantityUnit } from './quantity';
import './infrastructure-ui.css';

/** Invalid intermediate text stays in the form; only valid, committed canonical values escape. */
export function QuantityField({
  label,
  value,
  units,
  change,
  minimum = 0,
  maximum = Infinity,
  help,
  optional = false,
  integer = false,
}: {
  label: string;
  value?: number;
  units: QuantityUnit[];
  change: (value: number | undefined) => void;
  minimum?: number;
  maximum?: number;
  optional?: boolean;
  integer?: boolean;
  help?: string;
}) {
  const id = useId();
  const [unitIndex, setUnitIndex] = useState(0);
  const unit = units[unitIndex] ?? units[0];
  const [text, setText] = useState(value === undefined ? '' : String(value / unit.factor));
  const [error, setError] = useState('');
  const validity = useEditorFieldValidation();
  useEffect(() => () => validity(`quantity:${id}`, false, label), [id, label, validity]);
  useEffect(() => {
    setText(value === undefined ? '' : String(Number((value / unit.factor).toPrecision(12))));
    setError('');
    validity(`quantity:${id}`, false, label);
  }, [value, unit.factor, id, label, validity]);
  function validate(next: string) {
    try {
      const result =
        optional && !next.trim() ? undefined : quantityValue(next, unit, minimum, maximum);
      if (integer && result !== undefined && !Number.isSafeInteger(result))
        throw new Error(`Enter a whole number of ${unit.label}.`);
      setError('');
      validity(`quantity:${id}`, false, label);
      return { valid: true, value: result };
    } catch (failure) {
      setError((failure as Error).message);
      validity(`quantity:${id}`, true, label);
      return { valid: false, value: undefined };
    }
  }
  function commit() {
    const result = validate(text);
    if (result.valid) change(result.value);
  }
  return (
    <div className="simulation-field infrastructure-quantity">
      <label htmlFor={id}>{label}</label>
      <div className="infrastructure-quantity-controls">
        <input
          id={id}
          aria-label={label}
          inputMode="decimal"
          value={text}
          aria-invalid={!!error}
          aria-describedby={help || error ? `${id}-help` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            validate(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              commit();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setText(value === undefined ? '' : String(value / unit.factor));
              setError('');
              validity(`quantity:${id}`, false, label);
            }
          }}
        />
        {units.length > 1 ? (
          <select
            aria-label={`${label} unit`}
            value={unitIndex}
            onChange={(event) => setUnitIndex(Number(event.target.value))}
          >
            {units.map((choice, index) => (
              <option key={choice.label} value={index}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <span>{unit.label}</span>
        )}
      </div>
      {(help || error) && (
        <small id={`${id}-help`} role={error ? 'alert' : undefined}>
          {error || help}
        </small>
      )}
    </div>
  );
}
