import { DEFAULT_IMPORT_LIMIT_BYTES } from '../imports/limits';
import { useI18n } from '../i18n';

/** A raised file ceiling never implies support for larger files. */
export function ImportSizeNotice({ bytes }: { bytes: number }) {
  const { t } = useI18n();
  return bytes > DEFAULT_IMPORT_LIMIT_BYTES ? (
    <p role="note" className="import-limit-warning">
      {t('imports.largeWarning')}
    </p>
  ) : null;
}
