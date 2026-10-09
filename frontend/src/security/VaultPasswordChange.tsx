import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { BackupSecurityNotice } from './BackupSecurityNotice';
import { VaultPasswordFields } from './VaultPasswordFields';
import type { VaultSession } from './vault-session';

export function VaultPasswordChange({
  session,
  close,
}: {
  session: VaultSession;
  close: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={t('security.password.changeTitle')} close={close} dismissible={!busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (password.length < 12 || password !== confirmation) {
            setError('Use at least 12 characters and enter the same password twice.');
            return;
          }
          setBusy(true);
          setError('');
          void session
            .changePassword(password, currentPassword)
            .then(close)
            .catch((error: unknown) => setError((error as Error).message))
            .finally(() => {
              setBusy(false);
              setPassword('');
              setCurrentPassword('');
              setConfirmation('');
            });
        }}
      >
        <p>{t('security.password.changeEffect')}</p>
        <VaultPasswordFields
          password={password}
          confirmation={confirmation}
          setPassword={setPassword}
          setConfirmation={setConfirmation}
          disabled={busy}
          confirm
        />
        <label className="field">
          <span>{t('security.credential.currentWorkspacePassword')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <BackupSecurityNotice encrypted />
        {error && (
          <p className="form-error" role="alert">
            {localizedFeedback(error, t)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={close}>
            {t('security.action.cancel')}
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? t('security.password.changing') : t('security.password.changeAndLock')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
