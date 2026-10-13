import { useEditor } from '../state/editor';
import { StorageError } from '../model/validation';
import { localBridgeUrl } from './access';
import { BridgeOperations, type OperationCommand } from './operations';
import { bridgeDiagnostics } from './diagnostics';
import { workspace } from '../storage/workspace';
import { VaultStorageError } from '../security/vault-storage';
import type { WorkspaceOperation } from '../storage/contracts';
import { SvgExportError } from '../export/svg-job-types';
import type { RobloxPublishAction, RobloxPublishSession } from './roblox-publish-types';
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
  operationId?: string;
  operationNew?: boolean;
  operationAction?: OperationCommand['operationAction'];
  browserInstanceId?: string;
  accessGrantId?: string;
}
export function bridgeResponseStatus(path: string, method: string): number {
  const endpoint = path.replace(/^\/api\/v1/, '');
  if (/^\/diagrams\/[^/]+\/roblox\/builds$/.test(endpoint) && method === 'POST') return 202;
  if (/^\/diagrams\/[^/]+\/roblox\/builds\/[^/]+$/.test(endpoint) && method === 'DELETE')
    return 200;
  if (
    method === 'POST' &&
    /^\/diagrams\/[^/]+\/roblox\/(entities|rules|variables|items|quests|timers|prefabs|instances)$/.test(
      endpoint,
    )
  )
    return 201;
  if (/^\/diagrams\/[^/]+\/analytics\/jobs\/[^/]+$/.test(endpoint) && method === 'DELETE')
    return 200;
  if (
    method === 'POST' &&
    /^\/diagrams\/[^/]+\/analytics\/(datasets|series|charts|indicators|measurements|rules|backtests|scenarios|jobs)$/.test(
      endpoint,
    )
  )
    return 201;
  return method === 'DELETE' &&
    endpoint !== '/presentation/video' &&
    !/^\/exports\/(svg|diagrams)\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      endpoint,
    )
    ? 204
    : method === 'POST' &&
        (endpoint === '/exports/svg' ||
          /\/(spatial-diagrams|diagrams|nodes|edges|owners|children|import|particle-types|resources|improvements|scenarios|processes|runs)$/.test(
            path,
          ))
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
  return error instanceof StorageError ||
    error instanceof VaultStorageError ||
    error instanceof SvgExportError
    ? error.status
    : 422;
}
export class Bridge {
  private readonly browserInstanceId = crypto.randomUUID();
  private accessGrantId = crypto.randomUUID();
  private readonly operations = new BridgeOperations();
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private generation = 0;
  private restricted = false;
  private connectedWorkspace?: string;
  private publicationController = new AbortController();
  private publicationRequests = new Map<
    string,
    { resolve(value: unknown): void; reject(error: unknown): void; cleanup(): void }
  >();
  /** Private browser UI transport; repository commands and MCP cannot invoke publication. */
  captureRobloxPublisher(): RobloxPublishSession {
    const socket = this.socket,
      generation = this.generation,
      grant = this.accessGrantId,
      workspaceId = this.connectedWorkspace;
    const signal = this.publicationController.signal;
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (
        !socket ||
        !this.canReply(socket, generation) ||
        grant !== this.accessGrantId ||
        workspaceId !== this.connectedWorkspace ||
        this.restricted ||
        useEditor.getState().mcpAccess !== 'write'
      )
        throw new StorageError(
          403,
          'Publishing requires a connected bridge and a current Read + write grant.',
        );
      if (bridgeDiagnostics.snapshot().state !== 'current')
        throw new StorageError(
          409,
          'Update the local bridge to use Roblox publication. A website update does not update its binary.',
        );
    };
    assertCurrent();
    return {
      signal,
      assertCurrent,
      request: <T>(
        action: RobloxPublishAction,
        data: Record<string, unknown>,
        requestSignal?: AbortSignal,
      ): Promise<T> => {
        assertCurrent();
        const requestId = crypto.randomUUID();
        return new Promise<T>((resolve, reject) => {
          const stop = () => {
            cleanup();
            reject(
              new StorageError(
                409,
                action === 'finalize'
                  ? 'Upload outcome is unknown. Check Roblox version history before trying again.'
                  : 'The publishing session was cancelled.',
              ),
            );
          };
          const timeout = setTimeout(stop, action === 'finalize' ? 132000 : 75000);
          const cleanup = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', stop);
            requestSignal?.removeEventListener('abort', stop);
            this.publicationRequests.delete(requestId);
          };
          this.publicationRequests.set(requestId, {
            resolve: (value) => {
              cleanup();
              try {
                assertCurrent();
                resolve(value as T);
              } catch (error) {
                reject(error);
              }
            },
            reject: (error) => {
              cleanup();
              reject(error);
            },
            cleanup,
          });
          signal.addEventListener('abort', stop, { once: true });
          requestSignal?.addEventListener('abort', stop, { once: true });
          if (requestSignal?.aborted) {
            stop();
            return;
          }
          try {
            socket!.send(
              JSON.stringify({
                type: 'roblox-publish',
                requestId,
                browserInstanceId: this.browserInstanceId,
                accessGrantId: grant,
                action,
                data,
              }),
            );
          } catch (error) {
            cleanup();
            reject(error);
          }
        });
      },
    };
  }
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
    this.revokeOperations();
    this.restricted = false;
    this.connectedWorkspace = undefined;
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = undefined;
    bridgeDiagnostics.disconnect();
    useEditor.setState({ bridgeStatus: 'disabled' });
  }
  /** Retain only an already-open authorized connection; never reconnect a locked workspace. */
  restrictToControl() {
    this.revokeOperations();
    clearTimeout(this.retry);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connectedWorkspace) {
      this.disconnect();
      return;
    }
    this.restricted = true;
    try {
      this.socket.send(
        JSON.stringify({
          peerMode: 'control',
          mcpAccess: 'off',
          browserInstanceId: this.browserInstanceId,
          accessGrantId: this.accessGrantId,
        }),
      );
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
  /** An explicit choice ends prior receipts even when the selected access level is unchanged. */
  beginAccessChoice() {
    this.revokeOperations();
    if (this.socket?.readyState === WebSocket.OPEN && !this.restricted) {
      try {
        this.socket.send(
          JSON.stringify({
            peerMode: 'content',
            mcpAccess: useEditor.getState().mcpAccess,
            browserInstanceId: this.browserInstanceId,
            accessGrantId: this.accessGrantId,
          }),
        );
      } catch {
        this.reconnect();
      }
    }
  }
  reconnect() {
    if (this.restricted) return;
    this.revokeOperations();
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
      bridgeDiagnostics.connect();
      socket.send(
        JSON.stringify({
          workspaceId: this.connectedWorkspace,
          peerMode: 'content',
          mcpAccess: useEditor.getState().mcpAccess,
          browserInstanceId: this.browserInstanceId,
          accessGrantId: this.accessGrantId,
        }),
      );
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
        if (bridgeDiagnostics.receive(command)) return;
        if ((command as unknown as { type?: string }).type === 'roblox-publish-result') {
          const reply = command as unknown as {
            requestId?: string;
            status?: number;
            body?: unknown;
          };
          const pending = reply.requestId
            ? this.publicationRequests.get(reply.requestId)
            : undefined;
          if (pending) {
            if (typeof reply.status === 'number' && reply.status >= 200 && reply.status < 300)
              pending.resolve(reply.body);
            else {
              const error = reply.body as {
                error?: string | { message?: string; code?: string };
                code?: string;
              };
              const message =
                typeof error?.error === 'string' ? error.error : error?.error?.message;
              const code =
                error?.code ?? (typeof error?.error === 'object' ? error.error?.code : undefined);
              pending.reject(
                Object.assign(
                  new StorageError(
                    reply.status ?? 422,
                    message ?? 'The publication request failed.',
                  ),
                  { code },
                ),
              );
            }
          }
          return;
        }
        if (!command.id || !command.path?.startsWith('/')) return;
        const grant = this.accessGrantId;
        const workspaceId = this.connectedWorkspace;
        if (
          command.operationId &&
          command.browserInstanceId === this.browserInstanceId &&
          command.accessGrantId === grant &&
          !this.restricted
        ) {
          const preparation = this.operations.prepare(command as OperationCommand);
          if (preparation) {
            if (this.canReply(socket, generation))
              socket.send(JSON.stringify({ id: command.id, ...preparation }));
            return;
          }
        }
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
          const checkGrant = () => {
            if (
              grant !== this.accessGrantId ||
              workspaceId !== this.connectedWorkspace ||
              this.restricted
            )
              throw new StorageError(
                403,
                'The originating MCP grant was revoked. Read saved state before issuing a fresh request.',
              );
          };
          const guarded = operation
            ? {
                ...operation,
                check: async () => {
                  await operation!.check();
                  checkGrant();
                },
              }
            : undefined;
          const execute = async () => {
            try {
              const body = await workspace.external(
                command.path,
                command.method,
                command.data,
                guarded,
              );
              return { status: bridgeResponseStatus(command.path, command.method), body };
            } catch (error) {
              return { status: bridgeErrorStatus(error), body: bridgeError(error) };
            }
          };
          let response;
          if (command.operationId) {
            if (
              command.browserInstanceId !== this.browserInstanceId ||
              command.accessGrantId !== grant
            )
              throw new StorageError(
                409,
                'This operation belongs to a different browser or access grant. Read saved state before issuing new work.',
              );
            if (!['reserve', 'execute', 'status'].includes(command.operationAction ?? ''))
              throw new StorageError(422, 'Invalid operation action.');
            response = await this.operations.request(
              command as OperationCommand,
              async () => {
                if (locking && workspaceSecurityStatus(workspace.repo.db).state === 'locked')
                  return;
                if (!guarded) throw lockedWorkspace();
                await workspace.authorizeExternal(command.path, command.method, guarded);
              },
              execute,
            );
          } else response = await execute();
          // Only this exact command intentionally revokes its own lease and returns public metadata.
          if (!locking) {
            await operation?.check();
            if (operation?.signal.aborted) throw lockedWorkspace();
          }
          if (this.canReply(socket, generation))
            socket.send(JSON.stringify({ id: command.id, ...response }));
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
      this.revokePublications();
      bridgeDiagnostics.disconnect();
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
  private revokePublications() {
    this.publicationController.abort();
    this.publicationController = new AbortController();
    for (const request of this.publicationRequests.values()) {
      request.reject(
        new StorageError(
          403,
          'The publishing grant was revoked. Check Roblox version history if an upload had begun.',
        ),
      );
      request.cleanup();
    }
    this.publicationRequests.clear();
  }
  private revokeOperations() {
    this.revokePublications();
    this.accessGrantId = crypto.randomUUID();
    this.operations.clear();
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
