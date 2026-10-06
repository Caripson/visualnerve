import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { StoryboardEditor } from '../src/presentation/StoryboardEditor';
import { getStoryboard } from '../src/presentation/storyboard';
import { defaultOverview, setOverviewConfig } from '../src/overview/types';
import {
  PRESENTATION_VIEW_REQUEST,
  type PresentationViewRequest,
} from '../src/presentation/camera';
const player = vi.hoisted(() => ({ open: vi.fn(), seek: vi.fn() }));
vi.mock('../src/presentation/service', () => ({ presentation: player }));
beforeEach(() => {
  const graph = blankGraph('Truck');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build', description: 'Original node description' }),
    newNode(graph.diagram.id, { title: 'Deliver', x: 700 }),
    newNode(graph.diagram.id, { title: 'Service', x: 1400 }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'Ready' }),
  ];
  useEditor.setState({
    graph,
    selectedNodes: [],
    selectedEdges: [graph.edges[0].id],
    history: [],
    future: [],
    editRevision: 0,
  });
  vi.clearAllMocks();
});
afterEach(() =>
  useEditor.setState({
    graph: null,
    selectedNodes: [],
    selectedEdges: [],
    history: [],
    future: [],
  }),
);
it('creates a scene from selected link endpoints, edits separate narration, saves and supports Undo', async () => {
  const before = structuredClone(useEditor.getState().graph!);
  render(<StoryboardEditor />);
  fireEvent.click(screen.getByRole('button', { name: 'New scene from selection' }));
  await screen.findByLabelText('Scene name');
  const scene = getStoryboard(useEditor.getState().graph!).scenes[0];
  expect(scene.nodeIds).toEqual(before.nodes.slice(0, 2).map((n) => n.id));
  expect(scene.edgeIds).toEqual([before.edges[0].id]);
  fireEvent.change(screen.getByLabelText('Scene name'), {
    target: { value: 'Assembly and delivery' },
  });
  fireEvent.change(screen.getByLabelText('Scene narration'), {
    target: { value: 'The scene explains two modules together.' },
  });
  fireEvent.change(screen.getByLabelText('Scene seconds'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
  await waitFor(() =>
    expect(getStoryboard(useEditor.getState().graph!).scenes[0]).toMatchObject({
      id: scene.id,
      name: 'Assembly and delivery',
      narration: 'The scene explains two modules together.',
      seconds: 12,
    }),
  );
  expect(useEditor.getState().graph!.nodes).toEqual(before.nodes);
  expect(useEditor.getState().graph!.edges).toEqual(before.edges);
  useEditor.getState().undo();
  expect(getStoryboard(useEditor.getState().graph!).scenes[0].name).toBe('Scene 1');
});
it('captures a saved viewport, can return to auto-fit, and previews only the saved scene', async () => {
  const respond = (event: Event) =>
    (event as CustomEvent<PresentationViewRequest>).detail.respond({
      mode: '2d',
      viewport: { x: 120, y: -50, zoom: 0.75 },
    });
  window.addEventListener(PRESENTATION_VIEW_REQUEST, respond);
  try {
    render(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'New scene from selection' }));
    await screen.findByLabelText('Scene name');
    fireEvent.click(screen.getByRole('button', { name: 'Capture current view' }));
    await screen.findByText('Saved 2D view');
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    expect(getStoryboard(useEditor.getState().graph!).scenes[0].view).toEqual({
      mode: '2d',
      viewport: { x: 120, y: -50, zoom: 0.75 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved scene' }));
    expect(player.open).toHaveBeenCalledWith('storyboard');
    expect(player.seek).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-fit objects' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    expect(getStoryboard(useEditor.getState().graph!).scenes[0].view).toBeUndefined();
  } finally {
    window.removeEventListener(PRESENTATION_VIEW_REQUEST, respond);
  }
});
it('rejects an invalid draft without replacing the last saved scene', async () => {
  render(<StoryboardEditor />);
  fireEvent.click(screen.getByRole('button', { name: 'New scene from selection' }));
  await screen.findByLabelText('Scene name');
  const before = getStoryboard(useEditor.getState().graph!);
  fireEvent.change(screen.getByLabelText('Scene name'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Scene name');
  expect(getStoryboard(useEditor.getState().graph!)).toEqual(before);
});
it('disables captured views in Overview and explains Details or Auto-fit without changing scene data', async () => {
  useEditor.setState({
    graph: setOverviewConfig(useEditor.getState().graph!, {
      ...defaultOverview(),
      enabled: true,
    }),
  });
  const capture = vi.fn();
  window.addEventListener(PRESENTATION_VIEW_REQUEST, capture);
  try {
    render(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'New scene from selection' }));
    await screen.findByLabelText('Scene name');
    const before = getStoryboard(useEditor.getState().graph!);
    const button = screen.getByRole('button', { name: 'Capture current view' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(capture).not.toHaveBeenCalled();
    expect(screen.getByRole('note')).toHaveTextContent('Choose Details or use Auto-fit objects');
    expect(getStoryboard(useEditor.getState().graph!)).toEqual(before);
  } finally {
    window.removeEventListener(PRESENTATION_VIEW_REQUEST, capture);
  }
});
it('bounds the object chooser and searches a large diagram instead of rendering every checkbox', () => {
  const graph = useEditor.getState().graph!;
  graph.nodes.push(
    ...Array.from({ length: 2000 }, (_, i) =>
      newNode(graph.diagram.id, { title: `Customer ${i}` }),
    ),
  );
  useEditor.setState({ graph: { ...graph } });
  render(<StoryboardEditor />);
  fireEvent.click(screen.getByRole('button', { name: 'New scene from selection' }));
  fireEvent.click(screen.getByText('Choose scene objects'));
  expect(screen.getAllByRole('checkbox')).toHaveLength(151);
  fireEvent.change(screen.getByLabelText('Find scene nodes'), {
    target: { value: 'Customer 1999' },
  });
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByRole('checkbox', { name: 'Customer 1999' })).toBeVisible();
});
