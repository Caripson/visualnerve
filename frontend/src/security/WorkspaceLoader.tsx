import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import type { VaultSession, VaultSessionOperation } from './vault-session';

const legacySnapshot = Object.freeze({ epoch: undefined, status: 'unlocked' });
const noSubscription = () => () => {};
const legacyState = () => legacySnapshot;

/** A late module download never publishes UI under a replacement vault session. */
export function WorkspaceLoader({
  session,
  load,
}: {
  session?: VaultSession;
  load: () => Promise<{ default: ComponentType }>;
}) {
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscription,
    session?.getSnapshot ?? legacyState,
  );
  const [ready, setReady] = useState<{
    epoch?: number;
    Surface?: ComponentType;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (snapshot.status !== 'unlocked') return;
    const epoch = snapshot.epoch;
    const controller = new AbortController();
    let operation: VaultSessionOperation | undefined;
    setReady(undefined);
    void (async () => {
      try {
        operation = session ? await session.captureOperation(controller.signal) : undefined;
        if (controller.signal.aborted) return;
        const module = await load();
        await operation?.check();
        operation?.assertActive();
        if (!controller.signal.aborted) setReady({ epoch, Surface: module.default });
      } catch {
        if (!controller.signal.aborted) setReady({ epoch, failed: true });
      } finally {
        operation?.dispose();
      }
    })();
    return () => {
      controller.abort();
      operation?.dispose();
    };
  }, [session, snapshot.status, snapshot.epoch, load]);
  if (snapshot.status !== 'unlocked') return null;
  if (ready?.epoch === snapshot.epoch && ready?.failed)
    return (
      <div className="workspace-loading" role="alert">
        <p>
          The workspace could not be opened. Reload to retry loading its local application files.
        </p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  const Surface = ready?.epoch === snapshot.epoch ? ready?.Surface : undefined;
  return Surface ? <Surface /> : <p role="status">Loading workspace…</p>;
}
