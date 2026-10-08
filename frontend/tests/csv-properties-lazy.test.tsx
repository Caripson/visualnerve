import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CsvProperties } from '../src/components/CsvProperties';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { useEditor } from '../src/state/editor';

const fixture = vi.hoisted(() => ({
  imports: 0,
  release: undefined as undefined | (() => void),
}));
vi.mock('../src/storage/workspace', () => ({ workspace: {} }));
vi.mock('../src/components/MeasureExplanationDialog', async () => {
  fixture.imports++;
  await new Promise<void>((resolve) => (fixture.release = resolve));
  return { MeasureExplanationDialog: () => <div role="dialog">Measure evidence opened</div> };
});
afterEach(() => {
  cleanup();
  useEditor.setState({ graph: null });
});

it('defers evidence computation until requested and cancels a pending dialog without changing the dataset', async () => {
  const dataset = parseCsv('Company,Amount\nAAA,10\nAAA,20', 'orders.csv');
  const analysis = {
    ...defaultAnalysis(dataset),
    levels: ['c0'],
    metrics: [{ id: 'sum', operation: 'sum' as const, columnId: 'c1' }],
  };
  const graph = csvGraph(dataset, analysis);
  const node = graph.nodes.find((item) => item.title === 'AAA')!;
  expect(node).toBeTruthy();
  useEditor.setState({ graph, privacyAcknowledged: true });
  const initial = structuredClone(graph);
  render(<CsvProperties graph={graph} node={node} />);
  expect(fixture.imports).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Explain Sum · Amount' }));
  await waitFor(() => expect(fixture.imports).toBe(1));
  expect(screen.getByRole('dialog', { name: 'Opening tools' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => fixture.release!());
  expect(screen.queryByText('Measure evidence opened')).toBeNull();
  expect(graph).toEqual(initial);
  expect(graph.dataset).toBe(dataset);
  fireEvent.click(screen.getByRole('button', { name: 'Explain Sum · Amount' }));
  expect(await screen.findByText('Measure evidence opened')).toBeInTheDocument();
  expect(fixture.imports).toBe(1);
  expect(useEditor.getState().graph).toBe(graph);
  expect(graph).toEqual(initial);
});
