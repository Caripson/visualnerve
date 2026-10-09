import { presentationMessage } from '../presentation/display-messages';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { assertImportLimitMb, IMPORT_LIMIT_SETTING } from '../imports/limits';

export function ImportSettings() {
  const { t } = useI18n();
  const active = useEditor((state) => state.importFileLimitMb);
  const [draft, setDraft] = useState(String(active));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => setDraft(String(active)), [active]);
  const largerLimit = active > 50 || Number(draft) > 50;

  async function save() {
    setError('');
    setMessage('');
    try {
      const value = Number(draft);
      assertImportLimitMb(value);
      setBusy(true);
      await workspace.setPreference(IMPORT_LIMIT_SETTING, value);
      setMessage('Import file size limit saved for this browser.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="import-settings"
      aria-label={t('imports.settingsRegion')}
      data-testid="import-settings"
    >
      <div className="property-section">{t('imports.sizeTitle')}</div>
      <label className="field">
        <span>{t('imports.sizeField')}</span>
        <input
          type="number"
          aria-label={t('imports.sizeField')}
          min={50}
          max={1024}
          step={1}
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
            setMessage('');
          }}
        />
      </label>
      <p className="muted">{t('imports.sizeDefaultsHint')}</p>
      <p className="muted">{t('imports.sizeGuarantee')}</p>
      {largerLimit && (
        <p className="import-limit-warning" role="note" data-testid="import-limit-warning">
          {t('imports.largeWarning')}
        </p>
      )}
      <div className="storage-actions">
        <button
          type="button"
          disabled={busy || Number(draft) === active}
          onClick={() => void save()}
        >
          {busy ? t('presentation.importSaving') : t('imports.saveSizeAction')}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {presentationMessage(error, t)}
        </p>
      )}
      {message && (
        <p className="settings-message" role="status">
          {presentationMessage(message, t)}
        </p>
      )}
    </section>
  );
}
