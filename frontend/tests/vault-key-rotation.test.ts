import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordStorage, type VaultPhysicalRecord } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import {
  projectWorkspaceIndexes,
  workspaceEqualityPartitions,
} from '../src/security/vault-indexes';
import { prepareVaultKeyRotation } from '../src/security/vault-key-rotation';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { base, blankGraph, newNode, newEdge } from '../src/model/types';
import { parseCsv } from '../src/data/csv';
import { workspaceStoreNames } from '../src/storage/contracts';
import { WORKSPACE_MIGRATION_SETTING } from '../src/storage/migration-settings';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph } from '../src/simulation/document';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';

// Real production KDFs and native transactional rollback must finish under shared CI CPU load.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const password = 'original confidential vault password';
const nextPassword = 'replacement incident vault password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage,
  session: VaultSession,
  codec: VaultLogicalRecordCodec,
  db: EncryptedWorkspaceDatabase;
const siblings: VaultSession[] = [];

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  storage = new VaultRecordStorage(`rotation-${crypto.randomUUID()}`);
  await storage.create(created.header);
  session = new VaultSession(storage, cipher);
  await session.initialize();
  await session.unlock(password);
  codec = new VaultLogicalRecordCodec(cipher);
  db = new EncryptedWorkspaceDatabase(session, codec);
  await db.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.dispose();
  for (const sibling of siblings.splice(0)) await sibling.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(storage.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Rotation fixture retained a database connection.'));
  });
  vi.unstubAllGlobals();
});
async function rawRecords(): Promise<VaultPhysicalRecord[]> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(storage.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = connection.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    connection.close();
  }
}
async function records() {
  const result: Record<string, unknown[]> = {};
  for (const name of workspaceStoreNames) result[name] = await db[name].toArray();
  return result;
}
async function populate(chunked = false) {
  const repo = new Repository(db);
  const graph = blankGraph('Private incident response workflow', 'flowchart');
  graph.owners = [
    {
      ...base(),
      name: 'Private rotation operator',
      kind: 'person',
      color: '#0f766e',
      metadata: { secret: 'Private owner information' },
      externalId: 'private-owner-alias',
    },
  ];
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Private incident assembly',
      externalId: 'incident-assembly',
      ownerIds: [graph.owners[0].id],
    }),
    newNode(graph.diagram.id, {
      title: 'Private incident delivery',
      externalId: 'incident-delivery',
    }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      label: 'Private transfer rules',
      externalId: 'incident-flow',
    }),
  ];
  graph.dataset = {
    ...parseCsv(
      'Customer,Amount\nPrivate rotation customer,27\nOther confidential customer,43',
      'private-data.csv',
    ),
    diagramId: graph.diagram.id,
  };
  if (chunked)
    graph.dataset.rows = Array.from({ length: 500 }, (_, index) => [
      `Private rotation customer ${index} ${'secret'.repeat(35)}`,
      String(index),
    ]);
  const saved = await repo.saveGraph(graph, 0);
  await repo.history.create(saved.diagram.id, {
    name: 'Private retained baseline',
    baseVersion: saved.diagram.version,
  });
  await db.templates.put({
    id: 'private-custom-template',
    name: 'Private reusable rotation template',
    graph: blankGraph('Private template instructions', 'flowchart'),
    builtin: false,
  });
  const sim = await repo.saveGraph(
    createSimulationGraph(
      'Private rotation simulation',
      createBasicModel({ particles: 4, processingSeconds: 10 }),
    ),
    0,
  );
  const options = { durationSeconds: 120, seed: 12345, runId: 'private-retained-run' };
  const result = runSimulation(sim.simulation!, options);
  const store = new SimulationRunStore(db);
  await store.put({
    id: result.runId,
    diagramId: sim.diagram.id,
    model: sim.simulation!,
    options,
    result,
    status: result.status,
    createdAt: '2026-10-08T16:00:00.000Z',
    updatedAt: '2026-10-08T16:02:00.000Z',
  });
  await store.putCheckpoint(result.runId, result.timeSeconds, result);
  await db.settings.bulkPut([
    { key: 'workspace-id', value: 'destination-rotation-identity' },
    { key: 'mcp-access', value: 'off' },
    { key: 'storage-consent', value: true },
    { key: 'presentation-voice', value: 'en_GB-alan-medium' },
  ]);
  return saved;
}
async function sibling() {
  const other = new VaultSession(new VaultRecordStorage(storage.name), cipher);
  siblings.push(other);
  await other.initialize();
  await other.unlock(password);
  return other;
}
const options = () => ({ currentPassword: password });

