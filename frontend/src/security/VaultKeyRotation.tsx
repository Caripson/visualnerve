import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { BackupSecurityNotice } from './BackupSecurityNotice';
import { VaultPasswordFields } from './VaultPasswordFields';
import { VaultRecoveryNotice } from './VaultRecoveryNotice';
import type { VaultSession } from './vault-session';
import { prepareVaultKeyRotation, type PreparedVaultKeyRotation } from './vault-key-rotation';

/** Human-only incident operation, outside the editor while its content is being rewritten. */
export function VaultKeyRotation({
  session,
  close,
  closing,
  closeError,
}: {
  session: VaultSession;
  close: () => void;
  closing: boolean;
  closeError: string;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [prepared, setPrepared] = useState<PreparedVaultKeyRotation>();
  const [recoveryKey, setRecoveryKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const artifact = useRef<PreparedVaultKeyRotation | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      artifact.current?.dispose();
    };
  }, []);
  const cancel = () => {
    if (activating || closing) return;
    request.current?.abort();
    artifact.current?.dispose();
    artifact.current = undefined;
    setPassword('');
    setConfirmation('');
    setCurrentPassword('');
    setRecoveryKey('');
    setPrepared(undefined);
    close();
  };
  return (
    <Modal
      title="Rotate the workspace content key"
      close={cancel}
      dismissible={!activating && !closing}
    >
      <p>
        Use this if you suspect that a workspace encryption key was exposed. Every saved record will
        be encrypted again with a new random content key. A normal password change only replaces the
        password protection around the existing key.
      </p>
      <p className="muted">
        The editor, simulations and integrations are stopped. Keep a verified backup before
        continuing. This operation can take time and needs browser storage and memory headroom. If
        preparation, authentication or storage fails, the original encrypted workspace remains
        available. All workspace tabs lock after successful activation.
      </p>
      <BackupSecurityNotice encrypted />
      {prepared ? (
        <VaultRecoveryNotice
          recoveryKey={recoveryKey}
          continueLabel="Rotate content key and lock"
          continue={() => {
            if (busy || closing) return;
            const candidate = prepared;
            setPrepared(undefined);
            setRecoveryKey('');
            setBusy(true);
            setActivating(true);
            setError('');
            void candidate
              .activate()
              .catch((failure: unknown) => {
                if (mounted.current && !request.current?.signal.aborted)
                  setError((failure as Error).message);
              })
              .finally(() => {
                candidate.dispose();
                if (artifact.current === candidate) artifact.current = undefined;
                if (mounted.current) {
                  setBusy(false);
                  setActivating(false);
                }
              });
          }}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || closing) return;
            if (
              [...password].length < 12 ||
              password !== confirmation ||
              password === currentPassword
            ) {
              setError(
                'Use a different, unique passphrase of at least 12 characters and matching confirmation.',
              );
              return;
            }
            const nextPassword = password,
              previousPassword = currentPassword;
            setPassword('');
            setConfirmation('');
            setCurrentPassword('');
            setBusy(true);
            setError('');
            request.current?.abort();
            const controller = new AbortController();
            request.current = controller;
            // Capture the originating session inside the helper before any async work.
            void prepareVaultKeyRotation(session, nextPassword, {
              currentPassword: previousPassword,
              signal: controller.signal,
            })
              .then((candidate) => {
                if (!mounted.current || controller.signal.aborted) {
                  candidate.dispose();
                  return;
                }
                artifact.current = candidate;
                setRecoveryKey(candidate.recoveryKey);
                setPrepared(candidate);
              })
              .catch((failure: unknown) => {
                if (mounted.current && !controller.signal.aborted)
                  setError((failure as Error).message);
              })
              .finally(() => {
                if (mounted.current && !controller.signal.aborted) setBusy(false);
              });
          }}
        >
          <VaultPasswordFields
            password={password}
            confirmation={confirmation}
            setPassword={setPassword}
            setConfirmation={setConfirmation}
            disabled={busy || closing}
            confirm
          />
          <label className="field">
            <span>Current workspace password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              disabled={busy || closing}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="primary" type="submit" disabled={busy || closing}>
              {activating
                ? 'Encrypting and verifying all records…'
                : busy
                  ? 'Preparing new key…'
                  : 'Prepare new content key'}
            </button>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <button onClick={cancel} disabled={activating || closing}>
          Cancel
        </button>
      </div>
      {activating && (
        <p role="status">
          Keep this tab open. The new key becomes active only after every record has been verified.
        </p>
      )}
      {closing && <p role="status">Checking the workspace before reopening…</p>}
      {(error || closeError) && (
        <p className="form-error" role="alert">
          {error || closeError}
        </p>
      )}
    </Modal>
  );
}
