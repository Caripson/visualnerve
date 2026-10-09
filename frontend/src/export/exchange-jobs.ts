import type { Graph } from '../model/types';
import { captureSvgTheme } from './svg-jobs';
import { registerSvgJobsCleanup } from './svg-job-lifecycle';
import type { SvgJobAuthority } from './svg-job-types';
import { assertExportActive, checkExportActive, waitForExport } from './guard';
import { exchangeGraphSnapshot, validateExchangeOptions } from './exchange-scene';
import {
  ExchangeExportError,
  exchangeLimits,
  type ExchangeFormat,
  type ExchangeOptions,
  type ExchangeResult,
  type ExchangeJobStatus,
  type ExchangeWorkerRequest,
  type ExchangeWorkerResponse,
} from './exchange-types';

interface Entry {
  status: ExchangeJobStatus;
  authority: SvgJobAuthority;
  worker?: Worker;
  result?: ExchangeResult;
  pending: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  listeners: Set<(status: ExchangeJobStatus) => void>;
  abort(): void;
  deadline?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
}
const cancelled = () => new DOMException('Diagram export cancelled.', 'AbortError');
const missing = () =>
  new ExchangeExportError(
    'EXCHANGE_JOB_NOT_FOUND',
    'This diagram export is unavailable or expired. Start a new export.',
    404,
  );

