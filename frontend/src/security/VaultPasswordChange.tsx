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
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Change workspace password" close={close} dismissible={!busy}>
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
        <p>
          The current workspace stays encrypted with the same content key. All workspace tabs lock
          after this change; unlock using the new password.
        </p>
        <VaultPasswordFields
          password={password}
          confirmation={confirmation}
          setPassword={setPassword}
          setConfirmation={setConfirmation}
          disabled={busy}
          confirm
        />
        <label className="field">
          <span>Current workspace password</span>
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
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Changing password…' : 'Change password and lock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
