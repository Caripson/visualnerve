import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layoutWithElk, LAYOUT_TIMEOUT_MS } from '../src/layouts/elk';

const backend = vi.hoisted(() => ({ layout: vi.fn(), construct: vi.fn() }));
vi.mock('elkjs/lib/elk-api.js', () => ({
  default: class {
    constructor(options: unknown) {
      backend.construct(options);
    }
    layout = backend.layout;
  },
}));
class LayoutWorker extends EventTarget {
  static latest: LayoutWorker;
  terminate = vi.fn();
  constructor() {
    super();
    LayoutWorker.latest = this;
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Worker', LayoutWorker);
  backend.layout.mockResolvedValue({ id: 'graph', children: [{ id: 'work', x: 20, y: 10 }] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('uses the worker API and terminates the worker after a successful layout', async () => {
  const input = { id: 'graph' };
  const result = await layoutWithElk(input);
  expect(backend.layout).toHaveBeenCalledWith(input);
  const options = backend.construct.mock.calls[0][0] as {
    algorithms: string[];
    workerFactory(): Worker;
  };
  expect(options.algorithms).toEqual(['layered']);
  expect(options.workerFactory()).toBe(LayoutWorker.latest);
  expect(result.children?.[0].x).toBe(20);
  expect(LayoutWorker.latest.terminate).toHaveBeenCalledOnce();
});
it('reports unsupported browsers without importing a synchronous layout engine', async () => {
  vi.stubGlobal('Worker', undefined);
  await expect(layoutWithElk({ id: 'graph' })).rejects.toThrow('needs Web Workers');
  expect(backend.construct).not.toHaveBeenCalled();
});
it('terminates workers when layout rejects or construction fails', async () => {
  backend.layout.mockRejectedValueOnce(new Error('Invalid graph'));
  await expect(layoutWithElk({ id: 'graph' })).rejects.toThrow('Invalid graph');
  expect(LayoutWorker.latest.terminate).toHaveBeenCalledOnce();
  backend.construct.mockImplementationOnce(() => {
    throw new Error('Worker registration failed');
  });
  await expect(layoutWithElk({ id: 'graph' })).rejects.toThrow('Worker registration failed');
  expect(LayoutWorker.latest.terminate).toHaveBeenCalledOnce();
});
it('fails promptly on worker loading or message errors instead of hanging', async () => {
  for (const event of ['error', 'messageerror']) {
    backend.layout.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = layoutWithElk({ id: 'graph' });
    const failure = expect(pending).rejects.toThrow('could not load its local worker');
    await vi.waitFor(() => expect(backend.layout).toHaveBeenCalled());
    LayoutWorker.latest.dispatchEvent(new Event(event));
    await failure;
    expect(LayoutWorker.latest.terminate).toHaveBeenCalledOnce();
    backend.layout.mockClear();
  }
});
it('bounds a stalled layout and terminates its worker', async () => {
  vi.useFakeTimers();
  backend.layout.mockImplementationOnce(() => new Promise(() => undefined));
  const pending = layoutWithElk({ id: 'graph' });
  const failure = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(LAYOUT_TIMEOUT_MS);
  await failure;
  expect(LayoutWorker.latest.terminate).toHaveBeenCalledOnce();
});
