import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import {
  assertProjectSourceFileLimit,
  DEFAULT_PROJECT_SOURCE_FILE_LIMIT,
  LARGE_PROJECT_FILE_WARNING,
  MAX_PROJECT_SOURCE_FILE_LIMIT,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
} from '../code/project/limits';

export function ProjectFileLimitSettings() {
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
      aria-label="ZIP project source-file limit"
      data-testid="project-file-limit-settings"
    >
      <div className="property-section">ZIP project source-file limit</div>
      <label className="field">
        <span>Maximum analyzed source files in a ZIP project</span>
        <input
          type="number"
          aria-label="Maximum analyzed source files in a ZIP project"
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
      <p className="muted">
        Default: 500 files. Maximum: 10,000 files. ZIP projects only; source-file and folder imports
        keep their 500-file limit. This setting stays in this browser.
      </p>
      <p className="muted">
        Only ZIP projects with up to 500 analyzed source files are supported and guaranteed.
      </p>
      {experimental && (
        <p className="import-limit-warning" role="note" data-testid="project-file-limit-warning">
          {LARGE_PROJECT_FILE_WARNING}
        </p>
      )}
      <p className="muted">
        The archive still allows at most 10,000 entries, including ignored files and directory
        records. Use Folder relationships for larger projects; other analysis and diagram limits
        still apply.
      </p>
      <div className="storage-actions">
        <button
          type="button"
          disabled={busy || Number(draft) === active}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save ZIP file limit'}
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
