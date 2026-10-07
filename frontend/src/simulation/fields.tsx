import type { ScalingRule } from './types';

export function NumberField({
  label,
  value,
  change,
  min = 0,
  step = 'any',
  help,
}: {
  label: string;
  value?: number;
  change: (value: number | undefined) => void;
  min?: number;
  step?: number | 'any';
  help?: string;
}) {
  return (
    <label className="simulation-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        onChange={(event) =>
          change(event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
      {help && <small>{help}</small>}
    </label>
  );
}
export function ScalingFields({
  value,
  change,
  capacity,
}: {
  value?: ScalingRule;
  change: (rule?: ScalingRule) => void;
  capacity: number;
}) {
  const patch = (partial: Partial<ScalingRule>) => change({ ...value!, ...partial });
  return (
    <fieldset>
      <legend>Automatic scaling</legend>
      <label>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(event) =>
            change(
              event.target.checked
                ? {
                    minCapacity: capacity,
                    maxCapacity: Math.max(capacity, 5),
                    queueAbove: 20,
                    increment: 1,
                    cooldownSeconds: 60,
                  }
                : undefined,
            )
          }
        />{' '}
        Enable scaling
      </label>
      {value && (
        <div className="simulation-grid">
          <NumberField
            label="Minimum capacity"
            value={value.minCapacity ?? 1}
            step={1}
            change={(v) => patch({ minCapacity: v })}
          />
          <NumberField
            label="Maximum capacity"
            value={value.maxCapacity}
            step={1}
            change={(v) => patch({ maxCapacity: v ?? 1 })}
          />
          <NumberField
            label="Scale increment"
            value={value.increment ?? 1}
            min={1}
            step={1}
            change={(v) => patch({ increment: v })}
          />
          <NumberField
            label="Scale up when queue exceeds"
            value={value.queueAbove}
            change={(v) => patch({ queueAbove: v })}
          />
          <NumberField
            label="Scale up utilization (%)"
            value={value.utilizationAbove === undefined ? undefined : value.utilizationAbove * 100}
            change={(v) => patch({ utilizationAbove: v === undefined ? undefined : v / 100 })}
          />
          <NumberField
            label="Scale down utilization (%)"
            value={value.utilizationBelow === undefined ? undefined : value.utilizationBelow * 100}
            change={(v) => patch({ utilizationBelow: v === undefined ? undefined : v / 100 })}
          />
          <NumberField
            label="Low utilization hold (minutes)"
            value={
              value.scaleDownAfterSeconds === undefined
                ? undefined
                : value.scaleDownAfterSeconds / 60
            }
            change={(v) => patch({ scaleDownAfterSeconds: v === undefined ? undefined : v * 60 })}
          />
          <NumberField
            label="Startup delay (minutes)"
            value={(value.startupSeconds ?? 0) / 60}
            change={(v) => patch({ startupSeconds: (v ?? 0) * 60 })}
          />
          <NumberField
            label="Shutdown delay (minutes)"
            value={(value.shutdownSeconds ?? 0) / 60}
            change={(v) => patch({ shutdownSeconds: (v ?? 0) * 60 })}
          />
          <NumberField
            label="Scaling cooldown (minutes)"
            value={(value.cooldownSeconds ?? 60) / 60}
            change={(v) => patch({ cooldownSeconds: (v ?? 0) * 60 })}
          />
          <NumberField
            label="Scale up one-off cost"
            value={value.scaleUpCost ?? 0}
            change={(v) => patch({ scaleUpCost: v ?? 0 })}
          />
          <NumberField
            label="Extra unit cost / hour"
            help="Scaling surcharge per extra unit, added to its regular hourly cost."
            value={value.additionalCostPerHour ?? 0}
            change={(v) => patch({ additionalCostPerHour: v ?? 0 })}
          />
        </div>
      )}
    </fieldset>
  );
}
