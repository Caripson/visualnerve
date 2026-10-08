import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { workspace } from '../storage/workspace';
import { VaultRecoveryNotice } from './VaultRecoveryNotice';
import {
  prepareLegacyEncryptedBackup,
  type LegacyEncryptedTransfer,
} from './legacy-encrypted-backup';

/** Optional encrypted transfer from a legacy workspace; the original data stays in place. */
export function LegacyEncryptedBackup({
  close,
  complete,
}: {
  close: () => void;
  complete?: (filename: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState<LegacyEncryptedTransfer>();
  const request = useRef<AbortController | undefined>(undefined);
  const artifact = useRef<LegacyEncryptedTransfer | undefined>(undefined);
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
    request.current?.abort();
    artifact.current?.dispose();
    setPassword('');
    setConfirmation('');
    setPrepared(undefined);
    close();
  };
  return (
    <Modal title="Encrypted transfer backup" close={cancel}>
      <p>
        Create an encrypted copy to move this workspace to the dedicated encrypted app or keep a
        protected backup. This action does not encrypt, migrate or delete the existing local
        workspace.
      </p>
      <p className="muted">
        The transfer has its own password and recovery key. Later changes to your workspace or its
        credentials do not update this file. Plaintext exports and older readable backups remain
        readable.
      </p>
      {prepared ? (
        <VaultRecoveryNotice
          recoveryKey={prepared.recoveryKey}
          subject="backup"
          continueLabel="Download encrypted backup"
          continue={() => {
            if (busy) return;
            setBusy(true);
            setMessage('');
            void prepared
              .download()
              .then(() => {
                if (!mounted.current || request.current?.signal.aborted) return;
                complete?.(prepared.filename);
                cancel();
              })
              .catch((error: unknown) => {
                if (mounted.current && !request.current?.signal.aborted) {
                  setPrepared(undefined);
                  setMessage((error as Error).message);
                }
              })
              .finally(() => {
                if (mounted.current) setBusy(false);
              });
          }}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if ([...password].length < 12 || password !== confirmation) {
              setMessage(
                'Use a unique passphrase of at least 12 characters and matching confirmation.',
              );
              return;
            }
            let secret = password;
            setPassword('');
            setConfirmation('');
            setBusy(true);
            setMessage('');
            request.current?.abort();
            const controller = new AbortController();
            request.current = controller;
            const preparing = prepareLegacyEncryptedBackup(workspace, secret, {
              signal: controller.signal,
              onInvalidated: () => {
                if (mounted.current && !controller.signal.aborted) {
                  setPrepared(undefined);
                  setMessage('The original workspace has closed. Start a new export.');
                }
              },
            });
            secret = '';
            void preparing
              .then((value) => {
                if (!mounted.current || controller.signal.aborted) {
                  value.dispose();
                  return;
                }
                artifact.current = value;
                setPrepared(value);
              })
              .catch((error: unknown) => {
                if (mounted.current && !controller.signal.aborted)
                  setMessage((error as Error).message);
              })
              .finally(() => {
                if (mounted.current && !controller.signal.aborted) setBusy(false);
              });
          }}
        >
          <label className="field">
            <span>Transfer backup password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p className="muted">
            Use at least 12 characters. Choose a long, unique passphrase and keep it in a protected
            location.
          </p>
          <label className="field">
            <span>Confirm transfer password</span>
            <input
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              required
              disabled={busy}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="primary" disabled={busy} type="submit">
              {busy ? 'Encrypting backup…' : 'Prepare encrypted backup'}
            </button>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <button onClick={cancel}>Cancel</button>
      </div>
      {busy && prepared && <p role="status">Checking the original workspace before download…</p>}
      {message && <p role="alert">{message}</p>}
    </Modal>
  );
}
