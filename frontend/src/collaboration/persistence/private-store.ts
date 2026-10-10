import { base64url, unbase64url } from '../../security/vault-codec';
import { VaultCrypto } from '../../security/vault-crypto';
import { VaultJournal, type VaultJournalScope } from '../../security/vault-journal';
import { VaultLogicalRecordCodec } from '../../security/vault-logical-record';
import type { VaultSession, VaultSessionOperation } from '../../security/vault-session';
import { VaultStorageError } from '../../security/vault-storage';
import { collaborationDocumentLimits, type CollaborationShareScope } from '../document/scope';
import { isCollaborationBytes } from '../document/bytes';

export const collaborationPrivateLimits = Object.freeze({
  rooms: 128,
  outboxCount: 128,
  outboxBytes: 8 * 1024 * 1024,
  publicKeyBytes: 4096,
});
export interface CollaborationPendingCiphertext {
  operationId: string;
  epoch: number;
  ciphertext: Uint8Array;
}
/**
 * No MLS ratchet/signing private key is persisted in this release. Reloading must
 * create a fresh approved device; retained ciphertext is not authority to rejoin.
 */
export interface PrivateCollaborationState {
  roomId: string;
  diagramId: string;
  relayUrl: string;
  scope: CollaborationShareScope;
  crdtState: Uint8Array;
  pinnedOwnerSigningKey?: Uint8Array;
  ownerDeviceId?: string;
  lastEpoch?: number;
  pending: CollaborationPendingCiphertext[];
}
export interface PrivateCollaborationSnapshot {
  revision: number;
  state: PrivateCollaborationState;
}
export interface CollaborationRoomAssociation {
  roomId: string;
  diagramId: string;
  relayUrl: string;
  scope: CollaborationShareScope;
}
type EncodedState = Omit<
  PrivateCollaborationState,
  'crdtState' | 'pinnedOwnerSigningKey' | 'pending'
> & {
  format: 'visualnerve-private-collaboration';
  version: 1;
  crdtState: string;
  pinnedOwnerSigningKey?: string;
  pending: Array<Omit<CollaborationPendingCiphertext, 'ciphertext'> & { ciphertext: string }>;
};
const store = 'collaboration' as const;
const token = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const invalid = (message: string): never => {
  throw new VaultStorageError(422, 'INVALID_COLLABORATION_STATE', message);
};
const fields = new Set([
  'roomId',
  'diagramId',
  'relayUrl',
  'scope',
  'crdtState',
  'pinnedOwnerSigningKey',
  'ownerDeviceId',
  'lastEpoch',
  'pending',
]);
const projection = ({
  roomId,
  diagramId,
  relayUrl,
  scope,
}: PrivateCollaborationState): CollaborationRoomAssociation => ({
  roomId,
  diagramId,
  relayUrl,
  scope,
});

