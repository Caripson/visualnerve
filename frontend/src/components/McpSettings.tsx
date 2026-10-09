import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { McpAccess } from '../integration/access';
import { McpConnectionInfo } from './McpConnectionInfo';

export function McpSettings() {
  const { t } = useI18n();
  const access = useEditor((state) => state.mcpAccess);
  const state = useEditor((state) => state.bridgeStatus);
  const endpoint = useEditor((state) => state.bridgeUrl);
  const [address, setAddress] = useState(endpoint);
  const [token, setToken] = useState(sessionStorage.getItem('vn-token') ?? '');
  const [message, setMessage] = useState('');
  return (
    <section aria-label={t('integration.settings.region')}>
      <div className="property-section">{t('integration.settings.title')}</div>
      <p className="muted">{t('integration.settings.authorizedSharing')}</p>
      <label className="field">
        <span>{t('integration.settings.accessLabel')}</span>
        <select
          aria-label={t('integration.settings.accessAccessible')}
          value={access}
          onChange={(event) => {
            void workspace
              .setPreference('mcp-access', event.target.value as McpAccess)
              .catch((error) => setMessage(error.message));
          }}
        >
          <option value="off">{t('integration.access.off')}</option>
          <option value="read">{t('integration.access.read')}</option>
          <option value="write">{t('integration.access.write')}</option>
        </select>
      </label>
      <p className="mcp-state" role="status">
        {t('integration.connection.status', {
          status:
            state === 'connected'
              ? t('integration.connection.connected')
              : state === 'disabled'
                ? t('integration.connection.disabled')
                : state === 'error'
                  ? t('integration.connection.error')
                  : t('integration.connection.waiting'),
        })}
      </p>
      <p className="muted">{t('integration.settings.keepOpen')}</p>
      <McpConnectionInfo endpoint={endpoint} />
      {state === 'error' && <p className="muted">{t('integration.settings.bridgeUnavailable')}</p>}
      <details className="storage-details">
        <summary>{t('integration.settings.localDetails')}</summary>
        <p className="muted">{t('integration.settings.websocketExplanation')}</p>
        <label className="field">
          <span>{t('integration.settings.bridgeAddress')}</span>
          <input
            aria-label={t('integration.settings.bridgeAddress')}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('integration.settings.token')}</span>
          <input
            type="password"
            aria-label={t('integration.settings.token')}
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t('integration.settings.tokenPlaceholder')}
          />
        </label>
        <button
          onClick={async () => {
            try {
              await workspace.setPreference('bridge-url', address);
              sessionStorage.setItem('vn-token', token);
              const { bridge } = await import('../integration/bridge');
              bridge.reconnect();
              setMessage('Local connection updated. The token lasts for this browser session.');
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          {t('integration.settings.saveConnection')}
        </button>
        <p className="muted">
          {t('integration.settings.localRestriction')}{' '}
          <a href="/help/api-mcp/" target="_blank" rel="noopener noreferrer">
            {t('integration.settings.setupGuide')}
          </a>
        </p>
      </details>
      {message && <p className="settings-message">{localizedFeedback(message, t)}</p>}
    </section>
  );
}
