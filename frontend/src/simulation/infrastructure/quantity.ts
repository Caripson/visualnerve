/** Factors convert displayed numbers to the declared model dimension. */
export interface QuantityUnit {
  label: string;
  factor: number;
}
export const quantityUnits = {
  cores: [{ label: 'cores', factor: 1 }],
  cpuWork: [{ label: 'core-seconds', factor: 1 }],
  memory: [
    { label: 'MiB', factor: 1 },
    { label: 'GiB', factor: 1024 },
  ],
  bandwidth: [
    { label: 'Mbps', factor: 1 },
    { label: 'Gbps', factor: 1000 },
  ],
  power: [
    { label: 'kW', factor: 1 },
    { label: 'W', factor: 0.001 },
  ],
  energy: [
    { label: 'kWh', factor: 1 },
    { label: 'Wh', factor: 0.001 },
  ],
  payload: [
    { label: 'MiB', factor: 1048576 },
    { label: 'KiB', factor: 1024 },
    { label: 'bytes', factor: 1 },
  ],
  time: [
    { label: 'seconds', factor: 1 },
    { label: 'milliseconds', factor: 0.001 },
    { label: 'minutes', factor: 60 },
    { label: 'hours', factor: 3600 },
  ],
  arrival: [
    { label: 'requests/second', factor: 3600 },
    { label: 'requests/minute', factor: 60 },
    { label: 'requests/hour', factor: 1 },
  ],
  ratio: [{ label: '%', factor: 0.01 }],
  count: [{ label: 'items', factor: 1 }],
} satisfies Record<string, QuantityUnit[]>;

export function quantityValue(text: string, unit: QuantityUnit, minimum = 0, maximum = Infinity) {
  const decimal = text.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(decimal))
    throw new Error('Use one decimal separator (. or ,), without thousands separators.');
  const value = Number(decimal.replace(',', '.')) * unit.factor;
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(
      `Enter a number from ${minimum / unit.factor} to ${Number.isFinite(maximum) ? maximum / unit.factor : 'the supported limit'} ${unit.label}.`,
    );
  return value;
}
