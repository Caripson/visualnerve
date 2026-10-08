import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import { BackupSecurityNotice } from './BackupSecurityNotice';
import { VaultPasswordFields } from './VaultPasswordFields';
import { VaultRecoveryNotice } from './VaultRecoveryNotice';
import type { VaultSession } from './vault-session';

/** Mounts the workspace only after unlocking AND opening its encrypted repository. */
export function VaultGate({
  session,
  openWorkspace,
  children,
}: {
  session: VaultSession;
  openWorkspace: () => Promise<void>;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [initialized, setInitialized] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newRecovery, setNewRecovery] = useState('');
  const [awaitingRecovery, setAwaitingRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void session
      .initialize()
      .then(() => {
        if (active) setInitialized(true);
      })
      .catch((error: unknown) => {
        if (active) setError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [session]);
  useEffect(
    () =>
      session.onLock(() => {
        setPassword('');
        setConfirmation('');
        setRecoveryInput('');
        setNewRecovery('');
        setAwaitingRecovery(false);
        setReady(false);
        setRecovering(false);
      }),
    [session],
  );
  useEffect(() => {
    if (snapshot.status !== 'unlocked' || awaitingRecovery) return;
    let active = true;
    const openingEpoch = snapshot.epoch;
    void openWorkspace()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (
          !active ||
          session.getSnapshot().status !== 'unlocked' ||
          session.getSnapshot().epoch !== openingEpoch
        )
          return;
        setError((error as Error).message);
        void session.lock().catch(() => undefined);
      });
    return () => {
      active = false;
    };
  }, [snapshot.status, snapshot.epoch, awaitingRecovery, openWorkspace, session]);
  if (snapshot.status === 'unlocked' && ready && !awaitingRecovery) return children;
  const setup =
    snapshot.status === 'uninitialized' || (snapshot.status === 'unlocking' && !snapshot.vaultId);
  const title = newRecovery
    ? 'Save your recovery key'
    : setup
      ? 'Protect your local workspace'
      : recovering
        ? 'Recover your workspace'
        : 'Unlock your workspace';
  return (
    <Modal title={title} close={() => {}} dismissible={false}>
      {!initialized ? (
        <p role="status">{error || 'Checking local workspace…'}</p>
      ) : newRecovery ? (
        <VaultRecoveryNotice
          recoveryKey={newRecovery}
          continue={() => {
            setNewRecovery('');
            setAwaitingRecovery(false);
            setRecovering(false);
          }}
        />
      ) : snapshot.status === 'unlocked' ? (
        <p role="status">Opening encrypted workspace…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if ((setup || recovering) && (password.length < 12 || password !== confirmation)) {
              setError('Use at least 12 characters and enter the same password twice.');
              return;
            }
            setError('');
            setBusy(true);
            if (setup || recovering) setAwaitingRecovery(true);
            void (async () => {
              try {
                if (setup) setNewRecovery((await session.setup(password)).recoveryKey);
                else if (recovering)
                  setNewRecovery((await session.recover(recoveryInput, password)).recoveryKey);
                else await session.unlock(password);
              } catch (error) {
                setError((error as Error).message);
                setAwaitingRecovery(false);
              } finally {
                setPassword('');
                setConfirmation('');
                setRecoveryInput('');
                setBusy(false);
              }
            })();
          }}
        >
          <p>
            {setup
              ? 'Your workspace is encrypted in this browser. Choose a password before creating or importing private work.'
              : 'Enter your password locally. It is not sent to Visual Nerve, the integration bridge or an AI agent.'}
          </p>
          {recovering && (
            <label className="field">
              <span>Recovery key</span>
              <input
                type="password"
                autoComplete="off"
                value={recoveryInput}
                onChange={(event) => setRecoveryInput(event.target.value)}
                required
                disabled={busy}
              />
            </label>
          )}
          <VaultPasswordFields
            password={password}
            confirmation={confirmation}
            setPassword={setPassword}
            setConfirmation={setConfirmation}
            disabled={busy}
            confirm={setup || recovering}
          />
          {(setup || recovering) && <BackupSecurityNotice encrypted />}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            {!setup && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRecovering(!recovering);
                  setError('');
                  setPassword('');
                  setConfirmation('');
                  setRecoveryInput('');
                }}
              >
                {recovering ? 'Use password' : 'Use recovery key'}
              </button>
            )}
            <button className="primary" type="submit" disabled={busy}>
              {busy
                ? 'Please wait…'
                : setup
                  ? 'Create encrypted workspace'
                  : recovering
                    ? 'Set new password'
                    : 'Unlock'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
