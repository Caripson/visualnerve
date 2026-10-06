import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SqlImportDialog } from '../src/components/SqlImportDialog';
import { parseSqlAsync } from '../src/sql/client';
import type { SqlImportResult } from '../src/sql/parser';
import type { SqlTable } from '../src/sql/schema';
import type { SqlQueryResult, SqlQuerySource } from '../src/sql/query-schema';
import { blankGraph, newEdge, newNode } from '../src/model/types';

vi.mock('../src/sql/client', () => ({
  parseSqlAsync: vi.fn(),
  SQL_FILE_LIMIT: 50 * 1024 * 1024,
}));
const parse = vi.mocked(parseSqlAsync);
const source = 'CREATE TABLE customers (id INTEGER PRIMARY KEY);';
const count = (label: string) =>
  within(screen.getByLabelText('SQL schema preview')).getByText(label).nextElementSibling;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function result(tableCount = 2): SqlImportResult {
  const graph = blankGraph('Customers schema');
  for (let index = 0; index <= tableCount; index++) {
    const external = index === tableCount;
    graph.nodes.push(
      newNode(graph.diagram.id, {
        title: `table_${index}`,
        metadata: {
          sqlTable: {
            version: 1,
            name: `table_${index}`,
            qualifiedName: ['public', `table_${index}`],
            columns: external
              ? []
              : [
                  {
                    name: 'id',
                    dataType: 'INTEGER',
                    nullable: false,
                    primaryKey: true,
                    foreignKey: false,
                    unique: true,
                  },
                  {
                    name: 'name',
                    dataType: 'TEXT',
                    nullable: true,
                    primaryKey: false,
                    foreignKey: false,
                    unique: false,
                  },
                ],
            primaryKey: external ? [] : ['id'],
            uniqueKeys: [],
            ...(external ? { external: true } : {}),
          } satisfies SqlTable,
        },
      }),
    );
  }
  graph.edges.push(newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id));
  return {
    graph,
    warnings: ['Referenced table was not defined.'],
    tableCount: graph.nodes.length,
    columnCount: tableCount * 2,
    relationshipCount: 1,
    ignoredStatementCount: 3,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  parse.mockReset();
});

it('requires an explicit preview and create, with bounded table/warning lists and external counts', async () => {
  const preview = result(40);
  preview.warnings = Array.from({ length: 25 }, (_, index) => `Import note ${index + 1}`);
  parse.mockResolvedValue(preview);
  const create = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <SqlImportDialog
      initial={{ text: source, name: 'Customers schema' }}
      close={close}
      create={create}
    />,
  );
  expect(screen.getByLabelText('SQL script')).toHaveValue(source);
  expect(parse).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  await screen.findByLabelText('SQL schema preview');
  expect(parse).toHaveBeenCalledWith(source, 'Customers schema', {
    signal: expect.any(AbortSignal),
  });
  expect(count('Tables')).toHaveTextContent('41');
  expect(count('Columns')).toHaveTextContent('80');
  expect(count('Relationships')).toHaveTextContent('1');
  expect(count('Unresolved tables')).toHaveTextContent('1');
  expect(
    within(screen.getByRole('list', { name: 'Preview tables' })).getAllByRole('listitem'),
  ).toHaveLength(30);
  expect(screen.getByText('Showing 30 of 41 table objects.')).toBeVisible();
  expect(screen.getByText('5 additional notes.')).toBeVisible();
  expect(screen.queryByText('Import note 21')).not.toBeInTheDocument();
  expect(screen.getByText('3 other statements ignored. Data rows are not imported.')).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(preview.graph);
});

