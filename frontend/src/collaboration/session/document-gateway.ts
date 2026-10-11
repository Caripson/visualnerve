import type { WorkspaceStorage } from '../../storage/contracts';
import { withCollaborationJournal } from '../../security/collaboration-journal';
import { StorageError } from '../../model/errors';
import { blankGraph, type Graph } from '../../model/types';
import type { Workspace } from '../../storage/workspace';
import type { VaultSessionOperation } from '../../security/vault-session';
import { collaborationPermissions } from '../access';
import { collaborationDocumentHooks } from '../document-hooks';
import { CollaborativeDocument, CollaborationDocumentError } from '../document/document';
import { sharedGraph, localGraph, type CollaborationShareScope } from '../document/scope';
import {
  CollaborationPrivateStore,
  type PrivateCollaborationState,
} from '../persistence/private-store';
import type { SharedRole } from '../access';
import type { EncryptedRoom, EncryptedPacket } from './encrypted-room';
import { encodeBytes } from '../transport/identity';
import { compressPayload } from './payload-codec';
import {
  CollaborationEnvelopeError,
  validateCollaborationStateVector,
} from '../document/update-envelope';
import {
  CollaborationPeerMessageError,
  CollaborationConnectionError,
} from '../transport/room-transport';
import { CollaborationWorkflow, type WorkflowCheckpoint } from './workflow';
import { appendSemanticActivity, retainCollaborationNodeTitles } from '../model';
import type { RoomMember } from '../../../../collaboration-worker/src/protocol';
import type { CollaborationActionContext } from '../model/types';
const encoder = new TextEncoder();
export interface DocumentGatewayOptions {
  workspace: Workspace;
  store: CollaborationPrivateStore;
  room: EncryptedRoom;
  graph: Graph;
  scope: CollaborationShareScope;
  state?: Uint8Array;
  workflowRevision?: number;
  lease: VaultSessionOperation;
  check(): void;
  role(): SharedRole;
  documentContext?(): CollaborationActionContext;
  onFailure(error: Error): void;
  onOffline(): void;
}
/** The authoritative repository owns graph writes; this port stages only CRDT deltas. */
export class CollaborationDocumentGateway {
  readonly document: CollaborativeDocument;
  private persisted: PrivateCollaborationState;
  private revision = 0;
  private privateQueue = Promise.resolve();
  private sending = Promise.resolve();
  private unbind: Array<() => void> = [];
  private stopped = false;
  private missing: Array<{ sender: string; epoch: number; bytes: Uint8Array }> = [];
  readonly workflow: CollaborationWorkflow;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private syncResponses = new Map<string, number>();
  constructor(private options: DocumentGatewayOptions) {
    this.document = new CollaborativeDocument(options.graph, options.scope, options.state, true);
    this.workflow = new CollaborationWorkflow(
      {
        diagramId: options.graph.diagram.id,
        check: () => this.check(),
        owner: () => options.room.role === 'owner',
        context: (sender) => {
          if (!sender) return options.documentContext?.() ?? { role: options.role(), source: 'ui' };
          const member = options.room.currentPolicy!.policy.members.find(
            (member) => member.deviceId === sender.deviceId,
          );
          if (!member || member.role === 'viewer')
            throw new CollaborationPeerMessageError(
              'This device cannot change protected collaboration.',
            );
          return {
            role: member.role,
            profileId: options.room.profileBindings[member.deviceId],
            source: 'collaboration',
          };
        },
        activeProfileIds: () =>
          Object.entries(options.room.profileBindings)
            .filter(([id]) =>
              options.room.currentPolicy!.policy.members.some((member) => member.deviceId === id),
            )
            .map(([, profileId]) => profileId),
        read: () => options.workspace.repo.getGraph(this.document.diagramId),
        commit: (change, authorize) => this.commitWorkflow(change, authorize),
        send: async (kind, bytes, recipient) => {
          if (kind === 'workflow-request')
            return options.room.message(
              kind,
              bytes,
              options.room.currentPolicy!.policy.ownerDeviceId,
            );
          const compressed = await compressPayload(bytes, options.lease.signal);
          try {
            await options.room.message(kind, compressed, recipient);
          } finally {
            compressed.fill(0);
          }
        },
        failure: (error) => this.backgroundFailure(error),
      },
      options.workflowRevision,
      options.graph.diagram.collaboration,
    );
    const owner = options.room.currentPolicy!.policy.members?.find(
      (member) => member.role === 'owner',
    );
    this.persisted = {
      roomId: options.room.currentPolicy!.policy.roomId,
      diagramId: options.graph.diagram.id,
      relayUrl: '',
      scope: { ...options.scope },
      crdtState: this.document.encodedState(),
      pending: [],
      lastEpoch: options.room.epoch,
      ...(owner
        ? {
            ownerDeviceId: owner.deviceId,
            pinnedOwnerSigningKey: encoder.encode(JSON.stringify(owner.signingKey)),
          }
        : {}),
    };
  }
  private backgroundFailure(error: Error) {
    if (this.stopped) return;
    if (error instanceof CollaborationConnectionError) this.options.onOffline();
    else this.options.onFailure(error);
  }
  private check() {
    this.options.check();
    this.options.lease.assertActive();
    this.options.room.assertAuthorized();
    if (this.stopped) throw new Error('The shared document is closed.');
  }
  async initialize(relay: string, beforeBinding?: () => void, alreadySaved = false) {
    const thisGateway = this;
    this.persisted.relayUrl = relay;
    const existing = await this.options.store.load(this.persisted.roomId, this.options.lease);
    this.check();
    this.revision = existing?.revision ?? 0;
    const initial = structuredClone(this.persisted);
    if (!alreadySaved)
      await this.persist((state) => {
        Object.assign(state, initial);
      });
    else if (!existing) throw new Error('The initial shared state was not saved with its diagram.');
    const id = this.document.diagramId;
    this.check();
    beforeBinding?.();
    this.unbind.push(
      collaborationPermissions.bind(id, {
        get role() {
          return thisGateway.options.role();
        },
        check: () => this.check(),
        hasSharedChanges: (a, b) => this.document.hasSharedChanges(a, b),
        undo: () => this.history('undo'),
        redo: () => this.history('redo'),
        documentContext: () =>
          this.options.documentContext?.() ?? {
            role: this.options.role(),
            source: 'ui',
          },
        applyDocumentAction: (action, context, check) =>
          this.workflow.action(action, context, check),
        activeProfileIds: () =>
          Object.entries(this.options.room.profileBindings ?? {})
            .filter(([id]) =>
              this.options.room.currentPolicy!.policy.members.some(
                (member) => member.deviceId === id,
              ),
            )
            .map(([, profileId]) => profileId),
      }),
    );
    this.unbind.push(
      collaborationDocumentHooks.bind(id, {
        scope: this.options.scope,
        prepareLocal: (before, after, storage) => this.prepareLocal(before, after, storage),
      }),
    );
  }
  async stageInitialization(relay: string, storage: WorkspaceStorage): Promise<() => void> {
    this.check();
    this.persisted.relayUrl = relay;
    const initial = structuredClone(this.persisted);
    return this.stage(storage, (state) => {
      Object.assign(state, initial);
    });
  }
  private persist(change: (state: PrivateCollaborationState) => void): Promise<void> {
    const pending = this.privateQueue.then(async () => {
      this.check();
      const saved = await this.options.store.mutate(
        this.persisted.roomId,
        this.persisted,
        (state) => {
          this.check();
          change(state);
        },
        this.options.lease,
      );
      this.check();
      this.persisted = saved.state;
      this.revision = saved.revision;
    });
    this.privateQueue = pending.catch(() => {});
    return pending;
  }
  private stage(
    storage: WorkspaceStorage,
    change: (state: PrivateCollaborationState) => void,
  ): Promise<() => void> {
    return withCollaborationJournal(storage, async (scope) => {
      this.check();
      const current = await this.options.store.loadWithinJournal(scope, this.persisted.roomId);
      this.check();
      const next = structuredClone(current?.state ?? this.persisted);
      change(next);
      const revision = await this.options.store.saveWithinJournal(
        scope,
        next,
        current?.revision ?? 0,
      );
      this.check();
      return () => {
        this.check();
        this.persisted = next;
        this.revision = revision;
      };
    });
  }
  private async prepareLocal(before: Graph, after: Graph, storage: WorkspaceStorage) {
    this.check();
    if (
      JSON.stringify(before.diagram.collaboration) !== JSON.stringify(after.diagram.collaboration)
    )
      throw new CollaborationPeerMessageError(
        'Use semantic actions for protected collaboration changes.',
      );
    const current = await storage.graph(this.document.diagramId);
    this.check();
    after = {
      ...after,
      diagram: { ...after.diagram, collaboration: structuredClone(current?.diagram.collaboration) },
    };
    const protectedBefore = structuredClone(after);
    if (this.options.room.role === 'owner' && after.diagram.collaboration) {
      after = this.recordActivity(
        before,
        after,
        this.options.documentContext?.() ?? { role: 'owner', source: 'ui' },
      );
    }
    if (!this.document.hasSharedChanges(before, after))
      return {
        graph: this.document.graph(after),
        committed: () => this.workflow.changed(protectedBefore, after),
      };
    const prepared = this.document.prepareLocal(before, after, {
      canWrite: this.options.role() !== 'viewer',
      assertActive: () => this.check(),
    });
    const epoch = this.options.room.epoch;
    const compressed = await compressPayload(prepared.update, this.options.lease.signal);
    this.check();
    let packets: EncryptedPacket[];
    try {
      packets = await this.options.room.encrypt('update', compressed);
    } finally {
      compressed.fill(0);
    }
    this.check();
    const batchId = crypto.randomUUID();
    const messages = packets.map((packet, index) => ({
      operationId: `${batchId}_${index}_${packets.length}`,
      epoch,
      ciphertext: encoder.encode(JSON.stringify(packet)),
    }));
    const finalize = await this.stage(storage, (state) => {
      state.crdtState = prepared.state;
      state.lastEpoch = epoch;
      state.pending.push(...messages);
    });
    return {
      graph: prepared.graph,
      committed: () => {
        this.check();
        finalize();
        prepared.commit();
        this.workflow.changed(protectedBefore, prepared.graph);
        void this.flush().catch((error) => this.backgroundFailure(error));
      },
    };
  }

