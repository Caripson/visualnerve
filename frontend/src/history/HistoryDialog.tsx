import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import type { Graph } from '../model/types';
import type { HistoryStore } from './store';
import type { HistoryComparison, HistorySnapshot } from './types';
import './history.css';

export interface HistoryDialogProps {
  store: HistoryStore;
  diagramId: string;
  onClose: () => void;
  onRestored: (graph: Graph) => void | Promise<void>;
  beforeAction?: () => void | Promise<void>;
}
export function HistoryDialog({
  store,
  diagramId,
  onClose,
  onRestored,
  beforeAction,
}: HistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [selected, setSelected] = useState('');
  const [target, setTarget] = useState('current');
  const [name, setName] = useState('');
  const [comparison, setComparison] = useState<HistoryComparison | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    store
      .list(diagramId)
      .then((value) => {
        if (active) setSnapshots(value);
      })
      .catch((error) => {
        if (active) setMessage((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [store, diagramId]);
  useEffect(() => {
    setComparison(null);
    setAcknowledged(false);
    setDeleteReady(false);
  }, [selected, target]);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await beforeAction?.();
      await operation();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => setSnapshots(await store.list(diagramId));
  const create = () =>
    act(async () => {
      const current = await store.current(diagramId);
      const snapshot = await store.create(diagramId, {
        name,
        baseVersion: current.diagram.version,
      });
      await reload();
      setSelected(snapshot.id);
      setName('');
      setMessage('Named snapshot saved locally.');
    });
  const review = () =>
    act(async () => {
      setComparison(await store.compare(diagramId, selected, target));
      setAcknowledged(false);
    });
  const restore = () =>
    act(async () => {
      if (!comparison || target !== 'current' || !acknowledged) return;
      const result = await store.restore(diagramId, selected, {
        baseVersion: comparison.currentVersion,
      });
      await onRestored(result.graph);
      await reload();
      setComparison(null);
      setAcknowledged(false);
      setMessage(`Restored. Your previous work is preserved as “${result.safetySnapshot.name}”.`);
    });
  const remove = () =>
    act(async () => {
      if (!deleteReady) {
        setDeleteReady(true);
        return;
      }
      await store.remove(diagramId, selected);
      setSelected('');
      await reload();
      setMessage('Snapshot deleted. The current diagram is unchanged.');
    });
  return (
    <Modal title="Diagram history" close={onClose} wide dismissible={!busy}>
      <div className="history-dialog">
        <p>
          Named snapshots and checkpoints before source refresh or restore are saved in this
          browser. Ordinary autosaves do not create snapshots. Workspace backups include history.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="history-create"
        >
          <label>
            Snapshot name
            <input
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <button disabled={busy || !name.trim()} type="submit">
            Save snapshot
          </button>
        </form>
        <p className="history-capacity">
          Up to {store.limits.snapshotsPerDiagram} snapshots per diagram and{' '}
          {Math.round(store.limits.bytes / 1024 / 1024)} MiB of shared history. Delete snapshots
          explicitly to free space; named snapshots are never evicted automatically.
        </p>
        {!snapshots.length ? (
          <p>No snapshots yet.</p>
        ) : (
          <>
            <label>
              Snapshot
              <select
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a snapshot</option>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.name} · {new Date(snapshot.createdAt).toLocaleString()} ·{' '}
                    {snapshot.kind}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                <label>
                  Compare with
                  <select
                    value={target}
                    disabled={busy}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="current">Current diagram</option>
                    {snapshots
                      .filter((snapshot) => snapshot.id !== selected)
                      .map((snapshot) => (
                        <option key={snapshot.id} value={snapshot.id}>
                          {snapshot.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="history-actions">
                  <button onClick={() => void review()} disabled={busy}>
                    Review changes
                  </button>
                  <button onClick={() => void remove()} disabled={busy}>
                    {deleteReady ? 'Confirm delete snapshot' : 'Delete snapshot'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {comparison && (
          <section aria-label="Snapshot comparison">
            <h3>{comparison.totalChanges} meaningful changes</h3>
            <p>
              Changes run from the selected snapshot to{' '}
              {target === 'current' ? 'your current diagram' : 'the comparison snapshot'}. Restoring
              reverses these changes.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Added</th>
                  <th>Removed</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(comparison.counts).map(([entity, count]) => (
                  <tr key={entity}>
                    <th>{entity}</th>
                    <td>{count.added}</td>
                    <td>{count.removed}</td>
                    <td>{count.changed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {comparison.affectedTotal} objects may be affected through modeled connections. Camera
              movements and save timestamps are ignored.
            </p>
            {comparison.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {comparison.changesTruncated && (
              <p>
                Showing the first {comparison.changes.length} changes; counts include all changes.
              </p>
            )}
            {comparison.affectedTruncated && (
              <p>
                Affected references are limited to 2,000 nodes and 2,000 connections; the total is
                shown above.
              </p>
            )}
            <ul className="history-changes">
              {comparison.changes.map((change) => (
                <li key={`${change.entity}:${change.id}`}>
                  <strong>{change.label}</strong> · {change.entity} {change.kind}
                  {change.fields.length
                    ? ` · ${change.fields.slice(0, 12).join(', ')}${change.fields.length > 12 ? '…' : ''}`
                    : ''}
                </li>
              ))}
            </ul>
            {target === 'current' && (
              <>
                <p>
                  Restore preserves diagram and object IDs and creates a checkpoint of your current
                  work first. Shared owner profiles retain their current details. Another tab
                  changing this diagram requires a new review.
                </p>
                <label className="history-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I reviewed the changes and want to restore this snapshot.
                </label>
                <button disabled={busy || !acknowledged} onClick={() => void restore()}>
                  Restore reviewed snapshot
                </button>
              </>
            )}
          </section>
        )}
        {message && <p role="status">{message}</p>}
        {busy && <p role="status">Working…</p>}
      </div>
    </Modal>
  );
}
