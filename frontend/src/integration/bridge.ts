import { useEditor } from '../state/editor';
import { StorageError } from '../model/validation';
import { localBridgeUrl } from './access';
import { workspace } from '../storage/workspace';

interface Command {
  id: string;
  path: string;
  method: string;
  data?: unknown;
}
export function bridgeResponseStatus(path: string, method: string): number {
  return method === 'DELETE' && path.replace(/^\/api\/v1/, '') !== '/presentation/video'
    ? 204
    : method === 'POST' &&
        /\/(spatial-diagrams|diagrams|nodes|edges|owners|children|import|particle-types|resources|improvements|scenarios|processes|runs)$/.test(
          path,
        )
      ? 201
      : 200;
}
export function bridgeError(error: unknown) {
  const details = error as { message?: string; code?: string; issues?: unknown };
  return {
    error: details?.message ?? 'The command failed.',
    ...(typeof details?.code === 'string' ? { code: details.code } : {}),
    ...(Array.isArray(details?.issues) ? { issues: details.issues } : {}),
  };
}
class Bridge {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private generation = 0;
  start() {
    this.unsubscribe?.();
    this.unsubscribe = useEditor.subscribe((state, previous) => {
      if (
        state.mcpAccess !== previous.mcpAccess ||
        state.bridgeUrl !== previous.bridgeUrl ||
        state.workspaceId !== previous.workspaceId
      )
        this.reconnect();
    });
    this.reconnect();
  }
  reconnect() {
    const generation = ++this.generation;
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = undefined;
    if (useEditor.getState().mcpAccess === 'off') {
      useEditor.setState({ bridgeStatus: 'disabled' });
      return;
    }
    void this.connect(generation);
  }
  private async connect(generation: number) {
    if (generation !== this.generation) return;
    const token = sessionStorage.getItem('vn-token');
    let url: URL;
    let socket: WebSocket;
    try {
      url = localBridgeUrl(useEditor.getState().bridgeUrl);
      if (token) url.searchParams.set('token', token);
      useEditor.setState({ bridgeStatus: 'waiting' });
      socket = new WebSocket(url);
    } catch {
      useEditor.setState({ bridgeStatus: 'error' });
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return socket.close();
      socket.send(JSON.stringify({ workspaceId: useEditor.getState().workspaceId }));
      useEditor.setState({ bridgeStatus: 'connected' });
    };
    socket.onmessage = (event) => {
      void (async () => {
        let command: Command;
        try {
          command = JSON.parse(String(event.data)) as Command;
        } catch {
          return;
        }
        if (!command.id || !command.path?.startsWith('/')) return;
        try {
          const body = await workspace.external(command.path, command.method, command.data);
          const status = bridgeResponseStatus(command.path, command.method);
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ id: command.id, status, body }));
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                id: command.id,
                status: error instanceof StorageError ? error.status : 422,
                body: bridgeError(error),
              }),
            );
        }
      })();
    };
    socket.onerror = () => {
      if (generation === this.generation) useEditor.setState({ bridgeStatus: 'error' });
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      if (useEditor.getState().bridgeStatus !== 'error')
        useEditor.setState({ bridgeStatus: 'waiting' });
      this.retry = setTimeout(() => {
        void this.connect(generation);
      }, 3000);
    };
  }
}
export const bridge = new Bridge();
