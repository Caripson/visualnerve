import { useEffect, useMemo, useState } from 'react';
import { utf8Bytes } from '../imports/limits';
import { ImportSizeNotice } from './ImportSizeNotice';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Properties';
import { defaultAnalysis, getCsvAnalysis, getCsvNode } from '../data/csv';
import { analyzeCsv, previewCsvRows, profileCsvAsync } from '../data/client';
import {
  filterOperations,
  metricOperations,
  type CsvAnalysis,
  type CsvDataset,
  type CsvFilter,
  type CsvMetric,
  type MetricOperation,
} from '../data/types';
import type { Graph } from '../model/types';
import './csv-import.css';

const operations: Record<MetricOperation, string> = {
  count: 'Row count',
  sum: 'Sum',
  avg: 'Average',
  median: 'Median',
  min: 'Minimum',
  max: 'Maximum',
  distinct: 'Distinct count',
};
const filters: Record<CsvFilter['operation'], string> = {
  equals: 'Equals',
  notEquals: 'Does not equal',
  startsWith: 'Starts with',
  contains: 'Contains',
  gt: 'Greater than',
  gte: 'At least',
  lt: 'Less than',
  lte: 'At most',
  empty: 'Is empty',
  notEmpty: 'Is not empty',
};
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);

export function CsvImportDialog({
  dataset,
  previous,
  initialAnalysis,
  close,
  apply,
  legacyImport,
}: {
  dataset: CsvDataset;
  previous?: Graph;
  initialAnalysis?: CsvAnalysis;
  close: () => void;
  apply: (analysis: CsvAnalysis, name: string) => Promise<void>;
  legacyImport?: () => Promise<void>;
}) {
  const [name, setName] = useState(previous?.diagram.name ?? dataset.name);
  const sourceBytes = useMemo(() => {
    let bytes = dataset.columns.reduce((sum, column) => sum + utf8Bytes(column.label), 0);
    for (const row of dataset.rows) for (const cell of row) bytes += utf8Bytes(cell);
    return bytes;
  }, [dataset]);
  const [analysis, setAnalysis] = useState<CsvAnalysis>(
    () => initialAnalysis || (previous && getCsvAnalysis(previous)) || defaultAnalysis(dataset),
  );
  const [preview, setPreview] = useState<Graph | null>(null);
  const [samples, setSamples] = useState<{
    rows: string[][];
    originalRows: string[][];
    total: number;
  } | null>(null);
  const [profiles, setProfiles] = useState<
    { columnId: string; numericCount: number; missingCount: number; invalidCount: number }[]
  >([]);
  const [original, setOriginal] = useState(false);
  const [working, setWorking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<CsvAnalysis>) => setAnalysis((value) => ({ ...value, ...patch }));
  const changeView = (patch: Partial<CsvAnalysis>) =>
    setAnalysis((current) => {
      const next = { ...current, ...patch, offset: 0 };
      if (
        next.sortBy !== 'count' &&
        next.sortBy !== 'label' &&
        !next.metrics.some((entry) => entry.id === next.sortBy && entry.operation !== 'count')
      )
        next.sortBy = 'count';
      if (patch.columnRules) next.focusPath = [];
      return next;
    });
  const columnOptions = dataset.columns.map((column) => (
    <option key={column.id} value={column.id}>
      {column.label}
    </option>
  ));

  useEffect(() => {
    let active = true;
    setWorking(true);
    setError('');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const graph = await analyzeCsv(dataset, analysis, previous);
          if (!active) return;
          setPreview(graph);
          const sample = await previewCsvRows(dataset, analysis, analysis.focusPath, 5);
          if (active) setSamples(sample);
        } catch (error) {
          if (active && (error as Error).name !== 'AbortError') {
            setError((error as Error).message);
            setPreview(null);
            setSamples(null);
          }
        } finally {
          if (active) setWorking(false);
        }
      })();
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dataset, analysis, previous]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void profileCsvAsync(dataset, analysis.decimalSeparator, analysis)
        .then((profile) => {
          if (active) setProfiles(profile);
        })
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dataset, analysis.columnRules, analysis.decimalSeparator]);

  const root = preview?.nodes.find((node) => {
    const csv = getCsvNode(node);
    return csv && csv.visible !== false && !node.parentId;
  });
  const summary = root && getCsvNode(root);
  const visibleNodes =
    preview?.nodes.filter((node) => getCsvNode(node)?.visible !== false && getCsvNode(node))
      .length ?? 0;
  const metric = (id: string, patch: Partial<CsvMetric>) =>
    changeView({
      metrics: analysis.metrics.map((value) => (value.id === id ? { ...value, ...patch } : value)),
    });
  const run = async (legacy = false) => {
    setBusy(true);
    try {
      if (legacy && legacyImport) await legacyImport();
      else await apply(analysis, name.trim());
      close();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={previous ? 'Explore CSV data' : 'Import CSV data'}
      close={close}
      wide
      dismissible={!busy}
    >
      <form
        className="csv-import"
        inert={busy}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <p className="muted">
          {dataset.fileName} · {number(dataset.rows.length)} rows · {dataset.columns.length}{' '}
          columns. Saved in this browser when you apply.
        </p>
        <ImportSizeNotice bytes={sourceBytes} />
        <Field title="Diagram name">
          <input
            aria-label="CSV diagram name"
            value={name}
            required
            maxLength={500}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {analysis.focusPath.length > 0 && (
          <div className="csv-focus-note">
            <span>
              Exploring:{' '}
              {analysis.focusPath
                .map(
                  (part) =>
                    `${dataset.columns.find((column) => column.id === part.columnId)?.label}: ${part.value || '(Empty)'}`,
                )
                .join(' / ')}
            </span>
            <button type="button" onClick={() => changeView({ focusPath: [] })}>
              All data
            </button>
          </div>
        )}

        <fieldset>
          <legend>1. Clean columns</legend>
          <p className="muted">
            Original cells are kept. Cleanup is applied before filtering, grouping and calculations.
          </p>
          {analysis.columnRules.map((rule, index) => (
            <div className="csv-rule" key={index}>
              <div className="csv-control-row">
                <select
                  aria-label={`Cleanup column ${index + 1}`}
                  value={rule.columnId}
                  onChange={(event) =>
                    changeView({
                      columnRules: analysis.columnRules.map((entry, i) =>
                        i === index ? { ...entry, columnId: event.target.value } : entry,
                      ),
                    })
                  }
                >
                  {columnOptions}
                </select>
                <select
                  aria-label={`Number format ${index + 1}`}
                  value={rule.numberFormat ?? 'auto'}
                  onChange={(event) =>
                    changeView({
                      columnRules: analysis.columnRules.map((entry, i) =>
                        i === index
                          ? {
                              ...entry,
                              numberFormat: event.target.value as 'auto' | 'dot' | 'comma',
                            }
                          : entry,
                      ),
                    })
                  }
                >
                  <option value="auto">Number format: Auto</option>
                  <option value="dot">Decimal dot (1,234.56)</option>
                  <option value="comma">Decimal comma (1.234,56)</option>
                </select>
                <button
                  type="button"
                  aria-label={`Remove cleanup ${index + 1}`}
                  onClick={() =>
                    changeView({ columnRules: analysis.columnRules.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="csv-control-row">
                <input
                  aria-label={`Cleanup regex ${index + 1}`}
                  placeholder="Regex, e.g. ^\s*\d+\s*[-–—]\s*"
                  value={rule.pattern ?? ''}
                  onChange={(event) =>
                    changeView({
                      columnRules: analysis.columnRules.map((entry, i) =>
                        i === index ? { ...entry, pattern: event.target.value } : entry,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Cleanup replacement ${index + 1}`}
                  placeholder="Replace with (blank removes matches)"
                  value={rule.replacement ?? ''}
                  onChange={(event) =>
                    changeView({
                      columnRules: analysis.columnRules.map((entry, i) =>
                        i === index ? { ...entry, replacement: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </div>
              <label className="csv-check">
                <input
                  type="checkbox"
                  checked={rule.trim !== false}
                  onChange={(event) =>
                    changeView({
                      columnRules: analysis.columnRules.map((entry, i) =>
                        i === index ? { ...entry, trim: event.target.checked } : entry,
                      ),
                    })
                  }
                />
                Trim spaces
              </label>
            </div>
          ))}
          <button
            type="button"
            disabled={analysis.columnRules.length >= dataset.columns.length}
            onClick={() => {
              const column = dataset.columns.find(
                (entry) => !analysis.columnRules.some((rule) => rule.columnId === entry.id),
              );
              if (column)
                changeView({
                  columnRules: [
                    ...analysis.columnRules,
                    {
                      columnId: column.id,
                      trim: true,
                      pattern: '',
                      replacement: '',
                      flags: 'g',
                      numberFormat: 'auto',
                    },
                  ],
                });
            }}
          >
            <Plus size={14} />
            Add column cleanup
          </button>
          <p className="muted">
            Auto accepts unambiguous formats. For values such as 1,234, choose a decimal format
            explicitly.
          </p>
        </fieldset>

        <fieldset>
          <legend>2. Filter rows</legend>
          <p className="muted">All conditions must match. For example, Company starts with AAA.</p>
          {analysis.filters.map((filter, index) => (
            <div className="csv-control-row" key={filter.id}>
              <select
                aria-label={`Filter column ${index + 1}`}
                value={filter.columnId}
                onChange={(event) =>
                  changeView({
                    filters: analysis.filters.map((entry) =>
                      entry.id === filter.id ? { ...entry, columnId: event.target.value } : entry,
                    ),
                  })
                }
              >
                {columnOptions}
              </select>
              <select
                aria-label={`Filter operator ${index + 1}`}
                value={filter.operation}
                onChange={(event) =>
                  changeView({
                    filters: analysis.filters.map((entry) =>
                      entry.id === filter.id
                        ? { ...entry, operation: event.target.value as CsvFilter['operation'] }
                        : entry,
                    ),
                  })
                }
              >
                {filterOperations.map((operation) => (
                  <option key={operation} value={operation}>
                    {filters[operation]}
                  </option>
                ))}
              </select>
              {!['empty', 'notEmpty'].includes(filter.operation) && (
                <input
                  aria-label={`Filter value ${index + 1}`}
                  placeholder="AAA"
                  value={filter.value}
                  onChange={(event) =>
                    changeView({
                      filters: analysis.filters.map((entry) =>
                        entry.id === filter.id ? { ...entry, value: event.target.value } : entry,
                      ),
                    })
                  }
                />
              )}
              <button
                type="button"
                aria-label={`Remove filter ${index + 1}`}
                onClick={() =>
                  changeView({
                    filters: analysis.filters.filter((entry) => entry.id !== filter.id),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={analysis.filters.length >= 12}
            onClick={() =>
              changeView({
                filters: [
                  ...analysis.filters,
                  {
                    id: crypto.randomUUID(),
                    columnId: dataset.columns[0].id,
                    operation: 'startsWith',
                    value: '',
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            Add filter
          </button>
        </fieldset>

        <fieldset>
          <legend>3. Group into a diagram</legend>
          <p className="muted">
            Choose columns in order. Each level becomes connected objects in the diagram.
          </p>
          {analysis.levels.map((level, index) => (
            <div className="csv-control-row" key={index}>
              <span className="csv-level-number">{index + 1}</span>
              <select
                aria-label={`Grouping level ${index + 1}`}
                value={level}
                onChange={(event) =>
                  changeView({
                    levels: analysis.levels.map((entry, i) =>
                      i === index ? event.target.value : entry,
                    ),
                    focusPath: [],
                  })
                }
              >
                {dataset.columns
                  .filter((column) => column.id === level || !analysis.levels.includes(column.id))
                  .map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                aria-label={`Move grouping level ${index + 1} up`}
                disabled={index === 0}
                onClick={() => {
                  const levels = [...analysis.levels];
                  [levels[index - 1], levels[index]] = [levels[index], levels[index - 1]];
                  changeView({ levels, focusPath: [] });
                }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                aria-label={`Move grouping level ${index + 1} down`}
                disabled={index === analysis.levels.length - 1}
                onClick={() => {
                  const levels = [...analysis.levels];
                  [levels[index + 1], levels[index]] = [levels[index], levels[index + 1]];
                  changeView({ levels, focusPath: [] });
                }}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label={`Remove grouping level ${index + 1}`}
                onClick={() =>
                  changeView({
                    levels: analysis.levels.filter((_, i) => i !== index),
                    focusPath: [],
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={analysis.levels.length >= Math.min(6, dataset.columns.length)}
            onClick={() => {
              const column = dataset.columns.find((entry) => !analysis.levels.includes(entry.id));
              if (column) changeView({ levels: [...analysis.levels, column.id], focusPath: [] });
            }}
          >
            <Plus size={14} />
            Add grouping level
          </button>
        </fieldset>

        <fieldset>
          <legend>4. Show measures</legend>
          {analysis.metrics.map((entry, index) => (
            <div className="csv-control-row" key={entry.id}>
              <select
                aria-label={`Measure ${index + 1}`}
                value={entry.operation}
                onChange={(event) => {
                  const operation = event.target.value as MetricOperation;
                  metric(entry.id, {
                    operation,
                    columnId:
                      operation === 'count' ? undefined : (entry.columnId ?? dataset.columns[0].id),
                  });
                }}
              >
                {metricOperations.map((operation) => (
                  <option value={operation} key={operation}>
                    {operations[operation]}
                  </option>
                ))}
              </select>
              {entry.operation !== 'count' && (
                <select
                  aria-label={`Measure column ${index + 1}`}
                  value={entry.columnId}
                  onChange={(event) => metric(entry.id, { columnId: event.target.value })}
                >
                  {columnOptions}
                </select>
              )}
              <button
                type="button"
                aria-label={`Remove measure ${index + 1}`}
                onClick={() =>
                  changeView({ metrics: analysis.metrics.filter((value) => value.id !== entry.id) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={analysis.metrics.length >= 8}
            onClick={() => {
              const column =
                profiles.find((entry) => entry.numericCount > 0)?.columnId ?? dataset.columns[0].id;
              const operation = !analysis.metrics.some((entry) => entry.operation === 'count')
                ? 'count'
                : 'sum';
              changeView({
                metrics: [
                  ...analysis.metrics,
                  {
                    id: crypto.randomUUID(),
                    operation,
                    ...(operation === 'count' ? {} : { columnId: column }),
                  },
                ],
              });
            }}
          >
            <Plus size={14} />
            Add measure
          </button>
          <p className="muted">
            Empty and invalid numbers are excluded from numeric measures, not treated as zero. Row
            count includes every matching row.
          </p>
        </fieldset>

        <fieldset>
          <legend>5. Keep the diagram readable</legend>
          <div className="csv-control-row">
            <Field title="Groups per level">
              <select
                aria-label="Groups per level"
                value={analysis.limit}
                onChange={(event) => changeView({ limit: Number(event.target.value) })}
              >
                {[20, 50, 100, 200].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Sort groups by">
              <select
                aria-label="Sort groups by"
                value={analysis.sortBy}
                onChange={(event) => changeView({ sortBy: event.target.value })}
              >
                <option value="count">Row count</option>
                <option value="label">Name</option>
                {analysis.metrics
                  .filter((entry) => entry.operation !== 'count')
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {operations[entry.operation]} ·{' '}
                      {dataset.columns.find((column) => column.id === entry.columnId)?.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field title="Order">
              <select
                aria-label="Group sort order"
                value={analysis.sortDirection}
                onChange={(event) =>
                  changeView({ sortDirection: event.target.value as 'asc' | 'desc' })
                }
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </Field>
          </div>
        </fieldset>

        <section
          className="csv-analysis-preview"
          aria-label="CSV analysis preview"
          aria-busy={working}
        >
          <h3>Preview</h3>
          {working && <p role="status">Analyzing in the background…</p>}
          {!working && summary && (
            <>
              <p>
                <b>{number(summary.rowCount)}</b> matching rows · {number(visibleNodes)} diagram
                objects.
              </p>
              {summary.hiddenChildren > 0 && (
                <p>
                  {number(summary.totalChildren - summary.hiddenChildren)} of{' '}
                  {number(summary.totalChildren)} top-level groups shown. Measures use all matching
                  rows.
                </p>
              )}
              <dl className="csv-preview-measures">
                {summary.measures.map((entry) => (
                  <div key={entry.id}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value === null ? '—' : number(entry.value)}</dd>
                    {entry.invalidCount + entry.missingCount > 0 && (
                      <small>
                        {number(entry.missingCount)} empty · {number(entry.invalidCount)} invalid
                      </small>
                    )}
                  </div>
                ))}
              </dl>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {samples && (
            <details open>
              <summary>First {samples.rows.length} matching rows · before / after cleanup</summary>
              <label className="csv-check">
                <input
                  type="checkbox"
                  checked={original}
                  onChange={(event) => setOriginal(event.target.checked)}
                />
                Original values
              </label>
              <div className="csv-import-table">
                <table>
                  <thead>
                    <tr>
                      {dataset.columns.map((column) => (
                        <th key={column.id}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(original ? samples.originalRows : samples.rows).map((row, index) => (
                      <tr key={index}>
                        {row.map((value, column) => (
                          <td key={column}>{value || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
        {legacyImport && dataset.columns.some((column) => column.label === 'title') && (
          <button
            type="button"
            className="csv-legacy-import"
            disabled={busy}
            onClick={() => void run(true)}
          >
            Import as existing diagram rows instead
          </button>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || working || !!error || !preview || !name.trim()}
          >
            {busy ? 'Applying…' : previous ? 'Apply data view' : 'Create data diagram'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
