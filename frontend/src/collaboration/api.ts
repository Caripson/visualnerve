import { StorageError } from '../model/errors';
import { collaborationRelayOrigin } from './config';
import { collaborationDocumentLimits, defaultCollaborationShareScope } from './document/scope';
import { collaborationUpdateLimits } from './document/update-envelope';
import { collaborationFrameLimits } from './sync/message-framing';
import { collaborationPayloadLimits } from './session/payload-codec';
import type { CollaborationSnapshot } from './types';

export interface CollaborationApiRuntime {
  inspect(): Readonly<CollaborationSnapshot> | undefined;
  disconnect(diagramId: string): Promise<void>;
}
export function collaborationCapabilities(configured: boolean) {
  return {
    schemaVersion: 1,
    protocol: 1,
    configured,
    execution: 'browser-local',
    transport: 'cloudflare-durable-object-websocket',
    sharedModel: 'yjs-per-field',
    encryption: 'mls-rfc9420',
    authentication: 'owner-approved-device-and-owner-signed-acl',
    roles: ['owner', 'editor', 'viewer'],
    controls: {
      inspect: true,
      existingGraphCrud: true,
      disconnect: true,
      create: false,
      join: false,
      invite: false,
      approve: false,
      unlock: false,
    },
    storage: {
      workspace: 'encrypted-indexeddb',
      privateState: 'non-exported-encrypted-vault',
      mlsSecrets: 'live-memory-only',
    },
    recovery: {
      reconnect: 'same-unlocked-live-device',
      reload: 'fresh-device-owner-approval',
      ownerReload: 'new-room',
    },
    assurance: 'not-independently-audited',
    requiresConfiguredRelay: true,
    limits: {
      ...collaborationDocumentLimits,
      ...collaborationUpdateLimits,
      ...collaborationFrameLimits,
      ...collaborationPayloadLimits,
    },
  } as const;
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const invalid = (): never => {
  throw new StorageError(
    422,
    'Collaboration inspection accepts no arguments or an empty object, and no query parameters.',
  );
};
function empty(data: unknown) {
  if (data === undefined) return;
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(data)) ||
    Reflect.ownKeys(data).length
  )
    invalid();
}

/** Shared path/body preflight runs before the authoritative repository lookup. */
export function collaborationCommandUrl(path: string, data?: unknown): URL {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new StorageError(422, 'Use a relative collaboration API path.');
  const url = new URL(path, 'http://browser.local');
  if (url.search || url.hash) invalid();
  empty(data);
  const match = /^\/diagrams\/([^/]+)\/collaboration(?:\/disconnect)?$/.exec(url.pathname);
  if (match && !uuid.test(match[1]))
    throw new StorageError(422, 'Collaboration diagram id must be a UUID.');
  return url;
}

/** Explicit semantic whitelist: invitation, fingerprints, credentials and relay URLs are UI/private only. */
export function collaborationApiSnapshot(snapshot: Readonly<CollaborationSnapshot>) {
  return {
    configured: snapshot.configured,
    status: snapshot.status,
    ...(snapshot.roomId ? { roomId: snapshot.roomId } : {}),
    ...(snapshot.diagramId ? { diagramId: snapshot.diagramId } : {}),
    ...(snapshot.selfDeviceId ? { selfDeviceId: snapshot.selfDeviceId } : {}),
    ...(snapshot.role ? { role: snapshot.role } : {}),
    scope: {
      shareMetadata: snapshot.scope.shareMetadata,
      shareOwners: snapshot.scope.shareOwners,
      shareDatasets: snapshot.scope.shareDatasets,
    },
    participants: snapshot.participants.map((participant) => ({
      deviceId: participant.deviceId,
      name: participant.name,
      role: participant.role,
      connected: participant.connected,
      selectedNodeIds: [...participant.selectedNodeIds],
      ...(participant.actor ? { actor: participant.actor } : {}),
    })),
    pendingJoinCount: snapshot.pendingJoins.length,
    ...(snapshot.syncProgress
      ? {
          syncProgress: {
            completed: snapshot.syncProgress.completed,
            total: snapshot.syncProgress.total,
          },
        }
      : {}),
  };
}
export class CollaborationCommands {
  constructor(
    private runtime: CollaborationApiRuntime,
    private configured: () => boolean,
  ) {}
  async request(path: string, method: string, data?: unknown): Promise<unknown> {
    const url = collaborationCommandUrl(path, data);
    if (url.pathname === '/collaboration/capabilities' && method === 'GET')
      return collaborationCapabilities(this.configured());
    const current = this.runtime.inspect();
    if (url.pathname === '/collaboration/sessions' && method === 'GET')
      return current?.roomId && current.diagramId ? [collaborationApiSnapshot(current)] : [];
    const match = /^\/diagrams\/([^/]+)\/collaboration(\/disconnect)?$/.exec(url.pathname);
    if (!match) throw new StorageError(404, 'Unknown collaboration API command.');
    if (!uuid.test(match[1]))
      throw new StorageError(422, 'Collaboration diagram id must be a UUID.');
    if (method === 'GET' && !match[2]) {
      if (current?.diagramId === match[1]) return collaborationApiSnapshot(current);
      return {
        configured: this.configured(),
        diagramId: match[1],
        status: 'idle',
        scope: { ...defaultCollaborationShareScope },
        participants: [],
        pendingJoinCount: 0,
      };
    }
    if (method === 'POST' && match[2]) {
      if (current?.diagramId !== match[1] || !current.roomId)
        throw new StorageError(404, 'This diagram has no active local collaboration session.');
      await this.runtime.disconnect(match[1]);
      return { diagramId: match[1], status: 'disconnected' };
    }
    throw new StorageError(404, 'Unknown collaboration API command.');
  }
}

/** Workspace enforces human vault authorization and the existing MCP grant before loading this facade. */
export async function executeCollaborationCommand(
  path: string,
  method: string,
  data?: unknown,
): Promise<unknown> {
  const { collaborationRuntime } = await import('./runtime');
  return new CollaborationCommands(
    collaborationRuntime,
    () => !!collaborationRelayOrigin(),
  ).request(path, method, data);
}
