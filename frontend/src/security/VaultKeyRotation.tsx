import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
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
      title={t('security.rotation.title')}
      close={cancel}
      dismissible={!activating && !closing}
    >
      <p>{t('security.rotation.effect')}</p>
      <p className="muted">{t('security.rotation.preconditionsAndFailure')}</p>
      <BackupSecurityNotice encrypted />
      {prepared ? (
        <VaultRecoveryNotice
          recoveryKey={recoveryKey}
          continueLabel={t('security.rotation.activateAndLock')}
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
            <span>{t('security.credential.currentWorkspacePassword')}</span>
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
                ? t('security.rotation.encryptingVerifying')
                : busy
                  ? t('security.rotation.preparingKey')
                  : t('security.rotation.prepare')}
            </button>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <button onClick={cancel} disabled={activating || closing}>
          {t('security.action.cancel')}
        </button>
      </div>
      {activating && <p role="status">{t('security.rotation.keepOpen')}</p>}
      {closing && <p role="status">{t('security.rotation.checkingBeforeReopen')}</p>}
      {(error || closeError) && (
        <p className="form-error" role="alert">
          {localizedFeedback(error || closeError, t)}
        </p>
      )}
    </Modal>
  );
}
