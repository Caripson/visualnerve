import type { WorkspaceStorage } from '../../storage/contracts';
import { withCollaborationJournal } from '../../security/collaboration-journal';
import type { Graph } from '../../model/types';
import type { Workspace } from '../../storage/workspace';
import type { VaultSessionOperation } from '../../security/vault-session';
import { collaborationPermissions } from '../access';
import { collaborationDocumentHooks } from '../document-hooks';
import { CollaborativeDocument, CollaborationDocumentError } from '../document/document';
import { sharedGraph, type CollaborationShareScope } from '../document/scope';
import {
  CollaborationPrivateStore,
  type PrivateCollaborationState,
} from '../persistence/private-store';
import type { SharedRole } from '../access';
import type { EncryptedRoom, EncryptedPacket } from './encrypted-room';
import { encodeBytes } from '../transport/identity';
import { compressPayload } from './payload-codec';
const encoder = new TextEncoder();
export interface DocumentGatewayOptions {
  workspace: Workspace;
  store: CollaborationPrivateStore;
  room: EncryptedRoom;
  graph: Graph;
  scope: CollaborationShareScope;
  state?: Uint8Array;
  lease: VaultSessionOperation;
  check(): void;
  role(): SharedRole;
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
  private missing: Array<Uint8Array> = [];
  constructor(private options: DocumentGatewayOptions) {
    this.document = new CollaborativeDocument(options.graph, options.scope, options.state);
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
  private check() {
    this.options.check();
    this.options.lease.assertActive();
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
      }),
    );
    this.unbind.push(
      collaborationDocumentHooks.bind(id, {
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
    if (!this.document.hasSharedChanges(before, after))
      return { graph: this.document.graph(after), committed: () => {} };
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
        void this.flush().catch(() => this.options.onOffline());
      },
    };
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
    // The current CRDT includes every locally committed edit. Publish it under the
    // new epoch rather than attempting to reuse old ratchet ciphertext.
    await this.persist((state) => {
      state.pending = [];
      state.lastEpoch = this.options.room.epoch;
    });
    if (this.options.role() !== 'viewer')
      await this.sendUpdate(this.document.diff(new Uint8Array([0])));
  }
  private async sendUpdate(update: Uint8Array, recipient?: string) {
    const compressed = await compressPayload(update, this.options.lease.signal);
    try {
      await this.options.room.message('update', compressed, recipient);
    } finally {
      compressed.fill(0);
    }
  }
  async receive(update: Uint8Array) {
    this.check();
    try {
      const authority = collaborationPermissions.projection(this.document.diagramId, () =>
        this.check(),
      );
      await this.options.workspace.applySharedProjection(
        this.document.diagramId,
        async (current, storage) => {
          this.check();
          const prepared = this.document.prepareRemote(update, current);
          const finalize = await this.stage(storage, (state) => {
            state.crdtState = prepared.state;
          });
          this.check();
          return {
            graph: prepared.graph,
            committed: () => {
              this.check();
              finalize();
              prepared.commit();
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
          this.missing.length >= 32 ||
          this.missing.reduce((n, item) => n + item.length, update.length) > 8 * 1024 * 1024
        )
          throw new Error('Too many missing shared updates. Rejoin with a fresh invitation.');
        this.missing.push(new Uint8Array(update));
        await this.requestSync();
        return;
      }
      throw error;
    }
    if (this.missing.length) {
      const buffered = this.missing;
      this.missing = [];
      for (const item of buffered) {
        try {
          await this.receive(item);
        } finally {
          item.fill(0);
        }
      }
    }
  }
  async requestSync() {
    await this.options.room.message(
      'sync',
      this.document.stateVector(),
      this.options.room.currentPolicy!.policy.ownerDeviceId,
    );
  }
  async respondSync(vector: Uint8Array, recipient: string) {
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
    const bytes = encoder.encode(
      JSON.stringify({
        version: 1,
        scope: this.options.scope,
        document: sharedGraph(this.document.graph(graph), this.options.scope),
        state: encodeBytes(this.document.encodedState()),
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
              void this.flush().catch(() => this.options.onOffline());
            },
          };
        },
        authority,
      )
      .catch((error) => this.options.onFailure(error));
    return true;
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    for (const unbind of this.unbind) unbind();
    this.unbind = [];
    this.document.destroy();
    for (const item of this.missing) item.fill(0);
    this.missing = [];
    this.persisted.crdtState.fill(0);
    for (const item of this.persisted.pending) item.ciphertext.fill(0);
    this.persisted.pending = [];
  }
}
