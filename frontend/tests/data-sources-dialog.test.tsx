import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataSourcesDialog } from '../src/components/DataSourcesDialog';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { graphDatasets, reanalyzeDataModel, setAnalysisForDataset } from '../src/data/model';
import * as modelClient from '../src/data/modelClient';
import { openCsvFile } from '../src/data/client';
import { useEditor } from '../src/state/editor';
import type { Graph } from '../src/model/types';
vi.mock('../src/data/client', () => ({ openCsvFile: vi.fn() }));
beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ owners: [], status: 'saved', importFileLimitMb: 50 });
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const customers = parseCsv('Id,Name\nA,Alice\nB,Bob\n', 'Customers.csv'),
    orders = parseCsv('Customer,Amount\nA,10\nA,20\nX,90\n,50\n', 'Orders.csv');
  orders.diagramId = customers.diagramId;
  const graph = reanalyzeDataModel(
    setAnalysisForDataset(
      { ...csvGraph(customers, defaultAnalysis(customers)), datasets: [orders] },
      orders.id,
      defaultAnalysis(orders),
    ),
  );
  useEditor.getState().setGraph(graph);
  return graph;
}
it('requires preview, supports swapping two sources, reports missing/duplicate keys and applies one undoable command', async () => {
  const graph = fixture(),
    close = vi.fn();
  render(<DataSourcesDialog onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Match columns' }));
  expect(screen.queryByRole('button', { name: 'Add this relationship' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Relationship source'), {
    target: { value: graph.datasets![0].id },
  });
  expect(screen.getByLabelText('Relationship target')).toHaveValue(graph.dataset!.id);
  fireEvent.click(screen.getByRole('button', { name: 'Preview match' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('many-to-one'));
  expect(screen.getByRole('status')).toHaveTextContent('2 / 4');
  expect(screen.getByRole('status')).toHaveTextContent('1 / 0');
  expect(useEditor.getState().graph!.diagram.settings.csvRelationships).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Add this relationship' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  const saved = useEditor.getState().graph!;
  expect(saved.diagram.settings.csvRelationships![0]).toMatchObject({
    sourceDatasetId: graph.datasets![0].id,
    targetDatasetId: graph.dataset!.id,
  });
  expect(saved.edges.some((e) => e.metadata.csvModelGenerated === true)).toBe(true);
  expect(useEditor.getState().history).toHaveLength(1);
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph!.diagram.settings.csvRelationships).toBeUndefined();
  expect(useEditor.getState().graph!.dataset).toBe(graph.dataset);
});
it('stages a new source without changing the diagram until apply, and undo restores original immutable sources', async () => {
  const graph = fixture(),
    added = parseCsv('Order,Paid\na,12\n', 'Payments.csv');
  vi.mocked(openCsvFile).mockResolvedValue(added);
  const close = vi.fn();
  render(
    <DataSourcesDialog
      onClose={close}
      initialFiles={[new File(['private-row-data'], 'Payments.csv')]}
    />,
  );
  await screen.findByText('Payments');
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
  expect(screen.queryByText('private-row-data')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  const saved = useEditor.getState().graph!;
  expect(graphDatasets(saved)).toHaveLength(3);
  expect(saved.datasets![1].diagramId).toBe(graph.diagram.id);
  expect(saved.datasets![0]).toBe(graph.datasets![0]);
  act(() => useEditor.getState().undo());
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
  expect(useEditor.getState().graph!.datasets![0]).toBe(graph.datasets![0]);
});
it('invalidates preview when a column changes and closing leaves staged removals unapplied', async () => {
  const graph = fixture(),
    close = vi.fn();
  render(<DataSourcesDialog onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Match columns' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview match' }));
  await screen.findByRole('button', { name: 'Add this relationship' });
  fireEvent.change(screen.getByLabelText('Source matching column'), { target: { value: 'c1' } });
  expect(screen.queryByRole('button', { name: 'Add this relationship' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove source Orders' }));
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
  expect(close).toHaveBeenCalled();
  expect(useEditor.getState().graph).toBe(graph);
});
it('rejects a stale apply result rather than overwriting an edit made while analysis runs', async () => {
  const graph = fixture();
  let complete!: (graph: Graph) => void;
  vi.spyOn(modelClient, 'reanalyzeDataModelAsync').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<DataSourcesDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove source Orders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
  act(() =>
    useEditor.getState().updateNode(graph.nodes[0].id, { notes: 'Keep this concurrent note' }),
  );
  await act(async () => complete({ ...graph, datasets: [] }));
  expect(await screen.findByRole('alert')).toHaveTextContent('diagram changed');
  expect(useEditor.getState().graph!.nodes[0].notes).toBe('Keep this concurrent note');
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
});
it('accepts repeated CSV drops into the staged model without triggering a global file drop or applying early', async () => {
  const graph = fixture(),
    a = parseCsv('Order,Paid\na,12\n', 'Payments.csv'),
    b = parseCsv('Order,State\na,Open\n', 'States.csv');
  vi.mocked(openCsvFile).mockResolvedValueOnce(a).mockResolvedValueOnce(b);
  render(<DataSourcesDialog onClose={vi.fn()} />);
  const globalDrop = vi.fn();
  window.addEventListener('drop', globalDrop);
  const container = screen.getByRole('dialog').querySelector('.data-sources')!;
  try {
    fireEvent.drop(container, { dataTransfer: { files: [new File([''], 'Payments.csv')] } });
    await screen.findByText('Payments');
    fireEvent.drop(container, { dataTransfer: { files: [new File([''], 'States.csv')] } });
    await screen.findByText('States');
    expect(globalDrop).not.toHaveBeenCalled();
    expect(openCsvFile).toHaveBeenCalledTimes(2);
    expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
    await waitFor(() => expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(4));
    expect(useEditor.getState().graph!.dataset).toBe(graph.dataset);
  } finally {
    window.removeEventListener('drop', globalDrop);
  }
});
it('keeps the captured import limit for every file in a batch when settings change during loading', async () => {
  fixture();
  const payments = parseCsv('Order,Paid\na,12\n', 'Payments.csv'),
    states = parseCsv('Order,State\na,Open\n', 'States.csv');
  const files = [new File([''], 'Payments.csv'), new File([''], 'States.csv')];
  let complete!: (dataset: typeof payments) => void;
  vi.mocked(openCsvFile)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(states);
  useEditor.setState({ importFileLimitMb: 100 });
  render(<DataSourcesDialog onClose={vi.fn()} initialFiles={files} />);
  expect(openCsvFile).toHaveBeenNthCalledWith(1, files[0], 100 * 1024 * 1024);
  await act(async () => {
    useEditor.setState({ importFileLimitMb: 50 });
    complete(payments);
  });
  await screen.findByText('States');
  expect(openCsvFile).toHaveBeenNthCalledWith(2, files[1], 100 * 1024 * 1024);
  expect(screen.getByText('Payments')).toBeInTheDocument();
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(2);
});
it('allows initial auto-fit and a committed save while dropped files load without rolling back viewport or copying existing sources', async () => {
  const primary = parseCsv('Id,Name\nA,Alice\nB,Bob\n', 'Customers.csv');
  const graph = csvGraph(primary, defaultAnalysis(primary));
  graph.diagram.settings.csvDatasetOrder = [primary.id];
  useEditor.getState().setGraph(graph);
  const added = parseCsv('Customer,Amount\nA,10\nA,20\n', 'Orders.csv');
  let loaded!: (dataset: typeof added) => void;
  vi.mocked(openCsvFile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  const close = vi.fn();
  render(<DataSourcesDialog onClose={close} initialFiles={[new File([''], 'Orders.csv')]} />);
  const viewport = { x: -44, y: 33, zoom: 0.3 },
    updatedAt = new Date(Date.now() + 1000).toISOString();
  const committed: Graph = {
    ...graph,
    dataset: {
      ...primary,
      version: 2,
      updatedAt,
      columns: primary.columns.map((column) => ({ ...column })),
    },
    nodes: graph.nodes.map((node) => ({ ...node, version: node.version + 1, updatedAt })),
    edges: graph.edges.map((edge) => ({ ...edge, version: edge.version + 1, updatedAt })),
    diagram: {
      ...graph.diagram,
      version: 4,
      updatedAt,
      settings: {
        ...graph.diagram.settings,
        viewport,
        viewportDevice: 'desktop',
        entityOrder: {
          nodes: graph.nodes.map((node) => node.id),
          edges: graph.edges.map((edge) => edge.id),
        },
      },
    },
  };
  act(() =>
    useEditor.setState({ graph: committed, editRevision: useEditor.getState().editRevision + 1 }),
  );
  await act(async () => loaded(added));
  await screen.findByText('Orders');
  fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const result = useEditor.getState().graph!;
  expect(result.diagram.version).toBe(4);
  expect(result.diagram.settings.viewport).toBe(viewport);
  expect(result.diagram.settings.viewportDevice).toBe('desktop');
  expect(result.dataset).toBe(committed.dataset);
  expect(graphDatasets(result)).toHaveLength(2);
  expect(result.nodes.find((node) => node.id === graph.nodes[0].id)!.version).toBe(
    committed.nodes[0].version,
  );
  expect(useEditor.getState().history.at(-1)!.sources).toHaveLength(1);
  expect(useEditor.getState().history.at(-1)!.sources![0].after!.id).toBe(result.datasets![0].id);
});
it('rebases a completed worker result onto viewport and saved revisions changed while analysis runs', async () => {
  const graph = fixture();
  let complete!: (graph: Graph) => void;
  let submitted!: Graph;
  vi.spyOn(modelClient, 'reanalyzeDataModelAsync').mockImplementationOnce((next) => {
    submitted = next;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const close = vi.fn();
  render(<DataSourcesDialog onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove source Orders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
  const viewport = { x: 17, y: 45, zoom: 0.7 };
  act(() =>
    useEditor.setState({
      graph: {
        ...graph,
        diagram: {
          ...graph.diagram,
          version: 6,
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          settings: { ...graph.diagram.settings, viewport, viewportDevice: 'touch' },
        },
      },
      editRevision: useEditor.getState().editRevision + 1,
    }),
  );
  await act(async () => complete(reanalyzeDataModel(submitted)));
  expect(close).toHaveBeenCalledOnce();
  expect(useEditor.getState().graph!.diagram.version).toBe(6);
  expect(useEditor.getState().graph!.diagram.settings.viewport).toBe(viewport);
  expect(useEditor.getState().graph!.diagram.settings.viewportDevice).toBe('touch');
  expect(graphDatasets(useEditor.getState().graph!)).toHaveLength(1);
});
it.each(['source cells', 'analysis settings', 'connection condition'] as const)(
  'still rejects concurrent %s changes even when they arrive only through a committed version',
  async (kind) => {
    const graph = fixture();
    let complete!: (graph: Graph) => void;
    let submitted!: Graph;
    vi.spyOn(modelClient, 'reanalyzeDataModelAsync').mockImplementationOnce((next) => {
      submitted = next;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const close = vi.fn();
    render(<DataSourcesDialog onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove source Orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply data model' }));
    let updated: Graph = {
      ...graph,
      diagram: { ...graph.diagram, version: graph.diagram.version + 1 },
    };
    if (kind === 'source cells')
      updated = {
        ...updated,
        dataset: {
          ...graph.dataset!,
          rows: [
            ['A', 'Updated customer'],
            ['B', 'Bob'],
          ],
        },
      };
    else if (kind === 'analysis settings')
      updated = {
        ...updated,
        diagram: {
          ...updated.diagram,
          settings: {
            ...updated.diagram.settings,
            csvAnalysis: {
              ...updated.diagram.settings.csvAnalysis!,
              filters: [{ id: 'b', columnId: 'c0', operation: 'equals', value: 'B' }],
            },
          },
        },
      };
    else
      updated = {
        ...updated,
        edges: updated.edges.map((edge, index) =>
          index === 0
            ? { ...edge, label: 'New authoritative condition', direction: 'forward' }
            : edge,
        ),
      };
    act(() => useEditor.setState({ graph: updated }));
    await act(async () => complete(reanalyzeDataModel(submitted)));
    expect(await screen.findByRole('alert')).toHaveTextContent('diagram changed');
    expect(close).not.toHaveBeenCalled();
    expect(useEditor.getState().graph).toBe(updated);
  },
);
