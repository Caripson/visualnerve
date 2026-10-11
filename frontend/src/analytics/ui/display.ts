export const seriesColors = ['#2f8b70', '#648dcc', '#ba804a', '#9866b4', '#d16975', '#4596a0'];

export function valueLabel(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not available';
  const percent = unit === '%' || unit === 'percent' || unit === 'ratio';
  const displayed = percent ? value * 100 : value;
  if (!Number.isFinite(displayed)) return 'Not available';
  const digits = percent ? 3 : 4;
  const tiny = displayed !== 0 && Math.abs(displayed) < 0.5 * 10 ** -digits;
  const label = new Intl.NumberFormat(
    'en',
    tiny
      ? { notation: 'scientific', maximumSignificantDigits: 4 }
      : { maximumFractionDigits: digits },
  ).format(displayed);
  return `${label}${percent ? '%' : unit ? ` ${unit}` : ''}`;
}

export function dateLabel(time: number | string, timeZone = 'UTC'): string {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
}

export function inputDate(time: number | string): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Analysis could not be completed.';
}

export function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || ('code' in error && error.code === 'CANCELLED'))
  );
}

export function downloadText(text: string, fileName: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Present canonical calculation keys as readable labels without changing result contracts. */
export function metricName(name: string): string {
  if (name === 'rSquared') return 'R²';
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
