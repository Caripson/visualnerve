import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SpatialProperties } from '../src/components/SpatialProperties';
import { Toolbar } from '../src/components/Toolbar';
import { useEditor } from '../src/state/editor';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { getSpatialNode, getSpatialView } from '../src/spatial/types';
import { spatialPositions } from '../src/spatial/layout';
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({ screenToFlowPosition: () => ({ x: 0, y: 0 }) }),
  useStoreApi: () => ({ getState: () => ({ width: 900, height: 600, minZoom: 0.01 }) }),
}));
beforeEach(() => useEditor.getState().setGraph(null));
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const graph = blankGraph('Independent views');
  graph.diagram.settings.viewport = { x: 14, y: -9, zoom: 0.65 };
  graph.diagram.settings.spatialView = {
    version: 1,
    mode: '3d',
    camera: { position: { x: 8, y: 9, z: 10 }, target: { x: 0, y: 1, z: 0 } },
  };
  graph.diagram.settings.drawing = {
    version: 1,
    visible: true,
    strokes: [
      {
        id: 'ink',
        color: '#e85d3f',
        width: 3,
        points: [
          [10, 20],
          [30, 40],
        ],
      },
    ],
  };
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Release plan',
      x: 100,
      y: 200,
      status: 'done',
      notes: 'Keep the annotation.',
      metadata: {
        integration: { identity: 'source-42' },
        spatial: { version: 1, position: { x: 1, y: 2, z: 3 } },
      },
    }),
    newNode(graph.diagram.id, {
      title: 'Related topic',
      x: 500,
      y: 600,
      metadata: { spatial: { version: 1, position: { x: -4, y: -5, z: -6 } } },
    }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      label: 'Retain',
      direction: 'both',
    }),
  ];
  useEditor.getState().setGraph(graph);
  return graph;
}
function Placement() {
  const graph = useEditor((state) => state.graph)!;
  const selected = useEditor((state) => state.selectedNodes[0]);
  return (
    <SpatialProperties
      graph={graph}
      node={graph.nodes.find((node) => node.id === selected) ?? graph.nodes[0]}
    />
  );
}
it('rejects incomplete, nonfinite and out-of-range coordinates before a valid undoable placement, keeping 2D geometry and metadata', () => {
  const graph = fixture();
  render(<Placement />);
  const x = screen.getByLabelText('3D X');
  for (const value of ['', '1000001', '-1000001', 'Infinity']) {
    fireEvent.change(x, { target: { value } });
    fireEvent.blur(x);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter finite coordinates');
    expect(useEditor.getState().graph).toEqual(graph);
    expect(useEditor.getState().history).toHaveLength(0);
  }
  fireEvent.change(x, { target: { value: '-12.5' } });
  fireEvent.blur(x);
  const changed = useEditor.getState().graph!;
  expect(screen.queryByRole('alert')).toBeNull();
  expect(changed.nodes[0]).toEqual({
    ...graph.nodes[0],
    metadata: {
      ...graph.nodes[0].metadata,
      spatial: { version: 1, position: { x: -12.5, y: 2, z: 3 } },
    },
  });
  expect(changed.nodes[1]).toEqual(graph.nodes[1]);
  expect(changed.edges).toEqual(graph.edges);
  expect(changed.diagram.settings).toEqual(graph.diagram.settings);
  expect(useEditor.getState().history).toHaveLength(1);
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph).toEqual(graph);
  act(() => useEditor.getState().redo());
  expect(getSpatialNode(useEditor.getState().graph!.nodes[0])?.position?.x).toBe(-12.5);
});
it('restores an independent automatic 3D position without dropping notes, status, metadata or manual relationships', () => {
  const graph = fixture();
  render(<Placement />);
  const x = screen.getByLabelText('3D X');
  fireEvent.change(x, { target: { value: '12' } });
  fireEvent.blur(x);
  expect(getSpatialNode(useEditor.getState().graph!.nodes[0])?.position?.x).toBe(12);
  fireEvent.click(screen.getByRole('button', { name: 'Automatic 3D position' }));
  const current = useEditor.getState().graph!;
  expect(getSpatialNode(current.nodes[0])).toEqual({ version: 1 });
  expect(current.nodes[0]).toEqual({
    ...graph.nodes[0],
    metadata: { integration: { identity: 'source-42' }, spatial: { version: 1 } },
  });
  expect(current.nodes[1]).toEqual(graph.nodes[1]);
  expect(current.edges).toEqual(graph.edges);
  expect(screen.getByLabelText('3D X')).toHaveValue(
    spatialPositions(current).get(graph.nodes[0].id)!.x,
  );
  expect(screen.getByRole('button', { name: 'Automatic 3D position' })).toBeDisabled();
  act(() => useEditor.getState().undo());
  expect(getSpatialNode(useEditor.getState().graph!.nodes[0])?.position?.x).toBe(12);
});
it('resets a draft when selection changes so an unfinished coordinate is not applied to another object', () => {
  const graph = fixture();
  render(<Placement />);
  fireEvent.change(screen.getByLabelText('3D X'), { target: { value: '99' } });
  act(() => useEditor.getState().select([graph.nodes[1].id]));
  expect(screen.getByLabelText('3D X')).toHaveValue(-4);
  fireEvent.blur(screen.getByLabelText('3D X'));
  expect(useEditor.getState().graph).toEqual(graph);
  expect(useEditor.getState().history).toHaveLength(0);
});
it('switches views after saving inline editing and stopping the pen, preserving camera, viewport, geometry and ink', () => {
  const graph = fixture();
  graph.diagram.settings.spatialView = { ...getSpatialView(graph), mode: '2d' };
  useEditor.getState().setGraph(graph);
  useEditor.setState({
    editingNode: graph.nodes[0].id,
    editingTitle: 'Reviewed release plan',
    drawingTool: 'pen',
  });
  render(<Toolbar open={vi.fn()} showFilters={false} toggleFilters={vi.fn()} />);
  expect(screen.getByRole('button', { name: '2D view' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '3D view' }));
  let state = useEditor.getState();
  expect(state.editingNode).toBeNull();
  expect(state.drawingTool).toBe('none');
  expect(state.graph!.nodes).toEqual(
    graph.nodes.map((node, index) =>
      index === 0 ? { ...node, title: 'Reviewed release plan' } : node,
    ),
  );
  expect(state.graph!.edges).toEqual(graph.edges);
  expect(getSpatialView(state.graph!)).toEqual({ ...getSpatialView(graph), mode: '3d' });
  expect(state.graph!.diagram.settings.viewport).toEqual(graph.diagram.settings.viewport);
  expect(state.graph!.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
  expect(screen.getByRole('button', { name: '3D view' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '2D view' }));
  state = useEditor.getState();
  expect(getSpatialView(state.graph!)).toEqual(getSpatialView(graph));
  expect(state.graph!.nodes[0].title).toBe('Reviewed release plan');
  expect(state.graph!.diagram.settings.viewport).toEqual(graph.diagram.settings.viewport);
  expect(screen.getByRole('button', { name: '2D view' })).toHaveAttribute('aria-pressed', 'true');
});