function encode(state: PrivateCollaborationState): EncodedState {
  if (
    !state ||
    Object.keys(state).some((key) => !fields.has(key)) ||
    !token(state.roomId) ||
    !uuid.test(state.diagramId) ||
    typeof state.relayUrl !== 'string' ||
    state.relayUrl.length > 2048 ||
    !isCollaborationBytes(state.crdtState) ||
    state.crdtState.byteLength > collaborationDocumentLimits.stateBytes ||
    !state.scope ||
    Object.keys(state.scope).length !== 3 ||
    ['shareMetadata', 'shareOwners', 'shareDatasets'].some(
      (key) => typeof state.scope[key as keyof CollaborationShareScope] !== 'boolean',
    ) ||
    (state.ownerDeviceId !== undefined && !token(state.ownerDeviceId)) ||
    (state.lastEpoch !== undefined &&
      (!Number.isSafeInteger(state.lastEpoch) || state.lastEpoch < 0)) ||
    (state.pinnedOwnerSigningKey !== undefined &&
      (!isCollaborationBytes(state.pinnedOwnerSigningKey) ||
        state.pinnedOwnerSigningKey.byteLength > collaborationPrivateLimits.publicKeyBytes)) ||
    !Array.isArray(state.pending) ||
    state.pending.length > collaborationPrivateLimits.outboxCount
  )
    invalid('Invalid private room state or size limit exceeded.');
  let url: URL;
  try {
    url = new URL(state.relayUrl);
  } catch {
    return invalid('Invalid collaboration relay URL.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    invalid('Use an HTTPS relay URL (HTTP is permitted only on loopback).');
  const operationIds = new Set<string>();
  let bytes = 0;
  const pending = state.pending.map((item) => {
    if (
      !item ||
      Object.keys(item).length !== 3 ||
      !token(item.operationId) ||
      operationIds.has(item.operationId) ||
      !Number.isSafeInteger(item.epoch) ||
      item.epoch < 0 ||
      !isCollaborationBytes(item.ciphertext)
    )
      invalid('Invalid or duplicate pending collaboration message.');
    operationIds.add(item.operationId);
    bytes += item.ciphertext.byteLength;
    if (bytes > collaborationPrivateLimits.outboxBytes)
      invalid('Collaboration outbox exceeds its size limit.');
    return {
      operationId: item.operationId,
      epoch: item.epoch,
      ciphertext: base64url(item.ciphertext),
    };
  });
  return {
    format: 'visualnerve-private-collaboration',
    version: 1,
    ...projection(state),
    scope: { ...state.scope },
    crdtState: base64url(state.crdtState),
    pending,
    ...(state.pinnedOwnerSigningKey !== undefined
      ? { pinnedOwnerSigningKey: base64url(state.pinnedOwnerSigningKey) }
      : {}),
    ...(state.ownerDeviceId !== undefined ? { ownerDeviceId: state.ownerDeviceId } : {}),
    ...(state.lastEpoch !== undefined ? { lastEpoch: state.lastEpoch } : {}),
  };
}
function decode(value: EncodedState): PrivateCollaborationState {
  if (!value || value.format !== 'visualnerve-private-collaboration' || value.version !== 1)
    invalid('Invalid private collaboration record.');
  const { format: _format, version: _version, ...rest } = value;
  const state = {
    ...rest,
    crdtState: unbase64url(value.crdtState, 0, collaborationDocumentLimits.stateBytes),
    ...(value.pinnedOwnerSigningKey !== undefined
      ? {
          pinnedOwnerSigningKey: unbase64url(
            value.pinnedOwnerSigningKey,
            0,
            collaborationPrivateLimits.publicKeyBytes,
          ),
        }
      : {}),
    pending: value.pending.map((item) => ({
      ...item,
      ciphertext: unbase64url(item.ciphertext, 0, collaborationPrivateLimits.outboxBytes),
    })),
  } as PrivateCollaborationState;
  encode(state);
  return state;
}

/** Dedicated encrypted namespace: not a WorkspaceTable, setting, graph or export. */
export class CollaborationPrivateStore {
  private journal: VaultJournal;
  private codec: VaultLogicalRecordCodec;
  constructor(
    readonly session: VaultSession,
    crypto: VaultCrypto,
  ) {
    this.journal = new VaultJournal(session);
    this.codec = new VaultLogicalRecordCodec(crypto);
  }
  private id(roomId: string) {
    if (!token(roomId)) invalid('Invalid room identifier.');
    return `room:${roomId}`;
  }
  private async read(scope: VaultJournalScope, roomId: string) {
    const logicalId = this.id(roomId);
    const id = await this.codec.id(scope.context.keys, store, logicalId);
    const root = await scope.get(store, id);
    if (!root) return undefined;
    const result = await this.codec.read<EncodedState>(
      scope.context.keys,
      root,
      (ids) => Promise.all(ids.map((id) => scope.get(store, id))),
      logicalId,
    );
    const state = decode(result.value);
    if (
      state.roomId !== roomId ||
      JSON.stringify(result.projection) !== JSON.stringify(projection(state))
    )
      invalid('Private room identity/projection mismatch.');
    return { root, result, state };
  }
  /** Internal caller already owns the original vault journal; never acquire another transaction here. */
  async loadWithinJournal(
    scope: VaultJournalScope,
    roomId: string,
  ): Promise<PrivateCollaborationSnapshot | undefined> {
    const value = await this.read(scope, roomId);
    return value ? { revision: value.root.revision, state: value.state } : undefined;
  }
  async load(
    roomId: string,
    operation?: VaultSessionOperation,
  ): Promise<PrivateCollaborationSnapshot | undefined> {
    return this.journal.atomic(
      'r',
      [store],
      (scope) => this.loadWithinJournal(scope, roomId),
      operation,
    );
  }
  private async saveEncodedWithinJournal(
    scope: VaultJournalScope,
    value: EncodedState,
    expectedRevision: number,
  ): Promise<number> {
    const logicalId = this.id(value.roomId);
    const existing = await this.read(scope, value.roomId);
    if ((existing?.root.revision ?? 0) !== expectedRevision)
      throw new VaultStorageError(
        409,
        'COLLABORATION_STATE_CONFLICT',
        'Private room state changed. Reload before saving.',
      );
    if (!existing) {
      const partition = await this.codec.rootPartition(scope.context.keys, store);
      if ((await scope.select({ store, partition })).length >= collaborationPrivateLimits.rooms)
        invalid('Too many saved collaboration rooms.');
    }
    const bundle = await this.codec.encode(
      scope.context.keys,
      store,
      logicalId,
      value,
      expectedRevision + 1,
      [],
      {
        projection: projection(value as unknown as PrivateCollaborationState),
        previous: existing?.result.snapshot,
        payloadFields: ['crdtState', 'pending'],
      },
    );
    for (const record of bundle.records) await scope.put(record);
    for (const id of bundle.obsoleteIds) await scope.delete(store, id);
    return bundle.root.revision;
  }
  /** Graph and private CRDT/outbox are staged in this same journal, with one durable commit fence. */
  async saveWithinJournal(
    scope: VaultJournalScope,
    state: PrivateCollaborationState,
    expectedRevision: number,
  ): Promise<number> {
    const value = encode(state);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      invalid('Invalid private state revision.');
    return this.saveEncodedWithinJournal(scope, value, expectedRevision);
  }
  async save(
    state: PrivateCollaborationState,
    expectedRevision: number,
    operation?: VaultSessionOperation,
  ): Promise<number> {
    // Snapshot caller buffers synchronously, before vault acquisition or queue waits.
    const value = encode(state);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      invalid('Invalid private state revision.');
    return this.journal.atomic(
      'rw',
      [store],
      (scope) => this.saveEncodedWithinJournal(scope, value, expectedRevision),
      operation,
    );
  }
  /** Atomic acknowledgement/membership updates cannot race a coupled graph commit. */
  async mutate(
    roomId: string,
    fallback: PrivateCollaborationState,
    change: (state: PrivateCollaborationState) => void,
    operation?: VaultSessionOperation,
  ): Promise<PrivateCollaborationSnapshot> {
    const initial = decode(encode(fallback));
    if (initial.roomId !== roomId) invalid('Private room identity mismatch.');
    return this.journal.atomic(
      'rw',
      [store],
      async (scope) => {
        const current = await this.loadWithinJournal(scope, roomId);
        const next = current?.state ?? initial;
        change(next);
        if (next.roomId !== roomId) invalid('Private room identity cannot be changed.');
        const revision = await this.saveWithinJournal(scope, next, current?.revision ?? 0);
        return { revision, state: next };
      },
      operation,
    );
  }
  async remove(roomId: string, expectedRevision: number, operation?: VaultSessionOperation) {
    return this.journal.atomic(
      'rw',
      [store],
      async (scope) => {
        const existing = await this.read(scope, roomId);
        if ((existing?.root.revision ?? 0) !== expectedRevision)
          throw new VaultStorageError(
            409,
            'COLLABORATION_STATE_CONFLICT',
            'Private room state changed. Reload before removing.',
          );
        if (!existing) return;
        await scope.delete(store, existing.root.id);
        for (const id of existing.result.snapshot.chunkIds) await scope.delete(store, id);
      },
      operation,
    );
  }
  async associations(operation?: VaultSessionOperation): Promise<CollaborationRoomAssociation[]> {
    return this.journal.atomic(
      'r',
      [store],
      async (scope) => {
        const partition = await this.codec.rootPartition(scope.context.keys, store);
        const records = await scope.select({ store, partition });
        if (records.length > collaborationPrivateLimits.rooms)
          invalid('Too many saved collaboration rooms.');
        return Promise.all(
          records.map(async (root) => {
            const result = await this.codec.project<CollaborationRoomAssociation>(
              scope.context.keys,
              root,
            );
            if (result.logicalId !== this.id(result.projection.roomId))
              invalid('Invalid private room association.');
            return result.projection;
          }),
        );
      },
      operation,
    );
  }
}
