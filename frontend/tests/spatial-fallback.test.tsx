import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import { useEditor } from '../src/state/editor';
import { SpatialCanvas } from '../src/spatial/SpatialCanvas';

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three')>()),
  WebGLRenderer: class {
    constructor() {
      throw new Error('WebGL unavailable');
    }
  },
}));
beforeEach(() => {
  const graph = blankGraph('Fallback');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Plan release', status: 'done', x: 100, y: 200 }),
    newNode(graph.diagram.id, { title: 'Ship release', x: 300, y: 400 }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'communicates' }),
  ];
  useEditor.getState().setGraph(graph);
});

it('keeps canonical object and relationship selection available when WebGL cannot start', () => {
  const graph = useEditor.getState().graph!;
  const projection = projectGraph(graph, []);
  const returnTo2D = vi.fn();
  const saveCamera = vi.fn();
  render(
    <SpatialCanvas
      graph={graph}
      nodes={projection.nodes}
      edges={projection.edges}
      onReturnTo2D={returnTo2D}
      onCameraChange={saveCamera}
    />,
  );
  expect(screen.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'unavailable');
  expect(screen.getByText('3D graphics are unavailable in this browser')).toBeVisible();
  fireEvent.click(screen.getByText('Objects and relationships'));
  const object = screen.getByRole('button', { name: 'Select object Plan release' });
  expect(object).toHaveAttribute('data-node-status', 'done');
  fireEvent.click(object);
  expect(useEditor.getState().selectedNodes).toEqual([graph.nodes[0].id]);
  fireEvent.click(screen.getByText('Relationships (1)'));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Select relationship communicates from Plan release to Ship release',
    }),
  );
  expect(useEditor.getState().selectedEdges).toEqual([graph.edges[0].id]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Return to 2D' })[0]);
  expect(returnTo2D).toHaveBeenCalledOnce();
  expect(saveCamera).not.toHaveBeenCalled();
  expect(useEditor.getState().graph).toBe(graph);
  expect(graph.nodes[0]).toMatchObject({ x: 100, y: 200, status: 'done' });
});
