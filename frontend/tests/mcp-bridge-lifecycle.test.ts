import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bridge } from '../src/integration/bridge';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';
import { VaultStorageError } from '../src/security/vault-storage';

vi.mock('../src/storage/workspace', () => ({
  workspace: {
    external: vi.fn(),
    authorizeExternal: vi.fn(),
    repo: { db: { captureOperation: vi.fn() } },
  },
}));

class LocalSocket {
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (event: MessageEvent) => void;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  open() {
    this.readyState = LocalSocket.OPEN;
    this.onopen?.();
  }
}

let bridge: Bridge;
let sockets: LocalSocket[];
let construct: ReturnType<typeof vi.fn<(url: URL) => LocalSocket>>;
let abort: AbortController;
let origin: {
  signal: AbortSignal;
  storage: never;
  check: ReturnType<typeof vi.fn<() => Promise<void>>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(workspace.external).mockReset();
  vi.mocked(workspace.authorizeExternal)
    .mockReset()
    .mockImplementation(async (_path, _method, operation) => operation.check());
  delete (workspace.repo.db as unknown as { session?: unknown }).session;
  abort = new AbortController();
  origin = {
    signal: abort.signal,
    storage: {} as never,
    check: vi.fn(async () => {
      if (abort.signal.aborted)
        throw new VaultStorageError(
          423,
          'WORKSPACE_LOCKED',
          'Unlock the workspace in the browser to continue.',
        );
    }),
    dispose: vi.fn(),
  };
  vi.mocked(workspace.repo.db.captureOperation).mockReset().mockResolvedValue(origin);
  sessionStorage.clear();
  useEditor.setState({
    bridgeUrl: 'wss://127.0.0.1:4317/bridge',
    bridgeStatus: 'disabled',
    mcpAccess: 'off',
    workspaceId: '12345678-1234-1234-1234-123456789012',
  });
  sockets = [];
  construct = vi.fn((_url: URL) => {
    const socket = new LocalSocket();
    sockets.push(socket);
    return socket;
  });
  vi.stubGlobal(
    'WebSocket',
    class {
      static OPEN = LocalSocket.OPEN;
      constructor(url: URL) {
        return construct(url);
      }
    },
  );
  bridge = new Bridge();
  bridge.start();
});

it('reuses an operation after an ordinary socket reconnect without performing the write twice', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  const hello = JSON.parse(sockets[0].send.mock.calls[0][0]);
  let finish!: () => void;
  vi.mocked(workspace.external).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { id: 'saved-once', version: 1 };
  });
  const command = {
    ...hello,
    id: 'first',
    path: '/diagrams',
    method: 'POST',
    data: { name: 'Once' },
    operationId: 'vnop1.bridge.write',
    operationAction: 'execute',
    operationNew: true,
  };
  sockets[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(command) }));
  await vi.waitFor(() => expect(workspace.external).toHaveBeenCalledOnce());
  sockets[0].readyState = 3;
  sockets[0].onclose?.();
  await vi.advanceTimersByTimeAsync(3000);
  sockets[1].open();
  const reconnected = JSON.parse(sockets[1].send.mock.calls[0][0]);
  expect(reconnected.browserInstanceId).toBe(hello.browserInstanceId);
  expect(reconnected.accessGrantId).toBe(hello.accessGrantId);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  sockets[1].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ ...command, id: 'retry', operationNew: false }),
    }),
  );
  await vi.waitFor(() =>
    expect(JSON.parse(sockets[1].send.mock.calls.at(-1)![0])).toMatchObject({ id: 'retry' }),
  );
  expect(workspace.external).toHaveBeenCalledOnce();
  expect(JSON.parse(sockets[1].send.mock.calls.at(-1)![0])).toEqual({
    id: 'retry',
    status: 201,
    body: { id: 'saved-once', version: 1 },
  });
});

it('never revives a retained write result for an old grant after Off then Write', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  const hello = JSON.parse(sockets[0].send.mock.calls[0][0]);
  vi.mocked(workspace.external).mockResolvedValueOnce({ text: 'Private saved result' });
  const command = {
    ...hello,
    id: 'first',
    path: '/diagrams',
    method: 'POST',
    data: {},
    operationId: 'vnop1.bridge.write',
    operationAction: 'execute',
    operationNew: true,
  };
  sockets[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(command) }));
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() =>
    expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
      id: 'first',
      status: 201,
    }),
  );
  useEditor.setState({ mcpAccess: 'off' });
  useEditor.setState({ mcpAccess: 'write' });
  sockets[1].open();
  sockets[1].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ ...command, id: 'old-retry', operationNew: false }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(workspace.external).toHaveBeenCalledOnce();
  expect(JSON.parse(sockets[1].send.mock.calls.at(-1)![0])).toMatchObject({ status: 409 });
  expect(JSON.stringify(sockets[1].send.mock.calls)).not.toContain('Private saved result');
});

