import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';
import { appUpdates } from './runtime';
import type { AppUpdateController } from './app-update-controller';
import { vaultSession } from '../storage/runtime';
import { AppUpdateBlockedError } from './errors';
import './app-updates.css';

const empty = Object.freeze({ phase: 'idle', dismissed: false, changedElsewhere: false } as const);
const noSubscription = () => () => {};
const noUpdate = () => empty;
const prepare = async () => {
  const status = vaultSession?.getSnapshot().status;
  if (status === 'locked') return;
  if (status === 'unlocking' || status === 'uninitialized')
    throw new AppUpdateBlockedError('finishTask');
  await (await import('./prepare-update')).prepareAppUpdate();
};

/** Update discovery also remains available while the encrypted workspace is locked. */
export function AppUpdateBoundary({
  children,
  controller = appUpdates,
  beforeUpdate = prepare,
  reload = () => window.location.reload(),
}: {
  children: ReactNode;
  controller?: AppUpdateController;
  beforeUpdate?: () => Promise<void>;
  reload?: () => void;
}) {
  const { t } = useI18n();
  const state = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    controller?.getSnapshot ?? noUpdate,
    controller?.getSnapshot ?? noUpdate,
  );
  const progress = useRef<HTMLDivElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const wasApplying = useRef(false);
  useEffect(() => {
    controller?.start();
    return () => controller?.stop();
  }, [controller]);
  const applying = state.phase === 'applying';
  useEffect(() => {
    if (applying) progress.current?.focus();
    else if (wasApplying.current) applyButton.current?.focus();
    wasApplying.current = applying;
  }, [applying]);
  const error = 'error' in state ? state.error : undefined;
  const kind = error && typeof error === 'object' && 'kind' in error ? error.kind : undefined;
  const detail =
    kind === 'finishTask'
      ? t('appUpdate.finishTask')
      : kind === 'waitForRun'
        ? t('appUpdate.waitForRun')
        : error instanceof Error
          ? error.message
          : String(error ?? '');
  return (
    <>
      <div className="app-update-workspace" inert={applying ? true : undefined}>
        {children}
      </div>
      {state.phase !== 'idle' && !state.dismissed && !applying && (
        <aside className="app-update-notice" aria-label={t('appUpdate.title')}>
          <div className="app-update-copy" role="status" aria-live="polite">
            <strong>{t('appUpdate.title')}</strong>
            <p>{state.changedElsewhere ? t('appUpdate.changedElsewhere') : t('appUpdate.hint')}</p>
            {vaultSession && <p className="muted">{t('appUpdate.unlockAgain')}</p>}
          </div>
          {error !== undefined && (
            <p className="form-error" role="alert">
              {t('appUpdate.failed', { detail })}
            </p>
          )}
          <div className="app-update-actions">
            <button onClick={() => controller?.later()}>{t('appUpdate.later')}</button>
            <button
              ref={applyButton}
              className="primary"
              onClick={() => void controller?.apply(beforeUpdate, reload)}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {error ? t('appUpdate.retry') : t('appUpdate.apply')}
            </button>
          </div>
        </aside>
      )}
      {applying && (
        <div className="app-update-overlay">
          <div
            ref={progress}
            className="app-update-progress"
            role="dialog"
            aria-modal="true"
            aria-label={t('appUpdate.applying')}
            data-app-update-dialog
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Tab') event.preventDefault();
            }}
          >
            <RefreshCw size={22} aria-hidden="true" />
            <p role="status">{t('appUpdate.applying')}</p>
            <p className="muted">{t('appUpdate.savedWork')}</p>
          </div>
        </div>
      )}
    </>
  );
}
