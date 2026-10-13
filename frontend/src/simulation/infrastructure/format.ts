const formats = new Map<string, Intl.NumberFormat>();
/** Display rounding never erases a nonzero engine quantity or changes its stored precision. */
export function formatInfrastructureQuantity(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  const style =
    magnitude < 0.000001 || magnitude >= 1e12
      ? 'scientific'
      : magnitude < 0.001
        ? 'significant'
        : magnitude < 1
          ? 'fraction6'
          : 'fraction3';
  const key = `${locale ?? 'default'}:${style}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(
      locale,
      style === 'scientific'
        ? { notation: 'scientific', maximumSignificantDigits: 4 }
        : style === 'significant'
          ? { maximumSignificantDigits: 4 }
          : { maximumFractionDigits: style === 'fraction6' ? 6 : 3 },
    );
    formats.set(key, format);
  }
  return format.format(value);
}