it('an explicit same-level access choice rotates receipt authority without reconnecting', () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  const hello = JSON.parse(sockets[0].send.mock.calls[0][0]);
  bridge.beginAccessChoice();
  const updated = JSON.parse(sockets[0].send.mock.calls.at(-1)![0]);
  expect(updated).toMatchObject({
    peerMode: 'content',
    browserInstanceId: hello.browserInstanceId,
  });
  expect(updated.accessGrantId).not.toBe(hello.accessGrantId);
  expect(construct).toHaveBeenCalledOnce();
  expect(sockets[0].close).not.toHaveBeenCalled();
});

it('preserves structured locked-workspace status through the actual browser reply', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  vi.mocked(workspace.external).mockRejectedValueOnce(
    new VaultStorageError(
      423,
      'WORKSPACE_LOCKED',
      'Unlock the workspace in the browser to continue.',
    ),
  );
  sockets[0].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ id: 'locked-request', path: '/diagrams', method: 'GET' }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toEqual({
    id: 'locked-request',
    status: 423,
    body: { error: 'Unlock the workspace in the browser to continue.', code: 'WORKSPACE_LOCKED' },
  });
});

it('executes and publishes a private command through the exact originating capability', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  vi.mocked(workspace.external).mockResolvedValueOnce([{ id: 'private-diagram' }]);
  sockets[0].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ id: 'read', path: '/diagrams', method: 'GET' }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(workspace.external).toHaveBeenCalledWith(
    '/diagrams',
    'GET',
    undefined,
    expect.objectContaining({ storage: origin.storage, signal: origin.signal }),
  );
  expect(origin.check).toHaveBeenCalledOnce();
  expect(origin.dispose).toHaveBeenCalledOnce();
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toEqual({
    id: 'read',
    status: 200,
    body: [{ id: 'private-diagram' }],
  });
});

it('permits only safe security discovery without capturing a private lease', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  vi.mocked(workspace.repo.db.captureOperation).mockRejectedValueOnce(
    new VaultStorageError(423, 'WORKSPACE_LOCKED', 'Locked'),
  );
  vi.mocked(workspace.external).mockResolvedValueOnce({ mode: 'encrypted', state: 'locked' });
  sockets[0].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ id: 'safe', path: '/workspace/security', method: 'GET' }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(workspace.repo.db.captureOperation).not.toHaveBeenCalled();
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toEqual({
    id: 'safe',
    status: 200,
    body: { mode: 'encrypted', state: 'locked' },
  });
});

it('never publishes a completed private body after its originating session was revoked', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  let finish!: (body: unknown) => void;
  vi.mocked(workspace.external).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  sockets[0].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ id: 'late-body', path: '/diagrams', method: 'GET' }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  finish({ privateText: 'Do not release after lock or a later unlock' });
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    id: 'late-body',
    status: 423,
    body: { code: 'WORKSPACE_LOCKED' },
  });
  expect(JSON.stringify(sockets[0].send.mock.calls)).not.toContain('Do not release');
  expect(origin.dispose).toHaveBeenCalledOnce();
});

it('checks the synchronous abort fence after the last awaited publication check', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  let release!: () => void;
  origin.check.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  vi.mocked(workspace.external).mockResolvedValueOnce({ privateText: 'Private result' });
  sockets[0].onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ id: 'publication-gap', path: '/diagrams', method: 'GET' }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    status: 423,
    body: { code: 'WORKSPACE_LOCKED' },
  });
  expect(JSON.stringify(sockets[0].send.mock.calls)).not.toContain('Private result');
  expect(origin.dispose).toHaveBeenCalledOnce();
});

it('sanitizes late private diagnostics after lock and ignores replaced socket commands', async () => {
  useEditor.setState({ mcpAccess: 'read' });
  sockets[0].open();
  vi.mocked(workspace.external).mockImplementationOnce(async () => {
    abort.abort();
    throw new Error('Private source diagnostic');
  });
  const event = new MessageEvent('message', {
    data: JSON.stringify({ id: 'late-error', path: '/code/preview', method: 'POST' }),
  });
  sockets[0].onmessage?.(event);
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    status: 423,
    body: { code: 'WORKSPACE_LOCKED' },
  });
  expect(JSON.stringify(sockets[0].send.mock.calls)).not.toContain('Private source diagnostic');
  useEditor.setState({ mcpAccess: 'write' });
  sockets[1].open();
  sockets[0].onmessage?.(event);
  await vi.advanceTimersByTimeAsync(0);
  expect(workspace.external).toHaveBeenCalledOnce();
});

