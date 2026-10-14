import { legacyBridgeUpgrade } from '../integration/access';
import { useI18n } from '../i18n';

export function McpPortUpgrade({
  endpoint,
  busy,
  onUpgrade,
}: {
  endpoint: string;
  busy: boolean;
  onUpgrade: (address: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const target = legacyBridgeUpgrade(endpoint);
  if (!target || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  return (
    <div className="settings-message settings-copy" aria-label={t('integration.upgrade.title')}>
      <p>
        <strong>{t('integration.upgrade.title')}</strong>
      </p>
      <p>{t('integration.upgrade.explanation')}</p>
      <p>{t('integration.upgrade.consent')}</p>
      <button disabled={busy} onClick={() => void onUpgrade(target)}>
        {t('integration.upgrade.action')}
      </button>
    </div>
  );
}
