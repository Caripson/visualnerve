import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { ImportSizeNotice } from '../../components/ImportSizeNotice';
import { assertImportBytes } from '../../imports/limits';
import { currentImportLimitBytes } from '../../imports/preference';
import { analyticsService } from '../service';
import type {
  AnalyticsExtension,
  AnalyticsSeries,
  AnalyticsUnit,
  ImportMapping,
  ImportPreview,
  ImportSource,
} from '../types';
import type { AnalyticsImportMode } from '../document';
import { errorMessage, isCancelled } from './display';
import { ImportColumnFields, type ColumnConfiguration } from './ImportColumnFields';
import { ImportValidationReport } from './ImportValidationReport';
import './analytics.css';

interface Inspection {
  columns: string[];
  sample: Record<string, string | number | null>[];
  rows: number;
  sheets?: string[];
  seriesNames?: string[];
}
const initialMapping = (): ImportMapping => ({
  format: 'wide',
  timeColumn: '',
  dimensions: [],
  decimal: '.',
  percent: 'ratio',
  dateFormat: 'iso',
  timezone: 'UTC',
  resolution: 'month',
  duplicatePolicy: 'reject',
  invalidRows: 'reject',
  missingValues: 'preserve',
});

export function AnalyticsImportDialog({
  model,
  targetDatasetId,
  apply,
  close,
}: {
  model: AnalyticsExtension;
  targetDatasetId?: string;
  apply: (
    preview: ImportPreview,
    mode: AnalyticsImportMode,
    targetDatasetId?: string,
  ) => Promise<void>;
  close: () => void;
}) {
  const [source, setSource] = useState<ImportSource>();
  const [sourceBytes, setSourceBytes] = useState(0);
  const [inspection, setInspection] = useState<Inspection>();
  const [mapping, setMapping] = useState<ImportMapping>(initialMapping);
  const [columns, setColumns] = useState<Record<string, ColumnConfiguration>>({});
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<AnalyticsImportMode>(targetDatasetId ? 'update' : 'create');
  const [target, setTarget] = useState(targetDatasetId ?? model.datasets[0]?.id ?? '');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const datasetId = useRef(crypto.randomUUID());
  const longIds = useRef(new Map<string, string>());
  const fileRevision = useRef(0);
  const originModel = useRef(model);
  const previewModel = useRef<AnalyticsExtension | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (originModel.current === model) return;
    originModel.current = model;
    controller.current?.abort();
    previewModel.current = undefined;
    setPreview(undefined);
    setBusy(false);
  }, [model]);
  const patch = (update: Partial<ImportMapping>) => {
    if (busy || committing) return;
    setMapping({ ...mapping, ...update });
    setPreview(undefined);
  };
  const inspect = async (nextSource: ImportSource, bytes: number) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setProgress(0);
    setPreview(undefined);
    try {
      const result = await analyticsService.run(
        { kind: 'inspect-import', source: nextSource, byteLimit: currentImportLimitBytes() },
        {
          signal: active.signal,
          progress: (completed, total) => {
            if (mounted.current && !active.signal.aborted)
              setProgress(total ? completed / total : 0);
          },
        },
      );
      if (!mounted.current || active.signal.aborted) return;
      if (!('columns' in result) || !('sample' in result))
        throw new Error('The file could not be inspected.');
      const inspected = result as Inspection;
      setSource(nextSource);
      setSourceBytes(bytes);
      setInspection(inspected);
      setMapping(initialMapping());
      setColumns(
        Object.fromEntries(
          inspected.columns.map((column) => [
            column,
            {
              selected: false,
              id: crypto.randomUUID(),
              name: column,
              unit: { kind: 'number', label: 'units' },
              semantics: 'snapshot',
              aggregation: 'last',
              direction: 'neutral',
            },
          ]),
        ),
      );
    } catch (error) {
      if (mounted.current && !isCancelled(error)) setError(errorMessage(error));
    } finally {
      if (mounted.current && controller.current === active) setBusy(false);
    }
  };
  const openFile = async (file: File) => {
    const revision = ++fileRevision.current;
    controller.current?.abort();
    setError('');
    setBusy(true);
    setPreview(undefined);
    setInspection(undefined);
    setSource(undefined);
    try {
      assertImportBytes(file.size, currentImportLimitBytes(), 'Time-series');
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      if (!['csv', 'xlsx', 'json'].includes(extension ?? ''))
        throw new Error('Choose a CSV, XLSX or JSON file.');
      const next: ImportSource = {
        kind: extension as ImportSource['kind'],
        name: file.name,
        ...(extension === 'xlsx'
          ? { bytes: new Uint8Array(await file.arrayBuffer()) }
          : { text: await file.text() }),
      };
      if (mounted.current && revision === fileRevision.current) await inspect(next, file.size);
    } catch (error) {
      if (mounted.current && revision === fileRevision.current) {
        setError(errorMessage(error));
        setBusy(false);
      }
    }
  };
  const makeMapping = (): ImportMapping => {
    if (mapping.format === 'wide')
      return {
        ...mapping,
        valueColumns: Object.entries(columns)
          .filter(([, column]) => column.selected)
          .map(([column, entry]) => ({
            column,
            seriesId: entry.id,
            name: entry.name,
            unit: entry.unit,
            semantics: entry.semantics,
            aggregation: entry.aggregation,
            direction: entry.direction,
            riskPopulation: entry.riskPopulation,
          })),
      };
    const names = inspection?.seriesNames ?? [];
    const semantic = columns[mapping.valueColumn ?? ''];
    return {
      ...mapping,
      longSeries: names.map((name) => {
        if (!longIds.current.has(name)) longIds.current.set(name, crypto.randomUUID());
        return {
          name,
          id: longIds.current.get(name)!,
          unit: semantic?.unit ?? { kind: 'number', label: 'units' },
          semantics: semantic?.semantics ?? 'snapshot',
          aggregation: semantic?.aggregation ?? 'last',
          direction: semantic?.direction ?? 'neutral',
          riskPopulation: semantic?.riskPopulation,
        };
      }),
    };
  };
  const validate = async () => {
    if (!source || busy || committing) return;
    controller.current?.abort();
    const requestedModel = model;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const result = await analyticsService.run(
        {
          kind: 'import',
          source,
          mapping: makeMapping(),
          datasetId: mode === 'create' ? datasetId.current : target,
          byteLimit: currentImportLimitBytes(),
        },
        {
          signal: active.signal,
          progress: (completed, total) => {
            if (mounted.current && !active.signal.aborted)
              setProgress(total ? completed / total : 0);
          },
        },
      );
      if (!mounted.current || active.signal.aborted || originModel.current !== requestedModel)
        return;
      if (!('dataset' in result)) throw new Error('Unexpected import preview.');
      previewModel.current = requestedModel;
      setPreview(result);
    } catch (error) {
      if (mounted.current && !isCancelled(error)) setError(errorMessage(error));
    } finally {
      if (mounted.current && controller.current === active) setBusy(false);
    }
  };
  const commit = async () => {
    if (!mounted.current || busy || committing || !preview?.valid) return;
    if (previewModel.current !== model) {
      setPreview(undefined);
      setError('The document changed while this preview was prepared. Validate the import again.');
      return;
    }
    setCommitting(true);
    setError('');
    try {
      await apply(preview, mode, mode === 'create' ? undefined : target);
      if (mounted.current) close();
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      if (mounted.current) setCommitting(false);
    }
  };
  const discoverSeries = async (seriesColumn: string) => {
    if (!source || !seriesColumn || busy || committing) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    try {
      const result = await analyticsService.run(
        { kind: 'inspect-import', source, seriesColumn, byteLimit: currentImportLimitBytes() },
        { signal: active.signal },
      );
      if (mounted.current && !active.signal.aborted && 'columns' in result && 'sample' in result)
        setInspection(result);
    } catch (error) {
      if (mounted.current && !isCancelled(error)) setError(errorMessage(error));
    } finally {
      if (mounted.current && controller.current === active) setBusy(false);
    }
  };
  const select = (label: string, key: keyof ImportMapping, optional = false) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={String(mapping[key] ?? '')}
        onChange={(event) => {
          patch({ [key]: event.target.value || undefined });
          if (key === 'seriesColumn') void discoverSeries(event.target.value);
        }}
      >
        <option value="">{optional ? 'Not supplied' : 'Choose a column'}</option>
        {inspection?.columns.map((column) => (
          <option key={column}>{column}</option>
        ))}
      </select>
    </label>
  );
  const updateColumn = (column: string, update: Partial<ColumnConfiguration>) => {
    if (busy || committing) return;
    setColumns({ ...columns, [column]: { ...columns[column], ...update } });
    setPreview(undefined);
  };
  const semanticsFields = (column: string) =>
    columns[column] ? (
      <ImportColumnFields
        config={columns[column]}
        onChange={(update) => updateColumn(column, update)}
      />
    ) : null;
  return (
    <Modal
      title="Import time-series data"
      close={close}
      wide
      dismissible={!committing}
      className="analytics-import-dialog"
    >
      <div className="analytics-import">
        <p>
          Map the meaning of your data before it is saved. Importing does not send your file to a
          server.
        </p>
        <div
          className="analytics-import-drop"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy && !committing && event.dataTransfer.files[0])
              void openFile(event.dataTransfer.files[0]);
          }}
        >
          <Upload size={26} />
          <p>Drop a CSV, XLSX or JSON file</p>
          <input
            aria-label="Time-series file"
            type="file"
            accept=".csv,.xlsx,.json"
            disabled={busy || committing}
            onChange={(event) => {
              if (event.target.files?.[0]) void openFile(event.target.files[0]);
            }}
          />
        </div>
        {sourceBytes > 0 && <ImportSizeNotice bytes={sourceBytes} />}
        {busy && (
          <div className="analytics-progress" role="status">
            <progress value={progress} max={1} />
            <span>{Math.round(progress * 100)}%</span>
            <button
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
                setPreview(undefined);
              }}
            >
              Cancel processing
            </button>
          </div>
        )}
        {inspection && (
          <>
            <h3>Source preview · {inspection.rows.toLocaleString('en')} rows</h3>
            {source?.kind === 'xlsx' && inspection.sheets?.length ? (
              <label>
                Worksheet
                <select
                  value={source.sheet ?? inspection.sheets[0]}
                  disabled={busy || committing}
                  onChange={(event) =>
                    void inspect({ ...source, sheet: event.target.value }, sourceBytes)
                  }
                >
                  {inspection.sheets.map((sheet) => (
                    <option key={sheet}>{sheet}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="analytics-table-scroll">
              <table className="analytics-table">
                <thead>
                  <tr>
                    {inspection.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspection.sample.slice(0, 8).map((row, index) => (
                    <tr key={index}>
                      {inspection.columns.map((column) => (
                        <td key={column}>{String(row[column] ?? 'Missing')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <fieldset disabled={busy || committing}>
              <legend>Time, layout and conventions</legend>
              <div className="analytics-fields">
                <label>
                  Data layout
                  <select
                    aria-label="Data layout"
                    value={mapping.format}
                    onChange={(event) => patch({ format: event.target.value as 'wide' | 'long' })}
                  >
                    <option value="wide">Wide — one value column per series</option>
                    <option value="long">Long — series names and values in rows</option>
                  </select>
                </label>
                {select('Observation date / time', 'timeColumn')}
                <label>
                  Date convention
                  <select
                    aria-label="Date convention"
                    value={mapping.dateFormat}
                    onChange={(event) =>
                      patch({ dateFormat: event.target.value as ImportMapping['dateFormat'] })
                    }
                  >
                    <option value="iso">ISO 8601, with an explicit offset when timed</option>
                    <option value="dmy">Day / month / year</option>
                    <option value="mdy">Month / day / year</option>
                    <option value="excel-1900">Excel 1900 serial dates</option>
                    <option value="excel-1904">Excel 1904 serial dates</option>
                  </select>
                </label>
                <label>
                  Timezone
                  <input
                    aria-label="Import timezone"
                    value={mapping.timezone}
                    onChange={(event) => patch({ timezone: event.target.value })}
                    placeholder="Europe/Stockholm"
                  />
                </label>
                <label>
                  Native time resolution
                  <select
                    aria-label="Native time resolution"
                    value={mapping.resolution}
                    onChange={(event) =>
                      patch({ resolution: event.target.value as ImportMapping['resolution'] })
                    }
                  >
                    {['observation', 'day', 'week', 'month', 'quarter', 'year'].map(
                      (resolution) => (
                        <option key={resolution}>{resolution}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Decimal convention
                  <select
                    aria-label="Decimal convention"
                    value={mapping.decimal}
                    onChange={(event) => patch({ decimal: event.target.value as '.' | ',' })}
                  >
                    <option value=".">Dot: 1.25</option>
                    <option value=",">Comma: 1,25</option>
                  </select>
                </label>
                <label>
                  Numeric percent values
                  <select
                    aria-label="Numeric percent values"
                    value={mapping.percent}
                    onChange={(event) =>
                      patch({ percent: event.target.value as 'ratio' | 'percent' })
                    }
                  >
                    <option value="ratio">0.02 means 2%; 2 means a ratio of 2</option>
                    <option value="percent">2 means 2% (divide by 100)</option>
                  </select>
                </label>
                {select('Known / published at', 'knownAtColumn', true)}
              </div>
              <p className="muted">
                Local dates use the chosen timezone. Ambiguous daylight-saving times require an
                explicit ISO offset. Import time is not publication time.
              </p>
            </fieldset>
            <fieldset disabled={busy || committing}>
              <legend>Value series and meaning</legend>
              {mapping.format === 'wide' ? (
                <>
                  {inspection.columns
                    .filter((column) => column !== mapping.timeColumn)
                    .map((column) => (
                      <details key={column} open={columns[column]?.selected}>
                        <summary>
                          <label className="analytics-series-options" style={{ margin: 0 }}>
                            <input
                              type="checkbox"
                              aria-label={`Import column ${column}`}
                              checked={columns[column]?.selected ?? false}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                updateColumn(column, { selected: event.target.checked })
                              }
                            />
                            Import {column}
                          </label>
                        </summary>
                        {columns[column]?.selected && semanticsFields(column)}
                      </details>
                    ))}
                </>
              ) : (
                <>
                  <div className="analytics-fields">
                    {select('Series-name column', 'seriesColumn')}
                    {select('Value column', 'valueColumn')}
                  </div>
                  {mapping.valueColumn && semanticsFields(mapping.valueColumn)}
                  <p className="muted">
                    Long-format series use the configured value semantics. Each series is identified
                    by its name; preview must validate all observed names.
                  </p>
                </>
              )}
            </fieldset>
            <fieldset disabled={busy || committing}>
              <legend>Segments, denominators and OHLC</legend>
              <div className="analytics-series-options">
                {inspection.columns
                  .filter((column) => column !== mapping.timeColumn)
                  .map((column) => (
                    <label key={column}>
                      <input
                        type="checkbox"
                        checked={mapping.dimensions.includes(column)}
                        onChange={(event) =>
                          patch({
                            dimensions: event.target.checked
                              ? [...mapping.dimensions, column]
                              : mapping.dimensions.filter((entry) => entry !== column),
                          })
                        }
                      />
                      Segment: {column}
                    </label>
                  ))}
              </div>
              <div className="analytics-fields">
                {select('Numerator column', 'numeratorColumn', true)}
                {select('Denominator / exposure column', 'denominatorColumn', true)}
                <label>
                  OHLC data
                  <select
                    value={mapping.ohlcColumns ? 'yes' : 'no'}
                    onChange={(event) =>
                      patch({
                        ohlcColumns:
                          event.target.value === 'yes'
                            ? { open: '', high: '', low: '', close: '' }
                            : undefined,
                      })
                    }
                  >
                    <option value="no">No imported OHLC</option>
                    <option value="yes">Map real open / high / low / close columns</option>
                  </select>
                </label>
                {mapping.ohlcColumns &&
                  (['open', 'high', 'low', 'close'] as const).map((key) => (
                    <label key={key}>
                      {key.toUpperCase()} column
                      <select
                        value={mapping.ohlcColumns![key]}
                        onChange={(event) =>
                          patch({
                            ohlcColumns: { ...mapping.ohlcColumns!, [key]: event.target.value },
                          })
                        }
                      >
                        <option value="">Choose a column</option>
                        {inspection.columns.map((column) => (
                          <option key={column}>{column}</option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
              <p className="muted">
                Rates aggregate only through compatible numerator/denominator pairs. Aggregating
                disjoint segments is different from cumulative cohort churn. OHLC must come from
                real observations; no artificial wicks are created.
              </p>
            </fieldset>
            <fieldset disabled={busy || committing}>
              <legend>Visible data policies and destination</legend>
              <div className="analytics-fields">
                <label>
                  Duplicate time / series / segment keys
                  <select
                    value={mapping.duplicatePolicy}
                    onChange={(event) =>
                      patch({
                        duplicatePolicy: event.target.value as ImportMapping['duplicatePolicy'],
                      })
                    }
                  >
                    <option value="reject">Reject and show conflicts</option>
                    <option value="first">Keep first occurrence</option>
                    <option value="last">Keep last occurrence</option>
                    <option value="keep">Explicitly retain all occurrences</option>
                  </select>
                </label>
                <label>
                  Invalid rows
                  <select
                    value={mapping.invalidRows}
                    onChange={(event) =>
                      patch({ invalidRows: event.target.value as 'reject' | 'skip' })
                    }
                  >
                    <option value="reject">Reject import until corrected</option>
                    <option value="skip">Explicitly skip, report and record transformation</option>
                  </select>
                </label>
                <label>
                  Missing values
                  <select
                    value={mapping.missingValues}
                    onChange={(event) =>
                      patch({ missingValues: event.target.value as 'preserve' | 'reject' })
                    }
                  >
                    <option value="preserve">Preserve as missing (never zero)</option>
                    <option value="reject">Reject incomplete values</option>
                  </select>
                </label>
                <label>
                  Import action
                  <select
                    value={mode}
                    onChange={(event) => {
                      if (busy || committing) return;
                      setMode(event.target.value as AnalyticsImportMode);
                      setPreview(undefined);
                    }}
                  >
                    <option value="create">Create a new dataset</option>
                    {model.datasets.length > 0 && (
                      <>
                        <option value="replace">Replace an existing dataset</option>
                        <option value="update">
                          Update matching observations / append new keys
                        </option>
                      </>
                    )}
                  </select>
                </label>
                {mode !== 'create' && (
                  <label>
                    Target dataset
                    <select
                      value={target}
                      onChange={(event) => {
                        if (busy || committing) return;
                        setTarget(event.target.value);
                        setPreview(undefined);
                      }}
                    >
                      {model.datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="muted">
                A refresh preserves measurements, rules and notes, and marks previous results stale.
                No partial dataset is saved on cancellation or validation failure.
              </p>
            </fieldset>
            <div className="analytics-actions">
              <button
                className="primary"
                disabled={busy || committing || !mapping.timeColumn}
                onClick={() => void validate()}
              >
                Validate import preview
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="analytics-note analytics-error">
            {error}
          </p>
        )}
        {preview && (
          <ImportValidationReport
            preview={preview}
            busy={busy}
            committing={committing}
            onCommit={commit}
            onReview={() => setPreview(undefined)}
          />
        )}
      </div>
    </Modal>
  );
}
