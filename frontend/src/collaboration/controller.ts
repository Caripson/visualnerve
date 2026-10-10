import { registerCollaborationUpdateTask } from './update-task';
import type {
  PendingJoin,
  RoomMember,
  SignedRoomPolicy,
} from '../../../collaboration-worker/src/protocol';
import { record } from '../../../collaboration-worker/src/validation';
import { useEditor } from '../state/editor';
import type { Workspace } from '../storage/workspace';
import type { VaultSession, VaultSessionOperation } from '../security/vault-session';
import { blankGraph, type Graph } from '../model/types';
import { validateGraph } from '../model/validation';
import type { CollaborationSnapshot, CollaborationUiController } from './types';
import {
  defaultCollaborationShareScope,
  localGraph,
  type CollaborationShareScope,
  type SharedGraph,
} from './document/scope';
import { CollaborationPrivateStore } from './persistence/private-store';
import { EncryptedRoom } from './session/encrypted-room';
import { CollaborationDocumentGateway } from './session/document-gateway';
import { readInvitation, invitationUrl, type CollaborationInvitation } from './session/invitation';
import { displayName, presenceMessage } from './session/presence';
import { decodeBytes } from './transport/identity';
import { decompressPayload } from './session/payload-codec';
import { collaborationPermissions } from './access';
import { CollaborativeDocument } from './document/document';
import { mergeCollaborationSnapshot } from './document/merge-snapshot';
import { credentialId } from './transport/identity';
const encoder = new TextEncoder();
/** One live session per unlocked browser tab. Other local diagrams stay local. */
export class CollaborationController implements CollaborationUiController {
  private snapshot: Readonly<CollaborationSnapshot>;
  private listeners = new Set<() => void>();
  private lease?: VaultSessionOperation;
  private room?: EncryptedRoom;
  private gateway?: CollaborationDocumentGateway;
  private joins = new Map<string, PendingJoin>();

