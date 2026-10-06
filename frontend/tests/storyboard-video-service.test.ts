import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { defaultOverview, setOverviewConfig } from '../src/overview/types';
import {
  addStoryboardScene,
  getStoryboard,
  updateStoryboardScene,
} from '../src/presentation/storyboard';

const runtime = vi.hoisted(() => ({
  start: vi.fn(() => ({ status: 'preparing' })),
  release: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('../src/presentation/video-runtime', () => ({
  VideoExporter: class {
    start = runtime.start;
    isBusy = () => false;
    settled = () => Promise.resolve();
    cancel = vi.fn();
    subscribe = vi.fn();
    getState = () => ({ status: 'idle' });
  },
}));
vi.mock('../src/presentation/service', () => ({
  focusPresentationCamera: vi.fn(),
  focusPresentationStepCamera: vi.fn(),
  revealPresentationStep: vi.fn(),
  releasePresentationHighlight: runtime.release,
  presentation: {
    getState: () => ({ open: true, source: 'storyboard', audio: false, subtitles: true }),
    open: vi.fn(),
    pause: vi.fn(),
  },
}));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: runtime.prepare, cancel: vi.fn() },
}));
import { startVideo } from '../src/presentation/video-service';

beforeEach(() => {
  vi.clearAllMocks();
  let graph = blankGraph('Truck storyboard');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build' }),
    newNode(graph.diagram.id, { title: 'Deliver' }),
  ];
  graph = addStoryboardScene(graph, [graph.nodes[0].id], []);
  graph = addStoryboardScene(graph, [graph.nodes[1].id], []);
  graph = updateStoryboardScene(graph, getStoryboard(graph).scenes[1].id, {
    view: { mode: '3d', camera: { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } } },
  });
  graph = setOverviewConfig(graph, { ...defaultOverview(), enabled: true });
  useEditor.setState({ graph, privacyAcknowledged: true, mcpAccess: 'write' });
});
afterEach(() => useEditor.setState({ graph: null }));

it('preflights every movie scene before starting, downloading speech or changing graph data', () => {
  const before = JSON.stringify(useEditor.getState().graph);
  expect(() => startVideo({ source: 'storyboard', audio: true }, true)).toThrow(
    'Choose Details or use Auto-fit objects',
  );
  expect(runtime.start).not.toHaveBeenCalled();
  expect(runtime.prepare).not.toHaveBeenCalled();
  expect(runtime.release).not.toHaveBeenCalled();
  expect(JSON.stringify(useEditor.getState().graph)).toBe(before);
});
it('allows Auto-fit scenes in Overview and saved views in Details', async () => {
  const original = useEditor.getState().graph!;
  useEditor.setState({
    graph: updateStoryboardScene(original, getStoryboard(original).scenes[1].id, {
      view: undefined,
    }),
  });
  expect(startVideo({ source: 'storyboard' })).toEqual({ status: 'preparing' });
  await Promise.resolve();
  useEditor.setState({
    graph: setOverviewConfig(original, { ...defaultOverview(), enabled: false }),
  });
  expect(startVideo({ source: 'storyboard' })).toEqual({ status: 'preparing' });
  await Promise.resolve();
  expect(runtime.start).toHaveBeenCalledTimes(2);
});
