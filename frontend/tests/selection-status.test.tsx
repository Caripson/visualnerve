import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SelectionTools } from '../src/ui/SelectionTools';
import { Properties } from '../src/components/Properties';
import { useEditor } from '../src/state/editor';
import { blankGraph, newEdge, newNode } from '../src/model/types';

beforeEach(() => useEditor.getState().setGraph(null));
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const graph = blankGraph('Object status');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Contract', status: 'planned', color: '#d05a73' }),
    newNode(graph.diagram.id, { title: 'Invoice', status: 'blocked', metadata: { key: 'keep' } }),
    newNode(graph.diagram.id, { title: 'Delivery', status: 'awaiting customer' }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'then' }),
  ];
  useEditor.getState().setGraph(graph);
  return graph;
}

it('completes and reopens a mixed selection with one undo step while preserving objects and relationships', () => {
  const graph = fixture();
  useEditor.getState().select(graph.nodes.slice(0, 2).map((node) => node.id));
  render(<SelectionTools />);
  expect(screen.getByLabelText('Selection status')).toHaveDisplayValue('Mixed statuses');
  fireEvent.click(screen.getByRole('button', { name: 'Mark selected objects done' }));
  expect(useEditor.getState().graph).toEqual({
    ...graph,
    nodes: graph.nodes.map((node, i) => (i < 2 ? { ...node, status: 'done' } : node)),
  });
  expect(useEditor.getState().history).toHaveLength(1);
  expect(screen.getByLabelText('Selection status')).toHaveDisplayValue('Done');
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph).toEqual(graph);
  act(() => {
    useEditor.getState().redo();
    useEditor.getState().select(graph.nodes.slice(0, 2).map((node) => node.id));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reopen selected objects' }));
  expect(useEditor.getState().graph?.nodes.map((node) => node.status)).toEqual([
    'in-progress',
    'in-progress',
    'awaiting customer',
  ]);
  act(() => useEditor.getState().undo());
  expect(
    useEditor
      .getState()
      .graph?.nodes.slice(0, 2)
      .every((node) => node.status === 'done'),
  ).toBe(true);
});

it('displays existing custom status and lets a user clear it without changing any other node field', () => {
  const graph = fixture();
  useEditor.getState().select([graph.nodes[2].id]);
  render(<SelectionTools />);
  expect(screen.getByLabelText('Selection status')).toHaveDisplayValue('awaiting customer');
  fireEvent.click(screen.getByLabelText('Choose status'));
  fireEvent.change(screen.getByLabelText('Selection status'), { target: { value: '' } });
  expect(useEditor.getState().graph).toEqual({
    ...graph,
    nodes: graph.nodes.map((node, i) => (i === 2 ? { ...node, status: '' } : node)),
  });
  expect(screen.getByLabelText('Choose status')).toHaveFocus();
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph).toEqual(graph);
});

it('keeps completion actions out of an edge-only selection', () => {
  const graph = fixture();
  useEditor.getState().select([], [graph.edges[0].id]);
  render(<SelectionTools />);
  expect(screen.queryByLabelText('Choose status')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Mark selected objects done' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete selection' })).toBeVisible();
});

it('keeps custom status visible in properties and discrete status edits individually undoable', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const graph = fixture();
  useEditor.getState().select([graph.nodes[2].id]);
  render(<Properties />);
  const status = screen.getByLabelText('Node status');
  expect(status).toHaveDisplayValue('awaiting customer');
  fireEvent.change(status, { target: { value: 'in-progress' } });
  expect(status).toHaveDisplayValue('In progress');
  fireEvent.change(status, { target: { value: 'done' } });
  expect(useEditor.getState().history).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Node title'), { target: { value: 'Customer review' } });
  expect(useEditor.getState().history).toHaveLength(3);
  act(() => {
    useEditor.getState().undo();
    useEditor.getState().select([graph.nodes[2].id]);
  });
  expect(useEditor.getState().graph?.nodes[2]).toEqual({ ...graph.nodes[2], status: 'done' });
  act(() => {
    useEditor.getState().undo();
    useEditor.getState().select([graph.nodes[2].id]);
  });
  expect(screen.getByLabelText('Node status')).toHaveDisplayValue('In progress');
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph).toEqual(graph);
});
