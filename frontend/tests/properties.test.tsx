import { beforeEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Properties } from '../src/components/Properties';
import { useEditor } from '../src/state/editor';
import { base, blankGraph, newNode } from '../src/model/types';
import { createSimulationGraph } from '../src/simulation/document';
beforeEach(() => useEditor.getState().setGraph(null));
it('edits selected node properties and assigns a first-class owner as an undoable command', () => {
  const graph = blankGraph('Launch');
  const node = newNode(graph.diagram.id, { title: 'Research' });
  graph.nodes.push(node);
  const owner = {
    ...base(),
    name: 'Johan',
    kind: 'person' as const,
    color: '#31766c',
    metadata: {},
  };
  useEditor.getState().setGraph(graph);
  useEditor.setState({ selectedNodes: [node.id], owners: [owner] });
  render(<Properties />);
  fireEvent.change(screen.getByLabelText('Node title'), { target: { value: 'Market research' } });
  expect(useEditor.getState().graph?.nodes[0].title).toBe('Market research');
  fireEvent.change(screen.getByLabelText('Node owner'), { target: { value: owner.id } });
  expect(useEditor.getState().graph?.nodes[0].ownerIds).toEqual([owner.id]);
  useEditor.getState().undo();
  expect(useEditor.getState().graph?.nodes[0].ownerIds).toEqual([]);
});
it('keeps a required simulation resource selected and explains a rejected delete in Properties', () => {
  const graph = createSimulationGraph('Kiosk');
  const resource = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([resource.id]);
  render(<Properties />);
  fireEvent.click(screen.getByRole('button', { name: /^Delete node$/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('Disconnect this shared resource');
  expect(screen.getByLabelText('Node title')).toHaveValue(resource.name);
  expect(useEditor.getState().selectedNodes).toEqual([resource.id]);
  expect(useEditor.getState().graph).toBe(graph);
  // An outstanding viewport save can acknowledge after this rejected deletion.
  act(() => useEditor.setState({ status: 'saved', message: '' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Disconnect this shared resource');
  act(() =>
    useEditor.getState().command('Viewport', (current) => ({
      ...current,
      diagram: {
        ...current.diagram,
        settings: { ...current.diagram.settings, viewport: { x: 10, y: 20, zoom: 1 } },
      },
    })),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Disconnect this shared resource');
  fireEvent.change(screen.getByLabelText('Node title'), {
    target: { value: 'Updated shared employee' },
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
