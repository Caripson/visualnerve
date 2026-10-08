import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bridge } from '../src/integration/bridge';
import { useEditor } from '../src/state/editor';

vi.mock('../src/storage/workspace', () => ({ workspace: { external: vi.fn() } }));

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

beforeEach(() => {
  vi.useFakeTimers();
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
  expect(sockets[0].send).toHaveBeenCalledWith(
    JSON.stringify({ workspaceId: useEditor.getState().workspaceId }),
  );

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
