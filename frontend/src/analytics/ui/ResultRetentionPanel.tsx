import { useState } from 'react';
import { Modal } from '../../components/Modal';
import type { AnalyticsExtension } from '../types';
import { retainAnalyticsResults } from '../retention';
import type { PanelProps } from './types';
import { errorMessage } from './display';
import { UtcTimestamp } from './UtcTimestamp';
import { DefinitionRevisionNotice, useDefinitionRevision } from './use-definition-revision';

export function ResultRetentionPanel(props: PanelProps) {
  const [limits, setLimits] = useState(props.model.retention);
  const revision = useDefinitionRevision('retention', limits, props.model.retention, setLimits);
  const [review, setReview] = useState<{
    origin: AnalyticsExtension;
    candidate: AnalyticsExtension;
    reason: 'retention' | 'delete';
  }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = props.busy || saving;
  const removed = review
    ? review.origin.results.filter(
        (run) => !review.candidate.results.some((retained) => retained.id === run.id),
      )
    : [];
  const reviewRetention = () => {
    try {
      revision.assertCurrent();
      setError('');
      setReview({
        origin: props.model,
        candidate: retainAnalyticsResults(props.model, limits),
        reason: 'retention',
      });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const confirm = async () => {
    if (!review || busy || review.origin !== props.model) return;
    try {
      if (review.reason === 'retention') revision.assertCurrent();
      setSaving(true);
      await props.save(review.candidate);
      if (review.reason === 'retention') setLimits(review.candidate.retention);
      setReview(undefined);
      setError('');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="analytics-panel" aria-labelledby="analytics-retention-heading">
      <h2 id="analytics-retention-heading">Archived runs and retention</h2>
      <p className="analytics-note">
        Saved results include immutable input snapshots. Retention is bounded to{' '}
        {props.model.retention.results} results and {props.model.retention.dataVersions} distinct
        dataset-version sets. Eviction or deletion removes the retained result and its input
        snapshot together. Native document export includes these retained results; full backup
        includes the complete encrypted workspace.
      </p>
      <DefinitionRevisionNotice revision={revision} label="retention limits" />
      <div className="analytics-fields">
        <label>
          Maximum retained results
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            disabled={busy}
            value={limits.results}
            onChange={(event) => setLimits({ ...limits, results: Number(event.target.value) })}
          />
        </label>
        <label>
          Maximum retained data versions
          <input
            type="number"
            min={1}
            max={3}
            step={1}
            disabled={busy}
            value={limits.dataVersions}
            onChange={(event) => setLimits({ ...limits, dataVersions: Number(event.target.value) })}
          />
        </label>
      </div>
      <div className="analytics-actions">
        <button disabled={busy || revision.blocked} onClick={reviewRetention}>
          Review retention changes
        </button>
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      <div className="analytics-table-scroll" style={{ marginTop: 16 }}>
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Created</th>
              <th>Data versions</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {props.model.results.map((result) => (
              <tr key={result.id}>
                <td>{result.content.kind}</td>
                <td>
                  <UtcTimestamp value={result.createdAt} />
                </td>
                <td>
                  {Object.entries(result.dataVersions)
                    .map(
                      ([id, version]) =>
                        `${props.model.datasets.find((dataset) => dataset.id === id)?.name ?? id}: ${version}`,
                    )
                    .join(' · ')}
                </td>
                <td>{result.stale ? 'Stale — original snapshot retained' : 'Current'}</td>
                <td>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setReview({
                        origin: props.model,
                        candidate: retainAnalyticsResults({
                          ...props.model,
                          results: props.model.results.filter((run) => run.id !== result.id),
                        }),
                        reason: 'delete',
                      });
                    }}
                  >
                    Delete saved run and inputs
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {review && (
        <Modal
          title="Review saved-run removal"
          className="analytics-import"
          close={() => setReview(undefined)}
          dismissible={!saving}
        >
          <p>
            {review.reason === 'retention'
              ? `Keep up to ${review.candidate.retention.results} runs and ${review.candidate.retention.dataVersions} distinct data-version sets.`
              : 'Delete the selected saved result and its attached input snapshot.'}
          </p>
          <p>
            {removed.length} saved run{removed.length === 1 ? '' : 's'} will be removed.
          </p>
          {removed.length > 0 && (
            <>
              <ul>
                {removed.map((run) => (
                  <li key={run.id}>
                    {run.content.kind} · {run.id} ·{' '}
                    {Object.entries(run.dataVersions)
                      .map(([id, version]) => `${id}: v${version}`)
                      .join(', ')}
                  </li>
                ))}
              </ul>
              <p className="analytics-note">
                Removing a run also removes its retained input snapshot and clears measurement links
                to that result. Historical inputs may no longer be reproducible after removal.
                Export a document or backup first if you need them. Deletion does not revoke
                previously exported copies or backups.
              </p>
            </>
          )}
          {review.origin !== props.model && (
            <p role="alert" className="analytics-note analytics-error">
              The analysis changed after this review. Cancel and review the current saved runs
              again.
            </p>
          )}
          {error && (
            <p role="alert" className="analytics-note analytics-error">
              {error}
            </p>
          )}
          <div className="analytics-actions">
            <button disabled={saving} onClick={() => setReview(undefined)}>
              Cancel
            </button>
            <button
              className={removed.length ? 'danger' : 'primary'}
              disabled={
                busy ||
                review.origin !== props.model ||
                (review.reason === 'retention' && revision.blocked)
              }
              onClick={() => void confirm()}
            >
              {saving
                ? 'Saving…'
                : removed.length
                  ? 'Remove saved runs and confirm'
                  : 'Confirm retention'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
