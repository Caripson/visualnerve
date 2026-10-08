import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseProjectArchiveAsync, readProjectArchive } from '../src/code/project/client';
import {
  projectArchiveLimits,
  projectIgnoredReasons,
  type ProjectArchiveResult,
} from '../src/code/project/types';

const archive = zipSync({ 'repo/main.py': strToU8('def run(): pass') });
const data = Buffer.from(archive).toString('base64');
const result: ProjectArchiveResult = {
  name: 'Example',
  files: [{ path: 'main.py', content: 'def run(): pass', language: 'python' }],
  ignored: {
    total: 0,
    reasons: Object.fromEntries(
      projectIgnoredReasons.map((reason) => [reason, 0]),
    ) as ProjectArchiveResult['ignored']['reasons'],
  },
  expandedBytes: 15,
};
class FakeWorker {
  static instances: FakeWorker[] = [];
  static postError: Error | undefined;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn((_input: unknown, _transfer: unknown[]) => {
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
}
const file = (
  arrayBuffer = vi.fn(async () =>
    archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
  ),
) =>
  ({
    name: 'Example.zip',
    size: archive.length,
    arrayBuffer,
  }) as unknown as File;

describe('project ZIP worker client lifecycle', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.postError = undefined;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('transfers ZIP bytes, forwards scan/read progress, and releases the worker after completion', async () => {
    const onProgress = vi.fn();
    const promise = readProjectArchive(file(), { onProgress });
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    expect(worker.url.href).toContain('/code/project/worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    const [payload, transfers] = worker.postMessage.mock.calls[0] as [
      { bytes: Uint8Array; name: string; byteLimit: number },
      unknown[],
    ];
    expect(payload).toMatchObject({ bytes: archive, name: 'Example', byteLimit: 50 * 1024 * 1024 });
    expect(transfers).toEqual([payload.bytes.buffer]);
    worker.receive({ progress: { stage: 'scan', completed: 1, total: 2 } });
    worker.receive({ progress: { stage: 'read', completed: 2, total: 2, path: 'main.py' } });
    expect(onProgress.mock.calls.map((call) => call[0].stage)).toEqual(['scan', 'read']);
    worker.receive({ result });
    await expect(promise).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.receive({ progress: { stage: 'read', completed: 100, total: 100 } });
    worker.receive({ error: 'late error' });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('sends API base64 to the same worker without decoding it on the UI thread', async () => {
    const promise = parseProjectArchiveAsync({ name: 'API project', data });
    const worker = FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith(
      { input: { name: 'API project', data }, byteLimit: 50 * 1024 * 1024 },
      [],
    );
    worker.receive({ result });
    await expect(promise).resolves.toEqual(result);
  });

  it('rejects file-size, extension and API shape/size errors before reading or starting a worker', async () => {
    const read = vi.fn();
    await expect(
      readProjectArchive({ name: 'repo.zip', size: 501, arrayBuffer: read } as unknown as File, {
        byteLimit: 500,
      }),
    ).rejects.toThrow('import limit');
    await expect(
      readProjectArchive({ name: 'repo.tar', size: 30, arrayBuffer: read } as unknown as File),
    ).rejects.toThrow('.zip');
    await expect(parseProjectArchiveAsync({ data }, { byteLimit: 10 })).rejects.toThrow(
      'import limit',
    );
    await expect(parseProjectArchiveAsync({ data, name: ' ' })).rejects.toThrow('Project name');
    await expect(
      parseProjectArchiveAsync({ data, url: 'https://example.com/repo.zip' } as never),
    ).rejects.toThrow('optional name');
    expect(read).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('verifies actual file bytes instead of trusting the File size declaration', async () => {
    const value = file();
    Object.defineProperty(value, 'size', { value: 1 });
    await expect(readProjectArchive(value, { byteLimit: 10 })).rejects.toThrow('import limit');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('cancels promptly while a file read is pending and ignores its later resolution', async () => {
    let complete!: (value: ArrayBuffer) => void;
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new AbortController();
    const promise = readProjectArchive(file(read), { signal: controller.signal });
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    complete(archive.buffer.slice(0));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects an already cancelled import without reading or constructing a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    const value = file();
    await expect(readProjectArchive(value, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      parseProjectArchiveAsync({ data }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(value.arrayBuffer).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates cancelled workers and prevents stale results from settling a later import', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const first = parseProjectArchiveAsync({ data }, { signal: controller.signal });
    const firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const oldWorker = FakeWorker.instances[0];
    controller.abort();
    await firstFailure;
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    const second = parseProjectArchiveAsync({ data });
    const nextWorker = FakeWorker.instances[1];
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    oldWorker.receive({ result });
    await Promise.resolve();
    expect(settled).toBe(false);
    nextWorker.receive({ result });
    await expect(second).resolves.toBe(result);
  });

  it('times out expensive imports and ignores a late result', async () => {
    vi.useFakeTimers();
    const promise = parseProjectArchiveAsync({ data });
    const rejection = expect(promise).rejects.toThrow('two minutes');
    const worker = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(projectArchiveLimits.timeoutMs - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    worker.receive({ result });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([{ error: 'Invalid ZIP' }, {}])(
    'cleans up worker errors and incomplete results: %j',
    async (message) => {
      const promise = parseProjectArchiveAsync({ data });
      const rejection = expect(promise).rejects.toThrow();
      FakeWorker.instances[0].receive(message);
      await rejection;
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    },
  );

  it('cleans up failed transfers and module errors', async () => {
    FakeWorker.postError = new Error('Transfer failed');
    await expect(parseProjectArchiveAsync({ data })).rejects.toThrow('Transfer failed');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    FakeWorker.postError = undefined;
    const promise = parseProjectArchiveAsync({ data });
    const rejection = expect(promise).rejects.toThrow('Module unavailable');
    FakeWorker.instances[1].onerror?.({ message: 'Module unavailable' });
    await rejection;
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
  });

  it('uses the identical archive parser without Worker support for local/API execution', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await parseProjectArchiveAsync({ name: 'Fallback', data })).toMatchObject({
      name: 'Fallback',
      files: result.files,
      expandedBytes: 15,
    });
    expect(await readProjectArchive(file())).toMatchObject({
      name: 'Example',
      files: result.files,
      expandedBytes: 15,
    });
  });
});
