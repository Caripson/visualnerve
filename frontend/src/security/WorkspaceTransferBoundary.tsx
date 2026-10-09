import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import type { WorkspaceBackup } from '../storage/database';
import type { WorkspaceOperation } from '../storage/contracts';
import { EncryptedWorkspaceDatabase } from '../storage/encrypted-database';
import { vaultSession, workspaceStorage } from '../storage/runtime';
import { flushSpatialCamera, workspace } from '../storage/workspace';
import { useEditor } from '../state/editor';
import { bridge } from '../integration/bridge';
import { disposeCsvWorker } from '../data/client';
import { disposeDataModelWorker } from '../data/modelClient';
import { simulationService } from '../simulation/service';
import { presentation } from '../presentation/service';
import { speechService } from '../presentation/speech/service';
import { disposeVideoExport } from '../presentation/video-service';
import { BackupSecurityNotice } from './BackupSecurityNotice';
import type { WorkspaceMigrationSummary } from '../storage/migration';
import { VaultKeyRotation } from './VaultKeyRotation';
import { RotationContext, TransferContext } from './workspace-maintenance-context';
export { useWorkspaceTransfer, useVaultKeyRotation } from './workspace-maintenance-context';

/** Lives outside App so a pending transfer never runs alongside editor/API writes. */
export function WorkspaceTransferBoundary({ children }: { children: ReactNode }) {
  const [backup, setBackup] = useState<WorkspaceBackup>();
  const [rotating, setRotating] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const mounted = useRef(true);
  const opening = useRef(false);
  const operation = useRef<WorkspaceOperation | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.dispose();
    };
  }, []);
  const begin = async (value?: WorkspaceBackup) => {
    if (opening.current || backup || rotating) return;
    if (!(workspaceStorage instanceof EncryptedWorkspaceDatabase))
      throw new Error('Workspace transfer requires the encrypted app.');
    opening.current = true;
    let captured: WorkspaceOperation | undefined;
    try {
      captured = await workspaceStorage.captureOperation();
      operation.current = captured;
      await captured.check();
      if (!mounted.current || captured.signal.aborted) return;
      useEditor.getState().finishEditing();
      flushSpatialCamera();
      await workspace.settled();
      await captured.check();
      if (!mounted.current || captured.signal.aborted) return;
      // This human action explicitly revokes integrations before the transfer begins.
      await workspace.setPreference('mcp-access', 'off');
      await captured.check();
      if (!mounted.current || captured.signal.aborted) return;
      bridge.disconnect();
      workspace.stop();
      disposeCsvWorker();
      disposeDataModelWorker();
      simulationService.dispose();
      presentation.close();
      const stoppedVideo = disposeVideoExport();
      speechService.dispose();
      await Promise.all([stoppedVideo, presentation.settled()]);
      await captured.check();
      if (!mounted.current || captured.signal.aborted) return;
      await workspace.clearUnlockedState();
      await captured.check();
      if (mounted.current && !captured.signal.aborted) {
        if (value) setBackup(value);
        else setRotating(true);
      }
    } finally {
      captured?.dispose();
      if (operation.current === captured) operation.current = undefined;
      opening.current = false;
    }
  };
  const resume = async (selectedDiagramId?: string) => {
    if (resuming || !(workspaceStorage instanceof EncryptedWorkspaceDatabase)) return;
    setResuming(true);
    setResumeError('');
    let captured: WorkspaceOperation | undefined;
    try {
      captured = await workspaceStorage.captureOperation();
      operation.current = captured;
      const { verifyPendingMigration } = await import('../storage/migration');
      await captured.check();
      if (!mounted.current || captured.signal.aborted) return;
      // A failed post-commit verification must never be bypassed using Cancel.
      if (!(captured.storage instanceof EncryptedWorkspaceDatabase))
        throw new Error('Workspace transfer requires the encrypted app.');
      const verified = await verifyPendingMigration(captured.storage);
      if (selectedDiagramId) {
        if (verified?.firstDiagramId !== selectedDiagramId)
          throw new Error('The transferred diagram could not be verified.');
        await captured.storage.settings.put({ key: 'last-diagram', value: selectedDiagramId });
      }
      await captured.check();
      if (mounted.current && !captured.signal.aborted) {
        setBackup(undefined);
        setRotating(false);
      }
    } catch (error) {
      if (mounted.current && !captured?.signal.aborted)
        setResumeError(`The editor remains closed: ${(error as Error).message}`);
    } finally {
      captured?.dispose();
      if (operation.current === captured) operation.current = undefined;
      if (mounted.current) setResuming(false);
    }
  };
  return (
    <TransferContext.Provider value={begin}>
      <RotationContext.Provider value={() => begin()}>
        {backup ? (
          <WorkspaceTransfer
            backup={backup}
            close={(id) => {
              void resume(id);
            }}
            closing={resuming}
            closeError={resumeError}
          />
        ) : rotating && vaultSession ? (
          <VaultKeyRotation
            session={vaultSession}
            close={() => {
              void resume();
            }}
            closing={resuming}
            closeError={resumeError}
          />
        ) : (
          children
        )}
      </RotationContext.Provider>
    </TransferContext.Provider>
  );
}

