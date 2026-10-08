import { useEditor } from '../state/editor';
import { StorageError } from '../model/validation';
import { localBridgeUrl } from './access';
import { workspace } from '../storage/workspace';
import { VaultStorageError } from '../security/vault-storage';
import type { WorkspaceOperation } from '../storage/contracts';
import {
  isWorkspaceLockCommand,
  isWorkspaceSecurityDiscovery,
  workspaceSecurityStatus,
} from '../storage/security-status';

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
export function bridgeErrorStatus(error: unknown): number {
  return error instanceof StorageError || error instanceof VaultStorageError ? error.status : 422;
}
export class Bridge {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private generation = 0;
  private restricted = false;
  private connectedWorkspace?: string;
  start() {
    this.unsubscribe?.();
    this.unsubscribe = useEditor.subscribe((state, previous) => {
      if (this.restricted) {
        if (
          state.bridgeUrl !== previous.bridgeUrl ||
          (state.workspaceId && state.workspaceId !== this.connectedWorkspace)
        )
          this.disconnect();
        return;
      }
      if (
        state.mcpAccess !== previous.mcpAccess ||
        state.bridgeUrl !== previous.bridgeUrl ||
        state.workspaceId !== previous.workspaceId
      )
        this.reconnect();
    });
    if (!this.restricted) this.reconnect();
  }
  stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.disconnect();
  }
  /** An explicit Off choice cancels the transport even if the displayed grant is already Off. */
  disconnect() {
    ++this.generation;
    this.restricted = false;
    this.connectedWorkspace = undefined;
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = undefined;
    useEditor.setState({ bridgeStatus: 'disabled' });
  }
  /** Retain only an already-open authorized connection; never reconnect a locked workspace. */
  restrictToControl() {
    clearTimeout(this.retry);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connectedWorkspace) {
      this.disconnect();
      return;
    }
    this.restricted = true;
    try {
      this.socket.send(JSON.stringify({ peerMode: 'control' }));
    } catch {
      // Transport failure must never interrupt the remaining plaintext/key cleanup.
      this.disconnect();
    }
  }
  /** Called only after an explicit human grant has committed successfully. */
  authorizeContent() {
    if (!this.restricted) return;
    this.restricted = false;
    this.reconnect();
  }
  reconnect() {
    if (this.restricted) return;
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
    try {
      url = localBridgeUrl(useEditor.getState().bridgeUrl);
      if (token) url.searchParams.set('token', token);
    } catch {
      useEditor.setState({ bridgeStatus: 'error' });
      return;
    }
    let socket: WebSocket;
    try {
      useEditor.setState({ bridgeStatus: 'waiting' });
      socket = new WebSocket(url);
    } catch {
      useEditor.setState({ bridgeStatus: 'error' });
      this.scheduleRetry(generation);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return socket.close();
      this.connectedWorkspace = useEditor.getState().workspaceId;
      socket.send(JSON.stringify({ workspaceId: this.connectedWorkspace, peerMode: 'content' }));
      useEditor.setState({ bridgeStatus: 'connected' });
    };
    socket.onmessage = (event) => {
      void (async () => {
        if (!this.canReply(socket, generation)) return;
        let command: Command;
        try {
          command = JSON.parse(String(event.data)) as Command;
        } catch {
          return;
        }
        if (!command.id || !command.path?.startsWith('/')) return;
        let operation: WorkspaceOperation | undefined;
        const locking = isWorkspaceLockCommand(command.path, command.method);
        try {
          const security = workspaceSecurityStatus(workspace.repo.db);
          if (
            this.restricted &&
            security.state !== 'locked' &&
            !isWorkspaceSecurityDiscovery(command.path, command.method)
          )
            throw new StorageError(403, 'Choose a fresh MCP access grant in browser Settings.');
          if (
            !isWorkspaceSecurityDiscovery(command.path, command.method) &&
            !(locking && security.state === 'locked')
          )
            operation = await workspace.repo.db.captureOperation();
          if (!this.canReply(socket, generation)) return;
          if (operation?.signal.aborted) throw lockedWorkspace();
          const body = await workspace.external(
            command.path,
            command.method,
            command.data,
            operation,
          );
          // Only this exact command intentionally revokes its own lease and returns public metadata.
          if (!locking) {
            await operation?.check();
            if (operation?.signal.aborted) throw lockedWorkspace();
          }
          const status = bridgeResponseStatus(command.path, command.method);
          if (this.canReply(socket, generation))
            socket.send(JSON.stringify({ id: command.id, status, body }));
        } catch (error) {
          let responseError = error;
          if (operation) {
            try {
              await operation.check();
            } catch (revoked) {
              responseError = revoked;
            }
            // The last await may have crossed a lock/unlock boundary. Never
            // publish private validation details from the revoked request.
            if (operation.signal.aborted) responseError = lockedWorkspace();
          }
          if (this.canReply(socket, generation))
            socket.send(
              JSON.stringify({
                id: command.id,
                status: bridgeErrorStatus(responseError),
                body: bridgeError(responseError),
              }),
            );
        } finally {
          operation?.dispose();
        }
      })();
    };
    socket.onerror = () => {
      if (generation === this.generation) useEditor.setState({ bridgeStatus: 'error' });
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      if (this.restricted) {
        this.disconnect();
        return;
      }
      if (useEditor.getState().bridgeStatus !== 'error')
        useEditor.setState({ bridgeStatus: 'waiting' });
      this.scheduleRetry(generation);
    };
  }
  private canReply(socket: WebSocket, generation: number) {
    return (
      generation === this.generation &&
      socket === this.socket &&
      socket.readyState === WebSocket.OPEN
    );
  }
  private scheduleRetry(generation: number) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      void this.connect(generation);
    }, 3000);
  }
}
const lockedWorkspace = () =>
  new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );
export const bridge = new Bridge();
