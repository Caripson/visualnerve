import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { ExchangeExportController } from '../src/export/exchange-jobs';
import {
  exchangeLimits,
  type ExchangeWorkerRequest,
  type ExchangeWorkerResponse,
  type ExchangeResult,
} from '../src/export/exchange-types';
import { clearSvgJobsIfLoaded, registerSvgJobsCleanup } from '../src/export/svg-job-lifecycle';

class BoundaryWorker {
  onmessage?: (event: MessageEvent<ExchangeWorkerResponse>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  request?: ExchangeWorkerRequest;
  terminated = false;
  postMessage(request: ExchangeWorkerRequest) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
    this.request = undefined;
  }
  reply(response: ExchangeWorkerResponse) {
    this.onmessage?.({ data: response } as unknown as MessageEvent<ExchangeWorkerResponse>);
  }
}
const controllers: ExchangeExportController[] = [];
afterEach(() => {
  controllers.forEach((controller) => controller.clear());
  controllers.length = 0;
  vi.useRealTimers();
});
function fixture() {
  const workers: BoundaryWorker[] = [],
    controller = new ExchangeExportController(() => {
      const worker = new BoundaryWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
  controllers.push(controller);
  const graph = blankGraph('Original snapshot');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Original',
      description: 'Exported text',
      notes: 'Not exported',
    }),
  ];
  const abort = new AbortController(),
    check = vi.fn(async (): Promise<void> => undefined),
    dispose = vi.fn();
  return {
    graph,
    workers,
    controller,
    abort,
    check,
    dispose,
    authority: { guard: { signal: abort.signal, check, assertCurrent: vi.fn() }, dispose },
  };
}
async function start(f: ReturnType<typeof fixture>) {
  const status = f.controller.start(f.graph, 'drawio', {}, f.authority);
  await vi.waitFor(() => expect(f.workers[0]?.request).toBeDefined());
  return status;
}
function finish(worker: BoundaryWorker, content = '<mxfile>export</mxfile>') {
  const result: ExchangeResult = {
    format: 'drawio',
    mimeType: 'application/vnd.jgraph.mxfile',
    bytes: new TextEncoder().encode(content),
    nodeCount: 1,
    edgeCount: 0,
    warnings: [{ code: 'Fidelity', message: 'Explicit export simplification' }],
  };
  worker.reply({ type: 'result', result });
  return result;
}
describe('editable export worker leases and retained plaintext', () => {
  it('snapshots deliberate content before starting a worker and retains an independently guarded binary result', async () => {
    const f = fixture(),
      status = f.controller.start(f.graph, 'drawio', {}, f.authority);
    f.graph.nodes[0].title = 'Later edit';
    expect(status.state).toBe('queued');
    expect(f.workers).toHaveLength(0);
    await vi.waitFor(() => expect(f.workers[0]?.request).toBeDefined());
    expect(f.workers[0].request?.graph.nodes[0].title).toBe('Original');
    expect(f.workers[0].request?.graph.nodes[0].notes).toBeUndefined();
    f.workers[0].reply({ type: 'progress', progress: 70, phase: 'nodes' });
    expect((await f.controller.status(status.jobId)).progress).toBe(70);
    const result = finish(f.workers[0]);
    await f.controller.wait(status.jobId);
    expect(await f.controller.result(status.jobId)).toEqual(result);
    expect(await f.controller.status(status.jobId)).toMatchObject({
      state: 'succeeded',
      progress: 100,
      bytes: result.bytes.byteLength,
      warnings: result.warnings,
    });
    expect(f.workers[0].terminated).toBe(true);
    expect(f.dispose).not.toHaveBeenCalled();
    f.abort.abort();
    expect(result.bytes.every((byte) => byte === 0)).toBe(true);
    await expect(f.controller.status(status.jobId)).rejects.toMatchObject({ status: 404 });
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it('cannot publish an old worker result after lock and unlock', async () => {
    const f = fixture(),
      status = await start(f),
      late = f.workers[0].onmessage;
    const waiting = f.controller.wait(status.jobId),
      rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    f.abort.abort();
    await rejected;
    expect(f.workers[0].terminated).toBe(true);
    late?.({
      data: {
        type: 'result',
        result: {
          format: 'drawio',
          bytes: new Uint8Array([1]),
          mimeType: 'text/xml',
          nodeCount: 1,
          edgeCount: 0,
          warnings: [],
        },
      },
    } as unknown as MessageEvent<ExchangeWorkerResponse>);
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
    const fresh = fixture(),
      next = await start(fresh);
    finish(fresh.workers[0], 'Fresh authority');
    expect(new TextDecoder().decode((await fresh.controller.wait(next.jobId)).bytes)).toBe(
      'Fresh authority',
    );
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it('rechecks caller grant and final commit authority before exposing bytes', async () => {
    const f = fixture(),
      status = await start(f);
    let release!: () => void;
    f.check.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const sensitive = finish(f.workers[0]);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.abort.abort();
    release();
    await vi.waitFor(() => expect(sensitive.bytes.every((byte) => byte === 0)).toBe(true));
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
    const next = fixture(),
      job = await start(next);
    finish(next.workers[0]);
    await next.controller.wait(job.jobId);
    await expect(
      next.controller.result(job.jobId, async () => {
        throw new Error('grant denied');
      }),
    ).rejects.toThrow('grant denied');
  });
  it('cancels and erases completed results rather than leaving an export-download token', async () => {
    const f = fixture(),
      status = await start(f),
      data = finish(f.workers[0]);
    await f.controller.wait(status.jobId);
    expect((await f.controller.cancel(status.jobId)).state).toBe('cancelled');
    expect(data.bytes.every((byte) => byte === 0)).toBe(true);
    await expect(f.controller.result(status.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects wrong-format results and bounds execution, concurrency, retention and shared cache cleanup', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      one = f.controller.start(f.graph, 'drawio', {}, f.authority);
    f.controller.start(f.graph, 'drawio', {}, f.authority);
    expect(() => f.controller.start(f.graph, 'drawio', {}, f.authority)).toThrow('Two editable');
    await vi.advanceTimersByTimeAsync(0);
    const result = finish(f.workers[0]);
    result.format = 'svg' as never;
    await vi.advanceTimersByTimeAsync(0);
    expect((await f.controller.status(one.jobId)).error?.code).toBe('EXCHANGE_RESULT_INVALID');
    await vi.advanceTimersByTimeAsync(exchangeLimits.deadlineMs);
    expect(f.workers[1].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(exchangeLimits.retentionMs - exchangeLimits.deadlineMs);
    await expect(f.controller.status(one.jobId)).rejects.toMatchObject({ status: 404 });
    const clear = vi.fn();
    registerSvgJobsCleanup(clear);
    clearSvgJobsIfLoaded();
    expect(clear).toHaveBeenCalledOnce();
  });
  it('checks the originating authority before traversing any source content', () => {
    const f = fixture();
    f.abort.abort();
    Object.defineProperty(f.graph, 'nodes', {
      get: () => {
        throw new Error('source traversed');
      },
    });
    expect(() => f.controller.start(f.graph, 'drawio', {}, f.authority)).toThrow('cancelled');
  });
});
