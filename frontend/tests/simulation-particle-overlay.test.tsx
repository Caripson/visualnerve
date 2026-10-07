import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ParticleOverlay } from '../src/simulation/ParticleOverlay';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import { useEditor } from '../src/state/editor';
import type { SimulationView } from '../src/simulation/service';

let view: SimulationView | undefined;
vi.mock('../src/simulation/useSimulation', () => ({ useSimulation: () => view }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));
let now = 0,
  nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  rotate: vi.fn(),
  setLineDash: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
};
beforeEach(() => {
  now = 0;
  nextFrame = 0;
  frames.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(readonly definition: string) {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 4000,
    bottom: 4000,
    width: 4000,
    height: 4000,
    toJSON: () => ({}),
  });
  const create = document.createElementNS.bind(document);
  vi.spyOn(document, 'createElementNS').mockImplementation(((namespace: string, name: string) => {
    const element = create(namespace, name);
    if (name === 'path')
      Object.assign(element, {
        getTotalLength: () => 100,
        getPointAtLength: (length: number) => ({ x: length, y: 0 }),
      });
    return element;
  }) as typeof document.createElementNS);
});
afterEach(() => {
  cleanup();
  view = undefined;
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  frames.clear();
});
function fixture() {
  const model = createBasicModel({ particles: 1, processingSeconds: 1 });
  model.edges[0].travelSeconds = 3;
  model.edges[1].travelSeconds = 3;
  const graph = createSimulationGraph('Observed traffic', model);
  useEditor.getState().setGraph(graph);
  const engine = new SimulationEngine(graph.simulation!);
  engine.advance(1);
  view = {
    run: {
      id: 'observed-traffic',
      diagramId: graph.diagram.id,
      model: graph.simulation!,
      options: { seed: 42, durationSeconds: 60, speed: 10, animated: true },
      status: 'running',
      createdAt: '',
      updatedAt: '',
    },
    state: engine.state(),
  };
  return { engine, graph };
}
function frameAt(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  for (const frame of pending) frame(time);
}

it('moves only actual transit work between received times, then freezes exactly on pause/replay', () => {
  const { engine } = fixture();
  const { rerender } = render(<ParticleOverlay />);
  const canvas = screen.getByTestId('simulation-particles');
  expect(canvas).toHaveAttribute('data-transit-particles', '1');
  expect(canvas).toHaveAttribute('data-rendered-time', '1');
  expect(frames.size).toBe(0);
  now = 50;
  engine.advance(1.5);
  view = { ...view!, state: engine.state() };
  rerender(<ParticleOverlay />);
  expect(canvas).toHaveAttribute('data-simulated-time', '1.5');
  expect(canvas).toHaveAttribute('data-rendered-time', '1');
  frameAt(75);
  expect(canvas).toHaveAttribute('data-rendered-time', '1.25');
  expect(context.arc.mock.calls.at(-1)![0]).toBeCloseTo((100 * 1.25) / 3);
  expect(context.arc.mock.calls.at(-1)!.slice(1)).toEqual([0, 6, 0, Math.PI * 2]);
  frameAt(100);
  expect(canvas).toHaveAttribute('data-rendered-time', '1.5');
  expect(frames.size).toBe(0);
  now = 110;
  view = { ...view!, state: { ...view!.state!, status: 'paused' } };
  rerender(<ParticleOverlay />);
  const pausedCalls = context.arc.mock.calls.length;
  frameAt(10000);
  expect(canvas).toHaveAttribute('data-rendered-time', '1.5');
  expect(context.arc.mock.calls.length).toBe(pausedCalls);
  view = { ...view!, replayTimeSeconds: 1.5, state: { ...view!.state!, status: 'running' } };
  rerender(<ParticleOverlay />);
  expect(frames.size).toBe(0); // even if an intermediate replay snapshot says running
});

it('MAX uses exact state and completed/abandoned work never continues along a route', () => {
  const { engine } = fixture();
  view!.run.options.speed = 'max';
  const { rerender } = render(<ParticleOverlay />);
  engine.advance(9);
  now = 50;
  view = { ...view!, state: engine.state() };
  rerender(<ParticleOverlay />);
  const canvas = screen.getByTestId('simulation-particles');
  expect(canvas).toHaveAttribute('data-rendered-time', '9');
  expect(canvas).toHaveAttribute('data-transit-particles', '0');
  expect(canvas).toHaveAttribute('data-processing-particles', '0');
  expect(frames.size).toBe(0);
});

it('bounds real queue marks and exposes the whole simulated population without floating canvas text', () => {
  fixture();
  const model = createBasicModel({ particles: 1000 });
  const graph = createSimulationGraph('Real queues', model);
  const engine = new SimulationEngine(graph.simulation!);
  engine.advance(1);
  useEditor.getState().setGraph(graph);
  view = {
    ...view!,
    run: { ...view!.run, id: 'real-queues', model: graph.simulation!, diagramId: graph.diagram.id },
    state: engine.state(),
  };
  render(<ParticleOverlay />);
  const canvas = screen.getByTestId('simulation-particles');
  expect(canvas).toHaveAttribute('data-queued-particles', '12');
  expect(canvas).toHaveAttribute('data-simulated-particles', '1000');
  expect(Number(canvas.dataset.renderedParticles)).toBeLessThanOrEqual(400);
  expect(canvas).toHaveAccessibleName(/green clear, yellow busy, red congested/);
  // The mocked canvas intentionally has no fillText: counts belong to node cards.
});
