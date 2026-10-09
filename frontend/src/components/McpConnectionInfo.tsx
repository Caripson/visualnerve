import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useRef, useState } from 'react';
import { mcpServerUrl, mcpSetupNote } from '../integration/setup';
import { isEncryptedWorkspaceSurface } from '../security/surface';

export function McpConnectionInfo({ endpoint }: { endpoint: string }) {
  const { t } = useI18n();
  const website = location.origin;
  const reference = new URL('/api/docs/', website).href;
  const preview = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  let server = '';
  let instructions = '';
  try {
    server = mcpServerUrl(endpoint);
    instructions = mcpSetupNote(website, endpoint, isEncryptedWorkspaceSurface());
  } catch {
    // A malformed saved connection must never become a copyable remote MCP destination.
  }
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(instructions);
      setMessage('Connection instructions copied. No integration token is included.');
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setMessage('Instructions selected. Copy them with your keyboard or device copy menu.');
    }
  };
  return (
    <section aria-label={t('integration.addresses.region')}>
      <label className="field">
        <span>{t('integration.addresses.websiteLabel')}</span>
        <input aria-label={t('integration.addresses.websiteLabel')} readOnly value={website} />
      </label>
      <p className="muted">
        {t('integration.addresses.originExplanation')}{' '}
        <a href={reference} target="_blank" rel="noopener noreferrer">
          {t('integration.addresses.apiDocsLink')}
        </a>
      </p>
      <label className="field">
        <span>{t('integration.addresses.serverUrlLabel')}</span>
        <input aria-label={t('integration.addresses.serverUrlLabel')} readOnly value={server} />
      </label>
      <p className="muted">{t('integration.addresses.serviceNotWebsite')}</p>
      {!server && <p className="muted">{t('integration.addresses.saveValidLocal')}</p>}
      {server && (
        <details className="storage-details">
          <summary>{t('integration.instructions.title')}</summary>
          <p className="muted">{t('integration.instructions.docsFirst')}</p>
          <label className="field">
            <span>{t('integration.instructions.label')}</span>
            <textarea
              ref={preview}
              aria-label={t('integration.instructions.label')}
              readOnly
              rows={7}
              value={instructions}
            />
          </label>
          <button onClick={() => void copy()}>{t('integration.instructions.copy')}</button>
          {message && <p role="status">{localizedFeedback(message, t)}</p>}
        </details>
      )}
    </section>
  );
}
