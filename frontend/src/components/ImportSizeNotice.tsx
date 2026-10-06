import { DEFAULT_IMPORT_LIMIT_BYTES, LARGE_IMPORT_WARNING } from '../imports/limits';

/** A raised file ceiling never implies support for larger files. */
export function ImportSizeNotice({ bytes }: { bytes: number }) {
  return bytes > DEFAULT_IMPORT_LIMIT_BYTES ? (
    <p role="note" className="import-limit-warning">
      {LARGE_IMPORT_WARNING}
    </p>
  ) : null;
}
