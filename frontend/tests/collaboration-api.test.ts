import { describe, expect, it, vi } from 'vitest';
import {
  CollaborationCommands,
  collaborationApiSnapshot,
  collaborationCapabilities,
} from '../src/collaboration/api';
import type { CollaborationSnapshot } from '../src/collaboration/types';

const diagramId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
function snapshot(): CollaborationSnapshot {
  return {
    configured: true,
    status: 'live',
    roomId: 'public-room',
    diagramId,
    selfDeviceId: 'own-device',
    ownerCredentialId: 'secret-owner-credential',
    role: 'editor',
    displayName: 'Private account display name',
    scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
    participants: [
      {
        deviceId: 'other-device',
        name: 'Ada',
        role: 'viewer',
        credentialId: 'private-credential',
        connected: true,
        selectedNodeIds: [otherId],
        actor: 'human',
        lastSeen: 123,
        pointer: { x: 4, y: 5 },
      },
    ],
    pendingJoins: [
      {
        deviceId: 'pending-private-device',
        credentialId: 'pending-private-credential',
        expiresAt: 456,
      },
    ],
    invitation: { url: 'https://app.visualnerve.com/#private-admission-token', expiresAt: 456 },
    error: 'https://private-relay.invalid/?secret=private-error',
    syncProgress: { completed: 2, total: 4 },
  };
}
function commands(current: CollaborationSnapshot | null = snapshot(), configured = true) {
  const disconnect = vi.fn(async (_diagramId: string) => {});
  return {
    api: new CollaborationCommands(
      { inspect: () => current ?? undefined, disconnect },
      () => configured,
    ),
    disconnect,
  };
}
describe('semantic collaboration API', () => {
  it('advertises optional configured support and human-only admission without private data', () => {
    const capabilities = collaborationCapabilities(false);
    expect(capabilities).toMatchObject({
      configured: false,
      requiresConfiguredRelay: true,
      encryption: 'mls-rfc9420',
      assurance: 'not-independently-audited',
      controls: {
        inspect: true,
        disconnect: true,
        create: false,
        join: false,
        invite: false,
        approve: false,
        unlock: false,
      },
      storage: { mlsSecrets: 'live-memory-only', privateState: 'non-exported-encrypted-vault' },
    });
    expect(capabilities.limits).toMatchObject({
      nodes: 20000,
      edges: 100000,
      frameBytes: 65536,
      messageBytes: 33554432,
    });
  });
  it('whitelists semantic state and never serializes invitations, credentials, errors or relay URLs', async () => {
    const original = snapshot();
    const result = collaborationApiSnapshot(original);
    expect(result).toEqual({
      configured: true,
      status: 'live',
      roomId: 'public-room',
      diagramId,
      selfDeviceId: 'own-device',
      role: 'editor',
      scope: original.scope,
      participants: [
        {
          deviceId: 'other-device',
          name: 'Ada',
          role: 'viewer',
          connected: true,
          selectedNodeIds: [otherId],
          actor: 'human',
        },
      ],
      pendingJoinCount: 1,
      syncProgress: { completed: 2, total: 4 },
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'secret-owner',
      'private-credential',
      'pending-private',
      'private-admission',
      'private-error',
      'Private account',
    ])
      expect(serialized).not.toContain(privateValue);
    result.participants[0].selectedNodeIds.push(diagramId);
    expect(original.participants[0].selectedNodeIds).toEqual([otherId]);
    const { api } = commands(original);
    expect(await api.request('/collaboration/sessions', 'GET')).toEqual([
      collaborationApiSnapshot(original),
    ]);
  });
  it('reports only the current local session and an idle state for another document', async () => {
    const { api } = commands();
    expect(await api.request(`/diagrams/${diagramId}/collaboration`, 'GET')).toMatchObject({
      roomId: 'public-room',
      role: 'editor',
    });
    expect(await api.request(`/diagrams/${otherId}/collaboration`, 'GET')).toEqual({
      configured: true,
      diagramId: otherId,
      status: 'idle',
      scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
      participants: [],
      pendingJoinCount: 0,
    });
    expect(await commands(null, false).api.request('/collaboration/sessions', 'GET')).toEqual([]);
    expect(
      await commands({ ...snapshot(), roomId: undefined }).api.request(
        '/collaboration/sessions',
        'GET',
      ),
    ).toEqual([]);
  });
  it('disconnects only the matching current local session without accepting admission or role mutations', async () => {
    const { api, disconnect } = commands();
    await expect(
      api.request(`/diagrams/${otherId}/collaboration/disconnect`, 'POST', {}),
    ).rejects.toMatchObject({ status: 404 });
    expect(disconnect).not.toHaveBeenCalled();
    expect(
      await api.request(`/diagrams/${diagramId}/collaboration/disconnect`, 'POST', {}),
    ).toEqual({ diagramId, status: 'disconnected' });
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(diagramId);
    for (const action of ['invite', 'approve', 'join', 'unlock'])
      await expect(
        api.request(`/diagrams/${diagramId}/collaboration/${action}`, 'POST', {}),
      ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects malformed routes, unknown fields and query arguments rather than silently interpreting them', async () => {
    const { api, disconnect } = commands();
    for (const [path, method, data, status] of [
      ['//attacker.invalid/collaboration/sessions', 'GET', undefined, 422],
      ['/collaboration/sessions?secret=x', 'GET', undefined, 422],
      ['/collaboration/sessions#fragment', 'GET', undefined, 422],
      ['/collaboration/sessions', 'GET', { invite: 'secret' }, 422],
      ['/collaboration/sessions', 'GET', [], 422],
      ['/collaboration/sessions', 'GET', null, 422],
      ['/collaboration/sessions', 'GET', { [Symbol('private')]: true }, 422],
      ['/diagrams/not-a-uuid/collaboration', 'GET', undefined, 422],
      ['/collaboration/sessions', 'DELETE', undefined, 404],
      [`/diagrams/${diagramId}/collaboration/disconnect`, 'GET', undefined, 404],
    ] as const)
      await expect(api.request(path, method, data)).rejects.toMatchObject({ status });
    expect(disconnect).not.toHaveBeenCalled();
    expect(await api.request('/collaboration/capabilities', 'GET', Object.create(null))).toEqual(
      collaborationCapabilities(true),
    );
  });
});
