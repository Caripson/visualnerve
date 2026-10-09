import { useSyncExternalStore } from 'react';
import { bridgeDiagnostics } from '../integration/diagnostics';
import { useI18n } from '../i18n';

export function McpBridgeDiagnostics() {
  const diagnostic = useSyncExternalStore(bridgeDiagnostics.subscribe, bridgeDiagnostics.snapshot);
  const { t } = useI18n();
  if (diagnostic.state !== 'update-required') return null;
  return (
    <div className="settings-message" role="status">
      <p>{t('integration.bridge.updateRequired')}</p>
      {diagnostic.version && (
        <p>{t('integration.bridge.detectedVersion', { version: diagnostic.version })}</p>
      )}
      <a
        href="/help/api-mcp/#check-the-bridge-and-discovered-tools"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('integration.bridge.updateGuide')}
      </a>
    </div>
  );
}
