import { useState } from 'react';
import type { CsvDataset } from '../data/types';
import type { EvidencePage } from '../data/quality';
import type { Graph } from '../model/types';
import { graphDatasets, analysisForDataset } from '../data/model';
import './data-inspection.css';

export function RelatedDataScope({ graph }: { graph?: Graph }) {
  const focus = graph?.diagram.settings.csvEntityFocus;
  if (!graph || !focus) return null;
  const sources = graphDatasets(graph);
  return (
    <details>
      <summary>Related data scope</summary>
      <p>
        Connected rows are selected from{' '}
        {sources.find((source) => source.id === focus.datasetId)?.name}:{' '}
        {focus.path
          .map(
            (entry) =>
              `${sources.find((source) => source.id === focus.datasetId)?.columns.find((column) => column.id === entry.columnId)?.label}: ${entry.value}`,
          )
          .join(' → ')}
        . Each source row contributes once.
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
        Show original cells
      </label>
      <p className="muted">
        Rows {page.total ? page.offset + 1 : 0}–
        {Math.min(page.offset + page.rows.length, page.total)} of {page.total.toLocaleString()}.
        Source row numbers exclude the CSV header.
      </p>
      <div className="data-evidence-scroll" tabIndex={0} aria-label="Scroll evidence rows">
        <table aria-label="Evidence rows">
          <thead>
            <tr>
              <th>Source row</th>
              {page.rows.some((row) => row.disposition) && <th>Contribution</th>}
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
                    {row.disposition}
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
          Previous rows
        </button>
        <button
          disabled={page.offset + page.rows.length >= page.total}
          onClick={() => onPage(page.offset + 100)}
        >
          Next rows
        </button>
      </div>
    </div>
  );
}
