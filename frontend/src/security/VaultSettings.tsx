import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { VaultPasswordChange } from './VaultPasswordChange';
import type { VaultSession } from './vault-session';
import { workspace } from '../storage/workspace';
import { useVaultKeyRotation } from './workspace-maintenance-context';

export function VaultSettings({ session }: { session: VaultSession }) {
  const { t } = useI18n();
  const [idle, setIdle] = useState(15);
  const [absolute, setAbsolute] = useState(8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const rotateKey = useVaultKeyRotation();
  useEffect(() => {
    let active = true;
    void session
      .getPolicy()
      .then((policy) => {
        if (active) {
          setIdle(policy.idleTimeoutMs / 60_000);
          setAbsolute(policy.absoluteTimeoutMs / 3_600_000);
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [session]);
  return (
    <section className="data-privacy" aria-label={t('security.settings.title')}>
      <div className="property-section">{t('security.settings.title')}</div>
      <p>{t('security.settings.encryptionBoundary')}</p>
      <p className="muted">{t('security.settings.idleAndIntegrationBoundary')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setMessage('');
          void session
            .setPolicy({ idleTimeoutMs: idle * 60_000, absoluteTimeoutMs: absolute * 3_600_000 })
            .then(() =>
              setMessage('Session limits saved. Existing session clocks were not restarted.'),
            )
            .catch((error: unknown) => setMessage((error as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>{t('security.settings.idleMinutes')}</span>
          <input
            type="number"
            min="1"
            max="240"
            step="1"
            value={idle}
            onChange={(event) => setIdle(Number(event.target.value))}
            required
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>{t('security.settings.absoluteHours')}</span>
          <input
            type="number"
            min={Math.max(1 / 60, idle / 60)}
            max="24"
            step="any"
            value={absolute}
            onChange={(event) => setAbsolute(Number(event.target.value))}
            required
            disabled={busy}
          />
        </label>
        <p className="muted">{t('security.settings.shorterPolicyWarning')}</p>
        <div className="storage-actions">
          <button type="submit" disabled={busy}>
            {busy ? t('security.action.saving') : t('security.settings.savePolicy')}
          </button>
          <button type="button" disabled={busy} onClick={() => setChangePassword(true)}>
            {t('security.settings.changePassword')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMessage('');
              void workspace
                .settled()
                .then(() => session.lock())
                .catch((error: unknown) => {
                  setMessage(`Some edits could not be saved: ${(error as Error).message}`);
                  setUnsaved(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('security.settings.lockNow')}
          </button>
        </div>
      </form>
      {unsaved && (
        <button
          type="button"
          onClick={() => {
            void session.lock().catch((error: unknown) => setMessage((error as Error).message));
          }}
        >
          {t('security.settings.lockDiscard')}
        </button>
      )}
      {message && <p role="status">{localizedFeedback(message, t)}</p>}
      {rotateKey && (
        <details className="storage-danger">
          <summary>{t('security.settings.keyExposureTitle')}</summary>
          <p>{t('security.settings.keyExposureExplanation')}</p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMessage('');
              void rotateKey()
                .catch((error: unknown) => setMessage((error as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {t('security.settings.rotateKey')}
          </button>
        </details>
      )}
      <p className="muted">{t('security.settings.threatBoundary')}</p>
      {changePassword && (
        <VaultPasswordChange session={session} close={() => setChangePassword(false)} />
      )}
    </section>
  );
}
