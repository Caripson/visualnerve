import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Link, LockKeyhole, RefreshCw, Users } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { useI18n } from '../../i18n';
import { defaultCollaborationShareScope, type CollaborationShareScope } from '../document/scope';
import type { CollaborationSnapshot, CollaborationUiController } from '../types';
import { Participants, type RoomConfirmation } from './Participants';
import './collaboration.css';

function SecurityNotice() {
  const { t } = useI18n();
  return (
    <details className="collaboration-security">
      <summary>
        <LockKeyhole size={16} />
        {t('collaboration.securityTitle')}
      </summary>
      <p>{t('collaboration.securityBody')}</p>
      <p>{t('collaboration.reloadWarning')}</p>
      <p>{t('collaboration.backupWarning')}</p>
      <a href="/help/collaboration/" target="_blank" rel="noopener noreferrer">
        {t('app.exploreGuide')}
      </a>
    </details>
  );
}

function Confirmation({
  value,
  busy,
  cancel,
  execute,
}: {
  value: RoomConfirmation;
  busy: boolean;
  cancel: () => void;
  execute: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const initialFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    initialFocus.current?.focus();
  }, [value]);
  const text =
    value.kind === 'remove'
      ? t('collaboration.confirmRemove', { name: value.name })
      : value.kind === 'role'
        ? t('collaboration.confirmChangeRole', {
            name: value.name,
            role: t(`collaboration.role.${value.role}`),
          })
        : value.kind === 'reject'
          ? t('collaboration.confirmReject')
          : value.kind === 'close'
            ? t('collaboration.confirmClose')
            : t('collaboration.confirmLeave');
  return (
    <section
      className="collaboration-confirmation"
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
    >
      <h3 id={`${id}-title`}>{t('collaboration.confirmTitle')}</h3>
      <p id={`${id}-detail`}>{text}</p>
      <div className="collaboration-actions">
        <button ref={initialFocus} disabled={busy} onClick={cancel}>
          {t('collaboration.cancel')}
        </button>
        <button className="danger" disabled={busy} onClick={execute}>
          {t(busy ? 'collaboration.busy' : 'collaboration.confirm')}
        </button>
      </div>
    </section>
  );
}

