export function columnSchema(type: string): Record<string, unknown> {
  if (/\[\]|\b(array|map|struct|variant|json|object)\b/i.test(type))
    return { description: 'SQL type mapping requires review.' };
  if (/\b(bool|boolean|bit)\b/i.test(type)) return { type: 'boolean' };
  if (/\b(tinyint|smallint|integer|int|bigint)\b/i.test(type)) return { type: 'integer' };
  if (/\b(decimal|numeric|number|float|real|double|money)\b/i.test(type)) return { type: 'number' };
  if (/\b(timestamp|datetime)\b/i.test(type)) return { type: 'string', format: 'date-time' };
  if (/\bdate\b/i.test(type)) return { type: 'string', format: 'date' };
  if (/char|text|string|uuid/i.test(type)) return { type: 'string' };
  return { description: 'SQL type mapping requires review.' };
}