describe('canonical incident content-key rotation', () => {
  it('rebuilds all 14 stores/IDs/partitions/chunks without changing logical history, CSV, versions or simulator results; replaces canonical credentials and locks every original lease', async () => {
    const graph = await populate(true);
    const before = await records();
    const oldPhysical = await rawRecords();
    expect(workspaceStoreNames.every((name) => before[name].length > 0)).toBe(true);
    const oldCapture = await db.captureOperation();
    const nestedCapture = await oldCapture.storage.captureOperation();
    const other = await sibling();
    const otherCapture = await other.captureOperation();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const recoveryKey = preparation.recoveryKey;
    expect(JSON.stringify(preparation)).toBe('{}');
    expect(await rawRecords()).toEqual(oldPhysical);
    const originalControl = (await storage.control())!;
    await preparation.activate();
    expect(session.getSnapshot().status).toBe('locked');
    const updated = (await storage.control())!;
    expect(updated).toMatchObject({
      locked: true,
      epoch: originalControl.epoch + 1,
      revision: originalControl.revision + 1,
      header: { vaultId: created.header.vaultId, keyVersion: 2 },
    });
    expect(updated.policy).toEqual(originalControl.policy);
    const newPhysical = await rawRecords();
    const oldIds = new Set(oldPhysical.map((record) => record.id));
    const oldPartitions = new Set(oldPhysical.flatMap((record) => record.partitions));
    expect(
      newPhysical.every(
        (record) =>
          !oldIds.has(record.id) &&
          record.encrypted.keyVersion === 2 &&
          record.revision === 1 &&
          record.partitions.every((token) => !oldPartitions.has(token)),
      ),
    ).toBe(true);
    const text = JSON.stringify(newPhysical);
    for (const secret of [
      password,
      nextPassword,
      recoveryKey,
      graph.diagram.id,
      graph.diagram.name,
      graph.nodes[0].id,
      'Private rotation customer',
      'private-retained-run',
    ])
      expect(text).not.toContain(secret);
    await expect(oldCapture.check()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await expect(nestedCapture.storage.nodes.get(graph.nodes[0].id)).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    await expect(otherCapture.check()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await expect(storage.beginSession(created.header)).rejects.toMatchObject({
      code: 'VAULT_CONFLICT',
    });
    await expect(session.unlock(password)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(
      cipher.unlockWithRecovery(updated.header, created.recoveryKey),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    const recovery = await cipher.unlockWithRecovery(updated.header, recoveryKey);
    cipher.destroyKeys(recovery);
    await session.unlock(nextPassword);
    await db.open();
    expect(await records()).toEqual(before);
    expect((await new Repository(db).getGraph(graph.diagram.id)).dataset!.rows).toEqual(
      graph.dataset!.rows,
    );
    await expect(oldCapture.storage.diagrams.toArray()).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    await expect(otherCapture.run(async () => 'must not regain old access')).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    oldCapture.dispose();
    nestedCapture.dispose();
    otherCapture.dispose();
  });

  it('authenticates current password and rejects reusing a compromised password even without the optional current-password parameter', async () => {
    const before = await storage.control();
    await expect(
      prepareVaultKeyRotation(session, nextPassword, {
        currentPassword: 'incorrect original vault password',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(prepareVaultKeyRotation(session, password, options())).rejects.toMatchObject({
      code: 'PASSWORD_REUSE',
    });
    await expect(prepareVaultKeyRotation(session, password)).rejects.toMatchObject({
      code: 'PASSWORD_REUSE',
    });
    expect(await storage.control()).toEqual(before);
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('rejects revocation in the final awaited-check microtask before exposing a prepared recovery secret', async () => {
    const controller = new AbortController();
    const original = await session.captureOperation(controller.signal);
    let checks = 0;
    const capture = vi.spyOn(session, 'captureOperation').mockResolvedValue({
      ...original,
      check: async () => {
        await original.check();
        if (++checks === 4) queueMicrotask(() => controller.abort());
      },
    });
    const before = await storage.control();
    await expect(
      prepareVaultKeyRotation(session, nextPassword, { ...options(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(checks).toBe(4);
    expect(await storage.control()).toEqual(before);
    expect(await rawRecords()).toEqual([]);
    capture.mockRestore();
    original.dispose();
  });

  it('cancels preparation/acknowledgment without persisting new ciphertext, header or recovery material', async () => {
    await populate();
    const before = await rawRecords(),
      control = await storage.control();
    const destroy = vi.spyOn(cipher, 'destroyKeys');
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const recovery = preparation.recoveryKey;
    preparation.dispose();
    preparation.dispose();
    expect(destroy).toHaveBeenCalled();
    expect(() => preparation.recoveryKey).toThrow('Unlock the workspace');
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(await storage.control()).toEqual(control);
    expect(await rawRecords()).toEqual(before);
    expect(JSON.stringify(await rawRecords())).not.toContain(recovery);
  });

  it('keeps the original key/data after a real native quota exception midway through clear+put activation', async () => {
    const graph = await populate();
    const before = await rawRecords(),
      control = await storage.control();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    const quota = new DOMException('Rotation fixture quota.', 'QuotaExceededError');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (this.name === 'records' && ++writes === 3) throw quota;
      return originalPut.apply(this, args);
    });
    await expect(preparation.activate()).rejects.toBe(quota);
    put.mockRestore();
    expect(writes).toBe(3);
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
    expect(await db.nodes.get(graph.nodes[0].id)).toEqual(graph.nodes[0]);
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('rejects revision changes during acknowledgment without losing the new intervening edit', async () => {
    const graph = await populate();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    await db.nodes.update(graph.nodes[0].id, { title: 'New edit during acknowledgment' });
    const before = await rawRecords(),
      control = await storage.control();
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
    expect((await db.nodes.get(graph.nodes[0].id))!.title).toBe('New edit during acknowledgment');
  });

  it('rejects a non-coordinated writer that changes the exact control revision after rewriting', async () => {
    await populate();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const operation = await session.captureOperation();
    const originalActivation = storage.activateContentKey.bind(storage);
    const activation = vi
      .spyOn(storage, 'activateContentKey')
      .mockImplementation(async (...args) => {
        await operation.run(async (context) => {
          const value = { key: 'concurrent-writer', value: 'kept concurrent value' };
          const projection = projectWorkspaceIndexes('settings', value);
          const bundle = await codec.encode(
            context.keys,
            'settings',
            value.key,
            value,
            1,
            workspaceEqualityPartitions('settings', projection),
            { projection },
          );
          await storage.commit(
            context.lease,
            bundle.records.map((record) => ({ kind: 'put' as const, record, expectedRevision: 0 })),
          );
        });
        return originalActivation(...args);
      });
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    activation.mockRestore();
    operation.dispose();
    expect((await storage.control())!.header.keyVersion).toBe(1);
    expect((await db.settings.get('concurrent-writer'))!.value).toBe('kept concurrent value');
  });

  it('aborts original preparation after lock/unlock and destroys a late new key before publishing any recovery string', async () => {
    await populate();
    const before = await rawRecords();
    const rotate = cipher.rotateContentKey.bind(cipher);
    let late: Awaited<ReturnType<VaultCrypto['rotateContentKey']>> | undefined;
    const hook = vi.spyOn(cipher, 'rotateContentKey').mockImplementation(async (...args) => {
      late = await rotate(...args);
      await session.lock();
      await session.unlock(password);
      return late;
    });
    await expect(prepareVaultKeyRotation(session, nextPassword, options())).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    hook.mockRestore();
    await expect(cipher.indexToken(late!.keys, 'test', 'late')).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
    expect(await rawRecords()).toEqual(before);
    expect((await storage.control())!.header.keyVersion).toBe(1);
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('revokes an acknowledged prepared operation and any late payload rewriting on lock/unlock', async () => {
    await populate(true);
    const before = await rawRecords();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const encode = VaultLogicalRecordCodec.prototype.encode;
    let once = true;
    const spy = vi
      .spyOn(VaultLogicalRecordCodec.prototype, 'encode')
      .mockImplementation(async function (this: VaultLogicalRecordCodec, ...args) {
        const bundle = await encode.apply(this, args);
        if (once) {
          once = false;
          await session.lock();
          await session.unlock(password);
        }
        return bundle;
      });
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    spy.mockRestore();
    expect(await rawRecords()).toEqual(before);
    expect((await storage.control())!.header.keyVersion).toBe(1);
  });

  it('honors parent UI cancellation while the new key is deriving and again inside the native activation transaction', async () => {
    await populate();
    const before = await rawRecords(),
      control = await storage.control();
    const controller = new AbortController();
    const rotate = cipher.rotateContentKey.bind(cipher);
    const derive = vi.spyOn(cipher, 'rotateContentKey').mockImplementation(async (...args) => {
      const value = await rotate(...args);
      controller.abort();
      return value;
    });
    await expect(
      prepareVaultKeyRotation(session, nextPassword, { ...options(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    derive.mockRestore();
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
    const nativeController = new AbortController();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, {
      ...options(),
      signal: nativeController.signal,
    });
    const originalPut = IDBObjectStore.prototype.put;
    let cancelled = false;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const result = originalPut.apply(this, args);
      if (this.name === 'records' && !cancelled) {
        cancelled = true;
        nativeController.abort();
      }
      return result;
    });
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    put.mockRestore();
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
  });

  it('rejects corrupted old chunks before activation and does not rewrite an unverifiable source', async () => {
    await populate(true);
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const read = storage.select.bind(storage);
    const select = vi.spyOn(storage, 'select').mockImplementation(async (...args) => {
      const values = await read(...args);
      if ('store' in args[1] && args[1].store === 'historyRows') {
        const chunk = values.find((record) => !record.partitions.length)!;
        chunk.encrypted = {
          ...chunk.encrypted,
          ciphertext:
            (chunk.encrypted.ciphertext[0] === 'A' ? 'B' : 'A') +
            chunk.encrypted.ciphertext.slice(1),
        };
      }
      return values;
    });
    const before = await rawRecords(),
      control = await storage.control();
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    select.mockRestore();
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
  });

  it('rejects corrupted newly prepared ciphertext before canonical activation', async () => {
    await populate(true);
    const before = await rawRecords(),
      control = await storage.control();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    const original = VaultLogicalRecordCodec.prototype.encode;
    const encode = vi
      .spyOn(VaultLogicalRecordCodec.prototype, 'encode')
      .mockImplementation(async function (this: VaultLogicalRecordCodec, ...args) {
        const bundle = await original.apply(this, args);
        return {
          ...bundle,
          records: bundle.records.map((record) =>
            record.partitions.length
              ? record
              : {
                  ...record,
                  encrypted: {
                    ...record.encrypted,
                    ciphertext:
                      (record.encrypted.ciphertext[0] === 'A' ? 'B' : 'A') +
                      record.encrypted.ciphertext.slice(1),
                  },
                },
          ),
        };
      });
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    encode.mockRestore();
    expect(await rawRecords()).toEqual(before);
    expect(await storage.control()).toEqual(control);
  });

  it('rejects orphan ciphertext and pending migration before changing the canonical key', async () => {
    await populate();
    const operation = await session.captureOperation();
    await operation.run(async (context) => {
      const id = await cipher.indexToken(context.keys, 'orphan-test', 'orphan');
      const encrypted = await cipher.encryptRecord(
        context.keys,
        { store: 'nodes', recordId: id, recordVersion: 1 },
        { content: 'Unattached private object' },
      );
      await storage.commit(context.lease, [
        {
          kind: 'put',
          expectedRevision: 0,
          record: { id, store: 'nodes', partitions: [], revision: 1, encrypted },
        },
      ]);
    });
    operation.dispose();
    const before = await rawRecords();
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    await expect(preparation.activate()).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    expect(await rawRecords()).toEqual(before);
    expect((await storage.control())!.header.keyVersion).toBe(1);
  });

  it('requires pending transfer verification and bounds snapshot loading before activation', async () => {
    await db.settings.put({
      key: WORKSPACE_MIGRATION_SETTING,
      value: { state: 'pending-verification' },
    });
    const preparation = await prepareVaultKeyRotation(session, nextPassword, options());
    await expect(preparation.activate()).rejects.toMatchObject({
      code: 'MIGRATION_VERIFICATION_REQUIRED',
    });
    expect((await storage.control())!.header.keyVersion).toBe(1);
    const operation = await session.captureOperation();
    await operation.run(async (context) => {
      await expect(storage.select(context.lease, { store: 'settings' }, 0)).rejects.toMatchObject({
        code: 'VAULT_ROTATION_LIMIT',
      });
    });
    operation.dispose();
  });
});