  private recordActivity(before: Graph, after: Graph, context: CollaborationActionContext): Graph {
    const empty = blankGraph(after.diagram.name, after.diagram.type);
    empty.diagram.id = after.diagram.id;
    const visibleBefore = localGraph(
      sharedGraph(before, this.options.scope),
      empty,
      this.options.scope,
    );
    const visibleAfter = localGraph(
      sharedGraph(after, this.options.scope),
      empty,
      this.options.scope,
    );
    visibleBefore.diagram.collaboration = structuredClone(after.diagram.collaboration);
    visibleAfter.diagram.collaboration = structuredClone(after.diagram.collaboration);
    const recorded = appendSemanticActivity(visibleBefore, visibleAfter, context);
    return retainCollaborationNodeTitles({
      ...after,
      diagram: { ...after.diagram, collaboration: recorded.diagram.collaboration },
    });
  }
  async flush(): Promise<void> {
    const pending = this.sending.then(async () => {
      await this.privateQueue;
      this.check();
      const groups = new Map<string, typeof this.persisted.pending>();
      for (const item of this.persisted.pending) {
        if (item.epoch !== this.options.room.epoch) continue;
        const id = item.operationId.split('_')[0];
        groups.set(id, [...(groups.get(id) ?? []), item]);
      }
      for (const items of groups.values()) {
        this.check();
        const packets = items.map(
          (item) => JSON.parse(new TextDecoder().decode(item.ciphertext)) as EncryptedPacket,
        );
        await this.options.room.send(packets, items[0].epoch);
        this.check();
        await this.persist((state) => {
          state.pending = state.pending.filter(
            (value) => !items.some((item) => item.operationId === value.operationId),
          );
        });
      }
    });
    this.sending = pending.catch(() => {});
    return pending;
  }
  async epochChanged() {
    this.check();
    for (const item of this.missing) if (item.epoch !== this.options.room.epoch) item.bytes.fill(0);
    this.missing = this.missing.filter((item) => item.epoch === this.options.room.epoch);
    // The current CRDT includes every locally committed edit. Publish it under the
    // new epoch rather than attempting to reuse old ratchet ciphertext.
    await this.persist((state) => {
      state.pending = [];
      state.lastEpoch = this.options.room.epoch;
    });
    if (this.options.role() !== 'viewer') {
      const epoch = this.options.room.epoch;
      void this.sendUpdate(this.document.diff(new Uint8Array([0]))).catch((error) => {
        if (!this.stopped && epoch === this.options.room.epoch) this.backgroundFailure(error);
      });
    }
    if (this.options.room.role === 'owner')
      this.workflow.broadcast(await this.options.workspace.repo.getGraph(this.document.diagramId));
  }
  private async sendUpdate(update: Uint8Array, recipient?: string) {
    const compressed = await compressPayload(update, this.options.lease.signal);
    try {
      await this.options.room.message('update', compressed, recipient);
    } finally {
      compressed.fill(0);
    }
  }
  async receive(
    update: Uint8Array,
    sender = this.options.room.currentPolicy!.policy.ownerDeviceId,
    epoch = this.options.room.epoch,
  ) {
    const checkRemote = () => {
      this.check();
      const member = this.options.room.currentPolicy!.policy.members.find(
        (member) => member.deviceId === sender,
      );
      if (epoch !== this.options.room.epoch || !member || member.role === 'viewer')
        throw new CollaborationPeerMessageError(
          'This update no longer has current editing permission. Synchronize the current room state.',
        );
    };
    checkRemote();
    try {
      const authority = collaborationPermissions.projection(this.document.diagramId, () =>
        checkRemote(),
      );
      await this.options.workspace.applySharedProjection(
        this.document.diagramId,
        async (current, storage) => {
          checkRemote();
          let prepared;
          try {
            prepared = this.document.prepareRemote(update, current);
          } catch (error) {
            if (
              error instanceof CollaborationDocumentError &&
              error.code === 'COLLABORATION_DEPENDENCY_MISSING'
            )
              throw error;
            if (error instanceof StorageError || error instanceof CollaborationEnvelopeError)
              throw new CollaborationPeerMessageError(error.message);
            throw error;
          }
          const member = this.options.room.currentPolicy!.policy.members.find(
            (member) => member.deviceId === sender,
          );
          const graph =
            this.options.room.role === 'owner' && prepared.graph.diagram.collaboration
              ? this.recordActivity(current, prepared.graph, {
                  role: 'owner',
                  source: 'collaboration',
                  ...(member
                    ? { profileId: this.options.room.profileBindings[member.deviceId] }
                    : {}),
                })
              : prepared.graph;
          const finalize = await this.stage(storage, (state) => {
            state.crdtState = prepared.state;
          });
          checkRemote();
          return {
            graph,
            committed: () => {
              checkRemote();
              finalize();
              prepared.commit();
              if (this.options.room.role === 'owner') this.workflow.changed(current, graph);
            },
          };
        },
        authority,
      );
    } catch (error) {
      if (
        error instanceof CollaborationDocumentError &&
        error.code === 'COLLABORATION_DEPENDENCY_MISSING'
      ) {
        if (
          this.missing.filter((item) => item.sender === sender).length >= 8 ||
          this.missing
            .filter((item) => item.sender === sender)
            .reduce((n, item) => n + item.bytes.length, update.length) >
            2 * 1024 * 1024 ||
          this.missing.length >= 32
        )
          throw new CollaborationPeerMessageError(
            'This participant has too many missing shared updates; request a fresh state synchronization.',
          );
        this.missing.push({ sender, epoch, bytes: new Uint8Array(update) });
        this.recoverMissing();
        return;
      }
      if (
        error instanceof CollaborationDocumentError ||
        error instanceof CollaborationEnvelopeError
      )
        throw new CollaborationPeerMessageError(error.message);
      throw error;
    }
    if (this.missing.length) {
      const buffered = this.missing;
      this.missing = [];
      for (const item of buffered) {
        try {
          await this.receive(item.bytes, item.sender, item.epoch);
        } finally {
          item.bytes.fill(0);
        }
      }
    }
  }
  private recoverMissing() {
    if (this.recoveryTimer || this.stopped) return;
    const retry = () => {
      this.recoveryTimer = undefined;
      if (!this.missing.length || this.stopped) return;
      const epoch = this.options.room.epoch;
      void this.requestSync().catch((error) => {
        if (!this.stopped && epoch === this.options.room.epoch) this.backgroundFailure(error);
      });
      this.recoveryTimer = setTimeout(retry, 10_000);
    };
    retry();
  }
  async requestSync() {
    await this.options.room.message(
      'sync',
      this.document.stateVector(),
      this.options.room.currentPolicy!.policy.ownerDeviceId,
    );
  }
  async respondSync(vector: Uint8Array, recipient: string) {
    this.check();
    try {
      validateCollaborationStateVector(vector);
    } catch (error) {
      if (error instanceof CollaborationEnvelopeError)
        throw new CollaborationPeerMessageError(error.message);
      throw error;
    }
    let update: Uint8Array;
    try {
      update = this.document.diff(vector);
    } catch (error) {
      // A peer can miss many individually bounded edits. A valid causal diff
      // larger than 8 MiB falls back to the independently bounded full refresh;
      // malformed vectors and all other failures must still reject.
      if (!(error instanceof CollaborationDocumentError) || error.code !== 'COLLABORATION_LIMIT')
        throw error;
      update = this.document.diff(new Uint8Array([0]));
    }
    await this.sendUpdate(update, recipient);
  }
  async snapshot(recipient: string) {
    const graph = await this.options.workspace.repo.getGraph(this.document.diagramId);
    this.check();
    const workflow = this.workflow.checkpoint(graph);
    graph.diagram.collaboration = workflow.document;
    const bytes = encoder.encode(
      JSON.stringify({
        version: 2,
        workflow,
        scope: this.options.scope,
        document: sharedGraph(this.document.graph(graph), this.options.scope),
        state: encodeBytes(this.document.encodedState()),
        ...(this.options.room.role === 'owner'
          ? {
              profileBindings: Object.fromEntries(
                Object.entries(this.options.room.profileBindings).filter(([id]) =>
                  this.options.room.currentPolicy!.policy.members.some(
                    (member) => member.deviceId === id,
                  ),
                ),
              ),
            }
          : {}),
      }),
    );
    const compressed = await compressPayload(bytes, this.options.lease.signal);
    bytes.fill(0);
    try {
      await this.options.room.message('snapshot', compressed, recipient);
    } finally {
      compressed.fill(0);
    }
  }
  private async commitWorkflow(
    change: (current: Graph) => Graph,
    authorize: () => void = () => {},
  ): Promise<Graph> {
    const epoch = this.options.room.epoch;
    const checkWorkflow = () => {
      this.check();
      authorize();
      if (epoch !== this.options.room.epoch)
        throw new CollaborationPeerMessageError(
          'The collaboration policy changed while this action was pending. Read the current document before retrying.',
        );
    };
    checkWorkflow();
    let result!: Graph;
    const authority = collaborationPermissions.projection(this.document.diagramId, () =>
      checkWorkflow(),
    );
    await this.options.workspace.applySharedProjection(
      this.document.diagramId,
      async (current, storage) => {
        checkWorkflow();
        const graph = change(current);
        const finalize = await this.stage(storage, (state) => {
          state.crdtState = this.document.encodedState();
        });
        checkWorkflow();
        result = graph;
        return {
          graph,
          committed: () => {
            checkWorkflow();
            finalize();
            if (this.options.room.role === 'owner') this.workflow.changed(current, graph);
          },
        };
      },
      authority,
    );
    this.check();
    return this.options.workspace.repo.getGraph(result.diagram.id);
  }
  respondInBackground(vector: Uint8Array, recipient: string) {
    this.check();
    try {
      validateCollaborationStateVector(vector);
    } catch (error) {
      if (error instanceof CollaborationEnvelopeError)
        throw new CollaborationPeerMessageError(error.message);
      throw error;
    }
    const now = Date.now();
    if (now - (this.syncResponses.get(recipient) ?? -Infinity) < 10_000) return;
    this.syncResponses.set(recipient, now);
    const owned = new Uint8Array(vector);
    void (
      this.options.room.role === 'owner' && owned.length === 1 && owned[0] === 0
        ? this.snapshot(recipient)
        : this.respondSync(owned, recipient)
    )
      .catch((error) => this.backgroundFailure(error))
      .finally(() => owned.fill(0));
  }
  discardPeer(sender: string) {
    for (const item of this.missing) if (item.sender === sender) item.bytes.fill(0);
    this.missing = this.missing.filter((item) => item.sender !== sender);
  }
  private history(action: 'undo' | 'redo'): boolean {
    this.check();
    if (!(action === 'undo' ? this.document.canUndo : this.document.canRedo)) return false;
    const authority = collaborationPermissions.projection(this.document.diagramId, () =>
      this.check(),
    );
    void this.options.workspace
      .applySharedProjection(
        this.document.diagramId,
        async (graph, storage) => {
          this.check();
          const change = this.document[action](graph, {
            canWrite: this.options.role() !== 'viewer',
            assertActive: () => this.check(),
          });
          if (!change) return { graph, committed: () => {} };
          const epoch = this.options.room.epoch;
          const bytes = await compressPayload(change.update, this.options.lease.signal);
          let packets: EncryptedPacket[];
          try {
            packets = await this.options.room.encrypt('update', bytes);
          } finally {
            bytes.fill(0);
          }
          const batchId = crypto.randomUUID();
          const finalize = await this.stage(storage, (state) => {
            state.crdtState = change.state;
            state.pending.push(
              ...packets.map((packet, index) => ({
                operationId: `${batchId}_${index}_${packets.length}`,
                epoch,
                ciphertext: encoder.encode(JSON.stringify(packet)),
              })),
            );
          });
          return {
            graph: change.graph,
            committed: () => {
              finalize();
              void this.flush().catch((error) => this.backgroundFailure(error));
            },
          };
        },
        authority,
      )
      .catch((error) => this.backgroundFailure(error));
    return true;
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    for (const unbind of this.unbind) unbind();
    this.unbind = [];
    this.document.destroy();
    for (const item of this.missing) item.bytes.fill(0);
    this.workflow.dispose();
    this.missing = [];
    this.persisted.crdtState.fill(0);
    for (const item of this.persisted.pending) item.ciphertext.fill(0);
    this.persisted.pending = [];
  }
}
