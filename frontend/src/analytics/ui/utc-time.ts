/** Numeric controls use UTC explicitly and retain the unedited part of an instant. */
export function inputUtcTime(value: string | number): string {
  return new Date(value).toISOString().slice(11, 23);
}

export function replaceUtcDate(
  value: string | number | undefined,
  date: string,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const time = value === undefined ? '00:00:00.000' : inputUtcTime(value);
  const candidate = `${date}T${time}Z`;
  const instant = new Date(candidate);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
    return undefined;
  return instant.toISOString();
}

export function replaceUtcTime(value: string | number, time: string): string | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59)
    return undefined;
  const clock = `${match[1]}:${match[2]}:${match[3] ?? '00'}.${(match[4] ?? '').padEnd(3, '0')}`;
  return `${new Date(value).toISOString().slice(0, 10)}T${clock}Z`;
}
