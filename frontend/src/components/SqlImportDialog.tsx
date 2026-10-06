import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Modal } from './Modal';
import type { Graph } from '../model/types';
import { parseSqlAsync, SQL_FILE_LIMIT } from '../sql/client';
import type { SqlImportResult } from '../sql/parser';
import { getSqlTable } from '../sql/schema';
import './sql-import.css';

const number = (value: number) => value.toLocaleString();
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to import this SQL script.';

export function SqlImportDialog({
  initial,
  close,
  create,
}: {
  initial?: { text: string; name: string };
  close: () => void;
  create: (graph: Graph) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? 'SQL schema');
  const [text, setText] = useState(initial?.text ?? '');
  const [preview, setPreview] = useState<SqlImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const invalidate = () => {
    cancel();
    setWorking(false);
    setPreview(null);
    setError('');
  };
  const dismiss = useCallback(() => {
    cancel();
    close();
  }, [cancel, close]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  useEffect(() => {
    cancel();
    setName(initial?.name ?? 'SQL schema');
    setText(initial?.text ?? '');
    setPreview(null);
    setWorking(false);
    setError('');
  }, [initial?.text, initial?.name, cancel]);

  const loadFile = async (file: File) => {
    invalidate();
    if (file.size > SQL_FILE_LIMIT) {
      setError('SQL files must be 50 MiB or smaller.');
      return;
    }
    const current = generation.current;
    setWorking(true);
    try {
      const source = await file.text();
      if (!mounted.current || current !== generation.current) return;
      setText(source);
      setName(
        file.name
          .replace(/\.(sql|ddl)$/i, '')
          .trim()
          .slice(0, 500) || 'SQL schema',
      );
    } catch (error) {
      if (mounted.current && current === generation.current) setError(message(error));
    } finally {
      if (mounted.current && current === generation.current) setWorking(false);
    }
  };

  const previewSchema = async () => {
    if (!text.trim() || !name.trim() || working || creating) return;
    invalidate();
    const current = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    try {
      const result = await parseSqlAsync(text, name.trim(), { signal: pending.signal });
      if (!mounted.current || current !== generation.current || pending.signal.aborted) return;
      if (!result.tableCount || !result.graph.nodes.length)
        throw new Error('No supported CREATE TABLE definitions were found in this SQL script.');
      setPreview(result);
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted)
        setError(message(error));
    } finally {
      if (mounted.current && current === generation.current) {
        controller.current = null;
        setWorking(false);
      }
    }
  };
  const createDiagram = async () => {
    if (!preview || working || creating) return;
    setCreating(true);
    setError('');
    try {
      await create(preview.graph);
      if (mounted.current) dismiss();
    } catch (error) {
      if (mounted.current) {
        setError(message(error));
        setCreating(false);
      }
    }
  };
  const tables =
    preview?.graph.nodes.flatMap((node) => {
      const table = getSqlTable(node);
      return table ? [{ id: node.id, table }] : [];
    }) ?? [];
  const externalCount = tables.filter(({ table }) => table.external).length;

  return (
    <Modal title="Import SQL" close={dismiss} wide dismissible={!creating}>
      <form
        className="sql-import"
        aria-busy={working || creating}
        onSubmit={(event) => {
          event.preventDefault();
          void previewSchema();
        }}
      >
        <p className="sql-import-intro">
          Parse CREATE TABLE definitions and foreign keys locally to build a schema diagram. SQL is
          never executed. INSERT values and other data rows are not imported.
        </p>
        <label className="field">
          Diagram name
          <input
            aria-label="SQL diagram name"
            required
            maxLength={500}
            value={name}
            disabled={creating}
            onChange={(event) => {
              invalidate();
              setName(event.target.value);
            }}
          />
        </label>
        <label className="sql-file-picker">
          <FileUp size={16} aria-hidden="true" />
          Load SQL file
          <input
            aria-label="Load SQL file"
            type="file"
            accept=".sql,.ddl,text/plain,application/sql"
            disabled={creating}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void loadFile(file);
            }}
          />
        </label>
        <label className="field sql-script-field">
          SQL script
          <textarea
            aria-label="SQL script"
            rows={10}
            spellCheck={false}
            value={text}
            disabled={creating}
            placeholder="CREATE TABLE customers (id INTEGER PRIMARY KEY);"
            onChange={(event) => {
              invalidate();
              setText(event.target.value);
            }}
          />
        </label>
        <p className="sql-import-note">
          The script is a temporary draft. Only schema objects are saved.
        </p>
        {working && <p role="status">Preparing schema preview…</p>}
        {error && (
          <p role="alert" className="sql-import-error">
            {error}
          </p>
        )}
        {preview && (
          <section className="sql-schema-preview" aria-label="SQL schema preview">
            <h3>Schema preview</h3>
            <dl className="sql-preview-counts">
              {[
                ['Tables', preview.tableCount],
                ['Columns', preview.columnCount],
                ['Relationships', preview.relationshipCount],
                ['Unresolved tables', externalCount],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{number(value as number)}</dd>
                </div>
              ))}
            </dl>
            <ul className="sql-preview-tables" aria-label="Preview tables">
              {tables.slice(0, 30).map(({ id, table }) => (
                <li key={id}>
                  <strong>{table.qualifiedName.join('.')}</strong>
                  <span>
                    {table.external
                      ? 'Referenced table not defined in this script'
                      : `${number(table.columns.length)} columns`}
                  </span>
                </li>
              ))}
            </ul>
            {tables.length > 30 && <p>Showing 30 of {number(tables.length)} table objects.</p>}
            {preview.ignoredStatementCount > 0 && (
              <p>
                {number(preview.ignoredStatementCount)} other statements ignored. Data rows are not
                imported.
              </p>
            )}
            {preview.warnings.length > 0 && (
              <div className="sql-preview-warnings">
                <h4>Import notes</h4>
                <ul>
                  {preview.warnings.slice(0, 20).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
                {preview.warnings.length > 20 && (
                  <p>{number(preview.warnings.length - 20)} additional notes.</p>
                )}
              </div>
            )}
          </section>
        )}
        <div className="modal-actions sql-import-actions">
          <button type="button" disabled={creating} onClick={dismiss}>
            Cancel
          </button>
          <button type="submit" disabled={!text.trim() || !name.trim() || working || creating}>
            Preview schema
          </button>
          <button
            type="button"
            className="primary"
            disabled={!preview || working || creating}
            onClick={() => void createDiagram()}
          >
            {creating ? 'Creating diagram…' : 'Create diagram'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
