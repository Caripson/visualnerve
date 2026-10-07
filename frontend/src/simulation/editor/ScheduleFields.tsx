import { NumberField } from '../fields';
import type { ScheduleWindow } from '../types';

export const openingHours = (schedule?: ScheduleWindow[]) =>
  schedule?.length
    ? schedule.reduce(
        (hours, window) => hours + (window.endSeconds - window.startSeconds) / 3600,
        0,
      )
    : 24;
export function ScheduleFields({
  label,
  value,
  change,
}: {
  label: string;
  value?: ScheduleWindow[];
  change: (value?: ScheduleWindow[]) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        <input
          type="checkbox"
          checked={!!value?.length}
          onChange={(event) =>
            change(
              event.target.checked
                ? [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }]
                : undefined,
            )
          }
        />{' '}
        Use opening / availability hours
      </label>
      {value?.map((window, index) => {
        const patch = (partial: Partial<ScheduleWindow>) =>
          change(value.map((entry, i) => (i === index ? { ...entry, ...partial } : entry)));
        return (
          <div className="simulation-grid" key={index}>
            <NumberField
              label={`${label} start hour ${index + 1}`}
              value={window.startSeconds / 3600}
              change={(hours) => patch({ startSeconds: (hours ?? 0) * 3600 })}
            />
            <NumberField
              label={`${label} end hour ${index + 1}`}
              value={window.endSeconds / 3600}
              change={(hours) => patch({ endSeconds: (hours ?? 0) * 3600 })}
            />
            <label>
              Repeat
              <select
                aria-label={`${label} repeat ${index + 1}`}
                value={window.repeatSeconds ?? 0}
                onChange={(event) =>
                  patch({ repeatSeconds: Number(event.target.value) || undefined })
                }
              >
                <option value={0}>Once</option>
                <option value={86400}>Daily</option>
                <option value={604800}>Weekly</option>
                {window.repeatSeconds && ![86400, 604800].includes(window.repeatSeconds) && (
                  <option value={window.repeatSeconds}>
                    Every {window.repeatSeconds / 3600} hours
                  </option>
                )}
              </select>
            </label>
            <button onClick={() => change(value.filter((_, i) => i !== index))}>
              Remove time window
            </button>
          </div>
        );
      })}
      {!!value?.length && (
        <button
          onClick={() =>
            change([...value, { startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }])
          }
        >
          Add time window
        </button>
      )}
    </fieldset>
  );
}
