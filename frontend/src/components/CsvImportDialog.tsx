import { filterOperationLabel, metricOperationLabel } from './data-ui-text';
import { TranslatedText } from './TranslatedText';
import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { utf8Bytes } from '../imports/limits';
import { ImportSizeNotice } from './ImportSizeNotice';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { defaultAnalysis, getCsvAnalysis, getCsvNode } from '../data/csv';
import { analyzeCsv, previewCsvRows, profileCsvAsync } from '../data/client';
import {
  filterOperations,
  metricOperations,
  type CsvAnalysis,
  type CsvDataset,
  type CsvFilter,
  type MetricOperation,
  type CsvMetric,
} from '../data/types';
import type { Graph } from '../model/types';
import './csv-import.css';

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
  const { t, number: formatNumber } = useI18n();
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 4 });
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
      title={previous ? t('data.csv.exploreTitle') : t('data.csv.importTitle')}
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
          {t('data.csv.importSummary', {
            fileName: dataset.fileName,
            rows: number(dataset.rows.length),
            columns: dataset.columns.length,
          })}
        </p>
        <ImportSizeNotice bytes={sourceBytes} />
        <Field title={t('data.csv.nameLabel')}>
          <input
            aria-label={t('data.csv.nameAccessible')}
            value={name}
            required
            maxLength={500}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {analysis.focusPath.length > 0 && (
          <div className="csv-focus-note">
            <span>
              {t('data.csv.focusSummary', {
                path: analysis.focusPath
                  .map(
                    (part) =>
                      `${dataset.columns.find((column) => column.id === part.columnId)?.label}: ${part.value || '(Empty)'}`,
                  )
                  .join(' / '),
              })}
            </span>
            <button type="button" onClick={() => changeView({ focusPath: [] })}>
              {t('data.csv.allData')}
            </button>
          </div>
        )}

        <fieldset>
          <legend>{t('data.csv.cleanTitle')}</legend>
          <p className="muted">{t('data.csv.cleanupOrder')}</p>
          {analysis.columnRules.map((rule, index) => (
            <div className="csv-rule" key={index}>
              <div className="csv-control-row">
                <select
                  aria-label={t('data.csv.controls.cleanupColumn', { index: index + 1 })}
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
                  aria-label={t('data.csv.controls.numberFormat', { index: index + 1 })}
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
                  <option value="auto">{t('data.csv.numberFormatAuto')}</option>
                  <option value="dot">{t('data.csv.numberFormatDot')}</option>
                  <option value="comma">{t('data.csv.numberFormatComma')}</option>
                </select>
                <button
                  type="button"
                  aria-label={t('data.csv.controls.removeCleanup', { index: index + 1 })}
                  onClick={() =>
                    changeView({ columnRules: analysis.columnRules.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="csv-control-row">
                <input
                  aria-label={t('data.csv.controls.cleanupRegex', { index: index + 1 })}
                  placeholder={t('data.csv.regexPlaceholder', {
                    example: '^\\s*\\d+\\s*[-–—]\\s*',
                  })}
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
                  aria-label={t('data.csv.controls.cleanupReplacement', { index: index + 1 })}
                  placeholder={t('data.csv.replacementHint')}
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
                {t('data.csv.trim')}
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
            {t('data.csv.addCleanup')}
          </button>
          <p className="muted">{t('data.csv.autoNumberHint')}</p>
        </fieldset>

        <fieldset>
          <legend>{t('data.csv.filterTitle')}</legend>
          <p className="muted">{t('data.csv.allFiltersMustMatch')}</p>
          {analysis.filters.map((filter, index) => (
            <div className="csv-control-row" key={filter.id}>
              <select
                aria-label={t('data.csv.controls.filterColumn', { index: index + 1 })}
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
                aria-label={t('data.csv.controls.filterOperator', { index: index + 1 })}
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
                    {filterOperationLabel(operation, t)}
                  </option>
                ))}
              </select>
              {!['empty', 'notEmpty'].includes(filter.operation) && (
                <input
                  aria-label={t('data.csv.controls.filterValue', { index: index + 1 })}
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
                aria-label={t('data.csv.controls.removeFilter', { index: index + 1 })}
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
            {t('data.csv.addFilter')}
          </button>
        </fieldset>

        <fieldset>
          <legend>{t('data.csv.groupTitle')}</legend>
          <p className="muted">{t('data.csv.groupingExplanation')}</p>
          {analysis.levels.map((level, index) => (
            <div className="csv-control-row" key={index}>
              <span className="csv-level-number">{index + 1}</span>
              <select
                aria-label={t('data.csv.controls.groupingLevel', { index: index + 1 })}
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
                aria-label={t('data.csv.controls.moveLevelUp', { index: index + 1 })}
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
                aria-label={t('data.csv.controls.moveLevelDown', { index: index + 1 })}
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
                aria-label={t('data.csv.controls.removeLevel', { index: index + 1 })}
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
            {t('data.csv.addLevel')}
          </button>
        </fieldset>

        <fieldset>
          <legend>{t('data.csv.measuresTitle')}</legend>
          {analysis.metrics.map((entry, index) => (
            <div className="csv-control-row" key={entry.id}>
              <select
                aria-label={t('data.csv.controls.measure', { index: index + 1 })}
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
                    {metricOperationLabel(operation, t)}
                  </option>
                ))}
              </select>
              {entry.operation !== 'count' && (
                <select
                  aria-label={t('data.csv.controls.measureColumn', { index: index + 1 })}
                  value={entry.columnId}
                  onChange={(event) => metric(entry.id, { columnId: event.target.value })}
                >
                  {columnOptions}
                </select>
              )}
              <button
                type="button"
                aria-label={t('data.csv.controls.removeMeasure', { index: index + 1 })}
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
            {t('data.csv.addMeasure')}
          </button>
          <p className="muted">{t('data.csv.numericExclusions')}</p>
        </fieldset>

        <fieldset>
          <legend>{t('data.csv.readabilityTitle')}</legend>
          <div className="csv-control-row">
            <Field title={t('data.csv.groupsPerLevel')}>
              <select
                aria-label={t('data.csv.groupsPerLevel')}
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
            <Field title={t('data.csv.sortBy')}>
              <select
                aria-label={t('data.csv.sortBy')}
                value={analysis.sortBy}
                onChange={(event) => changeView({ sortBy: event.target.value })}
              >
                <option value="count">{t('data.measure.count')}</option>
                <option value="label">{t('data.csv.sortName')}</option>
                {analysis.metrics
                  .filter((entry) => entry.operation !== 'count')
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {metricOperationLabel(entry.operation, t)} ·{' '}
                      {dataset.columns.find((column) => column.id === entry.columnId)?.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field title={t('data.csv.order')}>
              <select
                aria-label={t('data.csv.sortOrderAccessible')}
                value={analysis.sortDirection}
                onChange={(event) =>
                  changeView({ sortDirection: event.target.value as 'asc' | 'desc' })
                }
              >
                <option value="desc">{t('data.csv.descending')}</option>
                <option value="asc">{t('data.csv.ascending')}</option>
              </select>
            </Field>
          </div>
        </fieldset>

        <section
          className="csv-analysis-preview"
          aria-label={t('data.csv.previewRegion')}
          aria-busy={working}
        >
          <h3>{t('data.csv.previewTitle')}</h3>
          {working && <p role="status">{t('data.csv.analyzing')}</p>}
          {!working && summary && (
            <>
              <p>
                <TranslatedText
                  messageId="data.csv.previewCounts"
                  parameters={{ objects: number(visibleNodes) }}
                  slots={{ rows: <b>{number(summary.rowCount)}</b> }}
                />
              </p>
              {summary.hiddenChildren > 0 && (
                <p>
                  {t('data.csv.shownGroups', {
                    shown: number(summary.totalChildren - summary.hiddenChildren),
                    total: number(summary.totalChildren),
                  })}
                </p>
              )}
              <dl className="csv-preview-measures">
                {summary.measures.map((entry) => (
                  <div key={entry.id}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value === null ? '—' : number(entry.value)}</dd>
                    {entry.invalidCount + entry.missingCount > 0 && (
                      <small>
                        {t('data.csv.invalidCounts', {
                          empty: number(entry.missingCount),
                          invalid: number(entry.invalidCount),
                        })}
                      </small>
                    )}
                  </div>
                ))}
              </dl>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {localizedFeedback(error, t)}
            </p>
          )}
          {samples && (
            <details open>
              <summary>{t('data.csv.sampleRows', { count: samples.rows.length })}</summary>
              <label className="csv-check">
                <input
                  type="checkbox"
                  checked={original}
                  onChange={(event) => setOriginal(event.target.checked)}
                />
                {t('data.csv.originalValues')}
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
            {t('data.csv.legacyRowsImport')}
          </button>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={close}>
            {t('data.action.cancel')}
          </button>
          <button
            className="primary"
            disabled={busy || working || !!error || !preview || !name.trim()}
          >
            {busy
              ? t('data.csv.applying')
              : previous
                ? t('data.csv.applyView')
                : t('data.csv.createDiagram')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