  private heartbeat?: ReturnType<typeof setInterval>;
  private presencePending = false;
  private epoch = -1;
  private disposed = false;
  private releaseUpdateTask?: () => void;
  private failureAccess?: () => void;
  private initialAccess?: () => void;
  private generation = 0;
  private management = Promise.resolve();
  private cleanups: Array<() => void> = [];
  constructor(
    private options: {
      workspace: Workspace;
      session: VaultSession;
      store: CollaborationPrivateStore;
      relay?: string;
      origin: string;
    },
  ) {
    this.snapshot = Object.freeze({
      configured: !!options.relay,
      status: 'idle',
      diagramId: useEditor.getState().graph?.diagram.id,
      participants: [],
      pendingJoins: [],
      displayName: '',
      scope: { ...defaultCollaborationShareScope },
    });
    this.cleanups.push(options.session.onLock(() => this.reset()));
    this.cleanups.push(
      useEditor.subscribe((state, previous) => {
        if (this.disposed) return;
        if (!this.room && state.graph?.diagram.id !== previous.graph?.diagram.id)
          this.update({ diagramId: state.graph?.diagram.id });
        if (this.gateway && state.selectedNodes !== previous.selectedNodes)
          void this.presence().catch(() => {});
      }),
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(value: Partial<CollaborationSnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...value });
    for (const listener of this.listeners) listener();
  }
  private check() {
    if (this.disposed || !this.lease) throw new Error('Unlock the workspace to collaborate.');
    this.lease.assertActive();
    if (['error', 'conflict'].includes(this.snapshot.status))
      throw new Error('Leave the failed session before editing.');
  }
  private current(generation: number, lease: VaultSessionOperation) {
    return !this.disposed && generation === this.generation && this.lease === lease;
  }
  private checkSession(generation: number, lease: VaultSessionOperation) {
    if (!this.current(generation, lease)) throw new Error('The collaboration session has changed.');
    lease.assertActive();
    this.check();
  }
  private relay() {
    if (!this.options.relay)
      throw new Error('Collaboration is not configured for this app deployment.');
    return this.options.relay;
  }
  private async begin(name: string, scope: CollaborationShareScope, diagramId?: string) {
    if (this.room || this.lease || this.releaseUpdateTask)
      throw new Error('Leave the current room before opening another.');
    this.relay();
    const validated = displayName(name);
    const generation = this.generation,
      release = registerCollaborationUpdateTask();
    this.releaseUpdateTask = release;
    try {
      const lease = await this.options.session.captureOperation();
      if (generation !== this.generation) {
        lease.dispose();
        throw new Error('The workspace was locked while collaboration was starting.');
      }
      this.lease = lease;
      this.check();
    } catch (error) {
      release();
      if (this.releaseUpdateTask === release) this.releaseUpdateTask = undefined;
      throw error;
    }
    this.update({
      status: 'connecting',
      displayName: validated,
      scope: { ...scope },
      diagramId,
      error: undefined,
      invitation: undefined,
      participants: [],
      pendingJoins: [],
      recoveryCopy: undefined,
      selfCredentialId: undefined,
    });
  }
  private roomOptions(roomId: string, diagramId: string) {
    const generation = this.generation,
      lease = this.lease!;
    const active = () => !this.disposed && generation === this.generation && this.lease === lease;
    const check = () => {
      if (!active()) throw new Error('The collaboration session has changed.');
      lease.assertActive();
      this.check();
    };
    return {
      roomId,
      diagramId,
      relay: this.relay(),
      signal: lease.signal,
      check,
      onPolicy: (policy: SignedRoomPolicy) => {
        check();
        this.policy(policy);
      },
      onJoin: (request: PendingJoin) => {
        check();
        this.joins.set(request.deviceId, request);
        this.joinList();
      },
      onReady: () => {
        check();
        return this.ready();
      },
      onMessage: (
        kind: Parameters<EncryptedRoom['message']>[0],
        payload: Uint8Array,
        sender: RoomMember,
      ) => {
        check();
        return this.message(kind, payload, sender);
      },
      onDisconnect: () => {
        if (active() && this.room)
          this.update({
            status: 'offline',
            participants: this.snapshot.participants.map((p) => ({
              ...p,
              connected: p.deviceId === this.snapshot.selfDeviceId,
            })),
          });
      },
      onEpochPending: () => {
        check();
        this.update({ status: 'syncing' });
      },
      onError: (error: Error) => {
        if (active()) this.fail(error);
      },
    };
  }
  async create(diagramId: string, name: string, scope: CollaborationShareScope) {
    await this.begin(name, scope, diagramId);
    const generation = this.generation,
      lease = this.lease!;
    const check = () => this.checkSession(generation, lease);
    let bootstrap: undefined | (() => void);
    try {
      await this.options.workspace.settled();
      check();
      // Freeze content only after draining existing autosaves, before crypto/network
      // awaits can let a newer local graph diverge from the initial shared state.
      bootstrap = collaborationPermissions.bind(diagramId, {
        role: 'viewer',
        check,
        hasSharedChanges: () => true,
      });
      this.initialAccess = bootstrap;
      const graph = await this.options.workspace.repo.getGraph(diagramId);
      check();
      validateGraph(graph);
      const roomId = crypto.randomUUID();
      this.update({ roomId });
      const room = await EncryptedRoom.open(this.roomOptions(roomId, diagramId));
      try {
        check();
      } catch (error) {
        room.dispose();
        throw error;
      }
      this.room = room;
      this.update({
        selfDeviceId: room.device.deviceId,
        selfCredentialId: room.device.credentialId,
      });
      await room.create();
      check();
      this.update({ status: 'live' });
      this.gateway = new CollaborationDocumentGateway(this.gatewayOptions(graph));
      await this.gateway.initialize(this.relay(), bootstrap);
      check();
      this.update({ status: 'live' });
      this.startPresence();
    } catch (error) {
      bootstrap?.();
      if (this.current(generation, lease)) this.fail(error as Error);
      throw error;
    } finally {
      bootstrap?.();
      if (this.initialAccess === bootstrap) this.initialAccess = undefined;
    }
  }
  async join(url: string, name: string) {
    const invitation = readInvitation(url, this.options.origin, this.relay());
    await this.begin(name, invitation.scope, invitation.diagramId);
    const generation = this.generation,
      lease = this.lease!;
    const check = () => this.checkSession(generation, lease);
    this.update({
      roomId: invitation.roomId,
      status: 'awaiting-approval',
      ownerCredentialId: invitation.ownerCredential,
    });
    try {
      const room = await EncryptedRoom.open({
        ...this.roomOptions(invitation.roomId, invitation.diagramId),
        invitation: invitation.ticket,
        ownerCredential: invitation.ownerCredential,
        ownerDeviceId: invitation.ownerDeviceId,
      });
      try {
        check();
      } catch (error) {
        room.dispose();
        throw error;
      }
      this.room = room;
      this.update({
        selfDeviceId: room.device.deviceId,
        selfCredentialId: room.device.credentialId,
      });
      await room.connect();
      check();
    } catch (error) {
      if (this.current(generation, lease)) this.fail(error as Error);
      throw error;
    }
  }
  private gatewayOptions(graph: Graph, state?: Uint8Array) {
    const generation = this.generation,
      lease = this.lease!,
      room = this.room!;
    const check = () => this.checkSession(generation, lease);
    return {
      workspace: this.options.workspace,
      store: this.options.store,
      room,
      graph,
      scope: { ...this.snapshot.scope },
      lease,
      state,
      check,
      role: () => {
        check();
        const role = room.role;
        if (!role) throw new Error('No approved document permission.');
        return ['connecting', 'syncing', 'awaiting-approval'].includes(this.snapshot.status)
          ? ('viewer' as const)
          : role;
      },
      onFailure: (error: Error) => {
        if (this.current(generation, lease)) this.fail(error);
      },
      onOffline: () => {
        if (this.current(generation, lease)) this.update({ status: 'offline' });
      },
    };
  }
  private policy(policy: SignedRoomPolicy) {
    this.check();
    const self = policy.policy.members.find(
      (member) => member.deviceId === this.room?.device.deviceId,
    );
    const previous = new Map(this.snapshot.participants.map((member) => [member.deviceId, member]));
    const participants = policy.policy.members.map((member) => ({
      ...previous.get(member.deviceId),
      deviceId: member.deviceId,
      name:
        previous.get(member.deviceId)?.name ??
        (member.deviceId === self?.deviceId ? this.snapshot.displayName : 'Approved participant'),
      role: member.role,
      credentialId: member.credentialId,
      connected: previous.get(member.deviceId)?.connected ?? member.deviceId === self?.deviceId,
      selectedNodeIds: previous.get(member.deviceId)?.selectedNodeIds ?? [],
      lastSeen: previous.get(member.deviceId)?.lastSeen ?? 0,
    }));
    for (const member of policy.policy.members) this.joins.delete(member.deviceId);
    this.update({
      selfDeviceId: self?.deviceId,
      ownerCredentialId: policy.policy.members.find((member) => member.role === 'owner')
        ?.credentialId,
      role: self?.role,
      participants,
      pendingJoins: [...this.joins.values()].map(({ deviceId, credentialId, expiresAt }) => ({
        deviceId,
        credentialId,
        expiresAt,
      })),
      invitation: undefined,
    });
  }
  private joinList() {
    const now = Date.now();
    for (const [id, request] of this.joins) if (request.expiresAt <= now) this.joins.delete(id);
    this.update({
      pendingJoins: [...this.joins.values()].map(({ deviceId, credentialId, expiresAt }) => ({
        deviceId,
        credentialId,
        expiresAt,
      })),
    });
  }
  private async ready() {
    this.check();
    const room = this.room!,
      generation = this.generation,
      lease = this.lease!;
    const check = () => this.checkSession(generation, lease);
    if (this.gateway) {
      const changed = this.epoch >= 0 && this.epoch !== room.epoch;
      this.epoch = room.epoch;
      this.update({ status: 'live', error: undefined });
      if (changed) await this.gateway.epochChanged();
      else {
        await this.gateway.epochChanged();
        await this.gateway.requestSync();
      }
      check();
      this.startPresence();
      return;
    }
    if (room.role === 'owner') {
      this.epoch = room.epoch;
      return;
    }
    this.update({ status: 'syncing' });
    // The owner is informed by a semantic encrypted sync request, even if its
    // post-approval snapshot was lost. No document is read from the relay.
    await room.message('sync', new Uint8Array([0]), room.currentPolicy!.policy.ownerDeviceId);
  }
  private async message(
    kind: Parameters<EncryptedRoom['message']>[0],
    payload: Uint8Array,
    sender: RoomMember,
  ) {
    this.check();
    if (kind === 'presence') {
      const presence = presenceMessage(payload);
      const now = Date.now();
      this.update({
        participants: this.snapshot.participants.map((member) =>
          member.deviceId === sender.deviceId
            ? { ...member, ...presence, connected: true, lastSeen: now }
            : member,
        ),
      });
      return;
    }
    if (kind === 'sync') {
      if (!this.gateway || this.room!.role === 'viewer') return;
      if (this.room!.role === 'owner' && payload.length === 1 && payload[0] === 0)
        await this.gateway.snapshot(sender.deviceId);
      else await this.gateway.respondSync(payload, sender.deviceId);
      return;
    }
    const bytes = await decompressPayload(payload, this.lease!.signal);
    try {
      if (kind === 'snapshot') {
        if (sender.role !== 'owner')
          throw new Error('Only the approved owner may initialize a shared document.');
        await this.acceptSnapshot(bytes);
      } else {
        if (!this.gateway) {
          await this.room!.message(
            'sync',
            new Uint8Array([0]),
            this.room!.currentPolicy!.policy.ownerDeviceId,
          );
          return;
        }
        await this.gateway.receive(bytes);
      }
    } finally {
      bytes.fill(0);
    }
  }
  private async acceptSnapshot(bytes: Uint8Array) {
    if (this.gateway) return;
    const generation = this.generation,
      lease = this.lease!,
      room = this.room!,
      snapshot = this.snapshot;
    const check = () => this.checkSession(generation, lease);
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    record(input, ['version', 'scope', 'document', 'state']);
    if (input.version !== 1 || JSON.stringify(input.scope) !== JSON.stringify(snapshot.scope))
      throw new Error('The snapshot sharing scope differs from the accepted invitation.');
    const id = snapshot.diagramId!;
    // Drain already queued local work, then freeze content before any reads or
    // recovery awaits. Otherwise a newer saved edit could be overwritten by a
    // candidate merged from an earlier graph snapshot.
    await this.options.workspace.settled();
    check();
    const temporary = collaborationPermissions.bind(id, {
      role: 'viewer',
      check,
      hasSharedChanges: () => true,
    });
    this.initialAccess = temporary;
    let state: Uint8Array | undefined;
    let gateway: CollaborationDocumentGateway | undefined;
    let hadExisting = false;
    try {
      const skeleton = blankGraph('Shared diagram');
      skeleton.diagram.id = id;
      const existing = await this.options.workspace.repo.db.graph(id);
      check();
      hadExisting = !!existing;
      let association;
      const owner = room.currentPolicy!.policy.members.find((member) => member.role === 'owner')!;
      if (existing) {
        association = await this.options.store.load(snapshot.roomId!, lease);
        check();
        if (
          association?.state.diagramId !== id ||
          association.state.relayUrl !== this.relay() ||
          JSON.stringify(association.state.scope) !== JSON.stringify(snapshot.scope) ||
          association.state.ownerDeviceId !== owner.deviceId ||
          !association.state.pinnedOwnerSigningKey
        )
          throw new Error(
            'The prior room, owner or sharing scope differs. Keep a local copy before joining.',
          );
        const pinned = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(association.state.pinnedOwnerSigningKey),
        );
        if ((await credentialId(pinned)) !== owner.credentialId)
          throw new Error('The prior owner fingerprint differs. Keep a local copy before joining.');
        check();
      }
      let graph = localGraph(input.document as SharedGraph, existing ?? skeleton, {
        ...snapshot.scope,
      });
      validateGraph(graph);
      if (graph.diagram.id !== id) throw new Error('The snapshot belongs to another diagram.');
      state = decodeBytes(input.state, 32 * 1024 * 1024);
      if (existing && association) {
        if (room.role === 'viewer') {
          const source = new CollaborativeDocument(graph, snapshot.scope, state);
          try {
            if (source.hasSharedChanges(source.graph(existing), existing)) {
              const recovery = structuredClone(existing);
              recovery.diagram.name = `${existing.diagram.name} — recovered local copy`;
              const copy = await this.options.workspace.repo.importGraph(recovery, async () =>
                check(),
              );
              check();
              this.update({
                recoveryCopy: { diagramId: copy.diagram.id, title: copy.diagram.name },
              });
            }
          } finally {
            source.destroy();
          }
        }
        const merged = mergeCollaborationSnapshot(
          graph,
          state,
          existing,
          association.state.crdtState,
          { ...snapshot.scope },
          room.role !== 'viewer',
        );
        graph = merged.graph;
        state.fill(0);
        state = merged.state;
      }
      const initialized = new CollaborationDocumentGateway(this.gatewayOptions(graph, state));
      gateway = initialized;
      state.fill(0);
      const authority = collaborationPermissions.projection(id, check);
      await this.options.workspace.installSharedGraph(graph, !!existing, authority, (storage) =>
        initialized.stageInitialization(this.relay(), storage),
      );
      check();
      this.gateway = initialized;
      // Keep the initial read-only gate until the gateway replaces it synchronously.
      await initialized.initialize(this.relay(), temporary, true);
      check();
      this.epoch = room.epoch;
      this.update({ status: 'live' });
    } catch (error) {
      gateway?.dispose();
      if (this.gateway === gateway) this.gateway = undefined;
      throw error;
    } finally {
      state?.fill(0);
      temporary();
      if (this.initialAccess === temporary) this.initialAccess = undefined;
    }
    await this.options.workspace.open(id);
    check();
    // Fresh-device rejoin republishes reconciled Yjs data under fresh sender keys.
    if (hadExisting && room.role !== 'viewer') await gateway!.epochChanged();
    check();
    this.startPresence();
  }
  private owner() {
    this.check();
    if (this.room?.role !== 'owner')
      throw new Error('Only the room owner can manage participants.');
    return this.room;
  }
  async createInvitation() {
    const room = this.owner(),
      generation = this.generation,
      lease = this.lease!,
      snapshot = this.snapshot;
    const result = (await room.control('invite')) as {
      invitation: string;
      expiresAt: number;
      roomId: string;
    };
    this.checkSession(generation, lease);
    const invitation: CollaborationInvitation = {
      version: 1,
      roomId: snapshot.roomId!,
      diagramId: snapshot.diagramId!,
      relay: this.relay(),
      ownerDeviceId: room.device.deviceId,
      ownerCredential: room.device.credentialId,
      ticket: result.invitation,
      expiresAt: result.expiresAt,
      scope: { ...snapshot.scope },
    };
    const url = invitationUrl(invitation, this.options.origin);
    readInvitation(url, this.options.origin, this.relay());
    this.update({ invitation: { url, expiresAt: result.expiresAt } });
  }
  private manage(work: (check: () => void) => Promise<void>) {
    const generation = this.generation,
      lease = this.lease!;
    const check = () => this.checkSession(generation, lease);
    const pending = this.management.then(async () => {
      check();
      this.owner();
      await this.options.workspace.settled();
      check();
      this.room!.cancelPendingSends();
      this.update({ status: 'syncing' });
      try {
        await work(check);
        check();
        this.epoch = this.room!.epoch;
        this.update({ status: 'live' });
        await this.gateway?.epochChanged();
        check();
        await this.presence();
      } catch (error) {
        if (this.current(generation, lease)) this.fail(error as Error);
        throw error;
      }
    });
    this.management = pending.catch(() => {});
    return pending;
  }
  approve(deviceId: string, role: 'editor' | 'viewer') {
    const generation = this.generation,
      lease = this.lease!;
    return this.manage(async (check) => {
      const room = this.owner();
      const request = this.joins.get(deviceId);
      if (!request || request.expiresAt <= Date.now())
        throw new Error('The admission request has expired.');
      await room.changeMembers(
        [
          ...room.currentPolicy!.policy.members,
          {
            deviceId: request.deviceId,
            signingKey: request.signingKey,
            credentialId: request.credentialId,
            mlsSignatureKey: request.mlsSignatureKey,
            role,
          },
        ],
        request,
      );
      check();
      this.joins.delete(deviceId);
      this.joinList();
    }).then(async () => {
      this.checkSession(generation, lease);
      await this.gateway?.snapshot(deviceId);
    });
  }
  async reject(deviceId: string) {
    const room = this.owner(),
      generation = this.generation,
      lease = this.lease!;
    await room.control('reject', deviceId);
    this.checkSession(generation, lease);
    this.joins.delete(deviceId);
    this.joinList();
  }
  changeRole(deviceId: string, role: 'editor' | 'viewer') {
    return this.manage(async () => {
      const room = this.owner();
      if (deviceId === room.device.deviceId) throw new Error('The owner role cannot be changed.');
      await room.changeMembers(
        room.currentPolicy!.policy.members.map((member) =>
          member.deviceId === deviceId ? { ...member, role } : member,
        ),
      );
    });
  }
  remove(deviceId: string) {
    return this.manage(async () => {
      const room = this.owner();
      if (deviceId === room.device.deviceId)
        throw new Error('Use End room to close your own room.');
      await room.changeMembers(
        room.currentPolicy!.policy.members.filter((member) => member.deviceId !== deviceId),
      );
    });
  }
  async reconnect() {
    this.check();
    const room = this.room!,
      generation = this.generation,
      lease = this.lease!;
    if (!room) throw new Error('There is no live session to reconnect.');
    this.update({ status: 'connecting' });
    try {
      await room.reconnect();
      this.checkSession(generation, lease);
    } catch (error) {
      if (this.current(generation, lease)) this.fail(error as Error);
      throw error;
    }
  }
  private startPresence() {
    if (this.heartbeat) return;
    void this.presence().catch(() => {});
    this.heartbeat = setInterval(() => {
      if (this.disposed) return;
      this.joinList();
      const cutoff = Date.now() - 45_000;
      this.update({
        participants: this.snapshot.participants.map((member) => ({
          ...member,
          connected: member.deviceId === this.snapshot.selfDeviceId || member.lastSeen > cutoff,
        })),
      });
      void this.presence().catch(() => {});
    }, 15_000);
  }
  private async presence() {
    if (this.presencePending || !this.room || !this.gateway || this.snapshot.status !== 'live')
      return;
    this.presencePending = true;
    try {
      const selected =
        useEditor.getState().graph?.diagram.id === this.snapshot.diagramId
          ? useEditor.getState().selectedNodes.slice(0, 100)
          : [];
      await this.room.message(
        'presence',
        encoder.encode(
          JSON.stringify({
            name: this.snapshot.displayName,
            selectedNodeIds: selected,
            actor: 'human',
          }),
        ),
      );
    } finally {
      this.presencePending = false;
    }
  }
  private fail(error: Error) {
    if (this.disposed || ['error', 'conflict'].includes(this.snapshot.status)) return;
    this.update({
      status:
        (error as { code?: string }).code === 'COLLABORATION_INVALID_UPDATE' ? 'conflict' : 'error',
      error: error.message.slice(0, 400),
      invitation: undefined,
    });
    this.generation++;
    this.initialAccess?.();
    this.initialAccess = undefined;
    this.room?.dispose();
    this.gateway?.dispose();
    this.gateway = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    // Destroy failed disposable CRDT state and freeze the last durable graph until Leave.
    if (this.snapshot.diagramId && this.lease && !this.failureAccess)
      this.failureAccess = collaborationPermissions.bind(this.snapshot.diagramId, {
        role: 'viewer',
        check: () => {
          throw new Error('Leave the failed session before editing.');
        },
        hasSharedChanges: () => true,
      });
  }
  async leave() {
    const room = this.room,
      gateway = this.gateway,
      generation = this.generation,
      lease = this.lease;
    if (room && lease && this.snapshot.status === 'live') {
      try {
        await gateway?.flush();
        this.checkSession(generation, lease);
        await room.control('leave');
      } finally {
        if (this.current(generation, lease)) this.reset();
      }
    } else this.reset();
  }
  async closeRoom() {
    const room = this.owner(),
      generation = this.generation,
      lease = this.lease!;
    try {
      await room.control('delete-room');
    } finally {
      if (this.current(generation, lease)) this.reset();
    }
  }
  private reset() {
    this.generation++;
    this.initialAccess?.();
    this.initialAccess = undefined;
    this.management = Promise.resolve();
    this.presencePending = false;
    this.failureAccess?.();
    this.failureAccess = undefined;
    this.releaseUpdateTask?.();
    this.releaseUpdateTask = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.gateway?.dispose();
    this.gateway = undefined;
    this.room?.dispose();
    this.room = undefined;
    this.lease?.dispose();
    this.lease = undefined;
    this.joins.clear();
    this.epoch = -1;
    this.update({
      status: 'idle',
      roomId: undefined,
      diagramId: useEditor.getState().graph?.diagram.id,
      selfDeviceId: undefined,
      selfCredentialId: undefined,
      recoveryCopy: undefined,
      role: undefined,
      ownerCredentialId: undefined,
      participants: [],
      pendingJoins: [],
      invitation: undefined,
      error: undefined,
    });
  }
  dispose() {
    this.reset();
    this.disposed = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.listeners.clear();
  }
}
