import { cleanupRuleText, measureRuleText } from './data-ui-text';
import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
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
  const { t, number } = useI18n();
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
    <Modal title={t('data.measureEvidence.title')} close={onClose} wide>
      <div className="data-inspection" aria-busy={busy}>
        <p className="muted">
          {dataset.fileName} ·{' '}
          {path
            .map(
              (entry) =>
                `${dataset.columns.find((column) => column.id === entry.columnId)?.label}: ${entry.value}`,
            )
            .join(' → ') || t('data.measureEvidence.allMatching')}
        </p>
        {busy && <p role="status">{t('data.measureEvidence.tracing')}</p>}
        {error && (
          <p role="alert" className="form-error">
            {localizedFeedback(error, t)}
          </p>
        )}
        {result && (
          <>
            <RelatedDataScope graph={model} />
            <h3>
              {result.measure.label}: {formatCsvMeasure(result.measure.value, number)}
            </h3>
            <p>{measureRuleText(result.measure.operation, result.rule, t)}</p>
            <p>
              {t('data.measureEvidence.counts', {
                matching: number(result.matchingRows),
                contributing: number(result.contributingRows),
                excluded: number(result.ignoredRows),
              })}
            </p>
            <details>
              <summary>{t('data.measureEvidence.rulesTitle')}</summary>
              <p className="muted">{t('data.measureEvidence.allFiltersRequired')}</p>
              <ul>
                {analysis.filters.map((filter) => (
                  <li key={filter.id}>
                    {t('data.measureEvidence.filterRow', {
                      column:
                        dataset.columns.find((column) => column.id === filter.columnId)?.label ??
                        '',
                      operation: filter.operation,
                      value: filter.value,
                      caseRule: t(
                        filter.caseSensitive
                          ? 'data.measureEvidence.caseSensitive'
                          : 'data.measureEvidence.ignoresCase',
                      ),
                    })}
                  </li>
                ))}
                {!analysis.filters.length && <li>{t('data.measureEvidence.noFilters')}</li>}
                {analysis.columnRules.map((rule) => (
                  <li key={rule.columnId}>
                    {cleanupRuleText(
                      rule,
                      dataset.columns.find((column) => column.id === rule.columnId)?.label ?? '',
                      t,
                    )}
                  </li>
                ))}
              </ul>
            </details>
            <label className="field">
              <span>{t('data.measureEvidence.rowsLabel')}</span>
              <select
                aria-label={t('data.measureEvidence.rowsAccessible')}
                value={disposition}
                onChange={(event) => {
                  setOffset(0);
                  setDisposition(event.target.value as typeof disposition);
                }}
              >
                <option value="all">{t('data.measureEvidence.allMatching')}</option>
                <option value="included">{t('data.measureEvidence.contributing')}</option>
                <option value="excluded">{t('data.measureEvidence.excluded')}</option>
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
