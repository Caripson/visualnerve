import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { lazy, Suspense, useState, type ComponentProps } from 'react';
import { HardDrive, X } from 'lucide-react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { Modal } from './Modal';
import { BackupSecurityNotice } from '../security/BackupSecurityNotice';
import { isEncryptedWorkspaceSurface } from '../security/surface';

const LazyDataPrivacy = lazy(() =>
  import('./DataPrivacySettings').then((module) => ({ default: module.DataPrivacy })),
);
const LazyRestoreBackup = lazy(() =>
  import('./DataPrivacySettings').then((module) => ({ default: module.RestoreBackup })),
);

export function StorageNotice() {
  const { t } = useI18n();
  return <p className="storage-notice">{t('privacy.storage.removalWarning')}</p>;
}
export function LocalBadge({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="local-storage-badge"
      title={t('privacy.localBadge.tooltip')}
      aria-label={t('privacy.localBadge.accessibleName')}
      onClick={onClick}
    >
      <HardDrive size={12} />
      <span>{t('privacy.localBadge.label')}</span>
    </button>
  );
}
export function PrivacyIntro() {
  const { t } = useI18n();
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
    <Modal title={t('privacy.consent.title')} close={() => {}} dismissible={false}>
      <p>{t('privacy.consent.publicWebsitePrivateProfile')}</p>
      <p className="muted">{t('privacy.consent.localNoAccount')}</p>
      <p className="muted">{t('privacy.consent.explicitExportSharing')}</p>
      <p>{t('privacy.consent.requiredStorage')}</p>
      <BackupSecurityNotice encrypted={isEncryptedWorkspaceSurface()} />
      <label className="check-field">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          aria-label={t('privacy.consent.acceptStorageAccessible')}
        />
        {t('privacy.consent.acceptStorage')}
      </label>
      {declined && <p role="status">{t('privacy.consent.declined')}</p>}
      {error && <p className="form-error">{localizedFeedback(error, t)}</p>}
      <div className="modal-actions">
        <a href="/privacy/" target="_blank" rel="noopener noreferrer">
          {t('privacy.consent.learnMore')}
        </a>
        <button disabled={busy} onClick={() => setDeclined(true)}>
          {t('privacy.consent.decline')}
        </button>
        <button
          className="primary"
          disabled={!accepted || busy}
          onClick={() => {
            void acknowledge();
          }}
        >
          {t('privacy.consent.continue')}
        </button>
      </div>
    </Modal>
  );
}
export function BackupNudge({ settings }: { settings: () => void }) {
  const { t } = useI18n();
  const count = useEditor((state) => state.diagrams.length);
  const exported = useEditor((state) => state.lastExport);
  const dismissed = useEditor((state) => state.backupNudgeDismissed);
  if (count < 10 || exported || dismissed) return null;
  return (
    <div className="backup-nudge">
      <span>{t('privacy.backupReminder.message', { count: count })}</span>
      <button onClick={settings}>{t('privacy.backupReminder.exportOptions')}</button>
      <button
        className="icon-button"
        aria-label={t('privacy.backupReminder.dismiss')}
        onClick={() => {
          void workspace.setPreference('backup-nudge-dismissed', true).catch(() => {});
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Keep the always-visible local-storage badge independent of backup/cache tools. */
export function DataPrivacy(props: ComponentProps<typeof LazyDataPrivacy>) {
  const { t } = useI18n();
  return (
    <Suspense fallback={<p role="status">{t('security.gate.wait')}</p>}>
      <LazyDataPrivacy {...props} />
    </Suspense>
  );
}

export function RestoreBackup(props: ComponentProps<typeof LazyRestoreBackup>) {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <Modal title={t('privacy.restore.title')} close={props.close}>
          <p role="status">{t('security.gate.wait')}</p>
        </Modal>
      }
    >
      <LazyRestoreBackup {...props} />
    </Suspense>
  );
}
