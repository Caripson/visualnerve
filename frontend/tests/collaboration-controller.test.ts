import { webcrypto } from 'node:crypto';
import { Blob as NativeBlob } from 'node:buffer';
import {
  CompressionStream as NativeCompressionStream,
  DecompressionStream as NativeDecompressionStream,
} from 'node:stream/web';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceIdentity,
  RoomMember,
  SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { CollaborationController } from '../src/collaboration/controller';
import { collaborationPermissions } from '../src/collaboration/access';
import { CollaborationPrivateStore } from '../src/collaboration/persistence/private-store';
import type {
  EncryptedRoom,
  EncryptedRoomOptions,
} from '../src/collaboration/session/encrypted-room';
import { credentialId, encodeBytes } from '../src/collaboration/transport/identity';
import { invitationUrl } from '../src/collaboration/session/invitation';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { sharedGraph } from '../src/collaboration/document/scope';
import { decodeCollaborationUpdate } from '../src/collaboration/document/update-envelope';
import { compressPayload, decompressPayload } from '../src/collaboration/session/payload-codec';
import { hasCollaborationUpdateTask } from '../src/collaboration/update-task';
import { CollaborationDocumentGateway } from '../src/collaboration/session/document-gateway';

// Real encrypted storage/repository/CRDT; only remote room admission/MLS setup
// is deferred to expose lifecycle races without a network or private key fixture.
const hooks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../src/collaboration/session/encrypted-room', () => ({
  EncryptedRoom: { open: (options: EncryptedRoomOptions) => hooks.open(options) },
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const password = 'test-only controller vault password';
const scope = { shareMetadata: false, shareOwners: false, shareDatasets: false };
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let session: VaultSession,
  physical: VaultRecordStorage,
  db: EncryptedWorkspaceDatabase,
  repo: Repository,
  workspace: Workspace;