function Disclosure({
  scope,
  change,
  disabled,
}: {
  scope: CollaborationShareScope;
  change?: (scope: CollaborationShareScope) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="collaboration-disclosure">
      <legend>{t(change ? 'collaboration.scopeTitle' : 'collaboration.sharing')}</legend>
      <p>{t('collaboration.coreScope')}</p>
      {(['shareMetadata', 'shareOwners', 'shareDatasets'] as const).map((key, index) => (
        <label className="check-field" key={key}>
          <input
            type="checkbox"
            checked={scope[key]}
            disabled={disabled || !change}
            onChange={(event) => change?.({ ...scope, [key]: event.target.checked })}
          />
          <span>
            {t(
              (
                [
                  'collaboration.metadata',
                  'collaboration.owners',
                  'collaboration.datasets',
                ] as const
              )[index],
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Invitation({
  snapshot,
  controller,
  busy,
  run,
}: {
  snapshot: Readonly<CollaborationSnapshot>;
  controller: CollaborationUiController;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
}) {
  const { t, date } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [snapshot.invitation?.url]);
  return (
    <section aria-label={t('collaboration.invitation')}>
      <h3>{t('collaboration.invitation')}</h3>
      <p>{t('collaboration.inviteHint')}</p>
      {snapshot.invitation && (
        <>
          <Field title={t('collaboration.invitation')}>
            <textarea
              className="collaboration-invitation"
              readOnly
              rows={2}
              spellCheck={false}
              value={snapshot.invitation.url}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <p className="muted">
            {t('collaboration.expires', {
              date: date(snapshot.invitation.expiresAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        </>
      )}
      <div className="collaboration-actions">
        {snapshot.invitation && (
          <button
            disabled={busy || snapshot.status !== 'live'}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(snapshot.invitation!.url)
                .then(() => {
                  setCopied(true);
                  setCopyFailed(false);
                })
                .catch(() => setCopyFailed(true));
              if (!navigator.clipboard?.writeText) setCopyFailed(true);
            }}
          >
            <Copy size={16} />
            {t('collaboration.copy')}
          </button>
        )}
        <button
          disabled={busy || snapshot.status !== 'live'}
          onClick={() => run(() => controller.createInvitation())}
        >
          <Link size={16} />
          {t('collaboration.newInvitation')}
        </button>
      </div>
      {copied && <p role="status">{t('collaboration.copied')}</p>}
      {copyFailed && <p role="status">{t('collaboration.copyFailed')}</p>}
    </section>
  );
}

export function CollaborationPanel({
  controller,
  close,
  initialInvitation,
}: {
  controller: CollaborationUiController;
  close: () => void;
  initialInvitation?: string;
}) {
  const { t, number } = useI18n();
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
  const [mode, setMode] = useState<'create' | 'join'>(initialInvitation ? 'join' : 'create');
  const [displayName, setDisplayName] = useState(snapshot.displayName);
  const [scope, setScope] = useState<CollaborationShareScope>({
    ...defaultCollaborationShareScope,
  });
  const [invitation, setInvitation] = useState(initialInvitation ?? '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<RoomConfirmation>();
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (alive.current) setConfirmation(undefined);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : t('collaboration.errorTitle'));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const active = !!snapshot.roomId;
  const disabled = busy || snapshot.status === 'connecting' || snapshot.status === 'syncing';
  const confirmationAction = () => {
    if (!confirmation) return;
    const value = confirmation;
    void run(() =>
      value.kind === 'remove'
        ? controller.remove(value.deviceId)
        : value.kind === 'role'
          ? controller.changeRole(value.deviceId, value.role)
          : value.kind === 'reject'
            ? controller.reject(value.deviceId)
            : value.kind === 'close'
              ? controller.closeRoom()
              : controller.leave(),
    );
  };
  return (
    <Modal
      title={t('collaboration.title')}
      close={close}
      wide
      dismissible={!busy}
      className="collaboration-panel"
    >
      <p>{t('collaboration.intro')}</p>
      <div className={`collaboration-status status-${snapshot.status}`} role="status">
        <span
          className={`collaboration-dot ${snapshot.status === 'live' ? 'connected' : ''}`}
          aria-hidden="true"
        />
        <strong>{t(`collaboration.status.${snapshot.status}`)}</strong>
        {snapshot.role && (
          <span className="collaboration-badge">{t(`collaboration.role.${snapshot.role}`)}</span>
        )}
      </div>
      {snapshot.syncProgress && (
        <div className="collaboration-progress">
          <progress
            aria-label={t('collaboration.status.syncing')}
            value={snapshot.syncProgress.completed}
            max={Math.max(1, snapshot.syncProgress.total)}
          />
          <p>
            {t('collaboration.syncProgress', {
              completed: number(snapshot.syncProgress.completed),
              total: number(snapshot.syncProgress.total),
            })}
          </p>
        </div>
      )}
      {(error || snapshot.error) && (
        <div role="alert" className="collaboration-error">
          <strong>{t('collaboration.errorTitle')}</strong>
          <p>{error || snapshot.error}</p>
        </div>
      )}
      {!snapshot.configured ? (
        <p className="collaboration-notice">{t('collaboration.unavailable')}</p>
      ) : !active ? (
        <>
          <div className="collaboration-modes" aria-label={t('collaboration.title')}>
            <button
              aria-pressed={mode === 'create'}
              className={mode === 'create' ? 'primary' : ''}
              disabled={disabled}
              onClick={() => setMode('create')}
            >
              <Users size={16} />
              {t('collaboration.create')}
            </button>
            <button
              aria-pressed={mode === 'join'}
              className={mode === 'join' ? 'primary' : ''}
              disabled={disabled}
              onClick={() => setMode('join')}
            >
              <Link size={16} />
              {t('collaboration.join')}
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!displayName.trim() || disabled) return;
              if (mode === 'create' && snapshot.diagramId && consent)
                void run(() => controller.create(snapshot.diagramId!, displayName.trim(), scope));
              if (mode === 'join' && invitation.trim())
                void run(async () => {
                  await controller.join(invitation.trim(), displayName.trim());
                  if (alive.current) setInvitation('');
                });
            }}
          >
            <Field title={t('collaboration.displayName')}>
              <input
                required
                maxLength={80}
                autoComplete="nickname"
                value={displayName}
                disabled={disabled}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <p className="muted">{t('collaboration.nameHint')}</p>
            {mode === 'create' ? (
              <>
                {!snapshot.diagramId && (
                  <p className="collaboration-notice">{t('collaboration.selectDiagram')}</p>
                )}
                <Disclosure scope={scope} change={setScope} disabled={disabled} />
                <p className="collaboration-notice">{t('collaboration.backupWarning')}</p>
                <p className="muted">{t('collaboration.reloadWarning')}</p>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={disabled}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  {t('collaboration.shareConsent')}
                </label>
                <div className="collaboration-actions">
                  <button
                    type="submit"
                    className="primary"
                    disabled={disabled || !snapshot.diagramId || !displayName.trim() || !consent}
                  >
                    {t(busy ? 'collaboration.busy' : 'collaboration.createAction')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Field title={t('collaboration.invitation')}>
                  <textarea
                    required
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    value={invitation}
                    disabled={disabled}
                    onChange={(event) => setInvitation(event.target.value)}
                  />
                </Field>
                <p>{t('collaboration.inviteHint')}</p>
                <p className="collaboration-notice">{t('collaboration.joinWarning')}</p>
                <div className="collaboration-actions">
                  <button
                    type="submit"
                    className="primary"
                    disabled={disabled || !displayName.trim() || !invitation.trim()}
                  >
                    {t(busy ? 'collaboration.busy' : 'collaboration.joinAction')}
                  </button>
                </div>
              </>
            )}
          </form>
        </>
      ) : (
        <>
          <p className="collaboration-room-id">
            {t('collaboration.room', { id: snapshot.roomId! })}
          </p>
          {snapshot.ownerCredentialId && (
            <dl className="collaboration-fingerprint">
              <dt>{t('collaboration.ownerFingerprint')}</dt>
              <dd>
                <code>{snapshot.ownerCredentialId}</code>
              </dd>
            </dl>
          )}
          {snapshot.selfCredentialId && snapshot.role !== 'owner' && (
            <div>
              <dl className="collaboration-fingerprint">
                <dt>{t('collaboration.selfFingerprint')}</dt>
                <dd>
                  <code>{snapshot.selfCredentialId}</code>
                </dd>
              </dl>
              {snapshot.status === 'awaiting-approval' && (
                <p className="muted">{t('collaboration.selfFingerprintHint')}</p>
              )}
            </div>
          )}
          {snapshot.recoveryCopy && (
            <p className="collaboration-notice" role="status">
              {t('collaboration.recoveryCopy', {
                name: snapshot.recoveryCopy.title,
                projects: t('workspace.projects'),
              })}
            </p>
          )}
          {snapshot.role === 'owner' && (
            <Invitation
              snapshot={snapshot}
              controller={controller}
              busy={busy || !!confirmation}
              run={(action) => {
                void run(action);
              }}
            />
          )}
          <Disclosure scope={snapshot.scope} disabled />
          <Participants
            snapshot={snapshot}
            controller={controller}
            busy={busy || !!confirmation}
            run={(action) => {
              void run(action);
            }}
            confirm={setConfirmation}
          />
          <p className="collaboration-notice">{t('collaboration.reloadWarning')}</p>
          <div className="collaboration-actions collaboration-session-actions">
            {(snapshot.status === 'offline' ||
              snapshot.status === 'error' ||
              snapshot.status === 'conflict') && (
              <button
                disabled={busy}
                onClick={() => {
                  void run(() => controller.reconnect());
                }}
              >
                <RefreshCw size={16} />
                {t('collaboration.reconnect')}
              </button>
            )}
            <button
              disabled={busy || !!confirmation}
              onClick={() =>
                setConfirmation({ kind: snapshot.role === 'owner' ? 'close' : 'leave' })
              }
            >
              {t(snapshot.role === 'owner' ? 'collaboration.closeRoom' : 'collaboration.leave')}
            </button>
          </div>
          {confirmation && (
            <Confirmation
              value={confirmation}
              busy={busy}
              cancel={() => setConfirmation(undefined)}
              execute={confirmationAction}
            />
          )}
        </>
      )}
      <SecurityNotice />
    </Modal>
  );
}
