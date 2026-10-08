import { useState } from 'react';
import { BackupSecurityNotice } from './BackupSecurityNotice';

export function VaultRecoveryNotice({
  recoveryKey,
  continue: proceed,
  subject = 'workspace',
  continueLabel = 'Continue',
}: {
  recoveryKey: string;
  continue: () => void;
  subject?: 'workspace' | 'backup';
  continueLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <section aria-label={`Save your ${subject} recovery key`}>
      <p>
        Save this recovery key in a trusted password manager or another protected location. It can
        unlock your encrypted {subject} if you forget the password. Visual Nerve cannot recover it
        for you.
      </p>
      <label className="field">
        <span>Recovery key — keep it private</span>
        <textarea value={recoveryKey} readOnly spellCheck={false} rows={3} />
      </label>
      <p className="muted">
        Do not send this key to an AI agent, paste it into a support request, or save it in an
        unprotected document.
      </p>
      <BackupSecurityNotice encrypted />
      <label className="check-field">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        I have saved my recovery key in a protected location.
      </label>
      <div className="modal-actions">
        <button className="primary" disabled={!saved} onClick={proceed}>
          {continueLabel}
        </button>
      </div>
    </section>
  );
}