let privateStore: CollaborationPrivateStore, controller: CollaborationController, graph: Graph;
const opened: FakeRoom[] = [];
class FakeRoom {
  readonly device: DeviceIdentity;
  readonly currentPolicy: SignedRoomPolicy;
  epoch = 0;
  role: 'owner' | 'editor' | 'viewer' = 'owner';
  dispose = vi.fn();
  cancelPendingSends = vi.fn();
  changeMembers = vi.fn(async () => {});
  message = vi.fn(async (..._args: Parameters<EncryptedRoom['message']>) => {});
  send = vi.fn(async () => {});
  encrypt = vi.fn(async (_kind: unknown, bytes: Uint8Array) => [
    { payloadKind: 'application' as const, ciphertext: encodeBytes(bytes) },
  ]);
  constructor(readonly options: EncryptedRoomOptions) {
    const publicBytes = encodeBytes(new Uint8Array(32).fill(1));
    this.device = {
      deviceId: `owner-${crypto.randomUUID()}`,
      credentialId: 'a'.repeat(64),
      signingKey: { kty: 'EC', crv: 'P-256', x: publicBytes, y: publicBytes },
      mlsSignatureKey: publicBytes,
    };
    this.currentPolicy = {
      policy: {
        protocol: 1,
        roomId: options.roomId,
        ownerDeviceId: this.device.deviceId,
        revision: 1,
        epoch: 0,
        members: [{ ...this.device, role: 'owner' }],
        transition: null,
      },
      signature: encodeBytes(new Uint8Array(64)),
    };
    opened.push(this);
  }
  async create() {
    this.options.check();
    this.options.onPolicy(this.currentPolicy);
    await this.options.onReady();
  }
  async connect() {
    this.options.check();
    this.options.onPolicy(this.currentPolicy);
    await this.options.onReady();
  }
  async control() {
    return {};
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeAll(async () => {
  vault = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('CompressionStream', NativeCompressionStream);
  vi.stubGlobal('DecompressionStream', NativeDecompressionStream);
  physical = new VaultRecordStorage(`collaboration-controller-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  repo = new Repository(db);
  workspace = new Workspace(repo);
  graph = blankGraph('Authoritative controller graph');
  graph.nodes.push(newNode(graph.diagram.id, { title: 'Original' }));
  graph = await repo.saveGraph(graph, 0);
  useEditor.setState({ graph, status: 'saved', history: [], future: [], selectedNodes: [] });
  privateStore = new CollaborationPrivateStore(session, cipher);
  controller = new CollaborationController({
    workspace,
    session,
    store: privateStore,
    relay: 'https://relay.example.com',
    origin: 'https://app.visualnerve.com',
  });
  opened.length = 0;
  hooks.open.mockReset();
  hooks.open.mockImplementation(async (options: EncryptedRoomOptions) => new FakeRoom(options));
});
afterEach(async () => {
  controller.dispose();
  workspace.stop();
  useEditor.setState({ graph: null, history: [], future: [], selectedNodes: [] });
  db.dispose();
  await session.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  expect(collaborationPermissions.role(graph.diagram.id)).toBeUndefined();
  expect(hasCollaborationUpdateTask()).toBe(false);
});
afterAll(() => {
  cipher.destroyKeys(vault.keys);
});
async function freshRejoin(role: 'editor' | 'viewer') {
  const roomId = crypto.randomUUID();
  const publicBytes = encodeBytes(new Uint8Array(32).fill(1));
  const owner: RoomMember = {
    deviceId: 'previous-owner-device',
    credentialId: '',
    signingKey: { kty: 'EC', crv: 'P-256', x: publicBytes, y: publicBytes },
    mlsSignatureKey: publicBytes,
    role: 'owner',
  };
  owner.credentialId = await credentialId(owner.signingKey);
  const prior = new CollaborativeDocument(graph, scope);
  let payload: Uint8Array;
  try {
    await privateStore.save(
      {
        roomId,
        diagramId: graph.diagram.id,
        relayUrl: 'https://relay.example.com',
        scope,
        crdtState: prior.encodedState(),
        pinnedOwnerSigningKey: new TextEncoder().encode(JSON.stringify(owner.signingKey)),
        ownerDeviceId: owner.deviceId,
        lastEpoch: 0,
        pending: [],
      },
      0,
    );
    payload = await compressPayload(
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          scope,
          document: sharedGraph(graph, scope),
          state: encodeBytes(prior.encodedState()),
        }),
      ),
      new AbortController().signal,
    );
  } finally {
    prior.destroy();
  }
  const offline = structuredClone(graph);
  offline.nodes[0].title = 'Saved offline local edit';
  graph = await repo.saveGraph(offline, graph.diagram.version);
  await db.settings.put({ key: 'storage-consent', value: true });
  await workspace.start();
  await workspace.open(graph.diagram.id);
  hooks.open.mockImplementationOnce(async (options: EncryptedRoomOptions) => {
    const room = new FakeRoom(options);
    room.role = role;
    room.currentPolicy.policy.ownerDeviceId = owner.deviceId;
    room.currentPolicy.policy.members = [owner, { ...room.device, role }];
    return room;
  });
  await controller.join(
    invitationUrl(
      {
        version: 1,
        roomId,
        diagramId: graph.diagram.id,
        relay: 'https://relay.example.com',
        ownerDeviceId: owner.deviceId,
        ownerCredential: owner.credentialId,
        ticket: encodeBytes(new Uint8Array(32).fill(7)),
        expiresAt: Date.now() + 60_000,
        scope,
      },
      'https://app.visualnerve.com',
    ),
    'Fresh device',
  );
  const room = opened.at(-1)!;
  return { room, owner, payload };
}
async function expectContentFrozen() {
  const revision = useEditor.getState().editRevision;
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Intervening UI edit' });
  expect(useEditor.getState().editRevision).toBe(revision);
  expect(useEditor.getState().graph?.nodes[0].title).toBe('Saved offline local edit');
  expect(useEditor.getState().commandError).toMatch(/read only/);
  await expect(
    repo.request(`/nodes/${graph.nodes[0].id}`, 'PATCH', {
      version: graph.nodes[0].version,
      title: 'Intervening API edit',
    }),
  ).rejects.toThrow(/read only/);
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Saved offline local edit');
}
describe('collaboration controller lifecycle against the encrypted repository', () => {
  it('freezes the initial graph before asynchronous MLS admission and synchronously replaces the gate', async () => {
    const admission = deferred<FakeRoom>(),
      entered = deferred<EncryptedRoomOptions>();
    hooks.open.mockImplementationOnce((options: EncryptedRoomOptions) => {
      entered.resolve(options);
      return admission.promise;
    });
    const creating = controller.create(graph.diagram.id, 'Synthetic owner', scope);
    const options = await entered.promise;
    expect(controller.getSnapshot().status).toBe('connecting');
    const edited = structuredClone(graph);
    edited.nodes[0].title = 'Intervening edit';
    await expect(repo.saveGraph(edited, graph.diagram.version)).rejects.toThrow(/read only/);
    await expect(
      repo.request(`/nodes/${graph.nodes[0].id}`, 'PATCH', {
        version: graph.nodes[0].version,
        title: 'Intervening API edit',
      }),
    ).rejects.toThrow(/read only/);
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
    admission.resolve(new FakeRoom(options));
    await creating;
    expect(controller.getSnapshot().status).toBe('live');
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('owner');
    const current = await repo.getGraph(graph.diagram.id);
    current.nodes[0].title = 'After admission';
    await expect(repo.saveGraph(current, current.diagram.version)).resolves.toBeDefined();
  });
  it('keeps a newly unlocked session live when an obsolete crypto startup rejects after lock', async () => {
    const admission = deferred<FakeRoom>(),
      entered = deferred<EncryptedRoomOptions>();
    hooks.open.mockImplementationOnce((options: EncryptedRoomOptions) => {
      entered.resolve(options);
      return admission.promise;
    });
    const original = controller.create(graph.diagram.id, 'Old owner', scope);
    const oldResult = original.catch((error) => error);
    await entered.promise;
    await session.lock();
    await session.unlock(password);
    await controller.create(graph.diagram.id, 'New owner', scope);
    const current = opened.at(-1)!;
    expect(controller.getSnapshot().status).toBe('live');
    admission.reject(new Error('Obsolete crypto startup rejected'));
    expect(await oldResult).toBeInstanceOf(Error);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'live',
      displayName: 'New owner',
      roomId: current.options.roomId,
    });
    expect(current.dispose).not.toHaveBeenCalled();
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('owner');
  });
  it('rejects all old callbacks after lock while leaving a fresh session untouched', async () => {
    await controller.create(graph.diagram.id, 'Old owner', scope);
    const old = opened.at(-1)!;
    await session.lock();
    await session.unlock(password);
    await controller.create(graph.diagram.id, 'New owner', scope);
    const fresh = controller.getSnapshot();
    expect(() => old.options.onPolicy(old.currentPolicy)).toThrow(/changed|locked/);
    expect(() => old.options.onReady()).toThrow(/changed|locked/);
    old.options.onError(new Error('Old socket failed'));
    old.options.onDisconnect();
    expect(controller.getSnapshot()).toBe(fresh);
  });
  it('retains the fresh app-update restart fence when an obsolete vault lease capture finishes', async () => {
    const oldLease = await session.captureOperation();
    const captured = deferred<typeof oldLease>(),
      entered = deferred<void>();
    vi.spyOn(session, 'captureOperation').mockImplementationOnce(() => {
      entered.resolve();
      return captured.promise;
    });
    const starting = controller.create(graph.diagram.id, 'Obsolete owner', scope);
    const oldResult = starting.catch((error) => error);
    await entered.promise;
    await session.lock();
    await session.unlock(password);
    await controller.create(graph.diagram.id, 'Current owner', scope);
    const current = controller.getSnapshot();
    captured.resolve(oldLease);
    expect(await oldResult).toBeInstanceOf(Error);
    expect(controller.getSnapshot()).toBe(current);
    expect(hasCollaborationUpdateTask()).toBe(true);
  });
  it('does not apply queued membership work to a different room after Leave', async () => {
    await controller.create(graph.diagram.id, 'Old owner', scope);
    const barrier = deferred<void>(),
      entered = deferred<void>();
    vi.spyOn(workspace, 'settled').mockImplementationOnce(() => {
      entered.resolve();
      return barrier.promise;
    });
    const changing = controller.changeRole('former-peer-device', 'editor');
    const oldResult = changing.catch((error) => error);
    await entered.promise;
    await controller.leave();
    await controller.create(graph.diagram.id, 'Fresh owner', scope);
    const fresh = opened.at(-1)!,
      snapshot = controller.getSnapshot();
    barrier.resolve();
    expect(await oldResult).toBeInstanceOf(Error);
    expect(fresh.changeMembers).not.toHaveBeenCalled();
    expect(fresh.dispose).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(snapshot);
  });
  it('ignores a late offline-send failure from the revoked gateway after a fresh unlock', async () => {
    await controller.create(graph.diagram.id, 'Old owner', scope);
    const old = opened.at(-1)!,
      sending = deferred<void>(),
      entered = deferred<void>();
    old.send.mockImplementationOnce(() => {
      entered.resolve();
      return sending.promise;
    });
    const flush = CollaborationDocumentGateway.prototype.flush;
    let oldFlush!: Promise<void>;
    vi.spyOn(CollaborationDocumentGateway.prototype, 'flush').mockImplementationOnce(function (
      this: CollaborationDocumentGateway,
    ) {
      oldFlush = flush.call(this);
      return oldFlush;
    });
    const edited = structuredClone(graph);
    edited.nodes[0].title = 'Committed before disconnect';
    await repo.saveGraph(edited, graph.diagram.version);
    await entered.promise;
    await session.lock();
    await session.unlock(password);
    await controller.create(graph.diagram.id, 'Fresh owner', scope);
    const current = controller.getSnapshot();
    sending.reject(new Error('Obsolete relay disappeared'));
    await expect(oldFlush).rejects.toThrow();
    expect(controller.getSnapshot()).toBe(current);
    expect(controller.getSnapshot().status).toBe('live');
  });
  it('destroys failed history state and freezes further content writes until explicit Leave', async () => {
    await controller.create(graph.diagram.id, 'Owner', scope);
    const current = await repo.getGraph(graph.diagram.id);
    current.nodes[0].title = 'Durable committed edit';
    const saved = await repo.saveGraph(current, current.diagram.version);
    await vi.waitFor(async () =>
      expect((await privateStore.load(opened.at(-1)!.options.roomId))!.state.pending).toHaveLength(
        0,
      ),
    );
    const failed = vi
      .spyOn(privateStore, 'saveWithinJournal')
      .mockRejectedValueOnce(new Error('Synthetic private history failure'));
    expect(collaborationPermissions.undo(graph.diagram.id)).toBe(true);
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'));
    failed.mockRestore();
    expect(opened.at(-1)!.dispose).toHaveBeenCalled();
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Durable committed edit');
    const rejected = structuredClone(saved);
    rejected.nodes[0].title = 'Must remain frozen';
    await expect(repo.saveGraph(rejected, saved.diagram.version)).rejects.toThrow(/failed session/);
    await controller.leave();
    const detached = await repo.getGraph(graph.diagram.id);
    detached.nodes[0].title = 'Local work after Leave';
    await expect(repo.saveGraph(detached, detached.diagram.version)).resolves.toBeDefined();
  });
  it('freezes rejoin content before the private association read and retains saved local edits', async () => {
    const { room, owner, payload } = await freshRejoin('editor');
    const association = deferred<void>(),
      entered = deferred<void>();
    const load = privateStore.load.bind(privateStore);
    vi.spyOn(privateStore, 'load').mockImplementationOnce(async (...args) => {
      const saved = await load(...args);
      entered.resolve();
      await association.promise;
      return saved;
    });
    const applying = room.options.onMessage('snapshot', payload, owner);
    await entered.promise;
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('viewer');
    await expectContentFrozen();
    association.resolve();
    await applying;
    expect(controller.getSnapshot().status).toBe('live');
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('editor');
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Saved offline local edit');
  });
  it('retains the rejoin gate throughout viewer recovery and keeps offline edits in a local copy', async () => {
    const { room, owner, payload } = await freshRejoin('viewer');
    const recovery = deferred<void>(),
      entered = deferred<void>();
    const importGraph = repo.importGraph.bind(repo);
    vi.spyOn(repo, 'importGraph').mockImplementationOnce(async (...args) => {
      entered.resolve();
      await recovery.promise;
      return importGraph(...args);
    });
    const applying = room.options.onMessage('snapshot', payload, owner);
    await entered.promise;
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('viewer');
    await expectContentFrozen();
    recovery.resolve();
    await applying;
    const copy = controller.getSnapshot().recoveryCopy;
    expect(copy?.diagramId).not.toBe(graph.diagram.id);
    expect((await repo.getGraph(copy!.diagramId)).nodes[0].title).toBe('Saved offline local edit');
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
    expect(controller.getSnapshot().status).toBe('live');
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('viewer');
  });
  it('releases a frozen snapshot bootstrap after its original vault lease is revoked', async () => {
    const { room, owner, payload } = await freshRejoin('editor');
    const association = deferred<void>(),
      entered = deferred<void>();
    const load = privateStore.load.bind(privateStore);
    vi.spyOn(privateStore, 'load').mockImplementationOnce(async (...args) => {
      const saved = await load(...args);
      entered.resolve();
      await association.promise;
      return saved;
    });
    const applying = room.options.onMessage('snapshot', payload, owner);
    const rejected = applying.catch((error: unknown) => error);
    await entered.promise;
    await session.lock();
    expect(collaborationPermissions.role(graph.diagram.id)).toBeUndefined();
    association.resolve();
    expect(await rejected).toBeInstanceOf(Error);
    await session.unlock(password);
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Saved offline local edit');
    expect(controller.getSnapshot().status).toBe('idle');
  });
  it('refreshes an accepted 9 MiB document under a new live epoch without freezing its room', async () => {
    const large = structuredClone(graph);
    large.nodes[0].description = 'x'.repeat(9 * 1024 * 1024);
    graph = await repo.saveGraph(large, graph.diagram.version);
    await controller.create(graph.diagram.id, 'Large diagram owner', scope);
    const room = opened.at(-1)!;
    room.epoch = 1;
    room.message.mockClear();
    // Copy the actual encrypted-room input before the gateway zeroes its buffer.
    const sent: Uint8Array[] = [];
    room.message.mockImplementation(async (kind: unknown, bytes: Uint8Array) => {
      if (kind === 'update') sent.push(bytes.slice());
    });
    await room.options.onReady();
    expect(controller.getSnapshot().status).toBe('live');
    expect(collaborationPermissions.role(graph.diagram.id)).toBe('owner');
    expect(sent).toHaveLength(1);
    const peer: RoomMember = { ...room.device, deviceId: 'approved-older-peer', role: 'editor' };
    room.currentPolicy.policy.members.push(peer);
    await room.options.onMessage('sync', new Uint8Array([1, 123, 1]), peer);
    expect(sent).toHaveLength(2);
    for (const bytes of sent) {
      const plain = await decompressPayload(bytes, new AbortController().signal);
      const envelope = decodeCollaborationUpdate(plain);
      expect(envelope.baseVector).toEqual(new Uint8Array([0]));
      expect(envelope.delta.byteLength).toBeGreaterThan(8 * 1024 * 1024);
      plain.fill(0);
      bytes.fill(0);
    }
    await expect(room.options.onMessage('sync', new Uint8Array([1, 128]), peer)).rejects.toThrow(
      'envelope',
    );
    expect(sent).toHaveLength(2);
    expect(room.dispose).not.toHaveBeenCalled();
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].description).toHaveLength(
      9 * 1024 * 1024,
    );
  });
});
