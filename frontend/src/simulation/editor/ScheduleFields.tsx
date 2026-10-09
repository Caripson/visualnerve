import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
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
        {t('simulator.editor.scheduleFields.useOpeningAvailabilityHours')}{' '}
      </label>
      {value?.map((window, index) => {
        const patch = (partial: Partial<ScheduleWindow>) =>
          change(value.map((entry, i) => (i === index ? { ...entry, ...partial } : entry)));
        return (
          <div className="simulation-grid" key={index}>
            <NumberField
              label={t('simulator.editor.scheduleFields.startHour', {
                label: String(label),
                windowNumber: String(index + 1),
              })}
              value={window.startSeconds / 3600}
              change={(hours) => patch({ startSeconds: (hours ?? 0) * 3600 })}
            />
            <NumberField
              label={t('simulator.editor.scheduleFields.endHour', {
                label: String(label),
                windowNumber: String(index + 1),
              })}
              value={window.endSeconds / 3600}
              change={(hours) => patch({ endSeconds: (hours ?? 0) * 3600 })}
            />
            <label>
              {t('simulator.editor.scheduleFields.repeat')}{' '}
              <select
                aria-label={t('simulator.editor.scheduleFields.repeat.label_value1', {
                  label: String(label),
                  windowNumber: String(index + 1),
                })}
                value={window.repeatSeconds ?? 0}
                onChange={(event) =>
                  patch({ repeatSeconds: Number(event.target.value) || undefined })
                }
              >
                <option value={0}>{t('simulator.editor.scheduleFields.once')}</option>
                <option value={86400}>{t('simulator.editor.scheduleFields.daily')}</option>
                <option value={604800}>{t('simulator.editor.scheduleFields.weekly')}</option>
                {window.repeatSeconds && ![86400, 604800].includes(window.repeatSeconds) && (
                  <option value={window.repeatSeconds}>
                    {t('simulator.schedule.repeatEvery', { hours: window.repeatSeconds / 3600 })}
                  </option>
                )}
              </select>
            </label>
            <button onClick={() => change(value.filter((_, i) => i !== index))}>
              {t('simulator.editor.scheduleFields.removeTimeWindow')}
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
          {t('simulator.editor.scheduleFields.addTimeWindow')}
        </button>
      )}
    </fieldset>
  );
}
