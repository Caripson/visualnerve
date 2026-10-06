import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnalysisTools } from '../src/components/AnalysisTools';
import { blankGraph, newNode } from '../src/model/types';
import { getExploration, getNamedAnalysisViews } from '../src/analysis/types';
import { useEditor } from '../src/state/editor';
import { Properties } from '../src/components/Properties';
vi.mock('../src/storage/workspace', () => ({
  workspace: { settled: vi.fn().mockResolvedValue(undefined) },
}));
beforeEach(() => {
  const graph = blankGraph('Analysis');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Start' }),
    newNode(graph.diagram.id, { title: 'Finish' }),
  ];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([graph.nodes[0].id]);
});
it('configures directed/undirected paths and resets without changing canonical objects', () => {
  const graph = useEditor.getState().graph!;
  render(<AnalysisTools />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore relationships and views' }));
  fireEvent.change(screen.getByLabelText('Relationship exploration mode'), {
    target: { value: 'path' },
  });
  fireEvent.change(screen.getByLabelText('Path destination'), {
    target: { value: graph.nodes[1].id },
  });
  fireEvent.click(screen.getByLabelText('Follow relationship directions'));
  fireEvent.click(screen.getByRole('button', { name: 'Explore relationships' }));
  expect(getExploration(useEditor.getState().graph!)).toMatchObject({
    mode: 'path',
    directed: false,
    targetId: graph.nodes[1].id,
    startId: graph.nodes[0].id,
  });
  expect(useEditor.getState().graph!.nodes).toBe(graph.nodes);
  fireEvent.click(screen.getAllByRole('button', { name: 'Reset exploration' }).at(-1)!);
  expect(getExploration(useEditor.getState().graph!)).toBeUndefined();
});
it('saves and loads a named layout, keeps current notes, and restores focus after closing the modal', async () => {
  render(<AnalysisTools />);
  const open = screen.getByRole('button', { name: 'Explore relationships and views' });
  open.focus();
  fireEvent.click(open);
  fireEvent.change(screen.getByLabelText('Analysis view name'), {
    target: { value: 'Customer dependencies' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
  const graph = useEditor.getState().graph!;
  const id = getNamedAnalysisViews(graph).views[0].id;
  act(() =>
    useEditor.getState().updateNode(graph.nodes[0].id, { x: 1234, notes: 'Keep this new note' }),
  );
  fireEvent.change(screen.getByLabelText('Saved analysis view'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Load view' }));
  await waitFor(() => expect(screen.getByText(/View loaded/)).toBeVisible());
  expect(useEditor.getState().graph!.nodes[0]).toMatchObject({
    x: graph.nodes[0].x,
    notes: 'Keep this new note',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(open).toHaveFocus();
});
it('keeps the Properties dialog and successful load feedback mounted when loading a view clears node selection', async () => {
  const graph = useEditor.getState().graph!;
  useEditor.getState().saveView('Selected-node view');
  const id = getNamedAnalysisViews(useEditor.getState().graph!).views[0].id;
  useEditor.getState().updateNode(graph.nodes[0].id, { x: 999, notes: 'Keep the latest note' });
  render(<Properties />);
  expect(screen.getByLabelText('Node title')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Explore relationships and views' }));
  const dialog = screen.getByRole('dialog', { name: 'Relationships and analysis views' });
  fireEvent.change(screen.getByLabelText('Saved analysis view'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Load view' }));
  await waitFor(() => expect(screen.getByText(/View loaded/)).toBeVisible());
  expect(useEditor.getState().selectedNodes).toEqual([]);
  expect(screen.getByRole('dialog', { name: 'Relationships and analysis views' })).toBe(dialog);
  expect(screen.getByLabelText('Saved analysis view')).toHaveValue(id);
  expect(screen.getByLabelText('Diagram name')).toBeVisible();
  expect(useEditor.getState().graph!.nodes[0]).toMatchObject({
    x: graph.nodes[0].x,
    notes: 'Keep the latest note',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
