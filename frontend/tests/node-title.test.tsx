import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NodeTitle } from '../src/nodes/NodeTitle';
import { SpatialTitle } from '../src/spatial/SpatialTitle';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { collaborationPermissions } from '../src/collaboration/access';
import { isReadonlyNodeTitle } from '../src/canvas/logical-geometry';
import { MindmapNode } from '../src/mindmap/Topic';
import { projectGraph } from '../src/canvas/projection';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  NodeResizer: () => null,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

beforeEach(() => {
  useEditor.getState().setGraph(null);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const graph = blankGraph('Inline titles', 'flowchart');
  const node = newNode(graph.diagram.id, { title: 'Review requests', nodeType: 'process' });
  graph.nodes = [node];
  useEditor.getState().setGraph(graph);
  return { graph, node };
}

it('commits one undoable ordinary-node rename on Enter and cancels the next draft on Escape', () => {
  const { node } = setup();
  render(<NodeTitle id={node.id} title={node.title} />);
  fireEvent.doubleClick(screen.getByText(node.title));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Approve requests  ' } });
  expect(useEditor.getState().graph!.nodes[0].title).toBe(node.title);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Approve requests');
  expect(useEditor.getState().history).toHaveLength(1);
  act(() => useEditor.getState().beginEditing(node.id));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discard this' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Approve requests');
  expect(useEditor.getState().editingNode).toBeNull();
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph!.nodes[0].title).toBe(node.title);
});

it('keeps newline and IME input as drafts; blur commits and an empty draft preserves the name', () => {
  const { node } = setup();
  render(<NodeTitle id={node.id} title={node.title} />);
  act(() => useEditor.getState().beginEditing(node.id));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review\norders' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(screen.getByRole('textbox'), {
    key: 'Enter',
    keyCode: 229,
    isComposing: false,
  });
  expect(useEditor.getState().editingNode).toBe(node.id);
  fireEvent.blur(screen.getByRole('textbox'));
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Review\norders');
  act(() => useEditor.getState().beginEditing(node.id));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Review\norders');
});

