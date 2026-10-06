import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MetricSummary } from '../src/components/MetricSummary';
import { Properties } from '../src/components/Properties';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { useEditor } from '../src/state/editor';
import { blankGraph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { copySelection } from '../src/state/clipboard';

beforeEach(() => useEditor.getState().setGraph(null));

it('shows every supported measure, empty results and per-object visibility without changing the title', () => {
  const dataset = parseCsv(
    'Region,Amount,Label,Empty\nNorth,10,A,\nNorth,30,B,\nNorth,,B,\nNorth,nope,A,\nSouth,4,C,',
    'sales.csv',
  );
  const analysis = defaultAnalysis(dataset);
  analysis.metrics = [
    { id: 'count', operation: 'count' },
    ...(['sum', 'avg', 'median', 'min', 'max'] as const).map((operation) => ({
      id: operation,
      operation,
      columnId: 'c1',
    })),
    { id: 'distinct', operation: 'distinct', columnId: 'c2' },
    { id: 'empty', operation: 'sum', columnId: 'c3' },
  ];
  const graph = csvGraph(dataset, analysis);
  const node = graph.nodes.find((item) => getCsvNode(item)?.path[0]?.value === 'North')!;
  const { rerender } = render(<MetricSummary node={node} />);
  const summary = screen.getByLabelText('CSV measures');
  for (const label of [
    'Count',
    'Sum · Amount',
    'Average · Amount',
    'Median · Amount',
    'Min · Amount',
    'Max · Amount',
    'Distinct · Label',
  ])
    expect(within(summary).getByText(label)).toBeVisible();
  expect(summary.querySelector('[data-csv-metric-id="sum"] dd')).toHaveTextContent('40');
  expect(summary.querySelector('[data-csv-metric-id="avg"] dd')).toHaveTextContent('20');
  expect(summary.querySelector('[data-csv-metric-id="empty"] dd')).toHaveTextContent('—');
  const hidden = {
    ...node,
    metadata: { ...node.metadata, csv: { ...getCsvNode(node)!, hiddenMetricIds: ['sum'] } },
  };
  rerender(<MetricSummary node={hidden} />);
  expect(summary.querySelector('[data-csv-metric-id="sum"]')).toBeNull();
  expect(hidden.title).toBe(node.title);
});

function SelectedSummary() {
  const node = useEditor((state) =>
    state.graph?.nodes.find((item) => item.id === state.selectedNodes[0]),
  );
  return node ? <MetricSummary node={node} /> : null;
}

it('keeps pasted metric snapshots editable and undoable without recreating a source binding', () => {
  const dataset = parseCsv('Region,Amount\nNorth,10\nNorth,20', 'Source.csv');
  const analysis = defaultAnalysis(dataset);
  analysis.metrics.push({ id: 'sum', operation: 'sum', columnId: 'c1' });
  const source = csvGraph(dataset, analysis);
  const north = source.nodes.find((node) => node.title === 'North')!;
  useEditor.getState().setGraph(blankGraph('Copied metrics'));
  useEditor.getState().paste(copySelection(source, [north.id]));
  const node = useEditor.getState().graph!.nodes[0];
  const focusCsv = vi.fn();
  render(
    <>
      <Properties focusCsv={focusCsv} />
      <SelectedSummary />
    </>,
  );
  expect(screen.getByText('The CSV source is unavailable for this object.')).toBeVisible();
  expect(screen.queryByText('Explore this group')).toBeNull();
  expect(screen.queryByText(/Source rows \(/)).toBeNull();
  expect(
    screen.getByLabelText('CSV measures').querySelector('[data-csv-metric-id="sum"] dd'),
  ).toHaveTextContent('30');
  fireEvent.click(screen.getByLabelText('Show Sum · Amount'));
  const edited = useEditor.getState().graph!.nodes[0];
  expect(edited.metadata.csv).toBeUndefined();
  expect(getCsvNode(edited)?.hiddenMetricIds).toEqual(['sum']);
  expect(() => validateGraph(useEditor.getState().graph!)).not.toThrow();
  expect(
    screen.getByLabelText('CSV measures').querySelector('[data-csv-metric-id="sum"]'),
  ).toBeNull();
  act(() => {
    useEditor.getState().undo();
    useEditor.getState().select([node.id]);
  });
  expect(useEditor.getState().graph!.nodes[0].metadata.csv).toBeUndefined();
  expect(
    screen.getByLabelText('CSV measures').querySelector('[data-csv-metric-id="sum"] dd'),
  ).toHaveTextContent('30');
  expect(() => validateGraph(useEditor.getState().graph!)).not.toThrow();
  const snapshot = copySelection(useEditor.getState().graph!, [node.id]);
  act(() => {
    useEditor.getState().setGraph(source);
    useEditor.getState().paste(snapshot);
  });
  expect(screen.getByText('The CSV source is unavailable for this object.')).toBeVisible();
  expect(screen.queryByText('Explore this group')).toBeNull();
  expect(screen.queryByText(/Source rows \(/)).toBeNull();
  const returned = useEditor
    .getState()
    .graph!.nodes.find((item) => item.id === useEditor.getState().selectedNodes[0])!;
  expect(returned.metadata.csv).toBeUndefined();
  expect(returned.metadata.csvSnapshot).toBeDefined();
  expect(() => validateGraph(useEditor.getState().graph!)).not.toThrow();
});

it(
  'undoes object measure and source-column choices, limits source previews and reopens diagram analysis',
  { timeout: 15000 },
  async () => {
    const dataset = parseCsv(
      `Region,Amount,Label\n${Array.from({ length: 101 }, (_, index) => `North,${index},Item ${index}`).join('\n')}\nSouth,5,Other`,
      'sales.csv',
    );
    const analysis = defaultAnalysis(dataset);
    analysis.metrics.push({ id: 'sum', operation: 'sum', columnId: 'c1' });
    const graph = csvGraph(dataset, analysis);
    const node = graph.nodes.find((item) => getCsvNode(item)?.path[0]?.value === 'North')!;
    node.metadata.integration = { key: 'keep' };
    useEditor.getState().setGraph(graph);
    useEditor.setState({ selectedNodes: [node.id] });
    const editCsv = vi.fn();
    render(
      <>
        <Properties editCsv={editCsv} />
        <SelectedSummary />
      </>,
    );
    fireEvent.click(screen.getByLabelText('Show Sum · Amount'));
    expect(
      screen.getByLabelText('CSV measures').querySelector('[data-csv-metric-id="sum"]'),
    ).toBeNull();
    expect(
      useEditor.getState().graph!.nodes.find((item) => item.id === node.id)!.metadata.integration,
    ).toEqual({ key: 'keep' });
    act(() => {
      useEditor.getState().undo();
      useEditor.getState().select([node.id]);
    });
    expect(
      screen.getByLabelText('CSV measures').querySelector('[data-csv-metric-id="sum"]'),
    ).not.toBeNull();

    fireEvent.click(screen.getByText('Source rows (101)'));
    const table = await screen.findByRole('table', { name: 'Source rows' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(screen.getByText(/Showing 100 of 101 rows/)).toBeVisible();
    expect(within(table).queryByText('Other')).toBeNull();
    fireEvent.click(screen.getByText('Columns shown (3)'));
    fireEvent.click(screen.getByLabelText('Show source column Amount'));
    expect(within(table).queryByRole('columnheader', { name: 'Amount' })).toBeNull();
    expect(useEditor.getState().graph!.dataset).toBe(dataset);
    act(() => {
      useEditor.getState().undo();
      useEditor.getState().select([node.id]);
    });
    expect(screen.getByLabelText('Show source column Amount')).toBeChecked();

    act(() => useEditor.getState().select([]));
    expect(screen.getByText('sales.csv')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change grouping and measures' }));
    expect(editCsv).toHaveBeenCalledOnce();
  },
);

it('explores and pages full groups while previewing cleaned and original source values', async () => {
  const dataset = parseCsv(
    'Customer,Country,Amount\nAAANorth,Sweden,10\nAAANorth,Norway,20\nAAASouth,Denmark,30\nAAAEast,Finland,40',
    'customers.csv',
  );
  const analysis = defaultAnalysis(dataset);
  analysis.levels = ['c0', 'c1'];
  analysis.limit = 1;
  analysis.columnRules = [{ columnId: 'c0', pattern: '^AAA', replacement: '' }];
  const graph = csvGraph(dataset, analysis);
  const node = graph.nodes.find((item) => getCsvNode(item)?.path[0]?.value === 'North')!;
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([node.id]);
  const focusCsv = vi.fn();
  const pageCsv = vi.fn();
  render(<Properties focusCsv={focusCsv} pageCsv={pageCsv} />);
  expect(screen.getByText(/1 more groups/)).toBeVisible();
  expect(screen.getByText(/Measures include all 2 matching rows/)).toBeVisible();
  expect(screen.getByText(/Current view: groups 1–1 of 3/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Previous groups' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next groups' }));
  expect(pageCsv).toHaveBeenCalledWith('next', dataset.id);
  fireEvent.click(screen.getByRole('button', { name: 'Explore this group' }));
  expect(focusCsv).toHaveBeenCalledWith(getCsvNode(node)!.path, dataset.id);
  fireEvent.click(screen.getByRole('button', { name: 'All data' }));
  expect(focusCsv).toHaveBeenCalledWith([], dataset.id);

  fireEvent.click(screen.getByText('Source rows (2)'));
  const table = await screen.findByRole('table', { name: 'Source rows' });
  expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(within(table).getAllByText('North')).toHaveLength(2);
  expect(within(table).queryByText('AAANorth')).toBeNull();
  fireEvent.click(screen.getByLabelText('Original values'));
  expect(within(table).getAllByText('AAANorth')).toHaveLength(2);
  expect(within(table).queryByText('North')).toBeNull();
  expect(dataset.rows[0][0]).toBe('AAANorth');
});
