import { useI18n } from '../i18n';
/** Shared wording for first-visit setup, password changes and backup/export screens. */
export function BackupSecurityNotice({ encrypted = false }: { encrypted?: boolean }) {
  const { t } = useI18n();
  return (
    <aside
      className="storage-notice backup-security-notice"
      aria-label={t('security.backup.copiesRegion')}
    >
      <strong>{t('security.backup.copiesTitle')}</strong>
      {encrypted ? (
        <>
          <p>{t('security.backup.oldCredentials')}</p>
          <p>{t('security.backup.replaceOldCopies')}</p>
          <p>{t('security.backup.rotationLimit')}</p>
          <p>{t('security.backup.plaintextStaysReadable')}</p>
        </>
      ) : (
        <p>{t('security.backup.legacyReadable')}</p>
      )}
      <a
        href="/help/settings/#downloaded-copies-and-password-changes"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('security.backup.oldCopiesHelp')}
      </a>
    </aside>
  );
}
