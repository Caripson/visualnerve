import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Modal } from './Modal';
import type { Graph } from '../model/types';
import { parseSqlAsync, SQL_FILE_LIMIT } from '../sql/client';
import type { SqlImportResult } from '../sql/parser';
import { getSqlTable } from '../sql/schema';
import { getSqlQueryResult, getSqlQuerySource } from '../sql/query-schema';
import './sql-import.css';

const number = (value: number) => value.toLocaleString();
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to import this SQL script.';

// This hint only names the preview button; the worker performs the actual parsing.
function queryDraft(text: string): boolean {
  let offset = 0;
  const limit = Math.min(text.length, 16_384);
  while (offset < limit) {
    if (/\s/.test(text[offset])) {
      offset++;
      continue;
    }
    if (text.startsWith('--', offset) || text[offset] === '#') {
      const end = text.indexOf('\n', offset);
      offset = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', offset)) {
      let depth = 1;
      offset += 2;
      while (offset < limit && depth) {
        if (text.startsWith('/*', offset)) {
          depth++;
          offset += 2;
        } else if (text.startsWith('*/', offset)) {
          depth--;
          offset += 2;
        } else offset++;
      }
      continue;
    }
    return /^(SELECT|WITH)\b/i.test(text.slice(offset, offset + 16));
  }
  return false;
}

export function SqlImportDialog({
  initial,
  close,
  create,
}: {
  initial?: { text: string; name: string };
  close: () => void;
  create: (graph: Graph) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? 'SQL diagram');
  const [text, setText] = useState(initial?.text ?? '');
  const [preview, setPreview] = useState<SqlImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const queryHint = useMemo(() => queryDraft(text), [text]);
  const isQueryDraft = preview?.kind === 'query' || queryHint;

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
    setName(initial?.name ?? 'SQL diagram');
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
          .slice(0, 500) || 'SQL diagram',
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
      if (!result.graph.nodes.length || (result.kind !== 'query' && !result.tableCount))
        throw new Error(
          isQueryDraft
            ? 'No supported SELECT query was found in this SQL script.'
            : 'No supported CREATE TABLE definitions were found in this SQL script.',
        );
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
  const isQuery = preview?.kind === 'query';
  const sources =
    preview?.graph.nodes.flatMap((node) => {
      const source = getSqlQuerySource(node);
      return source ? [{ id: node.id, source }] : [];
    }) ?? [];
  const queries =
    preview?.graph.nodes.flatMap((node) => {
      const query = getSqlQueryResult(node);
      return query ? [{ id: node.id, query }] : [];
    }) ?? [];

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
          Visualize SELECT sources, joins, expressions and filters, or CREATE TABLE definitions and
          foreign keys. Parsing happens locally. SQL is never executed and result rows are not
          fetched.
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
            placeholder="SELECT c.name, SUM(o.total) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;"
            onChange={(event) => {
              invalidate();
              setText(event.target.value);
            }}
          />
        </label>
        <p className="sql-import-note">
          The full script is a temporary draft. Schema imports save definitions only. Query diagrams
          save expressions and conditions, including literal values, locally with the diagram.
        </p>
        {working && <p role="status">Preparing {isQueryDraft ? 'query' : 'schema'} preview…</p>}
        {error && (
          <p role="alert" className="sql-import-error">
            {error}
          </p>
        )}
        {preview && (
          <section
            className="sql-schema-preview"
            aria-label={isQuery ? 'SQL query preview' : 'SQL schema preview'}
          >
            <h3>{isQuery ? 'Query preview' : 'Schema preview'}</h3>
            <dl className="sql-preview-counts">
              {(isQuery
                ? [
                    ['Source aliases', preview.sourceCount ?? sources.length],
                    ['Query blocks', preview.queryCount ?? queries.length],
                    [
                      'Result columns',
                      queries
                        .filter(({ query }) => !query.parentScope)
                        .reduce((count, { query }) => count + query.columns.length, 0),
                    ],
                    [
                      'Nested output columns',
                      queries
                        .filter(({ query }) => query.parentScope)
                        .reduce((count, { query }) => count + query.columns.length, 0),
                    ],
                    ['Connections', preview.relationshipCount],
                  ]
                : [
                    ['Tables', preview.tableCount],
                    ['Columns', preview.columnCount],
                    ['Relationships', preview.relationshipCount],
                    ['Unresolved tables', externalCount],
                  ]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{number(value as number)}</dd>
                </div>
              ))}
            </dl>
            {isQuery ? (
              <>
                <p>
                  Aliases of the same table remain separate objects. Nested SELECT statements have
                  their own result cards.
                </p>
                <ul className="sql-preview-tables" aria-label="Preview query sources">
                  {sources.slice(0, 30).map(({ id, source }) => (
                    <li key={id}>
                      <strong>{source.alias}</strong>
                      <span>
                        {source.kind === 'table'
                          ? source.qualifiedName.join('.')
                          : `${source.kind === 'cte' ? 'CTE' : 'Derived query'} · ${source.queryScope}`}
                      </span>
                      <span>
                        {source.scope} · {number(source.columns.length)} referenced columns
                      </span>
                    </li>
                  ))}
                </ul>
                {sources.length > 30 && (
                  <p>Showing 30 of {number(sources.length)} source aliases.</p>
                )}
                <ul className="sql-preview-tables" aria-label="Preview query results">
                  {queries.slice(0, 10).map(({ id, query }) => (
                    <li key={id}>
                      <strong>{query.name}</strong>
                      <span>
                        SELECT{query.distinct ? ' DISTINCT' : ''} · {number(query.columns.length)}{' '}
                        outputs · {query.scope}
                      </span>
                      {query.clauses.where && (
                        <span>
                          WHERE {query.clauses.where.slice(0, 220)}
                          {query.clauses.where.length > 220 ? '…' : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {queries.length > 10 && <p>Showing 10 of {number(queries.length)} query blocks.</p>}
              </>
            ) : (
              <>
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
              </>
            )}
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
            Preview {isQueryDraft ? 'query' : 'schema'}
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
