import { useI18n } from '../i18n';
import { useState } from 'react';
import { BackupSecurityNotice } from './BackupSecurityNotice';

export function VaultRecoveryNotice({
  recoveryKey,
  continue: proceed,
  subject = 'workspace',
  continueLabel,
}: {
  recoveryKey: string;
  continue: () => void;
  subject?: 'workspace' | 'backup';
  continueLabel?: string;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  return (
    <section
      aria-label={t(
        subject === 'backup'
          ? 'security.recovery.backupRegion'
          : 'security.recovery.workspaceRegion',
      )}
    >
      <p>
        {t(
          subject === 'backup'
            ? 'security.recovery.backupExplanation'
            : 'security.recovery.workspaceExplanation',
        )}
      </p>
      <label className="field">
        <span>{t('security.recovery.privateLabel')}</span>
        <textarea value={recoveryKey} readOnly spellCheck={false} rows={3} />
      </label>
      <p className="muted">{t('security.recovery.neverShare')}</p>
      <BackupSecurityNotice encrypted />
      <label className="check-field">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {t('security.recovery.savedAcknowledgement')}
      </label>
      <div className="modal-actions">
        <button className="primary" disabled={!saved} onClick={proceed}>
          {continueLabel ?? t('security.recovery.continue')}
        </button>
      </div>
    </section>
  );
}
