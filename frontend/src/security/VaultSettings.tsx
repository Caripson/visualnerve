import { useEffect, useState } from 'react';
import { VaultPasswordChange } from './VaultPasswordChange';
import type { VaultSession } from './vault-session';
import { workspace } from '../storage/workspace';
import { useVaultKeyRotation } from './workspace-maintenance-context';

export function VaultSettings({ session }: { session: VaultSession }) {
  const [idle, setIdle] = useState(15);
  const [absolute, setAbsolute] = useState(8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const rotateKey = useVaultKeyRotation();
  useEffect(() => {
    let active = true;
    void session
      .getPolicy()
      .then((policy) => {
        if (active) {
          setIdle(policy.idleTimeoutMs / 60_000);
          setAbsolute(policy.absoluteTimeoutMs / 3_600_000);
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [session]);
  return (
    <section className="data-privacy" aria-label="Workspace security">
      <div className="property-section">Workspace security</div>
      <p>
        Local records and workspace backups use AES-256-GCM encryption. Unlocking happens in this
        browser; there is no server password reset.
      </p>
      <p className="muted">
        Locking stops API/MCP access to your content and background work. Only your interaction with
        the app keeps the inactivity session alive.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setMessage('');
          void session
            .setPolicy({ idleTimeoutMs: idle * 60_000, absoluteTimeoutMs: absolute * 3_600_000 })
            .then(() =>
              setMessage('Session limits saved. Existing session clocks were not restarted.'),
            )
            .catch((error: unknown) => setMessage((error as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Lock after inactivity (minutes)</span>
          <input
            type="number"
            min="1"
            max="240"
            step="1"
            value={idle}
            onChange={(event) => setIdle(Number(event.target.value))}
            required
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Maximum session (hours)</span>
          <input
            type="number"
            min={Math.max(1 / 60, idle / 60)}
            max="24"
            step="any"
            value={absolute}
            onChange={(event) => setAbsolute(Number(event.target.value))}
            required
            disabled={busy}
          />
        </label>
        <p className="muted">
          A shorter limit may lock all workspace tabs immediately. Save your recovery key separately
          from your backups.
        </p>
        <div className="storage-actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save session limits'}
          </button>
          <button type="button" disabled={busy} onClick={() => setChangePassword(true)}>
            Change password
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMessage('');
              void workspace
                .settled()
                .then(() => session.lock())
                .catch((error: unknown) => {
                  setMessage(`Some edits could not be saved: ${(error as Error).message}`);
                  setUnsaved(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            Lock now
          </button>
        </div>
      </form>
      {unsaved && (
        <button
          type="button"
          onClick={() => {
            void session.lock().catch((error: unknown) => setMessage((error as Error).message));
          }}
        >
          Lock and discard unsaved changes
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {rotateKey && (
        <details className="storage-danger">
          <summary>Suspected content-key exposure</summary>
          <p>
            A normal password change keeps the content key. If that key may have been exposed,
            rotate it to encrypt all current records again. Copied backups and older readable files
            remain outside this protection.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMessage('');
              void rotateKey()
                .catch((error: unknown) => setMessage((error as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            Rotate workspace content key
          </button>
        </details>
      )}
      <p className="muted">
        Encryption protects saved data while locked. It cannot protect work from a compromised
        device, browser extension or malicious code running while you have unlocked the app. Diagram
        exports and information shared with an agent leave the vault as readable content.
      </p>
      {changePassword && (
        <VaultPasswordChange session={session} close={() => setChangePassword(false)} />
      )}
    </section>
  );
}
