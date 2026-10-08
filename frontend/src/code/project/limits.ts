import { StorageError } from '../../model/errors';

export const PROJECT_SOURCE_FILE_LIMIT_SETTING = 'project-source-file-limit';
export const DEFAULT_PROJECT_SOURCE_FILE_LIMIT = 500;
export const MAX_PROJECT_SOURCE_FILE_LIMIT = 10_000;
export const LARGE_PROJECT_FILE_WARNING =
  'Only ZIP projects with up to 500 analyzed source files are supported and guaranteed. Larger projects are experimental and may be slow or fail. Raising this limit does not increase byte, archive-entry, line, diagram, symbol, connection or time limits.';

function valid(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= DEFAULT_PROJECT_SOURCE_FILE_LIMIT &&
    value <= MAX_PROJECT_SOURCE_FILE_LIMIT
  );
}

/** Missing, invalid or older stored preferences preserve the supported default. */
export function projectSourceFileLimit(value: unknown): number {
  return valid(value) ? value : DEFAULT_PROJECT_SOURCE_FILE_LIMIT;
}

export function assertProjectSourceFileLimit(value: unknown): asserts value is number {
  if (!valid(value))
    throw new StorageError(
      422,
      'ZIP project source-file limit must be a whole number from 500 to 10,000.',
    );
}

/** This is an internal captured budget; source payloads cannot supply it. */
export function checkedProjectSourceFileLimit(value = DEFAULT_PROJECT_SOURCE_FILE_LIMIT): number {
  assertProjectSourceFileLimit(value);
  return value;
}
