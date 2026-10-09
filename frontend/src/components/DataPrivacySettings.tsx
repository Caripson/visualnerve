import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, Upload, Eraser } from 'lucide-react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { WorkspaceBackup } from '../storage/database';
import { workspaceStorage } from '../storage/runtime';
import { exportAllData } from '../storage/backup';
import { Modal } from './Modal';
import { StorageNotice } from './DataPrivacy';
import { assertImportBytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';
import { BackupSecurityNotice } from '../security/BackupSecurityNotice';
import { isEncryptedWorkspaceSurface } from '../security/surface';
import { clearAppCache } from '../security/app-cache';
import { speechService } from '../presentation/speech/service';
import { presentation } from '../presentation/service';
import { disposeVideoExport } from '../presentation/video-service';
import { useWorkspaceTransfer } from '../security/workspace-maintenance-context';

const LegacyEncryptedBackup = lazy(() =>
  import('../security/LegacyEncryptedBackup').then((module) => ({
    default: module.LegacyEncryptedBackup,
  })),
);

export function DataPrivacy({
  restore,
  deleted,
  onReadBackup,
}: {
  restore: (data: WorkspaceBackup) => void;
  deleted: () => void;
  onReadBackup?: (file: File) => Promise<WorkspaceBackup>;
}) {
  const { t, plural, number, date } = useI18n();
  const [message, setMessage] = useState('');
  const [usage, setUsage] = useState<number>();
  const [persistent, setPersistent] = useState<boolean>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const backupRead = useRef(0);
  const transferRead = useRef(false);
  const transfer = useWorkspaceTransfer();
  const [encryptedTransfer, setEncryptedTransfer] = useState(false);
  const count = useEditor((state) => state.diagrams.length);
  const permission = useEditor((state) => state.mcpAccess);
  const workspaceId = useEditor((state) => state.workspaceId);
  const lastExport = useEditor((state) => state.lastExport);
  useEffect(() => {
    let active = true;
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (active) setUsage(estimate.usage);
      })
      .catch(() => {});
    void navigator.storage
      ?.persisted?.()
      .then((value) => {
        if (active) setPersistent(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      backupRead.current++;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="data-privacy" aria-label={t('privacy.data.region')}>
      <div className="property-section">{t('privacy.data.title')}</div>
      <p>{t('privacy.data.otherVisitors')}</p>
      <dl className="storage-facts">
        <dt>{t('privacy.data.storageLabel')}</dt>
        <dd>{t('privacy.data.browserProfile')}</dd>
        <dt>{t('privacy.data.cloudLabel')}</dt>
        <dd>{t('privacy.data.cloudNotUsed')}</dd>
        <dt>{t('privacy.data.syncLabel')}</dt>
        <dd>{t('privacy.data.noAutomaticSync')}</dd>
        <dt>{t('privacy.data.mcpLabel')}</dt>
        <dd>
          {t('privacy.data.mcpSummary', {
            access:
              permission === 'off'
                ? t('integration.access.off')
                : permission === 'read'
                  ? t('integration.access.read')
                  : t('integration.access.write'),
          })}
        </dd>
      </dl>
      <p className="muted">{t('privacy.data.separateProfiles')}</p>
      <BackupSecurityNotice encrypted={isEncryptedWorkspaceSurface()} />
      <div className="storage-actions">
        <button
          disabled={busy}
          onClick={() => {
            void run(async () => {
              await exportAllData();
              setMessage(
                isEncryptedWorkspaceSurface()
                  ? 'Encrypted backup downloaded. Use the password or recovery key from this export to restore it.'
                  : 'Backup downloaded. Use Restore backup to import it.',
              );
            });
          }}
        >
          <Download size={15} />
          {t('privacy.backup.exportAll')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            transferRead.current = false;
            file.current?.click();
          }}
        >
          <Upload size={15} />
          {t('privacy.backup.restore')}
        </button>
        {transfer ? (
          <button
            disabled={busy}
            onClick={() => {
              transferRead.current = true;
              file.current?.click();
            }}
          >
            <Upload size={15} />
            {t('privacy.transfer.import')}
          </button>
        ) : !isEncryptedWorkspaceSurface() ? (
          <button disabled={busy} onClick={() => setEncryptedTransfer(true)}>
            <Download size={15} />
            {t('privacy.transfer.export')}
          </button>
        ) : null}
        <button
          disabled={busy}
          onClick={() => {
            void run(async () => {
              presentation.close();
              const stoppedVideo = disposeVideoExport();
              speechService.dispose();
              await Promise.all([stoppedVideo, presentation.settled()]);
              const result = await clearAppCache();
              setMessage(
                result.available
                  ? 'App cache cleared. Your diagrams and settings are preserved. Offline files and voices download again when needed.'
                  : 'This browser does not provide an app cache to clear. Your workspace data was not changed.',
              );
            });
          }}
        >
          <Eraser size={15} />
          {t('privacy.cache.clear')}
        </button>
      </div>
      {transfer ? (
        <p className="muted">{t('privacy.transfer.destinationInstructions')}</p>
      ) : !isEncryptedWorkspaceSurface() ? (
        <p className="muted">{t('privacy.transfer.sourceInstructions')}</p>
      ) : null}
      <p className="muted">{t('privacy.cache.removalBoundary')}</p>
      <p className="muted">
        {plural('privacy.data.count.one', 'privacy.data.count.other', count)}
        {lastExport ? t('privacy.data.lastExport', { date: date(lastExport) }) : ''}
      </p>
      <StorageNotice />
      <a href="/privacy/" target="_blank" rel="noopener noreferrer">
        {t('privacy.data.storageHelp')}
      </a>
      <details className="storage-details">
        <summary>{t('privacy.storage.details')}</summary>
        <dl className="storage-facts">
          <dt>{t('privacy.storage.databaseLabel')}</dt>
          <dd>{t('privacy.storage.schema', { schemaVersion: workspaceStorage.schemaVersion })}</dd>
          <dt>{t('privacy.storage.originLabel')}</dt>
          <dd>{location.origin}</dd>
          <dt>{t('privacy.storage.workspaceIdLabel')}</dt>
          <dd>{workspaceId}</dd>
          <dt>{t('privacy.storage.usageLabel')}</dt>
          <dd>
            {usage === undefined
              ? t('privacy.storage.unavailable')
              : t('privacy.storage.estimatedUsage', {
                  size: number(usage / 1024 / 1024, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                })}
          </dd>
          <dt>{t('privacy.storage.retentionLabel')}</dt>
          <dd>
            {persistent === true
              ? t('privacy.storage.persistentGranted')
              : persistent === false
                ? t('privacy.storage.defaultRetention')
                : t('privacy.storage.unavailable')}
          </dd>
        </dl>
        <p className="muted">{t('privacy.storage.estimateBoundary')}</p>
        {count > 0 && persistent !== true && navigator.storage?.persist && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const granted = await navigator.storage.persist();
                  setPersistent(granted);
                  setMessage(
                    granted
                      ? 'Your browser granted persistent storage. Manual clearing can still remove data.'
                      : 'Your browser did not grant persistent storage. You can still save locally and export backups.',
                  );
                });
              }}
            >
              {t('privacy.storage.requestPersistence')}
            </button>
            <p className="muted">{t('privacy.storage.persistenceLimit')}</p>
          </>
        )}
      </details>
      <details className="storage-danger">
        <summary>{t('privacy.delete.title')}</summary>
        <p>{t('privacy.delete.irreversibleWarning')}</p>
        {isEncryptedWorkspaceSurface() && <p>{t('privacy.delete.vaultAndCopiesPreserved')}</p>}
        <label className="check-field">
          <input
            type="checkbox"
            aria-label={t('privacy.delete.confirmAccessible')}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {t('privacy.delete.confirm')}
        </label>
        <button
          className="danger"
          disabled={!confirmed || busy}
          onClick={() => {
            void run(async () => {
              await workspace.deleteAll();
              deleted();
            });
          }}
        >
          {t('privacy.delete.execute')}
        </button>
      </details>
      {message && (
        <p className="settings-message" role="status">
          {localizedFeedback(message, t)}
        </p>
      )}
      <input
        ref={file}
        aria-label={t('privacy.backup.fileInput')}
        className="file-input"
        type="file"
        accept=".json"
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          if (!selected) return;
          const requested = ++backupRead.current;
          const moving = transferRead.current;
          transferRead.current = false;
          setBusy(true);
          setMessage('');
          try {
            assertImportBytes(selected.size, currentImportLimitBytes(), 'Backup file');
            const data = onReadBackup
              ? await onReadBackup(selected)
              : (JSON.parse(await selected.text()) as WorkspaceBackup);
            if (requested !== backupRead.current) return;
            if (!data || data.format !== 'visual-nerve-workspace' || !Array.isArray(data.diagrams))
              throw new Error('Choose a Visual Nerve backup file.');
            if (moving && transfer) await transfer(data);
            else restore(data);
          } catch (error) {
            if (requested === backupRead.current) setMessage((error as Error).message);
          } finally {
            if (requested === backupRead.current) {
              setBusy(false);
              if (file.current) file.current.value = '';
            }
          }
        }}
      />
      {encryptedTransfer && (
        <Suspense fallback={<p role="status">{t('privacy.transfer.opening')}</p>}>
          <LegacyEncryptedBackup
            close={() => setEncryptedTransfer(false)}
            complete={() => {
              setMessage(
                'Encrypted transfer downloaded. Keep its original password and recovery key, and keep this workspace until the destination has been verified.',
              );
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
export function RestoreBackup({ backup, close }: { backup: WorkspaceBackup; close: () => void }) {
  const { t, plural, date } = useI18n();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={t('privacy.restore.title')} close={close} dismissible={!busy}>
      <p>
        {backup.exportedAt
          ? plural(
              'privacy.restore.fileSummaryDated.one',
              'privacy.restore.fileSummaryDated.other',
              backup.diagrams.length,
              { date: date(backup.exportedAt) },
            )
          : plural(
              'privacy.restore.fileSummary.one',
              'privacy.restore.fileSummary.other',
              backup.diagrams.length,
            )}
      </p>
      <label className="check-field">
        <input
          type="radio"
          name="restore-mode"
          checked={mode === 'merge'}
          onChange={() => setMode('merge')}
        />
        {t('privacy.restore.mergeLabel')}
      </label>
      <p className="muted">{t('privacy.restore.mergeEffect')}</p>
      <label className="check-field">
        <input
          type="radio"
          name="restore-mode"
          checked={mode === 'replace'}
          onChange={() => setMode('replace')}
        />
        {t('privacy.restore.replaceLabel')}
      </label>
      {mode === 'replace' && (
        <>
          <p className="storage-notice">{t('privacy.restore.replaceEffect')}</p>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label={t('privacy.restore.confirmReplaceAccessible')}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t('privacy.restore.confirmReplace')}
          </label>
        </>
      )}
      {error && <p className="form-error">{localizedFeedback(error, t)}</p>}
      <div className="modal-actions">
        <button disabled={busy} onClick={close}>
          {t('security.action.cancel')}
        </button>
        <button
          className={mode === 'replace' ? 'danger' : 'primary'}
          disabled={busy || (mode === 'replace' && !confirmed)}
          onClick={async () => {
            setBusy(true);
            try {
              await workspace.restoreBackup(backup, mode);
              close();
            } catch (error) {
              setError((error as Error).message);
              setBusy(false);
            }
          }}
        >
          {t('privacy.backup.restore')}
        </button>
      </div>
    </Modal>
  );
}
