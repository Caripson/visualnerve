import { useEffect, useRef, useState } from 'react';
import { Download, Upload, HardDrive, X } from 'lucide-react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { database, type WorkspaceBackup } from '../storage/database';
import { exportAllData } from '../storage/backup';
import { Modal } from './Modal';
import { assertImportBytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';

export function StorageNotice() {
  return (
    <p className="storage-notice">
      Clearing this site's browser data, resetting your profile or uninstalling the browser may
      remove your diagrams. Export a backup to keep a portable copy. Private or incognito windows
      may discard data when the session ends.
    </p>
  );
}
export function LocalBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="local-storage-badge"
      title="Your Visual Nerve data is stored only in this browser."
      aria-label="Local only: storage and privacy"
      onClick={onClick}
    >
      <HardDrive size={12} />
      <span>Local only</span>
    </button>
  );
}
export function PrivacyIntro() {
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const acknowledge = async () => {
    if (!accepted) return;
    setBusy(true);
    try {
      await workspace.acceptStorage();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Your work stays in this browser" close={() => {}} dismissible={false}>
      <p>
        Visual Nerve can be a public website. Your diagrams stay private in this browser profile.
      </p>
      <p className="muted">
        Your work is saved locally and is never uploaded automatically. No account is required, and
        another browser or device has its own separate workspace.
      </p>
      <p className="muted">
        Use Export to keep a backup or move your work. Build with Lovable lets you review and share
        an app brief explicitly.
      </p>
      <p>
        To use the workspace, you must accept local browser storage. Diagrams and preferences are
        saved using IndexedDB; app files are cached so you can work offline. The service cannot work
        without this storage.
      </p>
      <label className="check-field">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          aria-label="I accept local storage and offline caching"
        />
        I accept local storage and offline caching.
      </label>
      {declined && (
        <p role="status">
          The workspace stays closed without acceptance. You can read the guide or privacy page, or
          accept here when you want to use it.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <a href="/privacy/" target="_blank" rel="noopener noreferrer">
          Learn more
        </a>
        <button disabled={busy} onClick={() => setDeclined(true)}>
          I don't accept
        </button>
        <button
          className="primary"
          disabled={!accepted || busy}
          onClick={() => {
            void acknowledge();
          }}
        >
          Accept and continue
        </button>
      </div>
    </Modal>
  );
}
export function BackupNudge({ settings }: { settings: () => void }) {
  const count = useEditor((state) => state.diagrams.length);
  const exported = useEditor((state) => state.lastExport);
  const dismissed = useEditor((state) => state.backupNudgeDismissed);
  if (count < 10 || exported || dismissed) return null;
  return (
    <div className="backup-nudge">
      <span>{count} local diagrams. Consider exporting a backup.</span>
      <button onClick={settings}>Export options</button>
      <button
        className="icon-button"
        aria-label="Dismiss backup reminder"
        onClick={() => {
          void workspace.setPreference('backup-nudge-dismissed', true);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
export function DataPrivacy({
  restore,
  deleted,
}: {
  restore: (data: WorkspaceBackup) => void;
  deleted: () => void;
}) {
  const [message, setMessage] = useState('');
  const [usage, setUsage] = useState<number>();
  const [persistent, setPersistent] = useState<boolean>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const count = useEditor((state) => state.diagrams.length);
  const permission = useEditor((state) => state.mcpAccess);
  const workspaceId = useEditor((state) => state.workspaceId);
  const lastExport = useEditor((state) => state.lastExport);
  useEffect(() => {
    let active = true;
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (active) setUsage(estimate.usage);
      })
      .catch(() => {});
    void navigator.storage
      ?.persisted?.()
      .then((value) => {
        if (active) setPersistent(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="data-privacy" aria-label="Data and Privacy">
      <div className="property-section">Data &amp; Privacy</div>
      <p>
        Your diagrams are saved in this browser. Other visitors to this website cannot see your
        work.
      </p>
      <dl className="storage-facts">
        <dt>Storage</dt>
        <dd>This browser profile</dd>
        <dt>Cloud storage</dt>
        <dd>Not used</dd>
        <dt>Account sync</dt>
        <dd>No automatic sync</dd>
        <dt>MCP access</dt>
        <dd>
          {permission === 'off' ? 'Off' : permission === 'read' ? 'Read only' : 'Read + write'} ·
          optional local integration
        </dd>
      </dl>
      <p className="muted">
        The same website in another browser, profile or device opens a separate workspace. Export
        and import to move your work.
      </p>
      <div className="storage-actions">
        <button
          disabled={busy}
          onClick={() => {
            void run(async () => {
              await exportAllData();
              setMessage('Backup downloaded. Use Restore backup to import it.');
            });
          }}
        >
          <Download size={15} />
          Export all data
        </button>
        <button disabled={busy} onClick={() => file.current?.click()}>
          <Upload size={15} />
          Restore backup
        </button>
      </div>
      <p className="muted">
        {count} local diagram{count === 1 ? '' : 's'}
        {lastExport ? ` · Last export: ${new Date(lastExport).toLocaleDateString()}` : ''}
      </p>
      <StorageNotice />
      <a href="/privacy/" target="_blank" rel="noopener noreferrer">
        How Visual Nerve stores your data
      </a>
      <details className="storage-details">
        <summary>Storage details</summary>
        <dl className="storage-facts">
          <dt>Database</dt>
          <dd>IndexedDB · schema {database.verno}</dd>
          <dt>Site address</dt>
          <dd>{location.origin}</dd>
          <dt>Workspace ID</dt>
          <dd>{workspaceId}</dd>
          <dt>Site storage usage</dt>
          <dd>
            {usage === undefined
              ? 'Unavailable in this browser'
              : `${(usage / 1024 / 1024).toFixed(1)} MB (estimated)`}
          </dd>
          <dt>Browser retention</dt>
          <dd>
            {persistent === true
              ? 'Persistent storage granted'
              : persistent === false
                ? 'Browser default'
                : 'Unavailable in this browser'}
          </dd>
        </dl>
        <p className="muted">
          The estimate includes app files kept for offline use. Browser storage limits and
          permission decisions vary.
        </p>
        {count > 0 && persistent !== true && navigator.storage?.persist && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const granted = await navigator.storage.persist();
                  setPersistent(granted);
                  setMessage(
                    granted
                      ? 'Your browser granted persistent storage. Manual clearing can still remove data.'
                      : 'Your browser did not grant persistent storage. You can still save locally and export backups.',
                  );
                });
              }}
            >
              Ask browser to keep local data
            </button>
            <p className="muted">
              This can reduce automatic removal under storage pressure. It does not prevent manual
              clearing or guarantee retention.
            </p>
          </>
        )}
      </details>
      <details className="storage-danger">
        <summary>Delete all local data</summary>
        <p>
          This permanently removes all Visual Nerve diagrams, owners, custom templates and settings
          in this browser. It cannot be undone unless you have an exported backup.
        </p>
        <label className="check-field">
          <input
            type="checkbox"
            aria-label="Confirm deletion of all local data"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I understand this permanently removes my local data.
        </label>
        <button
          className="danger"
          disabled={!confirmed || busy}
          onClick={() => {
            void run(async () => {
              await workspace.deleteAll();
              deleted();
            });
          }}
        >
          Delete all local Visual Nerve data
        </button>
      </details>
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
      <input
        ref={file}
        aria-label="Restore backup file"
        className="file-input"
        type="file"
        accept=".json"
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          if (!selected) return;
          try {
            assertImportBytes(selected.size, currentImportLimitBytes(), 'Backup file');
            const data = JSON.parse(await selected.text()) as WorkspaceBackup;
            if (data.format !== 'visual-nerve-workspace' || !Array.isArray(data.diagrams))
              throw new Error('Choose a Visual Nerve backup file.');
            restore(data);
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            if (file.current) file.current.value = '';
          }
        }}
      />
    </section>
  );
}
export function RestoreBackup({ backup, close }: { backup: WorkspaceBackup; close: () => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Import Visual Nerve backup" close={close}>
      <p>
        This file contains {backup.diagrams.length}{' '}
        {backup.diagrams.length === 1 ? 'diagram' : 'diagrams'}
        {backup.exportedAt ? `, exported ${new Date(backup.exportedAt).toLocaleDateString()}` : ''}.
      </p>
      <label className="check-field">
        <input
          type="radio"
          name="restore-mode"
          checked={mode === 'merge'}
          onChange={() => setMode('merge')}
        />
        Merge with existing data
      </label>
      <p className="muted">
        Keeps current diagrams and adds the imported work. Conflicting identities receive new IDs.
      </p>
      <label className="check-field">
        <input
          type="radio"
          name="restore-mode"
          checked={mode === 'replace'}
          onChange={() => setMode('replace')}
        />
        Replace all local data
      </label>
      {mode === 'replace' && (
        <>
          <p className="storage-notice">
            This removes current diagrams, owners, custom templates and preferences before restoring
            the file. MCP access will be off. Export your current work first if you want to keep it.
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Confirm replacement of all local data"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand this replaces all my local data.
          </label>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
        <button
          className={mode === 'replace' ? 'danger' : 'primary'}
          disabled={busy || (mode === 'replace' && !confirmed)}
          onClick={async () => {
            setBusy(true);
            try {
              await workspace.restoreBackup(backup, mode);
              close();
            } catch (error) {
              setError((error as Error).message);
              setBusy(false);
            }
          }}
        >
          Restore backup
        </button>
      </div>
    </Modal>
  );
}
