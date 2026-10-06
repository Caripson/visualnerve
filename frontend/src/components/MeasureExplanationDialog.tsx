import { useEffect, useMemo, useState } from 'react';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from '../data/types';
import type { Graph } from '../model/types';
import type { MeasureExplanation } from '../data/quality';
import { QualityClient } from '../data/qualityClient';
import { formatCsvMeasure } from './MetricSummary';
import { Modal } from './Modal';
import { DataEvidence, RelatedDataScope } from './DataEvidence';

export function MeasureExplanationDialog({
  dataset,
  analysis,
  path,
  metricId,
  model,
  onClose,
}: {
  dataset: CsvDataset;
  analysis: CsvAnalysis;
  path: CsvPathEntry[];
  metricId: string;
  model?: Graph;
  onClose(): void;
}) {
  const client = useMemo(() => new QualityClient(), []);
  const [offset, setOffset] = useState(0);
  const [original, setOriginal] = useState(false);
  const [disposition, setDisposition] = useState<'all' | 'included' | 'excluded'>('all');
  const [result, setResult] = useState<MeasureExplanation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setResult(undefined);
    void client
      .request<MeasureExplanation>({
        operation: 'measure',
        model,
        dataset,
        analysis,
        path,
        metricId,
        offset,
        disposition,
      })
      .then((value) => {
        if (active) setResult(value);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, dataset, analysis, path, metricId, offset, disposition, model]);
  return (
    <Modal title="Explain measure" close={onClose} wide>
      <div className="data-inspection" aria-busy={busy}>
        <p className="muted">
          {dataset.fileName} ·{' '}
          {path
            .map(
              (entry) =>
                `${dataset.columns.find((column) => column.id === entry.columnId)?.label}: ${entry.value}`,
            )
            .join(' → ') || 'All matching rows'}
        </p>
        {busy && <p role="status">Tracing source rows…</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {result && (
          <>
            <RelatedDataScope graph={model} />
            <h3>
              {result.measure.label}: {formatCsvMeasure(result.measure.value)}
            </h3>
            <p>{result.rule}</p>
            <p>
              {result.matchingRows.toLocaleString()} matching rows ·{' '}
              {result.contributingRows.toLocaleString()} contributing ·{' '}
              {result.ignoredRows.toLocaleString()} excluded or repeated
            </p>
            <details>
              <summary>Filters and cleanup used</summary>
              <p className="muted">
                All these filters must match. Display limits do not limit the calculation.
              </p>
              <ul>
                {analysis.filters.map((filter) => (
                  <li key={filter.id}>
                    {dataset.columns.find((column) => column.id === filter.columnId)?.label}{' '}
                    {filter.operation} {filter.value} (
                    {filter.caseSensitive ? 'case sensitive' : 'ignores case'})
                  </li>
                ))}
                {!analysis.filters.length && <li>No row filters.</li>}
                {analysis.columnRules.map((rule) => (
                  <li key={rule.columnId}>
                    {dataset.columns.find((column) => column.id === rule.columnId)?.label}:{' '}
                    {rule.trim !== false ? 'trim whitespace; ' : ''}
                    {rule.pattern
                      ? `replace /${rule.pattern}/${rule.flags ?? ''} with ${JSON.stringify(rule.replacement ?? '')}; `
                      : ''}
                    numbers: {rule.numberFormat ?? 'auto (ambiguous values excluded)'}
                  </li>
                ))}
              </ul>
            </details>
            <label className="field">
              <span>Rows to inspect</span>
              <select
                aria-label="Measure evidence rows"
                value={disposition}
                onChange={(event) => {
                  setOffset(0);
                  setDisposition(event.target.value as typeof disposition);
                }}
              >
                <option value="all">All matching rows</option>
                <option value="included">Contributing rows</option>
                <option value="excluded">Excluded or repeated rows</option>
              </select>
            </label>
            <DataEvidence
              dataset={dataset}
              page={result}
              originalValues={original}
              onOriginalChange={setOriginal}
              onPage={setOffset}
              highlight={result.measure.columnId}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
