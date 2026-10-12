import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Toolbar } from '../src/components/Toolbar';
import { Properties } from '../src/components/Properties';
import { blankGraph, diagramTypes, newNode } from '../src/model/types';
import { blankAnalytics } from '../src/analytics/validation';
import { createSimulationGraph } from '../src/simulation/document';
import { useEditor } from '../src/state/editor';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({ screenToFlowPosition: (point: unknown) => point }),
  useStoreApi: () => ({ getState: () => ({}) }),
}));

afterEach(() => useEditor.getState().setGraph(null));

const ordinaryTypes = diagramTypes.filter((type) => type !== 'process-simulator');

it.each(ordinaryTypes)(
  'adds and edits symbols in an ordinary %s diagram without changing its mode',
  async (type) => {
    const graph = blankGraph('Use symbols from any ordinary template', type);
    useEditor.getState().setGraph(graph);
    render(
      <>
        <Toolbar open={vi.fn()} showFilters={false} toggleFilters={vi.fn()} />
        <Properties />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'IBM symbols' }));
    expect(await screen.findByRole('heading', { name: 'Classic Flowcharting' })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Add IBM Document' }));
    const selector = await screen.findByLabelText('IBM flowchart symbol', { exact: true });
    const created = useEditor.getState().graph!.nodes[0];
    expect(created.flowchartSymbol).toBe('ibm-document');
    expect(created.nodeType).toBe('document');
    expect(useEditor.getState().graph!.diagram.type).toBe(type);
    fireEvent.change(selector, { target: { value: 'ibm-decision' } });
    expect(useEditor.getState().graph!.nodes[0]).toMatchObject({
      id: created.id,
      title: created.title,
      nodeType: 'document',
      flowchartSymbol: 'ibm-decision',
    });
    fireEvent.change(selector, { target: { value: '' } });
    expect(useEditor.getState().graph!.nodes[0].flowchartSymbol).toBeUndefined();
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.nodes[0].flowchartSymbol).toBe('ibm-decision');
  },
);

it.each(['simulation', 'analytics'] as const)(
  'keeps new symbol tools out of specialized %s documents',
  (mode) => {
    const graph = blankGraph(
      'Specialized tools',
      mode === 'simulation' ? 'process-simulator' : 'freeform',
    );
    if (mode === 'analytics') graph.diagram.analytics = blankAnalytics();
    const node = newNode(graph.diagram.id);
    graph.nodes.push(node);
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([node.id]);
    render(
      <>
        <Toolbar open={vi.fn()} showFilters={false} toggleFilters={vi.fn()} />
        <Properties />
      </>,
    );
    expect(screen.queryByRole('button', { name: 'IBM symbols' })).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('IBM flowchart symbol', { exact: true }),
    ).not.toBeInTheDocument();
  },
);

it('allows clearing an already saved symbol in a specialized document for compatibility', async () => {
  const graph = createSimulationGraph('Existing appearance');
  const node = graph.nodes[0];
  node.flowchartSymbol = 'ibm-process';
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([node.id]);
  render(<Properties />);
  const selector = await screen.findByLabelText('IBM flowchart symbol', { exact: true });
  fireEvent.change(selector, { target: { value: '' } });
  expect(useEditor.getState().graph!.nodes[0].flowchartSymbol).toBeUndefined();
  expect(screen.queryByLabelText('IBM flowchart symbol', { exact: true })).not.toBeInTheDocument();
});
