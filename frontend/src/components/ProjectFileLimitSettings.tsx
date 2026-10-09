import { presentationMessage } from '../presentation/display-messages';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import {
  assertProjectSourceFileLimit,
  DEFAULT_PROJECT_SOURCE_FILE_LIMIT,
  MAX_PROJECT_SOURCE_FILE_LIMIT,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
} from '../code/project/limits';

export function ProjectFileLimitSettings() {
  const { t } = useI18n();
  const active = useEditor((state) => state.projectSourceFileLimit);
  const [draft, setDraft] = useState(String(active));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => setDraft(String(active)), [active]);
  const experimental =
    active > DEFAULT_PROJECT_SOURCE_FILE_LIMIT || Number(draft) > DEFAULT_PROJECT_SOURCE_FILE_LIMIT;

  async function save() {
    setError('');
    setMessage('');
    try {
      const value = Number(draft);
      assertProjectSourceFileLimit(value);
      setBusy(true);
      await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, value);
      setMessage('ZIP project source-file limit saved for this browser.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="import-settings"
      aria-label={t('imports.zipLimitTitle')}
      data-testid="project-file-limit-settings"
    >
      <div className="property-section">{t('imports.zipLimitTitle')}</div>
      <label className="field">
        <span>{t('imports.zipLimitField')}</span>
        <input
          type="number"
          aria-label={t('imports.zipLimitField')}
          min={DEFAULT_PROJECT_SOURCE_FILE_LIMIT}
          max={MAX_PROJECT_SOURCE_FILE_LIMIT}
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
      <p className="muted">{t('imports.zipDefaultsHint')}</p>
      <p className="muted">{t('imports.zipGuarantee')}</p>
      {experimental && (
        <p className="import-limit-warning" role="note" data-testid="project-file-limit-warning">
          {t('imports.zipLargeWarning')}
        </p>
      )}
      <p className="muted">{t('imports.zipOtherLimitsHint')}</p>
      <div className="storage-actions">
        <button
          type="button"
          disabled={busy || Number(draft) === active}
          onClick={() => void save()}
        >
          {busy ? t('presentation.zipLimitSaving') : t('imports.zipSaveAction')}
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
