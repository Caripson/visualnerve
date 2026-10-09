import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import {
  SvgExportController,
  shouldUseBackgroundSVG,
  svgGraphSnapshot,
} from '../src/export/svg-jobs';
import {
  svgJobLimits,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from '../src/export/svg-job-types';
class BoundaryWorker {
  request?: SvgWorkerRequest;
  terminated = false;
  onmessage: ((event: MessageEvent<SvgWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(request: SvgWorkerRequest) {
    this.request = structuredClone(request);
  }
  terminate() {
    this.terminated = true;
    this.request = undefined;
  }
  reply(response: SvgWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<SvgWorkerResponse>);
  }
}
const controllers: SvgExportController[] = [];
afterEach(() => {
  controllers.forEach((controller) => controller.clear());
  controllers.length = 0;
  vi.useRealTimers();
});
function fixture() {
  const workers: BoundaryWorker[] = [],
    controller = new SvgExportController(() => {
      const worker = new BoundaryWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
  controllers.push(controller);
  const graph = blankGraph('Synthetic SVG job');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original snapshot' })];
  const abort = new AbortController(),
    dispose = vi.fn(),
    check = vi.fn(async (): Promise<void> => undefined);
  const authority = { guard: { signal: abort.signal, check, assertCurrent: vi.fn() }, dispose };
  return { controller, workers, graph, abort, dispose, check, authority };
}
async function started(f: ReturnType<typeof fixture>) {
  const status = f.controller.start(f.graph, {}, f.authority);
  await vi.waitFor(() => expect(f.workers[0]?.request).toBeDefined());
  return status;
}
function finish(
  worker: BoundaryWorker,
  svg = '<svg>full vector</svg>',
  bytes = new TextEncoder().encode(svg).length,
) {
  worker.reply({ type: 'result', svg, bytes, nodeCount: 1, edgeCount: 0 });
}
describe('transient SVG jobs and originating vault authority', () => {
  it('returns immediately, snapshots only visual content, reports progress and authorizes result publication', async () => {
    const f = fixture();
    f.graph.dataset = { id: 'private rows' } as never;
    const status = f.controller.start(f.graph, {}, f.authority);
    expect(status.state).toBe('queued');
    expect(f.workers).toHaveLength(0);
    f.graph.nodes[0].title = 'Later edit';
    await vi.waitFor(() => expect(f.workers[0]?.request).toBeDefined());
    expect(f.workers[0].request?.graph.nodes[0].title).toBe('Original snapshot');
    expect(f.workers[0].request?.graph.dataset).toBeUndefined();
    const progress: number[] = [],
      wait = f.controller.wait(status.jobId, (update) => progress.push(update.progress));
    f.workers[0].reply({ type: 'progress', progress: 57, phase: 'nodes' });
    expect((await f.controller.status(status.jobId)).progress).toBe(57);
    finish(f.workers[0]);
    expect(await wait).toContain('full vector');
    expect(await f.controller.result(status.jobId)).toContain('full vector');
    expect((await f.controller.status(status.jobId)).state).toBe('succeeded');
    expect(f.workers[0].terminated).toBe(true);
    expect(f.dispose).not.toHaveBeenCalled();
    f.controller.clear();
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(progress).toContain(100);
  });
  it('revocation erases running data and cannot publish a late result after unlock', async () => {
    const f = fixture(),
      status = await started(f),
      worker = f.workers[0],
      late = worker.onmessage;
    const wait = f.controller.wait(status.jobId),
      rejected = expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    f.abort.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(f.dispose).toHaveBeenCalledOnce();
    late?.({
      data: { type: 'result', svg: 'old private data', bytes: 16, nodeCount: 1, edgeCount: 0 },
    } as MessageEvent<SvgWorkerResponse>);
    await expect(f.controller.status(status.jobId)).rejects.toMatchObject({ status: 404 });
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
    const fresh = fixture(),
      next = await started(fresh);
    finish(fresh.workers[0], '<svg>new session</svg>');
    expect(await fresh.controller.wait(next.jobId)).toContain('new session');
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it('revocation removes already completed plaintext and status metadata', async () => {
    const f = fixture(),
      status = await started(f);
    finish(f.workers[0]);
    await f.controller.wait(status.jobId);
    f.abort.abort();
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it('revocation during the final authority check rejects a worker result', async () => {
    const f = fixture(),
      status = await started(f);
    let release!: () => void;
    f.check.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    finish(f.workers[0], '<svg>sensitive</svg>');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.abort.abort();
    release();
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it('rechecks caller authorization and cancels without exposing retained data', async () => {
    const f = fixture(),
      status = await started(f);
    finish(f.workers[0]);
    await f.controller.wait(status.jobId);
    await expect(
      f.controller.result(status.jobId, async () => {
        f.abort.abort();
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const fresh = fixture(),
      next = await started(fresh);
    expect((await fresh.controller.cancel(next.jobId)).state).toBe('cancelled');
    expect(fresh.workers[0].terminated).toBe(true);
    await expect(fresh.controller.result(next.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it('enforces an execution deadline and bounded lease retention', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      status = f.controller.start(f.graph, {}, f.authority);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.workers[0].request).toBeDefined();
    await vi.advanceTimersByTimeAsync(svgJobLimits.deadlineMs);
    expect((await f.controller.status(status.jobId)).error?.code).toBe('SVG_JOB_TIMEOUT');
    expect(f.workers[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(svgJobLimits.retentionMs - svgJobLimits.deadlineMs);
    await expect(f.controller.status(status.jobId)).rejects.toMatchObject({ status: 404 });
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it('limits concurrency and evicts completed results while preserving active work', async () => {
    const f = fixture(),
      one = await started(f),
      two = f.controller.start(f.graph, {}, f.authority);
    expect(() => f.controller.start(f.graph, {}, f.authority)).toThrow('Two SVG');
    await vi.waitFor(() => expect(f.workers).toHaveLength(2));
    finish(f.workers[0]);
    finish(f.workers[1]);
    await f.controller.wait(one.jobId);
    await f.controller.wait(two.jobId);
    for (let index = 0; index < 4; index++) {
      const status = f.controller.start(f.graph, {}, f.authority);
      await vi.waitFor(() => expect(f.workers.length).toBe(index + 3));
      finish(f.workers.at(-1)!);
      await f.controller.wait(status.jobId);
    }
    await expect(f.controller.status(one.jobId)).rejects.toMatchObject({ status: 404 });
    await expect(f.controller.status(two.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it('returns explicit validation/size failures rather than partial results', async () => {
    const f = fixture();
    expect(() =>
      f.controller.start(f.graph, { scope: 'selected', nodeIds: ['unknown'] }, f.authority),
    ).toThrow('existing');
    const status = await started(f);
    finish(f.workers[0], '<svg>too large</svg>', svgJobLimits.bytes + 1);
    await expect(f.controller.wait(status.jobId)).rejects.toMatchObject({ code: 'SVG_SIZE_LIMIT' });
    expect((await f.controller.status(status.jobId)).state).toBe('failed');
  });
  it('selects a worker for large diagrams/source evidence and never clones raw dataset rows', () => {
    const f = fixture();
    expect(shouldUseBackgroundSVG(f.graph)).toBe(false);
    f.graph.nodes = Array.from({ length: 101 }, () => newNode(f.graph.diagram.id));
    expect(shouldUseBackgroundSVG(f.graph)).toBe(true);
    f.graph.dataset = { rows: [['private']] } as never;
    f.graph.datasets = [f.graph.dataset];
    expect(svgGraphSnapshot(f.graph).dataset).toBeUndefined();
    expect(svgGraphSnapshot(f.graph).datasets).toBeUndefined();
  });
  it('does not inspect or clone raw source rows while capturing a visual export', () => {
    const f = fixture();
    const rows = { id: 'private source' };
    Object.defineProperty(rows, 'rows', {
      enumerable: true,
      get: () => {
        throw new Error('Raw rows were traversed');
      },
    });
    f.graph.dataset = rows as never;
    f.graph.datasets = [rows as never];
    expect(() => svgGraphSnapshot(f.graph)).not.toThrow();
    expect(svgGraphSnapshot(f.graph).nodes[0].title).toBe('Original snapshot');
  });
});
