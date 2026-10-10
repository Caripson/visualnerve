import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage, type VaultPhysicalRecord } from '../src/security/vault-storage';
import { VaultJournal } from '../src/security/vault-journal';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { prepareVaultKeyRotation } from '../src/security/vault-key-rotation';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { blankGraph } from '../src/model/types';
import { workspaceStoreNames } from '../src/storage/contracts';
import {
  CollaborationPrivateStore,
  type PrivateCollaborationState,
} from '../src/collaboration/persistence/private-store';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const password = 'test-only private collaboration password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage, session: VaultSession, privateStore: CollaborationPrivateStore;
const databases: EncryptedWorkspaceDatabase[] = [];
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  storage = new VaultRecordStorage(`private-collaboration-${crypto.randomUUID()}`);
  await storage.create(created.header);
  session = new VaultSession(storage, cipher);
  await session.initialize();
  await session.unlock(password);
  privateStore = new CollaborationPrivateStore(session, cipher);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(storage.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));
function state(): PrivateCollaborationState {
  return {
    roomId: 'confidential-room-1234',
    diagramId: crypto.randomUUID(),
    relayUrl: 'https://relay.example.com',
    scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
    crdtState: new TextEncoder().encode('private CRDT source'),
    pinnedOwnerSigningKey: new Uint8Array([1, 2, 3, 4]),
    ownerDeviceId: 'owner-device-1234',
    lastEpoch: 4,
    pending: [
      { operationId: 'operation-1234', epoch: 4, ciphertext: new Uint8Array([55, 66, 77]) },
    ],
  };
}
const comparable = (state: PrivateCollaborationState | undefined) =>
  state && {
    ...state,
    crdtState: [...state.crdtState],
    pinnedOwnerSigningKey: state.pinnedOwnerSigningKey && [...state.pinnedOwnerSigningKey],
    pending: state.pending.map((item) => ({ ...item, ciphertext: [...item.ciphertext] })),
  };
async function raw() {
  return session.withUnlocked(async ({ lease }) =>
    storage.select(lease, { store: 'collaboration' }),
  );
}

