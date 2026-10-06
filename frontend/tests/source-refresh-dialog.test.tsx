import { beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SourceRefreshDialog } from '../src/components/SourceRefreshDialog';
import { previewSqlRefresh, previewCsvRefresh, loadRefreshCsv } from '../src/data/refreshClient';
import { emptyRefreshSummary, type SourceRefreshResult } from '../src/data/refresh';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';
import { parseSql } from '../src/sql/parser';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';

vi.mock('../src/data/refreshClient', () => ({
  previewSqlRefresh: vi.fn(),
  previewCsvRefresh: vi.fn(),
  loadRefreshCsv: vi.fn(),
}));
vi.mock('../src/storage/workspace', () => ({ workspace: { settled: vi.fn() } }));
const sql = 'CREATE TABLE customers(id INT PRIMARY KEY);';
const parse = vi.mocked(previewSqlRefresh);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function preview(graph: Graph): SourceRefreshResult {
  return {
    graph,
    sourceId: 'sql',
    summary: {
      ...emptyRefreshSummary(),
      added: 1,
      changed: 2,
      removed: 1,
      retainedAnnotations: 1,
      affectedManualRelationships: 2,
      warnings: ['Removed tables become annotations.'],
      changes: [{ kind: 'added', label: 'invoices' }],
    },
  };
}
function open() {
  const close = vi.fn();
  render(<SourceRefreshDialog onClose={close} />);
  fireEvent.change(screen.getByLabelText('Replacement SQL script'), { target: { value: sql } });
  return close;
}
beforeEach(() => {
  vi.clearAllMocks();
  parse.mockReset();
  vi.mocked(workspace.settled).mockResolvedValue(undefined);
  useEditor.getState().setGraph(parseSql(sql).graph);
  useEditor.setState({ status: 'saved', editRevision: 0, message: '' });
});

