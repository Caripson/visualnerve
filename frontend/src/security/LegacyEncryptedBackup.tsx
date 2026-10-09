import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
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
    <Modal title={t('security.legacyTransfer.title')} close={cancel}>
      <p>{t('security.legacyTransfer.sourceUnchanged')}</p>
      <p className="muted">{t('security.legacyTransfer.independentCredentials')}</p>
      {prepared ? (
        <VaultRecoveryNotice
          recoveryKey={prepared.recoveryKey}
          subject="backup"
          continueLabel={t('security.legacyTransfer.download')}
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
            <span>{t('security.legacyTransfer.password')}</span>
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
          <p className="muted">{t('security.legacyTransfer.passphraseHint')}</p>
          <label className="field">
            <span>{t('security.legacyTransfer.confirmPassword')}</span>
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
              {busy
                ? t('security.legacyTransfer.encrypting')
                : t('security.legacyTransfer.prepare')}
            </button>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <button onClick={cancel}>{t('security.action.cancel')}</button>
      </div>
      {busy && prepared && <p role="status">{t('security.legacyTransfer.checkingDownload')}</p>}
      {message && <p role="alert">{localizedFeedback(message, t)}</p>}
    </Modal>
  );
}
