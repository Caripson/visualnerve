import type { MetricValue } from './types';
import { AnalyticsError } from './validation';
export const metric = (value: number | null, explanation?: string): MetricValue =>
  value !== null && Number.isFinite(value)
    ? { value }
    : {
        value: null,
        reason: value === null ? 'INSUFFICIENT_DATA' : 'NUMERIC_OVERFLOW',
        explanation: explanation ?? 'Insufficient valid data.',
      };
export function sum(values: number[]) {
  let result = 0,
    correction = 0;
  for (const value of values) {
    const next = result + value;
    correction +=
      Math.abs(result) >= Math.abs(value) ? result - next + value : value - next + result;
    result = next;
  }
  return result + correction;
}
export function mean(values: number[]) {
  return values.length ? sum(values.map((v) => v / values.length)) : null;
}
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1] / 2 + sorted[mid] / 2;
}
export function variance(values: number[]) {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  return sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1);
}
export function stddev(values: number[]) {
  const v = variance(values);
  return v === null ? null : Math.sqrt(v);
}
/** Relative change is undefined for zero or negative bases; no signed-base ambiguity. */
export function relativeChange(from: number, to: number): MetricValue {
  return from > 0
    ? metric((to - from) / from)
    : {
        value: null,
        reason: 'INSUFFICIENT_DATA',
        explanation:
          from === 0
            ? 'Relative change is undefined for a zero base.'
            : 'Relative change is undefined for a negative base; absolute change remains available.',
      };
}
export function ranks(values: number[]) {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const result = new Array<number>(values.length);
  for (let start = 0; start < ordered.length; ) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end++;
    const rank = (start + 1 + end) / 2;
    for (let i = start; i < end; i++) result[ordered[i].index] = rank;
    start = end;
  }
  return result;
}
export function pearson(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 2) return null;
  const mx = mean(x)!,
    my = mean(y)!;
  const xx = sum(x.map((v) => (v - mx) ** 2)),
    yy = sum(y.map((v) => (v - my) ** 2));
  if (xx === 0 || yy === 0) return null;
  return Math.max(
    -1,
    Math.min(1, sum(x.map((v, i) => (v - mx) * (y[i] - my))) / Math.sqrt(xx * yy)),
  );
}
export function regression(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 2) return null;
  const mx = mean(x)!,
    my = mean(y)!,
    xx = sum(x.map((v) => (v - mx) ** 2));
  if (xx === 0) return null;
  const slope = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / xx;
  const intercept = my - slope * mx;
  const residuals = x.map((v, i) => y[i] - (intercept + slope * v));
  const total = sum(y.map((v) => (v - my) ** 2));
  return {
    slope,
    intercept,
    rSquared:
      total === 0 ? null : Math.max(0, Math.min(1, 1 - sum(residuals.map((v) => v * v)) / total)),
    residuals,
  };
}
export function sma(values: (number | null)[], window: number) {
  const result: (number | null)[] = [];
  let total = 0,
    missing = 0;
  for (let i = 0; i < values.length; i++) {
    const current = values[i];
    if (current === null) missing++;
    else total += current;
    if (i >= window) {
      const old = values[i - window];
      if (old === null) missing--;
      else total -= old;
    }
    result.push(i >= window - 1 && missing === 0 ? total / window : null);
  }
  return result;
}
/** EMA seeds at the first valid value and resets after a missing observation. */
export function ema(values: (number | null)[], alpha: number) {
  let last: number | null = null;
  return values.map((value) => {
    if (value === null) {
      last = null;
      return null;
    }
    last = last === null ? value : alpha * value + (1 - alpha) * last;
    return last;
  });
}
export function finiteResult(value: number) {
  if (!Number.isFinite(value))
    throw new AnalyticsError(
      'NUMERIC_OVERFLOW',
      'The calculation exceeds the finite numeric range.',
    );
  return value;
}
