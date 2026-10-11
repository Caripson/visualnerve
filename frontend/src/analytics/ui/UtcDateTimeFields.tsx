import { inputDate } from './display';
import { inputUtcTime, replaceUtcDate, replaceUtcTime } from './utc-time';

export function UtcDateTimeFields({
  label,
  ariaLabel = label,
  value,
  onChange,
  optional,
  disabled,
}: {
  label: string;
  ariaLabel?: string;
  value?: string | number;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <label>
        {label} ({label.endsWith('date') ? 'UTC' : 'UTC date'})
        <input
          aria-label={ariaLabel}
          type="date"
          disabled={disabled}
          value={value === undefined ? '' : inputDate(value)}
          onChange={(event) => {
            if (!event.target.value) {
              if (optional) onChange(undefined);
              return;
            }
            const next = replaceUtcDate(value, event.target.value);
            if (next !== undefined) onChange(next);
          }}
        />
      </label>
      <label>
        {label.replace(/\sdate$/, '')} time (UTC)
        <input
          aria-label={`${ariaLabel.replace(/\sdate$/, '')} time (UTC)`}
          type="time"
          step="0.001"
          disabled={disabled || value === undefined}
          value={value === undefined ? '' : inputUtcTime(value)}
          onChange={(event) => {
            if (value === undefined) return;
            const next = replaceUtcTime(value, event.target.value);
            if (next !== undefined) onChange(next);
          }}
        />
      </label>
    </>
  );
}
