/** Show the stored instant, including intraday and millisecond precision, as accessible text. */
export function UtcTimestamp({ value }: { value: string | number }) {
  const canonical = new Date(value).toISOString();
  return <time dateTime={canonical}>{canonical}</time>;
}