describe('private collaboration storage in the encrypted vault', () => {
  it('stages private state inside the caller journal without nested acquisition and rolls back failed graph work', async () => {
    const record = state(),
      journal = new VaultJournal(session);
    await expect(
      journal.atomic('rw', ['collaboration', 'nodes'], async (scope) => {
        expect(await privateStore.saveWithinJournal(scope, record, 0)).toBe(1);
        expect((await privateStore.loadWithinJournal(scope, record.roomId))?.revision).toBe(1);
        throw new Error('Graph reference validation failed');
      }),
    ).rejects.toThrow('Graph reference validation failed');
    expect(await privateStore.load(record.roomId)).toBeUndefined();
    await journal.atomic('rw', ['collaboration', 'nodes'], async (scope) => {
      await privateStore.saveWithinJournal(scope, record, 0);
    });
    expect((await privateStore.load(record.roomId))?.revision).toBe(1);
    await expect(
      journal.atomic('rw', ['nodes'], (scope) => privateStore.saveWithinJournal(scope, record, 1)),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_VAULT_TRANSACTION' });
    expect((await privateStore.load(record.roomId))?.revision).toBe(1);
  });
  it('round-trips CRDT/outbox atomically while all on-disk identities/content stay opaque', async () => {
    const record = state();
    const revision = await privateStore.save(record, 0);
    expect(revision).toBe(1);
    expect((await privateStore.load(record.roomId))?.revision).toBe(1);
    expect(comparable((await privateStore.load(record.roomId))?.state)).toEqual(comparable(record));
    const disk = JSON.stringify(await raw());
    expect(disk).not.toMatch(
      /confidential-room|private CRDT source|relay.example|owner-device|operation-1234/,
    );
    expect(await privateStore.associations()).toEqual([
      {
        roomId: record.roomId,
        diagramId: record.diagramId,
        relayUrl: record.relayUrl,
        scope: record.scope,
      },
    ]);
    const changed = { ...record, crdtState: new Uint8Array([9, 8, 7]), pending: [] };
    await privateStore.save(changed, revision);
    expect(comparable((await privateStore.load(record.roomId))?.state)).toEqual(
      comparable(changed),
    );
  });
  it('rejects stale revision without losing the previously committed state', async () => {
    const record = state();
    await privateStore.save(record, 0);
    await expect(
      privateStore.save({ ...record, crdtState: new Uint8Array([5]) }, 0),
    ).rejects.toMatchObject({ status: 409, code: 'COLLABORATION_STATE_CONFLICT' });
    expect(comparable((await privateStore.load(record.roomId))?.state)).toEqual(comparable(record));
  });
  it('captures byte buffers before asynchronous queueing so caller mutation cannot alter the save', async () => {
    const record = state(),
      original = structuredClone(record);
    const saving = privateStore.save(record, 0);
    record.crdtState.fill(0);
    record.pending[0].ciphertext.fill(0);
    record.pinnedOwnerSigningKey!.fill(0);
    await saving;
    expect(comparable((await privateStore.load(record.roomId))?.state)).toEqual(
      comparable(original),
    );
  });
  it('rejects queued original-session writes even after lock and a later unlock', async () => {
    const record = state(),
      journal = new VaultJournal(session);
    let release!: () => void, enter!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocker = journal.atomic('r', ['nodes'], async () => {
      enter();
      await pending;
    });
    await started;
    const operation = await session.captureOperation();
    const queued = privateStore.save(record, 0, operation);
    const rejectedBlocker = expect(blocker).rejects.toMatchObject({ status: 423 });
    const rejectedSave = expect(queued).rejects.toMatchObject({ status: 423 });
    await session.lock();
    release();
    await Promise.all([rejectedBlocker, rejectedSave]);
    operation.dispose();
    await session.unlock(password);
    expect(await privateStore.load(record.roomId)).toBeUndefined();
  });
  it('never exports room associations/state through native graphs, logical/encrypted backups or settings API', async () => {
    const record = state();
    await privateStore.save(record, 0);
    const database = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
    databases.push(database);
    await database.initialize();
    const repository = new Repository(database);
    const graph = await repository.saveGraph(blankGraph('Only the diagram'), 0);
    const backup = await database.backup();
    expect(workspaceStoreNames).not.toContain('collaboration');
    const text =
      JSON.stringify(backup) +
      JSON.stringify(graph) +
      JSON.stringify(await repository.request('/settings', 'GET'));
    expect(text).not.toMatch(
      /confidential-room|private CRDT source|relay.example|owner-device|operation-1234/,
    );
    const container = await session.withUnlocked(async ({ keys }) =>
      cipher.encryptBackup(
        (await storage.control())!.header,
        keys,
        new TextEncoder().encode(JSON.stringify(backup)),
      ),
    );
    const recovered = await session.withUnlocked(async ({ keys }) =>
      cipher.decryptBackup(keys, container),
    );
    expect(new TextDecoder().decode(recovered)).not.toContain(record.roomId);
  });
  it('rotates private records with the vault key and restores them under the new session', async () => {
    const record = state();
    await privateStore.save(record, 0);
    const old = await raw();
    const prepared = await prepareVaultKeyRotation(session, 'new incident collaboration password', {
      currentPassword: password,
    });
    await prepared.activate();
    prepared.dispose();
    await session.unlock('new incident collaboration password');
    expect(comparable((await privateStore.load(record.roomId))?.state)).toEqual(comparable(record));
    const updated = await raw();
    expect(updated.length).toBe(old.length);
    expect(updated.every((item: VaultPhysicalRecord) => item.encrypted.keyVersion === 2)).toBe(
      true,
    );
    expect(updated[0].id).not.toBe(old[0].id);
  });
  it('rejects private signing/ratchet keys, unsafe relay addresses and malformed outbox records', async () => {
    const record = state();
    await expect(
      privateStore.save(
        { ...record, privateState: new Uint8Array([7]) } as unknown as PrivateCollaborationState,
        0,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_COLLABORATION_STATE' });
    await expect(
      privateStore.save({ ...record, relayUrl: 'https://relay.example.com/?secret=capability' }, 0),
    ).rejects.toMatchObject({ code: 'INVALID_COLLABORATION_STATE' });
    await expect(
      privateStore.save({ ...record, pending: [record.pending[0], record.pending[0]] }, 0),
    ).rejects.toMatchObject({ code: 'INVALID_COLLABORATION_STATE' });
    expect(await raw()).toHaveLength(0);
  });
});
