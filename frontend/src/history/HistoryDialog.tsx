import {
  historyKindLabel,
  historyEntityLabel,
  historyChangeKindLabel,
  historyWarningLabel,
} from '../ui/editor-labels';
import { useI18n } from '../i18n';
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
  const { t, plural, date } = useI18n();
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [selected, setSelected] = useState('');
  const [target, setTarget] = useState('current');
  const [name, setName] = useState('');
  const [comparison, setComparison] = useState<HistoryComparison | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<{
    kind: 'created' | 'restored' | 'removed';
    snapshotName?: string;
  }>();
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
    setNotice(undefined);
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
      setNotice({ kind: 'created' });
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
      setNotice({ kind: 'restored', snapshotName: result.safetySnapshot.name });
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
      setNotice({ kind: 'removed' });
    });
  return (
    <Modal title={t('editor.history.title')} close={onClose} wide dismissible={!busy}>
      <div className="history-dialog">
        <p>
          {t('editor.history.namedSnapshotsAndCheckpointsBeforeSourceRefreshOrRestoreAreSavedIn')}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="history-create"
        >
          <label>
            {t('editor.history.snapshotName')}{' '}
            <input
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <button disabled={busy || !name.trim()} type="submit">
            {t('editor.history.saveSnapshot')}
          </button>
        </form>
        <p className="history-capacity">
          {t('editor.history.limits', {
            snapshotLimit: store.limits.snapshotsPerDiagram,
            historyMiB: Math.round(store.limits.bytes / 1024 / 1024),
          })}
        </p>
        {!snapshots.length ? (
          <p>{t('editor.history.noSnapshotsYet')}</p>
        ) : (
          <>
            <label>
              {t('editor.history.snapshot')}{' '}
              <select
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{t('editor.history.chooseASnapshot')}</option>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.name} ·{' '}
                    {date(new Date(snapshot.createdAt), {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: 'numeric',
                      second: 'numeric',
                    })}{' '}
                    · {historyKindLabel(t, snapshot.kind)}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                <label>
                  {t('editor.history.compareWith')}{' '}
                  <select
                    value={target}
                    disabled={busy}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="current">{t('editor.history.currentDiagram')}</option>
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
                    {t('editor.history.reviewChanges')}
                  </button>
                  <button onClick={() => void remove()} disabled={busy}>
                    {deleteReady
                      ? t('editor.history.confirmDeleteSnapshot')
                      : t('editor.history.deleteSnapshot')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {comparison && (
          <section aria-label={t('editor.history.snapshotComparison')}>
            <h3>
              {plural(
                'editor.history.comparison.count.one',
                'editor.history.comparison.count.other',
                comparison.totalChanges,
              )}
            </h3>
            <p>
              {t(
                target === 'current'
                  ? 'editor.history.comparison.direction.current'
                  : 'editor.history.comparison.direction.snapshot',
              )}
            </p>
            <table>
              <thead>
                <tr>
                  <th>{t('editor.history.content')}</th>
                  <th>{t('editor.history.added')}</th>
                  <th>{t('editor.history.removed')}</th>
                  <th>{t('editor.history.changed')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(comparison.counts).map(([entity, count]) => (
                  <tr key={entity}>
                    <th>{historyEntityLabel(t, entity)}</th>
                    <td>{count.added}</td>
                    <td>{count.removed}</td>
                    <td>{count.changed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>{t('editor.history.comparison.affected', { count: comparison.affectedTotal })}</p>
            {comparison.warnings.map((warning) => (
              <p key={warning}>{historyWarningLabel(t, warning)}</p>
            ))}
            {comparison.changesTruncated && (
              <p>
                {t('editor.history.comparison.truncated', { count: comparison.changes.length })}
              </p>
            )}
            {comparison.affectedTruncated && (
              <p>{t('editor.history.affectedReferencesAreLimitedTo2000NodesAnd2000Connections')}</p>
            )}
            <ul className="history-changes">
              {comparison.changes.map((change) => (
                <li key={`${change.entity}:${change.id}`}>
                  <strong>{change.label}</strong> · {historyEntityLabel(t, change.entity)}{' '}
                  {historyChangeKindLabel(t, change.kind)}
                  {change.fields.length
                    ? ` · ${change.fields.slice(0, 12).join(', ')}${change.fields.length > 12 ? '…' : ''}`
                    : ''}
                </li>
              ))}
            </ul>
            {target === 'current' && (
              <>
                <p>
                  {t(
                    'editor.history.restorePreservesDiagramAndObjectIdsAndCreatesACheckpointOfYour',
                  )}
                </p>
                <label className="history-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  {t('editor.history.iReviewedTheChangesAndWantToRestoreThisSnapshot')}{' '}
                </label>
                <button disabled={busy || !acknowledged} onClick={() => void restore()}>
                  {t('editor.history.restoreReviewedSnapshot')}
                </button>
              </>
            )}
          </section>
        )}
        {notice && (
          <p role="status">
            {notice.kind === 'created'
              ? t('editor.history.namedSnapshotSavedLocally')
              : notice.kind === 'removed'
                ? t('editor.history.snapshotDeletedTheCurrentDiagramIsUnchanged')
                : t('editor.history.restoredYourPreviousWorkIsPreservedAs', {
                    snapshotName: notice.snapshotName ?? '',
                  })}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {busy && <p role="status">{t('editor.history.workingStatus')}</p>}
      </div>
    </Modal>
  );
}
