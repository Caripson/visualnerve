import type { ImportPreview } from '../types';
import { downloadText } from './display';

export function ImportValidationReport({
  preview,
  busy,
  committing,
  onCommit,
  onReview,
}: {
  preview: ImportPreview;
  busy: boolean;
  committing: boolean;
  onCommit: () => Promise<void>;
  onReview: () => void;
}) {
  return (
    <section
      aria-label="Import validation report"
      className="analytics-panel"
      style={{ marginTop: 20 }}
    >
      <h3>Validation report</h3>
      <p>
        {preview.dataset.observations.length.toLocaleString('en')} observations ·{' '}
        {preview.series.length} series · {preview.skippedRows} skipped rows.
      </p>
      {preview.issues.length > 100 && (
        <p className="muted">
          Showing the first 100 of {preview.issues.length.toLocaleString('en-US')} issues. Download
          the full report to inspect every reported row and column.
        </p>
      )}
      <button
        onClick={() =>
          downloadText(
            JSON.stringify(
              {
                observations: preview.dataset.observations.length,
                series: preview.series.length,
                skippedRows: preview.skippedRows,
                issues: preview.issues,
                transformations: preview.dataset.transformations,
              },
              null,
              2,
            ),
            'visual-nerve-import-validation.json',
          )
        }
      >
        Download validation report
      </button>
      {preview.issues.length ? (
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Row</th>
                <th>Column</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {preview.issues.slice(0, 100).map((issue, index) => (
                <tr key={index}>
                  <td>{issue.severity}</td>
                  <td>{issue.row ?? '—'}</td>
                  <td>{issue.column ?? '—'}</td>
                  <td className="analytics-wrap">
                    {issue.code}: {issue.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="analytics-success">No validation issues.</p>
      )}
      <details>
        <summary>Recorded transformations</summary>
        <ol>
          {preview.dataset.transformations.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </details>
      <div className="analytics-actions">
        <button
          className="primary"
          disabled={!preview.valid || busy || committing}
          onClick={() => void onCommit()}
        >
          {committing ? 'Saving…' : 'Confirm and commit import'}
        </button>
        <button disabled={committing} onClick={onReview}>
          Review mapping
        </button>
      </div>
      <p className="muted">Nothing is saved until you confirm this preview.</p>
    </section>
  );
}
