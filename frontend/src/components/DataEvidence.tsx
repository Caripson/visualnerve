import { evidenceDispositionLabel } from './data-ui-text';
import { useI18n } from '../i18n';
import { useState } from 'react';
import type { CsvDataset } from '../data/types';
import type { EvidencePage } from '../data/quality';
import type { Graph } from '../model/types';
import { graphDatasets, analysisForDataset } from '../data/model';
import './data-inspection.css';

export function RelatedDataScope({ graph }: { graph?: Graph }) {
  const { t } = useI18n();
  const focus = graph?.diagram.settings.csvEntityFocus;
  if (!graph || !focus) return null;
  const sources = graphDatasets(graph);
  return (
    <details>
      <summary>{t('data.evidence.relatedScopeTitle')}</summary>
      <p>
        {t('data.evidence.relatedRowsScope', {
          source: sources.find((source) => source.id === focus.datasetId)?.name ?? '',
          path: focus.path
            .map(
              (entry) =>
                `${sources.find((source) => source.id === focus.datasetId)?.columns.find((column) => column.id === entry.columnId)?.label}: ${entry.value}`,
            )
            .join(' → '),
        })}
      </p>
      <ul>
        {sources.flatMap((source) =>
          (analysisForDataset(graph, source.id)?.filters ?? []).map((filter) => (
            <li key={`${source.id}:${filter.id}`}>
              {source.name}: {source.columns.find((column) => column.id === filter.columnId)?.label}{' '}
              {filter.operation} {filter.value}
            </li>
          )),
        )}
      </ul>
    </details>
  );
}

export function DataEvidence({
  dataset,
  page,
  onPage,
  highlight,
  originalValues,
  onOriginalChange,
}: {
  dataset: CsvDataset;
  page: EvidencePage;
  onPage(offset: number): void;
  highlight?: string;
  originalValues?: boolean;
  onOriginalChange?: (value: boolean) => void;
}) {
  const { t, number } = useI18n();
  const [localOriginal, setLocalOriginal] = useState(false);
  const original = originalValues ?? localOriginal;
  return (
    <div className="data-evidence">
      <label className="check-field">
        <input
          type="checkbox"
          checked={original}
          onChange={(event) => (onOriginalChange ?? setLocalOriginal)(event.target.checked)}
        />
        {t('data.evidence.originalCells')}
      </label>
      <p className="muted">
        {t('data.evidence.rowRange', {
          first: page.total ? page.offset + 1 : 0,
          last: Math.min(page.offset + page.rows.length, page.total),
          total: number(page.total),
        })}
      </p>
      <div className="data-evidence-scroll" tabIndex={0} aria-label={t('data.evidence.scrollRows')}>
        <table aria-label={t('data.evidence.rowsAccessible')}>
          <thead>
            <tr>
              <th>{t('data.evidence.sourceRowLabel')}</th>
              {page.rows.some((row) => row.disposition) && (
                <th>{t('data.evidence.contributionLabel')}</th>
              )}
              {dataset.columns.map((column) => (
                <th key={column.id} className={column.id === highlight ? 'evidence-highlight' : ''}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.rowNumber}>
                <th scope="row">{row.rowNumber}</th>
                {row.disposition && (
                  <td>
                    {evidenceDispositionLabel(row.disposition, t)}
                    {row.numericValue !== undefined && row.numericValue !== null
                      ? ` (${row.numericValue})`
                      : ''}
                  </td>
                )}
                {(original ? row.original : row.cleaned).map((cell, index) => (
                  <td
                    key={dataset.columns[index].id}
                    className={dataset.columns[index].id === highlight ? 'evidence-highlight' : ''}
                  >
                    {cell || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-inspection-actions">
        <button disabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - 100))}>
          {t('data.evidence.previousRows')}
        </button>
        <button
          disabled={page.offset + page.rows.length >= page.total}
          onClick={() => onPage(page.offset + 100)}
        >
          {t('data.evidence.nextRows')}
        </button>
      </div>
    </div>
  );
}
