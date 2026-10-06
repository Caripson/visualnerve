import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDiagramAsync, parseDiagramFile } from '../src/imports/diagram/client';
import { diagramImportLimits, type DiagramImportResult } from '../src/imports/diagram/types';
import { blankGraph } from '../src/model/types';
import { MAX_IMPORT_LIMIT_BYTES } from '../src/imports/limits';

const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const result: DiagramImportResult = {
  format: 'drawio',
  pages: [
    { id: 'page-1', name: 'Imported', graph: blankGraph('Imported', 'freeform'), warnings: [] },
  ],
  warnings: [],
};
class FakeWorker {
  static instances: FakeWorker[] = [];
  static postError: Error | undefined;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn(() => {
    if (FakeWorker.postError) throw FakeWorker.postError;
  });
  terminate = vi.fn();
  constructor(
    public url: URL,
    public options: { type: string },
  ) {
    FakeWorker.instances.push(this);
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
  fail(message: string) {
    this.onerror?.({ message });
  }
}

describe('diagram import worker client', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.postError = undefined;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('transfers file bytes to an isolated module worker and terminates after a result', async () => {
    const promise = parseDiagramAsync({ format: 'drawio', data: xml, name: 'Example' });
    const worker = FakeWorker.instances[0];
    expect(worker.url.href).toContain('/imports/diagram/worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    const [payload, transfer] = worker.postMessage.mock.calls[0] as unknown as [
      { format: string; bytes: Uint8Array; name: string },
      ArrayBuffer[],
    ];
    expect(payload).toMatchObject({ format: 'drawio', name: 'Example' });
    expect(new TextDecoder().decode(payload.bytes)).toBe(xml);
    expect(transfer).toEqual([payload.bytes.buffer]);
    worker.receive({ result });
    await expect(promise).resolves.toBe(result);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.receive({ error: 'late failure' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker and removes its abort listener when parsing is cancelled', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = parseDiagramAsync(
      { format: 'drawio', data: xml },
      { signal: controller.signal },
    );
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    const worker = FakeWorker.instances[0];
    controller.abort();
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    worker.receive({ result });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('times out after 30 seconds and ignores a late worker result', async () => {
    vi.useFakeTimers();
    const promise = parseDiagramAsync({ format: 'drawio', data: xml });
    const rejection = expect(promise).rejects.toThrow(/exceeded 30 seconds/);
    const worker = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(29_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.receive({ result });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ error: 'Invalid XML' }, /Invalid XML/],
    [{}, /returned no preview/],
  ])(
    'rejects parser failures and incomplete messages while cleaning up the worker',
    async (message, expected) => {
      const promise = parseDiagramAsync({ format: 'drawio', data: xml });
      const rejection = expect(promise).rejects.toThrow(expected);
      const worker = FakeWorker.instances[0];
      worker.receive(message);
      await rejection;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it('cleans up a worker that cannot start processing or load its module', async () => {
    FakeWorker.postError = new Error('Transfer failed');
    await expect(parseDiagramAsync({ format: 'drawio', data: xml })).rejects.toThrow(
      'Transfer failed',
    );
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    FakeWorker.postError = undefined;
    const promise = parseDiagramAsync({ format: 'drawio', data: xml });
    const rejection = expect(promise).rejects.toThrow('Module unavailable');
    FakeWorker.instances[1].fail('Module unavailable');
    await rejection;
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
  });

  it('does not leak a cancelled job result into a subsequent import', async () => {
    const controller = new AbortController();
    const first = parseDiagramAsync({ format: 'drawio', data: xml }, { signal: controller.signal });
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const firstWorker = FakeWorker.instances[0];
    controller.abort();
    await rejection;
    const second = parseDiagramAsync({ format: 'drawio', data: xml });
    const secondWorker = FakeWorker.instances[1];
    let resolved = false;
    void second.then(() => {
      resolved = true;
    });
    firstWorker.receive({ result });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(secondWorker.terminate).not.toHaveBeenCalled();
    secondWorker.receive({ result });
    await expect(second).resolves.toBe(result);
    expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized file before reading or allocating its contents', async () => {
    const read = vi.fn();
    const file = {
      name: 'oversized.vsdx',
      size: diagramImportLimits.fileBytes + 1,
      arrayBuffer: read,
    } as unknown as File;
    await expect(parseDiagramFile(file)).rejects.toThrow(/configured 50 MB/);
    expect(read).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects unknown extensions before reading their contents', async () => {
    const read = vi.fn();
    const file = { name: 'workflows.exe', size: 30, arrayBuffer: read } as unknown as File;
    await expect(parseDiagramFile(file)).rejects.toThrow(/\.vsdx or \.drawio/);
    expect(read).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects an already aborted import before reading the file or creating a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn();
    const file = { name: 'diagram.drawio', size: 30, arrayBuffer: read } as unknown as File;
    await expect(parseDiagramFile(file, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      parseDiagramAsync({ format: 'drawio', data: xml }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('honors cancellation while a file read is pending', async () => {
    const controller = new AbortController();
    let completeRead!: (buffer: ArrayBuffer) => void;
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          completeRead = resolve;
        }),
    );
    const file = { name: 'diagram.drawio', size: xml.length, arrayBuffer: read } as unknown as File;
    const promise = parseDiagramFile(file, { signal: controller.signal });
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    completeRead(new TextEncoder().encode(xml).buffer);
    await rejection;
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('recognizes case-insensitive file extensions and reads the file only once', async () => {
    const read = vi.fn().mockResolvedValue(new TextEncoder().encode(xml).buffer);
    const file = {
      name: 'Workflow.DRAWIO',
      size: xml.length,
      arrayBuffer: read,
    } as unknown as File;
    const promise = parseDiagramFile(file);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    const worker = FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'drawio', name: 'Workflow.DRAWIO' }),
      expect.any(Array),
    );
    worker.receive({ result });
    await expect(promise).resolves.toBe(result);
  });

  it('falls back to the local parser when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const parsed = await parseDiagramAsync({ format: 'drawio', data: xml, name: 'Fallback' });
    expect(parsed.pages[0]).toMatchObject({ id: 'page-1', name: 'Fallback' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('captures a raised file budget before reading and sends the same budget to its worker', async () => {
    const read = vi.fn().mockResolvedValue(new TextEncoder().encode(xml).buffer);
    const file = {
      name: 'large.drawio',
      size: 60 * 1024 * 1024,
      arrayBuffer: read,
    } as unknown as File;
    await expect(parseDiagramFile(file)).rejects.toThrow(/configured 50 MB/);
    expect(read).not.toHaveBeenCalled();
    const pending = parseDiagramFile(file, { byteLimit: MAX_IMPORT_LIMIT_BYTES });
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ byteLimit: MAX_IMPORT_LIMIT_BYTES }),
      expect.any(Array),
    );
    FakeWorker.instances[0].receive({ result });
    await expect(pending).resolves.toBe(result);
  });

  it('enforces a decoded byte budget for fallback XML and strict base64 independently', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(
      parseDiagramAsync({ format: 'drawio', data: xml }, { byteLimit: xml.length - 1 }),
    ).rejects.toThrow(/exceeds/);
    const bytes = 'PK\u0003\u0004abcd';
    await expect(
      parseDiagramAsync({ format: 'vsdx', data: btoa(bytes) }, { byteLimit: 7 }),
    ).rejects.toThrow(/exceeds/);
  });
});