function WorkspaceTransfer({
  backup,
  close,
  closing,
  closeError,
}: {
  backup: WorkspaceBackup;
  close: (selectedDiagramId?: string) => void;
  closing: boolean;
  closeError: string;
}) {
  const { t, plural } = useI18n();
  const [replace, setReplace] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WorkspaceMigrationSummary>();
  const mounted = useRef(true);
  const operation = useRef<WorkspaceOperation | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.dispose();
    };
  }, []);
  return (
    <Modal
      title={t('security.transfer.title')}
      close={() => close()}
      dismissible={!busy && !closing}
    >
      {result ? (
        <>
          <p role="status">
            {t('security.transfer.verifiedSummary', {
              diagrams: result.counts.diagrams,
              nodes: result.counts.nodes,
              edges: result.counts.edges,
            })}
          </p>
          <p>{t('security.transfer.verifyBeforeRetiringSource')}</p>
          <div className="modal-actions">
            <button
              className="primary"
              disabled={closing}
              onClick={() => close(result.firstDiagramId)}
            >
              {t('security.transfer.open')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {plural(
              'security.transfer.contents.one',
              'security.transfer.contents.other',
              backup.diagrams.length,
            )}
          </p>
          <p className="muted">{t('security.transfer.independentOrigins')}</p>
          <BackupSecurityNotice encrypted />
          <label className="check-field">
            <input
              type="checkbox"
              checked={replace}
              disabled={busy || closing}
              onChange={(event) => setReplace(event.target.checked)}
            />
            {t('security.transfer.replaceAcknowledgement')}
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || closing}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {t('security.transfer.sourceKeptAcknowledgement')}
          </label>
          <div className="modal-actions">
            <button disabled={busy || closing} onClick={() => close()}>
              {t('security.action.cancel')}
            </button>
            <button
              className="primary"
              disabled={busy || closing || !acknowledged}
              onClick={() => {
                if (busy || closing || !acknowledged) return;
                setBusy(true);
                setError('');
                void (async () => {
                  let captured: WorkspaceOperation | undefined;
                  try {
                    if (!(workspaceStorage instanceof EncryptedWorkspaceDatabase))
                      throw new Error('Workspace transfer requires the encrypted app.');
                    captured = await workspaceStorage.captureOperation();
                    operation.current = captured;
                    const { migrateWorkspace } = await import('../storage/migration');
                    await captured.check();
                    if (!mounted.current || captured.signal.aborted) return;
                    if (!(captured.storage instanceof EncryptedWorkspaceDatabase))
                      throw new Error('Workspace transfer requires the encrypted app.');
                    const migrated = await migrateWorkspace(captured.storage, backup, {
                      replaceExisting: replace,
                    });
                    await captured.check();
                    if (mounted.current && !captured.signal.aborted) setResult(migrated);
                  } catch (failure) {
                    if (mounted.current && !captured?.signal.aborted)
                      setError((failure as Error).message);
                  } finally {
                    captured?.dispose();
                    if (operation.current === captured) operation.current = undefined;
                    if (mounted.current) setBusy(false);
                  }
                })();
              }}
            >
              {busy ? t('security.transfer.encryptingVerifying') : t('security.transfer.start')}
            </button>
          </div>
          {busy && <p role="status">{t('security.transfer.keepOpen')}</p>}
          {error && (
            <p className="form-error" role="alert">
              {localizedFeedback(error, t)}
            </p>
          )}
        </>
      )}
      {closing && <p role="status">{t('security.transfer.checkingBeforeReopen')}</p>}
      {closeError && (
        <p className="form-error" role="alert">
          {localizedFeedback(closeError, t)}
        </p>
      )}
    </Modal>
  );
}