it('does not turn read-only or exporting node faces into editors', () => {
  const { node } = setup();
  const { rerender } = render(<NodeTitle id={node.id} title={node.title} readonly />);
  fireEvent.doubleClick(screen.getByText(node.title));
  expect(useEditor.getState().editingNode).toBeNull();
  act(() => useEditor.getState().beginEditing(node.id));
  expect(screen.queryByRole('textbox')).toBeNull();
  rerender(<NodeTitle id={node.id} title={node.title} exporting />);
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('requires two stationary single-finger taps and lets a second finger elsewhere remain a pinch', () => {
  const { node } = setup();
  render(<NodeTitle id={node.id} title={node.title} />);
  const title = screen.getByText(node.title);
  const pointer = { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 80, clientY: 90 };
  const tap = () => {
    fireEvent.pointerDown(title, pointer);
    fireEvent.pointerUp(title, pointer);
  };
  tap();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.pointerDown(title, pointer);
  fireEvent.pointerDown(document.body, { ...pointer, pointerId: 2, isPrimary: false });
  fireEvent.pointerUp(title, pointer);
  expect(screen.queryByRole('textbox')).toBeNull();
  tap();
  expect(screen.queryByRole('textbox')).toBeNull();
  tap();
  expect(screen.getByRole('textbox')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  fireEvent.pointerDown(title, pointer);
  fireEvent.pointerUp(title, { ...pointer, clientX: 100 });
  tap();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('refuses viewer editing before creating a draft and rechecks a revoked write on commit', () => {
  const { graph, node } = setup();
  let role: 'editor' | 'viewer' = 'viewer';
  const release = collaborationPermissions.bind(graph.diagram.id, {
    get role() {
      return role;
    },
    check: () => {},
    hasSharedChanges: () => true,
  });
  try {
    useEditor.getState().beginEditing(node.id);
    expect(useEditor.getState().editingNode).toBeNull();
    role = 'editor';
    useEditor.getState().beginEditing(node.id);
    useEditor.setState({ editingTitle: 'Forbidden late write' });
    role = 'viewer';
    useEditor.getState().finishEditing();
    expect(useEditor.getState().graph!.nodes[0].title).toBe(node.title);
    expect(useEditor.getState().history).toHaveLength(0);
    expect(useEditor.getState().editingNode).toBeNull();
  } finally {
    release();
  }
});

it('allows canonical titles in packed simulation layouts but keeps generated summaries read only', () => {
  const { node } = setup();
  expect(isReadonlyNodeTitle({ ...node, metadata: { simulationLayoutProjected: true } })).toBe(
    false,
  );
  expect(
    isReadonlyNodeTitle({
      ...node,
      metadata: { simulationProjected: true, simulationLogicalNodeId: node.id },
    }),
  ).toBe(false);
  expect(
    isReadonlyNodeTitle({
      ...node,
      metadata: { simulationProjected: true, simulationLogicalNodeId: 'other' },
    }),
  ).toBe(true);
  expect(
    isReadonlyNodeTitle({
      ...node,
      metadata: {
        simulationProjected: true,
        simulationLogicalNodeId: node.id,
        simulationPoolSummary: true,
      },
    }),
  ).toBe(true);
});

it('mounts just one 3D title editor at the projected face and discards its draft after workspace close', () => {
  const { graph, node } = setup();
  const project = vi.fn(() => ({ x: 240, y: 150, width: 300 }));
  const { container, rerender } = render(<SpatialTitle graph={graph} project={project} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  act(() => useEditor.getState().beginEditing(node.id));
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(container.querySelector<HTMLElement>('.spatial-title-editor')!.style.left).toBe('240px');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sensitive draft' } });
  act(() => useEditor.getState().setGraph(null));
  rerender(<SpatialTitle graph={graph} project={project} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(useEditor.getState().editingTitle).toBe('');
});

it('keeps mind-map input compositions as drafts before committing a normal Enter', () => {
  const graph = blankGraph('Mind-map IME', 'mindmap');
  const node = newNode(graph.diagram.id, { title: 'Customer services' });
  graph.nodes = [node];
  useEditor.getState().setGraph(graph);
  const view = projectGraph(graph, []).nodes[0];
  render(
    <MindmapNode
      id={view.id}
      data={view.data}
      type={view.type!}
      selected={false}
      dragging={false}
      draggable
      selectable
      deletable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      zIndex={0}
    />,
  );
  act(() => useEditor.getState().beginEditing(node.id));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Approved name' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(screen.getByRole('textbox'), {
    key: 'Enter',
    keyCode: 229,
    isComposing: false,
  });
  expect(useEditor.getState().editingNode).toBe(node.id);
  expect(useEditor.getState().graph!.nodes[0].title).toBe(node.title);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Approved name');
});

it('commits a stencil topic on Tab and starts an ordinary child without inheriting its glyph', () => {
  const graph = blankGraph('Mixed mind-map title', 'mindmap');
  const node = newNode(graph.diagram.id, {
    title: 'Review input',
    flowchartSymbol: 'ibm-input-output',
  });
  graph.nodes = [node];
  useEditor.getState().setGraph(graph);
  render(<NodeTitle id={node.id} title={node.title} mindmap />);
  act(() => useEditor.getState().beginEditing(node.id));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Approved input' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab', isComposing: true });
  expect(useEditor.getState().graph!.nodes).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
  const state = useEditor.getState();
  expect(state.graph!.nodes[0]).toMatchObject({
    title: 'Approved input',
    flowchartSymbol: 'ibm-input-output',
  });
  const child = state.graph!.nodes.find((item) => item.parentId === node.id)!;
  expect(child.flowchartSymbol).toBeUndefined();
  expect(child.title).toBe('New child');
  expect(state.editingNode).toBe(child.id);
  expect(state.selectedNodes).toEqual([child.id]);
});