it('preserves the script through parser errors and refuses an empty result', async () => {
  parse.mockRejectedValueOnce(new Error('Unsupported table definition near line 1.'));
  const create = vi.fn();
  render(
    <SqlImportDialog
      initial={{ text: source, name: 'Customers' }}
      close={vi.fn()}
      create={create}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unsupported table definition near line 1.',
  );
  expect(screen.getByLabelText('SQL script')).toHaveValue(source);
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  parse.mockResolvedValueOnce({ ...result(), graph: blankGraph('Empty'), tableCount: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('No supported CREATE TABLE definitions'),
  );
  expect(screen.queryByLabelText('SQL schema preview')).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('aborts changed input and ignores a late stale parse before accepting the new preview', async () => {
  const stale = deferred<SqlImportResult>();
  const fresh = deferred<SqlImportResult>();
  parse.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
  render(
    <SqlImportDialog
      initial={{ text: source, name: 'Customers' }}
      close={vi.fn()}
      create={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  const oldSignal = parse.mock.calls[0][2]?.signal;
  fireEvent.change(screen.getByLabelText('SQL script'), {
    target: { value: 'CREATE TABLE orders (id INTEGER);' },
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  await act(async () => stale.resolve(result(99)));
  expect(screen.queryByLabelText('SQL schema preview')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Preparing schema preview');
  await act(async () => fresh.resolve(result(3)));
  expect(count('Tables')).toHaveTextContent('4');
  fireEvent.change(screen.getByLabelText('SQL diagram name'), { target: { value: 'Orders' } });
  expect(screen.queryByLabelText('SQL schema preview')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
});

it('cancels and aborts pending parsing, including when the dialog is unmounted', async () => {
  const pending = deferred<SqlImportResult>();
  parse.mockReturnValue(pending.promise);
  const close = vi.fn();
  const create = vi.fn();
  const view = render(
    <SqlImportDialog initial={{ text: source, name: 'Customers' }} close={close} create={create} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  const signal = parse.mock.calls[0][2]?.signal;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(signal?.aborted).toBe(true);
  view.unmount();
  await act(async () => pending.reject(new DOMException('Cancelled', 'AbortError')));
  expect(create).not.toHaveBeenCalled();
});

it('replaces a newly supplied draft and aborts the previous source without importing automatically', async () => {
  const pending = deferred<SqlImportResult>();
  parse.mockReturnValue(pending.promise);
  const create = vi.fn();
  const close = vi.fn();
  const view = render(
    <SqlImportDialog initial={{ text: source, name: 'Customers' }} close={close} create={create} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  const signal = parse.mock.calls[0][2]?.signal;
  view.rerender(
    <SqlImportDialog
      initial={{ text: 'CREATE TABLE orders (id INTEGER);', name: 'Orders' }}
      close={close}
      create={create}
    />,
  );
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(result(15)));
  expect(screen.getByLabelText('SQL script')).toHaveValue('CREATE TABLE orders (id INTEGER);');
  expect(screen.getByLabelText('SQL diagram name')).toHaveValue('Orders');
  expect(screen.queryByLabelText('SQL schema preview')).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('keeps preview and input when saving fails and prevents edits or duplicate creates while saving', async () => {
  const preview = result();
  parse.mockResolvedValue(preview);
  const saving = deferred<void>();
  const create = vi.fn().mockReturnValueOnce(saving.promise).mockResolvedValueOnce(undefined);
  const close = vi.fn();
  render(
    <SqlImportDialog initial={{ text: source, name: 'Customers' }} close={close} create={create} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview schema' }));
  await screen.findByLabelText('SQL schema preview');
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  expect(screen.getByLabelText('SQL script')).toBeDisabled();
  expect(screen.getByLabelText('SQL diagram name')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Creating diagram…' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument();
  await act(async () => saving.reject(new Error('Storage quota exceeded.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Storage quota exceeded.');
  expect(screen.getByLabelText('SQL script')).toHaveValue(source);
  expect(screen.getByLabelText('SQL schema preview')).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenLastCalledWith(preview.graph);
});

it('loads a bounded SQL file and prevents a late file read from replacing edited text', async () => {
  render(
    <SqlImportDialog
      initial={{ text: source, name: 'Customers' }}
      close={vi.fn()}
      create={vi.fn()}
    />,
  );
  const oversized = new File([], 'large.sql');
  Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText('Load SQL file'), { target: { files: [oversized] } });
  expect(screen.getByRole('alert')).toHaveTextContent('50 MiB or smaller');
  expect(screen.getByLabelText('SQL script')).toHaveValue(source);
  expect(screen.getByLabelText('Load SQL file')).toHaveAttribute(
    'accept',
    '.sql,.ddl,text/plain,application/sql',
  );
  const file = new File([], 'Orders.DDL');
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue('CREATE TABLE orders (id INTEGER);'),
  });
  fireEvent.change(screen.getByLabelText('Load SQL file'), { target: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByLabelText('SQL script')).toHaveValue('CREATE TABLE orders (id INTEGER);'),
  );
  expect(screen.getByLabelText('SQL diagram name')).toHaveValue('Orders');
  expect(parse).not.toHaveBeenCalled();
  const reading = deferred<string>();
  const late = new File([], 'late.sql');
  Object.defineProperty(late, 'text', { value: () => reading.promise });
  fireEvent.change(screen.getByLabelText('Load SQL file'), { target: { files: [late] } });
  fireEvent.change(screen.getByLabelText('SQL script'), { target: { value: source } });
  await act(async () => reading.resolve('STALE FILE CONTENT'));
  expect(screen.getByLabelText('SQL script')).toHaveValue(source);
  expect(screen.getByLabelText('SQL diagram name')).toHaveValue('Orders');
});

it('previews SELECT aliases, nested queries, DISTINCT and output counts before explicitly creating a query diagram', async () => {
  const graph = blankGraph('Sales query');
  const main: SqlQueryResult = {
    version: 1,
    scope: 'query_1',
    name: 'Query result',
    distinct: true,
    columns: [
      {
        ordinal: 1,
        name: 'customer',
        expression: 'b.name',
        references: [
          { scope: 'query_1', sourceAlias: 'b', column: 'name', resolution: 'resolved' },
        ],
      },
    ],
    clauses: { where: "b.country = 'NO'" },
  };
  const nested: SqlQueryResult = {
    ...main,
    scope: 'query_1/subquery',
    parentScope: 'query_1',
    name: 'inv_tmp',
    distinct: false,
  };
  const source: SqlQuerySource = {
    version: 1,
    scope: 'query_1',
    alias: 'b',
    kind: 'table',
    qualifiedName: ['app', 'business'],
    columns: ['name', 'country'],
  };
  graph.nodes = [
    newNode(graph.diagram.id, { metadata: { sqlQuerySource: source } }),
    newNode(graph.diagram.id, { metadata: { sqlQueryResult: main } }),
    newNode(graph.diagram.id, { metadata: { sqlQueryResult: nested } }),
  ];
  const preview: SqlImportResult = {
    graph,
    kind: 'query',
    queryCount: 2,
    sourceCount: 1,
    outputColumnCount: 2,
    tableCount: 1,
    columnCount: 4,
    relationshipCount: 2,
    ignoredStatementCount: 0,
    warnings: ['Duplicate output alias was retained.'],
  };
  parse.mockResolvedValue(preview);
  const create = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <SqlImportDialog
      initial={{
        text: "/* SELECT draft */ -- sample\n SELECT DISTINCT b.name AS customer FROM app.business b WHERE b.country = 'NO';",
        name: 'Sales query',
      }}
      close={close}
      create={create}
    />,
  );
  expect(screen.getByText(/including literal values/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
  const section = await screen.findByLabelText('SQL query preview');
  expect(within(section).getByText('Source aliases').nextElementSibling).toHaveTextContent('1');
  expect(within(section).getByText('Query blocks').nextElementSibling).toHaveTextContent('2');
  expect(within(section).getByText('Result columns').nextElementSibling).toHaveTextContent('1');
  expect(within(section).getByText('Nested output columns').nextElementSibling).toHaveTextContent(
    '1',
  );
  expect(within(section).getByText('app.business')).toBeVisible();
  expect(within(section).getByText('SELECT DISTINCT · 1 outputs · query_1')).toBeVisible();
  expect(within(section).getAllByText("WHERE b.country = 'NO'")).toHaveLength(2);
  expect(within(section).getByText('Duplicate output alias was retained.')).toBeVisible();
  expect(screen.queryByText('Unresolved tables')).toBeNull();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(graph);
});

it('accepts a SELECT without table sources and detects WITH after nested comments', async () => {
  const graph = blankGraph('Literal query');
  graph.nodes = [
    newNode(graph.diagram.id, {
      metadata: {
        sqlQueryResult: {
          version: 1,
          scope: 'query_1',
          name: 'Query result',
          distinct: false,
          columns: [{ ordinal: 1, name: 'answer', expression: '42', references: [] }],
          clauses: {},
        } satisfies SqlQueryResult,
      },
    }),
  ];
  parse.mockResolvedValue({
    graph,
    kind: 'query',
    tableCount: 0,
    columnCount: 1,
    relationshipCount: 0,
    ignoredStatementCount: 0,
    warnings: [],
  });
  render(
    <SqlImportDialog
      initial={{
        text: '/* outer /* nested */ comment */ WITH value AS (SELECT 42 AS answer) SELECT answer FROM value;',
        name: 'Literal query',
      }}
      close={vi.fn()}
      create={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
  expect(await screen.findByLabelText('SQL query preview')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeEnabled();
  expect(screen.queryByRole('alert')).toBeNull();
});
