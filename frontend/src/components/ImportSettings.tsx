import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { assertImportLimitMb, IMPORT_LIMIT_SETTING, LARGE_IMPORT_WARNING } from '../imports/limits';

export function ImportSettings() {
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
    <section className="import-settings" aria-label="Import settings" data-testid="import-settings">
      <div className="property-section">Import file size</div>
      <label className="field">
        <span>Maximum import file size (MB)</span>
        <input
          type="number"
          aria-label="Maximum import file size (MB)"
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
      <p className="muted">
        Default: 50 MB. Maximum: 1024 MB (1 GB). This setting stays in this browser.
      </p>
      <p className="muted">Only imports up to 50 MB are supported and guaranteed.</p>
      {largerLimit && (
        <p className="import-limit-warning" role="note" data-testid="import-limit-warning">
          {LARGE_IMPORT_WARNING}
        </p>
      )}
      <div className="storage-actions">
        <button
          type="button"
          disabled={busy || Number(draft) === active}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save import limit'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