it('reviews explicit changes before committing and preserves the complete source graph in one undoable command', async () => {
  const old = useEditor.getState().graph!;
  const next = { ...old, nodes: [...old.nodes, newNode(old.diagram.id, { title: 'invoices' })] };
  parse.mockResolvedValue(preview(next));
  const close = open();
  expect(screen.getByRole('button', { name: 'Apply source refresh' })).toBeDisabled();
  expect(parse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  const review = await screen.findByLabelText('Source changes preview');
  expect(within(review).getByText('Tables added').nextElementSibling).toHaveTextContent('1');
  expect(
    within(review).getByText('Manual connections affected').nextElementSibling,
  ).toHaveTextContent('2');
  expect(
    screen.getByText('These manual connections remain attached to the retained annotations.'),
  ).toBeVisible();
  expect(useEditor.getState().graph).toBe(old);
  fireEvent.click(screen.getByRole('button', { name: 'Apply source refresh' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(useEditor.getState().graph?.nodes).toHaveLength(2);
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph?.nodes).toHaveLength(1);
});

it('invalidates an in-flight preview on input edits and aborts rather than allowing a stale response to replace the draft', async () => {
  const pending = deferred<SourceRefreshResult>();
  parse.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await waitFor(() => expect(parse).toHaveBeenCalledOnce());
  const signal = parse.mock.calls[0][3]?.signal;
  fireEvent.change(screen.getByLabelText('Replacement SQL script'), {
    target: { value: 'CREATE TABLE newer(id INT);' },
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(preview(blankGraph('Stale'))));
  expect(screen.queryByLabelText('Source changes preview')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Replacement SQL script')).toHaveValue(
    'CREATE TABLE newer(id INT);',
  );
  expect(screen.getByRole('button', { name: 'Apply source refresh' })).toBeDisabled();
});

it('rejects a graph edited concurrently with the preview and requires another review', async () => {
  const pending = deferred<SourceRefreshResult>();
  parse.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await waitFor(() => expect(parse).toHaveBeenCalledOnce());
  act(() =>
    useEditor
      .getState()
      .updateNode(useEditor.getState().graph!.nodes[0].id, { description: 'Concurrent note' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/diagram changed/);
  await act(async () => pending.resolve(preview(blankGraph('Stale'))));
  expect(screen.queryByLabelText('Source changes preview')).not.toBeInTheDocument();
  expect(useEditor.getState().graph?.nodes[0].description).toBe('Concurrent note');
});

it('never applies the previous draft to a different diagram opened before preview', async () => {
  open();
  act(() => useEditor.getState().setGraph(parseSql('CREATE TABLE another(id INT);').graph));
  expect(await screen.findByRole('alert')).toHaveTextContent('The open diagram changed');
  expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply source refresh' })).toBeDisabled();
  expect(parse).not.toHaveBeenCalled();
});

it('terminates a pending request when dismissed and keeps source text after parser and storage failures', async () => {
  const pending = deferred<SourceRefreshResult>();
  parse.mockReturnValue(pending.promise);
  const close = open();
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await waitFor(() => expect(parse).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(parse.mock.calls[0][3]?.signal?.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  cleanup();
  parse.mockReset();
  const retryClose = open();
  parse.mockRejectedValueOnce(new Error('Malformed CREATE TABLE.'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Malformed CREATE TABLE.');
  expect(screen.getByLabelText('Replacement SQL script')).toHaveValue(sql);
  parse.mockResolvedValueOnce(preview(useEditor.getState().graph!));
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByLabelText('Source changes preview');
  vi.mocked(workspace.settled)
    .mockImplementationOnce(async () => undefined)
    .mockImplementationOnce(async () => {
      throw new Error('Disk quota reached.');
    });
  fireEvent.click(screen.getByRole('button', { name: 'Apply source refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk quota reached.');
  expect(retryClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Replacement SQL script')).toHaveValue(sql);
  expect(screen.getByRole('button', { name: 'Apply source refresh' })).toBeDisabled();
});

it('requires explicit CSV keys and lets users review renamed-column mapping and removal policy', async () => {
  const dataset = parseCsv('ID,Name\n1,Ada', 'people.csv');
  useEditor.getState().setGraph(csvGraph(dataset, defaultAnalysis(dataset)));
  const incoming = parseCsv('Key,Name\n1,Adelaide', 'next.csv');
  vi.mocked(loadRefreshCsv).mockResolvedValue(incoming);
  vi.mocked(previewCsvRefresh).mockResolvedValue(preview(useEditor.getState().graph!));
  render(<SourceRefreshDialog onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Replacement source file'), {
    target: { files: [new File(['ID,Name\n1,Ada'], 'next.csv')] },
  });
  await screen.findByLabelText('Replacement column for ID');
  expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Identity key ID'));
  fireEvent.change(screen.getByLabelText('Replacement column for ID'), { target: { value: 'c0' } });
  fireEvent.change(screen.getByLabelText('Removed source objects'), {
    target: { value: 'remove' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByLabelText('Source changes preview');
  expect(previewCsvRefresh).toHaveBeenCalledWith(
    expect.anything(),
    incoming,
    {
      datasetId: useEditor.getState().graph!.dataset!.id,
      keyColumnIds: ['c0'],
      columnMap: { c0: 'c0', c1: 'c1' },
      removedPolicy: 'remove',
    },
    { signal: expect.any(AbortSignal) },
  );
  expect(
    screen.getByText('These manual connections will be deleted with the removed objects.'),
  ).toBeVisible();
});

it('keeps identity configuration disabled until replacement-file loading has finished', async () => {
  const dataset = parseCsv('ID,Name\n1,Ada', 'people.csv');
  useEditor.getState().setGraph(csvGraph(dataset, defaultAnalysis(dataset)));
  const pending = deferred<ReturnType<typeof parseCsv>>();
  vi.mocked(loadRefreshCsv).mockReturnValueOnce(pending.promise);
  render(<SourceRefreshDialog onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Replacement source file'), {
    target: { files: [new File(['ID,Name\n1,Adelaide'], 'next.csv')] },
  });
  expect(screen.getByLabelText('Identity key ID')).toBeDisabled();
  expect(screen.getByLabelText('Removed source objects')).toBeDisabled();
  await act(async () => pending.resolve(parseCsv('ID,Name\n1,Adelaide', 'next.csv')));
  expect(screen.getByLabelText('Identity key ID')).toBeEnabled();
  expect(screen.getByLabelText('Removed source objects')).toBeEnabled();
  expect(screen.getByLabelText('Replacement column for ID')).toHaveValue('c0');
});

it('never reuses a previously parsed replacement after the next file fails to load', async () => {
  const dataset = parseCsv('ID,Name\n1,Ada', 'people.csv');
  useEditor.getState().setGraph(csvGraph(dataset, defaultAnalysis(dataset)));
  vi.mocked(loadRefreshCsv)
    .mockResolvedValueOnce(parseCsv('ID,Name\n1,Adelaide', 'valid.csv'))
    .mockRejectedValueOnce(new Error('Malformed replacement CSV.'));
  render(<SourceRefreshDialog onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Replacement source file'), {
    target: { files: [new File(['ID,Name\n1,Adelaide'], 'valid.csv')] },
  });
  await screen.findByLabelText('Replacement column for ID');
  fireEvent.click(screen.getByLabelText('Identity key ID'));
  expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Replacement source file'), {
    target: { files: [new File(['broken'], 'broken.csv')] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Malformed replacement CSV.');
  expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  expect(screen.queryByLabelText('Replacement column for ID')).not.toBeInTheDocument();
});

it('prunes only removed IDs from the current selection, including changes made during preview and apply', async () => {
  const original = useEditor.getState().graph!;
  const removed = original.nodes[0];
  const keep = newNode(original.diagram.id, { title: 'Keep' }),
    other = newNode(original.diagram.id, { title: 'Current selection' });
  const goneEdge = newEdge(original.diagram.id, removed.id, keep.id),
    keepEdge = newEdge(original.diagram.id, keep.id, other.id);
  const graph = { ...original, nodes: [removed, keep, other], edges: [goneEdge, keepEdge] };
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([removed.id], [goneEdge.id]);
  const parsePending = deferred<SourceRefreshResult>();
  parse.mockReturnValueOnce(parsePending.promise);
  const close = open();
  fireEvent.change(screen.getByLabelText('Removed source objects'), {
    target: { value: 'remove' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await waitFor(() => expect(parse).toHaveBeenCalledOnce());
  act(() => useEditor.getState().select([removed.id, keep.id], [goneEdge.id, keepEdge.id]));
  await act(async () =>
    parsePending.resolve(preview({ ...graph, nodes: [keep, other], edges: [keepEdge] })),
  );
  const applyPending = deferred<void>();
  vi.mocked(workspace.settled).mockReturnValueOnce(applyPending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Apply source refresh' }));
  act(() => useEditor.getState().select([removed.id, other.id], [goneEdge.id, keepEdge.id]));
  await act(async () => applyPending.resolve());
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(useEditor.getState().selectedNodes).toEqual([other.id]);
  expect(useEditor.getState().selectedEdges).toEqual([keepEdge.id]);
});