afterEach(() => {
  bridge.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('activates, changes grants, disables and reactivates from live settings without restarting', async () => {
  expect(construct).not.toHaveBeenCalled();
  useEditor.setState({ mcpAccess: 'read' });
  expect(construct).toHaveBeenCalledOnce();
  sockets[0].open();
  expect(useEditor.getState().bridgeStatus).toBe('connected');
  expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toMatchObject({
    workspaceId: useEditor.getState().workspaceId,
    peerMode: 'content',
    browserInstanceId: expect.any(String),
    accessGrantId: expect.any(String),
  });

  useEditor.setState({ mcpAccess: 'write' });
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(construct).toHaveBeenCalledTimes(2);
  sockets[1].open();
  useEditor.setState({ mcpAccess: 'off' });
  expect(sockets[1].close).toHaveBeenCalledOnce();
  expect(useEditor.getState().bridgeStatus).toBe('disabled');
  await vi.advanceTimersByTimeAsync(6_000);
  expect(construct).toHaveBeenCalledTimes(2);

  useEditor.setState({ mcpAccess: 'write' });
  expect(construct).toHaveBeenCalledTimes(3);
  sockets[2].open();
  expect(useEditor.getState().bridgeStatus).toBe('connected');
});

it('recovers a temporary browser rejection of socket construction without changing access or reloading', async () => {
  construct.mockImplementationOnce(() => {
    throw new DOMException('Local connection temporarily blocked', 'SecurityError');
  });
  useEditor.setState({ mcpAccess: 'read' });
  expect(useEditor.getState().bridgeStatus).toBe('error');
  expect(construct).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(3_000);
  expect(construct).toHaveBeenCalledTimes(2);
  sockets[0].open();
  expect(useEditor.getState().bridgeStatus).toBe('connected');
  expect(useEditor.getState().mcpAccess).toBe('read');
});

it('cancels temporary construction recovery immediately when access is turned off', async () => {
  construct.mockImplementation(() => {
    throw new DOMException('Local connection blocked', 'SecurityError');
  });
  useEditor.setState({ mcpAccess: 'write' });
  expect(construct).toHaveBeenCalledOnce();
  useEditor.setState({ mcpAccess: 'off' });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(construct).toHaveBeenCalledOnce();
  expect(useEditor.getState().bridgeStatus).toBe('disabled');
});

it('never retries or opens a socket for a rejected remote address', async () => {
  useEditor.setState({ bridgeUrl: 'wss://remote.example/bridge', mcpAccess: 'read' });
  expect(useEditor.getState().bridgeStatus).toBe('error');
  await vi.advanceTimersByTimeAsync(6_000);
  expect(construct).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('replaces a pending constructor retry when the saved local endpoint changes', async () => {
  construct.mockImplementationOnce(() => {
    throw new DOMException('Local connection temporarily blocked', 'SecurityError');
  });
  useEditor.setState({ mcpAccess: 'read' });
  useEditor.setState({ bridgeUrl: 'wss://localhost:9443/bridge' });
  expect(construct).toHaveBeenCalledTimes(2);
  expect(String(construct.mock.calls[1][0])).toBe('wss://localhost:9443/bridge');
  sockets[0].open();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(construct).toHaveBeenCalledTimes(2);
  expect(useEditor.getState().bridgeStatus).toBe('connected');
});

it('retries ordinary transport failures but ignores callbacks from a replaced connection', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  const stale = sockets[0];
  useEditor.setState({ bridgeUrl: 'wss://localhost:9443/bridge' });
  stale.onerror?.();
  stale.onclose?.();
  stale.open();
  expect(useEditor.getState().bridgeStatus).toBe('waiting');
  expect(vi.getTimerCount()).toBe(0);

  sockets[1].onerror?.();
  sockets[1].onclose?.();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(construct).toHaveBeenCalledTimes(3);
  expect(String(construct.mock.calls[2][0])).toBe('wss://localhost:9443/bridge');
  sockets[2].open();
  expect(useEditor.getState().bridgeStatus).toBe('connected');
});

it('stopping closes the socket, cancels recovery and removes its settings subscription', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].onclose?.();
  bridge.stop();
  expect(sockets[0].close).toHaveBeenCalledOnce();
  useEditor.setState({ bridgeUrl: 'wss://localhost:9443/bridge', mcpAccess: 'read' });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(construct).toHaveBeenCalledOnce();
  expect(useEditor.getState().bridgeStatus).toBe('disabled');
});

function encryptedState(status: 'locked' | 'unlocked') {
  Object.assign(workspace.repo.db, { session: { getSnapshot: () => ({ status }) } });
}
function command(id: string, path: string, method = 'GET', data?: unknown) {
  sockets[0].onmessage?.(
    new MessageEvent('message', { data: JSON.stringify({ id, path, method, data }) }),
  );
}
it('retains only a previously open connection for locked control without reconnecting', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  encryptedState('locked');
  bridge.restrictToControl();
  useEditor.setState({ mcpAccess: 'off', workspaceId: '' });
  bridge.start();
  expect(sockets[0].close).not.toHaveBeenCalled();
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    peerMode: 'control',
    browserInstanceId: expect.any(String),
    accessGrantId: expect.any(String),
  });
  vi.mocked(workspace.repo.db.captureOperation).mockRejectedValueOnce(
    new VaultStorageError(423, 'WORKSPACE_LOCKED', 'Locked'),
  );
  command('private', '/diagrams');
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    id: 'private',
    status: 423,
  });
  vi.mocked(workspace.external).mockResolvedValueOnce({ state: 'locked' });
  command('status', '/workspace/security');
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    id: 'status',
    status: 200,
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(construct).toHaveBeenCalledOnce();
});
it('does not create a control connection from a cold locked startup or a pending socket', async () => {
  encryptedState('locked');
  bridge.restrictToControl();
  bridge.start();
  expect(construct).not.toHaveBeenCalled();
  useEditor.setState({ mcpAccess: 'read' });
  bridge.restrictToControl();
  expect(sockets[0].close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(6000);
  expect(construct).toHaveBeenCalledOnce();
});
it('does not restore content or lock authorization after unlock until a committed human grant', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  encryptedState('locked');
  bridge.restrictToControl();
  useEditor.setState({ mcpAccess: 'off', workspaceId: '' });
  encryptedState('unlocked');
  useEditor.setState({ workspaceId: '12345678-1234-1234-1234-123456789012' });
  bridge.start();
  command('lock', '/workspace/lock', 'POST', {});
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    id: 'lock',
    status: 403,
  });
  expect(workspace.external).not.toHaveBeenCalled();
  useEditor.setState({ mcpAccess: 'write' });
  expect(construct).toHaveBeenCalledOnce();
  bridge.authorizeContent();
  expect(construct).toHaveBeenCalledTimes(2);
  sockets[1].open();
});
it('explicit Off and connection loss end restricted control without background reconnect', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  bridge.restrictToControl();
  useEditor.setState({ mcpAccess: 'off', workspaceId: '' });
  bridge.disconnect();
  await vi.advanceTimersByTimeAsync(6000);
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(construct).toHaveBeenCalledOnce();
  useEditor.setState({ workspaceId: '12345678-1234-1234-1234-123456789012', mcpAccess: 'write' });
  sockets[1].open();
  bridge.restrictToControl();
  sockets[1].onclose?.();
  await vi.advanceTimersByTimeAsync(6000);
  expect(construct).toHaveBeenCalledTimes(2);
});
it('publishes only the exact successful lock acknowledgement after intentional lease revocation', async () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  encryptedState('unlocked');
  vi.mocked(workspace.external).mockImplementationOnce(async () => {
    abort.abort();
    encryptedState('locked');
    bridge.restrictToControl();
    useEditor.setState({ mcpAccess: 'off', workspaceId: '' });
    return { state: 'locked' };
  });
  command('lock', '/workspace/lock', 'POST', {});
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toEqual({
    id: 'lock',
    status: 200,
    body: { state: 'locked' },
  });
  expect(origin.check).not.toHaveBeenCalled();
  expect(origin.dispose).toHaveBeenCalledOnce();
  vi.mocked(workspace.external).mockResolvedValueOnce({ state: 'locked' });
  command('again', '/workspace/lock', 'POST', {});
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toMatchObject({
    id: 'again',
    status: 200,
  });
  expect(workspace.repo.db.captureOperation).toHaveBeenCalledOnce();
});

it('does not interrupt lock cleanup when publishing the control hint fails', () => {
  useEditor.setState({ mcpAccess: 'write' });
  sockets[0].open();
  sockets[0].send.mockImplementationOnce(() => {
    throw new Error('Socket closed');
  });
  expect(() => bridge.restrictToControl()).not.toThrow();
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(useEditor.getState().bridgeStatus).toBe('disabled');
});
