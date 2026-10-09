import type { Graph } from '../model/types';
import { svgGraphSnapshot } from './svg-snapshot';
export { svgGraphSnapshot, shouldUseBackgroundSVG } from './svg-snapshot';
import { appLocaleController } from '../i18n/runtime';
import { simulationService } from '../simulation/service';
import { assertExportActive, checkExportActive, waitForExport } from './guard';
import { registerSvgJobsCleanup } from './svg-job-lifecycle';
import { svgPaint } from './svg-native';
import {
  svgJobLimits,
  SvgExportError,
  type SvgJobAuthority,
  type SvgJobOptions,
  type SvgJobStatus,
  type SvgTheme,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from './svg-job-types';

interface Entry {
  status: SvgJobStatus;
  authority: SvgJobAuthority;
  worker?: Worker;
  svg?: string;
  pending: Promise<string>;
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
  listeners: Set<(status: SvgJobStatus) => void>;
  abort: () => void;
  deadline?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
}
const cancelled = () => new DOMException('Diagram export cancelled.', 'AbortError');
const missing = () =>
  new SvgExportError(
    'SVG_JOB_NOT_FOUND',
    'This SVG job is unavailable or expired. Start a new export.',
    404,
  );
export function captureSvgTheme(graph: Graph): SvgTheme {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    svgPaint(style.getPropertyValue(name), fallback);
  return {
    background: color(graph.diagram.type === 'mindmap' ? '--node-bg' : '--canvas', '#fafaf7'),
    node: color('--node-bg', '#ffffff'),
    surface: color('--surface', '#fdfdfb'),
    text: color('--text', '#1f2d28'),
    muted: color('--muted', '#56675d'),
    border: color('--border', '#e2e5df'),
    doneBackground: color('--status-done-bg', '#dcfce7'),
    doneText: color('--status-done-ink', '#075b2c'),
    doneBorder: color('--status-done-border', '#16803d'),
    statusColors: {
      planned: {
        background: color('--status-planned-bg', '#f1f5f9'),
        text: color('--status-planned-ink', '#334155'),
      },
      'in-progress': {
        background: color('--status-progress-bg', '#dbeafe'),
        text: color('--status-progress-ink', '#1e40af'),
      },
      blocked: {
        background: color('--status-blocked-bg', '#fee2e2'),
        text: color('--status-blocked-ink', '#991b1b'),
      },
    },
  };
}
/** One bounded, transient job registry serves the UI and the existing local API. */
export class SvgExportController {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./svg-worker.ts', import.meta.url), { type: 'module' }),
  ) {}
  start(graph: Graph, options: SvgJobOptions, authority: SvgJobAuthority): SvgJobStatus {
    assertExportActive(authority.guard);
    if (
      graph.nodes.length > svgJobLimits.sourceNodes ||
      graph.edges.length > svgJobLimits.sourceEdges
    )
      throw new SvgExportError(
        'SVG_SOURCE_LIMIT',
        'The export source exceeds 100,000 nodes or 500,000 connections. Split the source document before exporting.',
      );
    if (this.activeCount() >= svgJobLimits.active)
      throw new SvgExportError(
        'SVG_JOB_BUSY',
        'Two SVG exports are already running. Wait or cancel an export.',
        429,
      );
    if (
      options.scope !== undefined &&
      !['complete', 'viewport', 'selected'].includes(options.scope)
    )
      throw new SvgExportError(
        'SVG_SCOPE_INVALID',
        'SVG scope must be complete, viewport or selected.',
      );
    if (options.scope === 'selected') {
      const ids = new Set(graph.nodes.map((node) => node.id));
      if (
        !Array.isArray(options.nodeIds) ||
        !options.nodeIds.length ||
        options.nodeIds.length > svgJobLimits.nodes ||
        options.nodeIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
        new Set(options.nodeIds).size !== options.nodeIds.length
      )
        throw new SvgExportError(
          'SVG_SELECTION_INVALID',
          'Select at most 20,000 existing, unique node IDs for a selected SVG export.',
        );
    } else if (options.nodeIds !== undefined)
      throw new SvgExportError(
        'SVG_SELECTION_INVALID',
        'Node IDs are only accepted for selected SVG exports.',
      );
    const snapshot = svgGraphSnapshot(graph),
      createdAt = new Date().toISOString(),
      jobId = crypto.randomUUID();
    let resolve!: (svg: string) => void, reject!: (error: Error) => void;
    const pending = new Promise<string>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    // API clients poll instead of awaiting; rejected background work is still observed.
    void pending.catch(() => undefined);
    const entry: Entry = {
      status: {
        jobId,
        diagramId: graph.diagram.id,
        format: 'svg',
        state: 'queued',
        progress: 0,
        phase: 'queued',
        createdAt,
        updatedAt: createdAt,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
      authority,
      pending,
      resolve,
      reject,
      listeners: new Set(),
      abort: () => this.drop(jobId, cancelled()),
    };
    const flow = document.querySelector<HTMLElement>('.canvas-shell .react-flow');
    const rect = flow?.getBoundingClientRect();
    const locale = appLocaleController.getSnapshot().locale;
    const request: SvgWorkerRequest = {
      graph: snapshot,
      options: structuredClone(options),
      theme: captureSvgTheme(graph),
      locale,
      viewportSize: {
        width: Math.max(1, Math.round(rect?.width || 1024)),
        height: Math.max(1, Math.round(rect?.height || 768)),
      },
      simulationView: graph.simulation
        ? structuredClone(simulationService.current(graph.diagram.id))
        : undefined,
    };
    assertExportActive(authority.guard);
    this.entries.set(jobId, entry);
    authority.guard.signal.addEventListener('abort', entry.abort, { once: true });
    entry.expiry = setTimeout(() => this.drop(jobId, missing()), svgJobLimits.retentionMs);
    void this.run(entry, request);
    return this.copy(entry);
  }
  private activeCount() {
    return [...this.entries.values()].filter((entry) =>
      ['queued', 'running'].includes(entry.status.state),
    ).length;
  }
  private copy(entry: Entry): SvgJobStatus {
    return structuredClone(entry.status);
  }
  private emit(entry: Entry) {
    entry.status.updatedAt = new Date().toISOString();
    for (const listener of entry.listeners) listener(this.copy(entry));
  }
  private async run(entry: Entry, request: SvgWorkerRequest) {
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
            new SvgExportError(
              'SVG_JOB_TIMEOUT',
              'SVG export exceeded the two-minute execution limit. Export a selection or use the semantic overview.',
            ),
          ),
        svgJobLimits.deadlineMs,
      );
      worker.onerror = () =>
        this.fail(
          entry,
          new SvgExportError(
            'SVG_WORKER_FAILED',
            'The local SVG worker could not run. Reload the application and try again.',
          ),
        );
      worker.onmessageerror = () =>
        this.fail(
          entry,
          new SvgExportError(
            'SVG_WORKER_FAILED',
            'The local SVG worker returned an unreadable result.',
          ),
        );
      worker.onmessage = (event: MessageEvent<SvgWorkerResponse>) => {
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
          if (response.nodeCount !== undefined) entry.status.nodeCount = response.nodeCount;
          if (response.edgeCount !== undefined) entry.status.edgeCount = response.edgeCount;
          this.emit(entry);
        } else if (response.type === 'error')
          this.fail(entry, new SvgExportError(response.code, response.message));
        else if (response.type === 'result') void this.complete(entry, response);
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
  private fail(entry: Entry, error: Error) {
    if (
      this.entries.get(entry.status.jobId) !== entry ||
      !['queued', 'running'].includes(entry.status.state)
    )
      return;
    this.stop(entry);
    entry.svg = undefined;
    entry.status.state = 'failed';
    entry.status.error = {
      code: error instanceof SvgExportError ? error.code : 'SVG_RENDER_FAILED',
      message: error.message,
    };
    this.emit(entry);
    entry.reject(error);
    this.trim();
  }
  private async complete(entry: Entry, response: Extract<SvgWorkerResponse, { type: 'result' }>) {
    this.stop(entry);
    try {
      await waitForExport(checkExportActive(entry.authority.guard), entry.authority.guard);
      if (this.entries.get(entry.status.jobId) !== entry || entry.status.state !== 'running')
        throw cancelled();
      if (response.bytes > svgJobLimits.bytes)
        throw new SvgExportError('SVG_SIZE_LIMIT', 'SVG exceeds the 64 MiB export limit.');
      entry.svg = response.svg;
      entry.status.state = 'succeeded';
      entry.status.phase = 'complete';
      entry.status.progress = 100;
      entry.status.bytes = response.bytes;
      entry.status.nodeCount = response.nodeCount;
      entry.status.edgeCount = response.edgeCount;
      this.emit(entry);
      entry.resolve(response.svg);
      this.trim();
    } catch (error) {
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
    while (retained.length > svgJobLimits.retained || bytes > svgJobLimits.retainedBytes) {
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
  async result(id: string, authorize?: () => Promise<void>) {
    const entry = await this.authorized(id, authorize);
    if (entry.status.state !== 'succeeded' || entry.svg === undefined)
      throw new SvgExportError(
        'SVG_JOB_NOT_READY',
        'The SVG result is not ready. Read the job status before requesting its result.',
        409,
      );
    assertExportActive(entry.authority.guard);
    return entry.svg;
  }
  async cancel(id: string, authorize?: () => Promise<void>) {
    const entry = await this.authorized(id, authorize);
    this.stop(entry);
    entry.svg = undefined;
    entry.status.state = 'cancelled';
    entry.status.bytes = undefined;
    entry.status.error = undefined;
    this.emit(entry);
    entry.reject(cancelled());
    const status = this.copy(entry);
    this.drop(id, cancelled());
    return status;
  }
  async wait(id: string, onProgress?: (status: SvgJobStatus) => void) {
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
    entry.svg = undefined;
    entry.listeners.clear();
    entry.reject(error);
    entry.authority.dispose();
  }
  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id, cancelled());
  }
}
export const svgExportController = new SvgExportController();
registerSvgJobsCleanup(() => svgExportController.clear());