/** Bounded local workers; UI and MCP share each immutable model snapshot and its original lease. */
export class ExchangeExportController {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./exchange-worker.ts', import.meta.url), { type: 'module' }),
  ) {}
  start(
    graph: Graph,
    format: ExchangeFormat,
    options: ExchangeOptions,
    authority: SvgJobAuthority,
  ): ExchangeJobStatus {
    assertExportActive(authority.guard);
    return this.startSnapshot(exchangeGraphSnapshot(graph), format, options, authority);
  }
  /** UI captures the allowlisted snapshot before awaiting its original vault operation. */
  startSnapshot(
    graph: Graph,
    format: ExchangeFormat,
    options: ExchangeOptions,
    authority: SvgJobAuthority,
  ): ExchangeJobStatus {
    assertExportActive(authority.guard);
    if (format !== 'drawio' && format !== 'vsdx')
      throw new ExchangeExportError(
        'EXCHANGE_FORMAT_INVALID',
        'Choose drawio or vsdx for editable export.',
      );
    validateExchangeOptions(graph, options);
    if (
      [...this.entries.values()].filter((entry) =>
        ['queued', 'running'].includes(entry.status.state),
      ).length >= exchangeLimits.active
    )
      throw new ExchangeExportError(
        'EXCHANGE_JOB_BUSY',
        'Two editable exports are already running. Wait or cancel an export.',
        429,
      );
    const snapshot = graph,
      createdAt = new Date().toISOString(),
      jobId = crypto.randomUUID();
    let resolve!: () => void, reject!: (error: Error) => void;
    const pending = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    void pending.catch(() => undefined);
    const entry: Entry = {
      status: {
        jobId,
        diagramId: graph.diagram.id,
        format,
        state: 'queued',
        progress: 0,
        phase: 'queued',
        createdAt,
        updatedAt: createdAt,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        warnings: [],
      },
      authority,
      pending,
      resolve,
      reject,
      listeners: new Set(),
      abort: () => this.drop(jobId, cancelled()),
    };
    const request: ExchangeWorkerRequest = {
      graph: snapshot,
      format,
      options: structuredClone(options),
      theme: captureSvgTheme(graph),
    };
    assertExportActive(authority.guard);
    this.entries.set(jobId, entry);
    authority.guard.signal.addEventListener('abort', entry.abort, { once: true });
    entry.expiry = setTimeout(() => this.drop(jobId, missing()), exchangeLimits.retentionMs);
    void this.run(entry, request);
    return this.copy(entry);
  }
  private copy(entry: Entry) {
    return structuredClone(entry.status);
  }
  private emit(entry: Entry) {
    entry.status.updatedAt = new Date().toISOString();
    for (const listener of entry.listeners) listener(this.copy(entry));
  }
  private async run(entry: Entry, request: ExchangeWorkerRequest) {
    try {
      await waitForExport(checkExportActive(entry.authority.guard), entry.authority.guard);
      if (this.entries.get(entry.status.jobId) !== entry) throw cancelled();
      const worker = this.createWorker();
      entry.worker = worker;
      entry.status.state = 'running';
      entry.status.phase = 'projection';
      this.emit(entry);
      entry.deadline = setTimeout(
        () =>
          this.fail(
            entry,
            new ExchangeExportError(
              'EXCHANGE_JOB_TIMEOUT',
              'Editable export exceeded two minutes. Export a selection.',
            ),
          ),
        exchangeLimits.deadlineMs,
      );
      worker.onerror = () =>
        this.fail(
          entry,
          new ExchangeExportError(
            'EXCHANGE_WORKER_FAILED',
            'The local export worker could not run. Reload the application and try again.',
          ),
        );
      worker.onmessageerror = () =>
        this.fail(
          entry,
          new ExchangeExportError(
            'EXCHANGE_WORKER_FAILED',
            'The local export worker returned an unreadable result.',
          ),
        );
      worker.onmessage = (event: MessageEvent<ExchangeWorkerResponse>) => {
        if (this.entries.get(entry.status.jobId) !== entry || entry.status.state !== 'running')
          return;
        try {
          assertExportActive(entry.authority.guard);
        } catch (error) {
          this.drop(entry.status.jobId, error as Error);
          return;
        }
        const response = event.data;
        if (response.type === 'progress') {
          entry.status.progress = Math.max(entry.status.progress, Math.min(99, response.progress));
          entry.status.phase = response.phase;
          this.emit(entry);
        } else if (response.type === 'error')
          this.fail(entry, new ExchangeExportError(response.code, response.message));
        else if (response.type === 'result') void this.complete(entry, response.result);
      };
      worker.postMessage(request);
    } catch (error) {
      this.fail(entry, error as Error);
    }
  }
  private stop(entry: Entry) {
    entry.worker?.terminate();
    entry.worker = undefined;
    clearTimeout(entry.deadline);
    entry.deadline = undefined;
  }
  private erase(entry: Entry) {
    entry.result?.bytes.fill(0);
    entry.result = undefined;
  }
  private fail(entry: Entry, error: Error) {
    if (
      this.entries.get(entry.status.jobId) !== entry ||
      !['queued', 'running'].includes(entry.status.state)
    )
      return;
    this.stop(entry);
    this.erase(entry);
    entry.status.state = 'failed';
    entry.status.error = {
      code: error instanceof ExchangeExportError ? error.code : 'EXCHANGE_EXPORT_FAILED',
      message: error.message,
    };
    this.emit(entry);
    entry.reject(error);
    this.trim();
  }
  private async complete(entry: Entry, result: ExchangeResult) {
    this.stop(entry);
    try {
      await waitForExport(checkExportActive(entry.authority.guard), entry.authority.guard);
      if (this.entries.get(entry.status.jobId) !== entry || entry.status.state !== 'running')
        throw cancelled();
      if (
        result.format !== entry.status.format ||
        !ArrayBuffer.isView(result.bytes) ||
        Object.prototype.toString.call(result.bytes) !== '[object Uint8Array]' ||
        !result.bytes.length ||
        result.bytes.byteLength > exchangeLimits.bytes
      )
        throw new ExchangeExportError(
          'EXCHANGE_RESULT_INVALID',
          'The editable export result exceeds its budget or has an invalid format.',
        );
      entry.result = result;
      entry.status.state = 'succeeded';
      entry.status.phase = 'complete';
      entry.status.progress = 100;
      entry.status.bytes = result.bytes.byteLength;
      entry.status.nodeCount = result.nodeCount;
      entry.status.edgeCount = result.edgeCount;
      entry.status.warnings = structuredClone(result.warnings);
      this.emit(entry);
      entry.resolve();
      this.trim();
    } catch (error) {
      result.bytes?.fill(0);
      if (entry.authority.guard.signal.aborted || !this.entries.has(entry.status.jobId))
        this.drop(entry.status.jobId, error as Error);
      else this.fail(entry, error as Error);
    }
  }
  private trim() {
    const retained = [...this.entries.values()]
      .filter((entry) => !['queued', 'running'].includes(entry.status.state))
      .sort((a, b) => a.status.updatedAt.localeCompare(b.status.updatedAt));
    let bytes = retained.reduce((sum, entry) => sum + (entry.status.bytes ?? 0), 0);
    while (retained.length > exchangeLimits.retained || bytes > exchangeLimits.retainedBytes) {
      const entry = retained.shift()!;
      bytes -= entry.status.bytes ?? 0;
      this.drop(entry.status.jobId, missing());
    }
  }
  private async authorized(id: string, authorize?: () => Promise<void>) {
    const entry = this.entries.get(id);
    if (!entry) throw missing();
    await waitForExport(
      Promise.resolve().then(() => authorize?.()),
      entry.authority.guard,
    );
    await waitForExport(checkExportActive(entry.authority.guard), entry.authority.guard);
    if (this.entries.get(id) !== entry) throw missing();
    return entry;
  }
  async status(id: string, authorize?: () => Promise<void>) {
    return this.copy(await this.authorized(id, authorize));
  }
  async result(id: string, authorize?: () => Promise<void>): Promise<ExchangeResult> {
    const entry = await this.authorized(id, authorize);
    if (entry.status.state !== 'succeeded' || !entry.result)
      throw new ExchangeExportError(
        'EXCHANGE_JOB_NOT_READY',
        'The diagram export is not ready. Read its job status first.',
        409,
      );
    assertExportActive(entry.authority.guard);
    return entry.result;
  }
  async cancel(id: string, authorize?: () => Promise<void>) {
    const entry = await this.authorized(id, authorize);
    this.stop(entry);
    this.erase(entry);
    entry.status.state = 'cancelled';
    entry.status.bytes = undefined;
    entry.status.error = undefined;
    this.emit(entry);
    entry.reject(cancelled());
    const status = this.copy(entry);
    this.drop(id, cancelled());
    return status;
  }
  async wait(id: string, onProgress?: (status: ExchangeJobStatus) => void) {
    const entry = await this.authorized(id);
    if (onProgress) {
      entry.listeners.add(onProgress);
      onProgress(this.copy(entry));
    }
    try {
      await entry.pending;
      return await this.result(id);
    } finally {
      if (onProgress) entry.listeners.delete(onProgress);
    }
  }
  private drop(id: string, error: Error) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.stop(entry);
    clearTimeout(entry.expiry);
    entry.authority.guard.signal.removeEventListener('abort', entry.abort);
    this.erase(entry);
    entry.listeners.clear();
    entry.reject(error);
    entry.authority.dispose();
  }
  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id, cancelled());
  }
}
export const exchangeExportController = new ExchangeExportController();
registerSvgJobsCleanup(() => exchangeExportController.clear());
