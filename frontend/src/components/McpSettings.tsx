import { bridgeSessionToken } from '../integration/session-token';
import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { McpAccess } from '../integration/access';
import { McpPortUpgrade } from './McpPortUpgrade';
import { McpConnectionInfo } from './McpConnectionInfo';
import { McpBridgeDiagnostics } from './McpBridgeDiagnostics';

export function McpSettings() {
  const { t } = useI18n();
  const access = useEditor((state) => state.mcpAccess);
  const state = useEditor((state) => state.bridgeStatus);
  const endpoint = useEditor((state) => state.bridgeUrl);
  const [address, setAddress] = useState(endpoint);
  const [token, setToken] = useState(() => bridgeSessionToken().read(endpoint));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAddress(endpoint);
    setToken(bridgeSessionToken().read(endpoint));
  }, [endpoint]);
  const upgrade = async (target: string) => {
    setBusy(true);
    setMessage('');
    try {
      await workspace.setPreference('bridge-url', target);
      if (useEditor.getState().bridgeUrl !== target)
        throw new Error('The connection change was superseded. Review the current address.');
      bridgeSessionToken().clear();
      setToken('');
      setAddress(target);
      setMessage(t('integration.upgrade.saved'));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={t('integration.settings.region')}>
      <div className="property-section">{t('integration.settings.title')}</div>
      <p className="muted">{t('integration.settings.authorizedSharing')}</p>
      <label className="field">
        <span>{t('integration.settings.accessLabel')}</span>
        <select
          aria-label={t('integration.settings.accessAccessible')}
          value={access}
          disabled={busy}
          onChange={(event) => {
            setMessage('');
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
      {state === 'connected' && <McpBridgeDiagnostics />}
      <McpConnectionInfo endpoint={endpoint} />
      <McpPortUpgrade endpoint={endpoint} busy={busy} onUpgrade={upgrade} />
      {state === 'error' && <p className="muted">{t('integration.settings.bridgeUnavailable')}</p>}
      <details className="storage-details">
        <summary>{t('integration.settings.localDetails')}</summary>
        <p className="muted">{t('integration.settings.websocketExplanation')}</p>
        <label className="field">
          <span>{t('integration.settings.bridgeAddress')}</span>
          <input
            aria-label={t('integration.settings.bridgeAddress')}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setToken('');
            }}
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
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await workspace.setPreference('bridge-url', address);
              bridgeSessionToken().save(address, token);
              setToken(token);
              const { bridge } = await import('../integration/bridge');
              bridge.reconnect();
              setMessage(
                address !== endpoint
                  ? t('integration.upgrade.saved')
                  : t('integration.settings.connectionSaved'),
              );
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
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
