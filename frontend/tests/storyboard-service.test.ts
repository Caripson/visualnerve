import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import {
  addStoryboardScene,
  getStoryboard,
  updateStoryboardScene,
} from '../src/presentation/storyboard';
import { defaultOverview, setOverviewConfig } from '../src/overview/types';
import { presentationSteps } from '../src/presentation/sequence';
import {
  PRESENTATION_ARRIVED,
  PRESENTATION_FOCUS,
  PRESENTATION_REVEAL,
  type PresentationFocus,
  type PresentationRevealRequest,
} from '../src/presentation/camera';
const video = vi.hoisted(() => ({ busy: vi.fn(() => false) }));
vi.mock('../src/presentation/video-service', () => ({
  isVideoExporting: video.busy,
  videoExport: { getState: () => ({ status: 'idle' }), cancel: vi.fn() },
  startVideo: vi.fn(),
}));
import { presentation, revealPresentationStep } from '../src/presentation/service';
import { presentationRequest } from '../src/presentation/commands';
beforeEach(() => {
  let graph = blankGraph('Truck');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build' }),
    newNode(graph.diagram.id, { title: 'Deliver' }),
    newNode(graph.diagram.id, { title: 'Selected before tour' }),
  ];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  graph = addStoryboardScene(graph, [graph.nodes[0].id], [graph.edges[0].id]);
  useEditor.setState({
    graph,
    selectedNodes: [graph.nodes[2].id],
    selectedEdges: [],
    history: [],
    future: [],
  });
  video.busy.mockReturnValue(false);
});
afterEach(() => {
  presentation.close();
  useEditor.setState({ graph: null, selectedNodes: [], selectedEdges: [] });
});
it('opens and seeks storyboard scenes, highlights canonical edge endpoints and restores original selection on close', async () => {
  const graph = useEditor.getState().graph!,
    before = JSON.stringify(graph),
    focus = vi.fn((event: Event) => {
      const request = (event as CustomEvent<PresentationFocus>).detail;
      window.dispatchEvent(
        new CustomEvent(PRESENTATION_ARRIVED, { detail: { requestId: request.requestId } }),
      );
    });
  const reveal = (event: Event) =>
    (event as CustomEvent<PresentationRevealRequest>).detail.respond();
  window.addEventListener(PRESENTATION_FOCUS, focus);
  window.addEventListener(PRESENTATION_REVEAL, reveal);
  try {
    expect(
      await presentationRequest('/presentation/open', 'POST', { source: 'storyboard' }),
    ).toMatchObject({ source: 'storyboard', total: 1, sceneId: getStoryboard(graph).scenes[0].id });
    await presentationRequest('/presentation/seek', 'POST', { index: 0 });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(presentation.getState().status).toBe('paused');
    expect(useEditor.getState().selectedNodes).toEqual(graph.nodes.slice(0, 2).map((n) => n.id));
    expect(useEditor.getState().selectedEdges).toEqual([graph.edges[0].id]);
    expect(focus.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
    await presentationRequest('/presentation/close', 'POST', {});
    expect(useEditor.getState().selectedNodes).toEqual([graph.nodes[2].id]);
    expect(useEditor.getState().selectedEdges).toEqual([]);
    expect(JSON.stringify(useEditor.getState().graph)).toBe(before);
    expect(useEditor.getState().history).toEqual([]);
  } finally {
    window.removeEventListener(PRESENTATION_FOCUS, focus);
    window.removeEventListener(PRESENTATION_REVEAL, reveal);
  }
});
it('rejects malformed scene source/seek commands, rechecks grants and blocks competing exports', async () => {
  for (const value of [{ source: 'wrong' }, { source: true }, { source: 'storyboard', unknown: 1 }])
    await expect(presentationRequest('/presentation/open', 'POST', value)).rejects.toMatchObject({
      status: 422,
    });
  await presentationRequest('/presentation/open', 'POST', { source: 'storyboard' });
  for (const value of [{ index: -1 }, { index: 1 }, { index: 0, extra: 1 }, {}])
    await expect(presentationRequest('/presentation/seek', 'POST', value)).rejects.toMatchObject({
      status: 422,
    });
  const deny = async () => {
    throw Object.assign(new Error('Grant revoked'), { status: 403 });
  };
  await expect(
    presentationRequest('/presentation/open', 'POST', { source: 'storyboard' }, deny),
  ).rejects.toMatchObject({ status: 403 });
  video.busy.mockReturnValue(true);
  await expect(
    presentationRequest('/presentation/open', 'POST', { source: 'storyboard' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    presentationRequest('/presentation/seek', 'POST', { index: 0 }),
  ).rejects.toMatchObject({ status: 409 });
});
it('rejects a saved view in Overview before revealing or selecting any objects, while allowing Auto-fit', async () => {
  let graph = useEditor.getState().graph!;
  graph = updateStoryboardScene(graph, getStoryboard(graph).scenes[0].id, {
    view: { mode: '2d', viewport: { x: 0, y: 0, zoom: 1 } },
  });
  graph = setOverviewConfig(graph, { ...defaultOverview(), enabled: true });
  useEditor.setState({ graph });
  const selected = [...useEditor.getState().selectedNodes],
    before = JSON.stringify(graph),
    reveal = vi.fn((event: Event) =>
      (event as CustomEvent<PresentationRevealRequest>).detail.respond(),
    );
  window.addEventListener(PRESENTATION_REVEAL, reveal);
  try {
    const step = presentationSteps(graph, 'storyboard')[0];
    expect(() => revealPresentationStep(step, new AbortController().signal)).toThrow(
      'Choose Details or use Auto-fit objects',
    );
    expect(reveal).not.toHaveBeenCalled();
    expect(useEditor.getState().selectedNodes).toEqual(selected);
    expect(JSON.stringify(useEditor.getState().graph)).toBe(before);
    presentation.open('storyboard');
    presentation.seek(0);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(presentation.getState()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Choose Details or use Auto-fit objects'),
    });
    expect(useEditor.getState().selectedNodes).toEqual(selected);
    await revealPresentationStep({ ...step, view: undefined }, new AbortController().signal);
    expect(reveal).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(PRESENTATION_REVEAL, reveal);
  }
});
