import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { WorkspaceDatabase, type WorkspaceBackup } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { migrateWorkspace } from '../src/storage/migration';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage, type VaultPhysicalRecord } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { prepareVaultKeyRotation } from '../src/security/vault-key-rotation';
import { blankGraph, newNode } from '../src/model/types';
import { parseCsv } from '../src/data/csv';

const rows = 100_000;
const columns = 20;
const canary = 'Confidential migration-and-rotation customer';

async function rawRecords(name: string): Promise<VaultPhysicalRecord[]> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
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

function counts(records: VaultPhysicalRecord[]) {
  return {
    records: records.length,
    roots: records.filter((record) => record.partitions.length > 0).length,
    chunks: records.filter((record) => record.partitions.length === 0).length,
    ciphertextCharacters: records.reduce(
      (sum, record) => sum + record.encrypted.ciphertext.length,
      0,
    ),
  };
}

it('measures a real 100000×20 CSV exact transfer, incident rotation and new-password reopen while geometry-only saves reuse every dataset chunk', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
  const originalPassword = 'representative migration original password';
  const newPassword = 'representative rotated incident password';
  const vault = await cipher.createVault(originalPassword);
  const physical = new VaultRecordStorage(`performance-target-${crypto.randomUUID()}`);
  const session = new VaultSession(physical, cipher);
  const codec = new VaultLogicalRecordCodec(cipher);
  const destination = new EncryptedWorkspaceDatabase(session, codec);
  const source = new WorkspaceDatabase(`performance-source-${crypto.randomUUID()}`);
  try {
    await physical.create(vault.header);
    await session.initialize();
    await session.unlock(originalPassword);
    await destination.open();
    await source.open();
    const importStarted = performance.now();
    const header = Array.from({ length: columns }, (_, column) => `Column ${column}`).join(',');
    let csv = `${header}\n${Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) =>
        row === 0 && column === 0 ? canary : `${row}:${column}`,
      ).join(','),
    ).join('\n')}`;
    const csvBytes = new TextEncoder().encode(csv).byteLength;
    const graph = blankGraph('Confidential representative transfer', 'flowchart');
    graph.nodes = [newNode(graph.diagram.id, { title: 'Confidential retained dataset' })];
    graph.dataset = {
      ...parseCsv(csv, 'representative-100k.csv'),
      diagramId: graph.diagram.id,
    };
    csv = '';
    const sourceRepo = new Repository(source);
    const original = await sourceRepo.saveGraph(graph, 0);
    const importMilliseconds = performance.now() - importStarted;
    expect(original.dataset!.rows).toHaveLength(rows);
    expect(original.dataset!.columns).toHaveLength(columns);
    const backupStarted = performance.now();
    const backup = JSON.parse(JSON.stringify(await source.backup())) as WorkspaceBackup;
    const backupMilliseconds = performance.now() - backupStarted;
    const migrationStarted = performance.now();
    const migration = await migrateWorkspace(destination, backup);
    const migrationMilliseconds = performance.now() - migrationStarted;
    expect(migration.status).toBe('verified');
    expect(migration.firstDiagramId).toBe(original.diagram.id);
    const migrated = await rawRecords(physical.name);
    expect(counts(migrated).chunks).toBeGreaterThan(10);

    const rotationStarted = performance.now();
    const prepared = await prepareVaultKeyRotation(session, newPassword, {
      currentPassword: originalPassword,
    });
    const recovery = prepared.recoveryKey;
    await prepared.activate();
    const rotationMilliseconds = performance.now() - rotationStarted;
    expect(session.getSnapshot().status).toBe('locked');
    const rotated = await rawRecords(physical.name);
    const oldIds = new Set(migrated.map((record) => record.id));
    expect(rotated.every((record) => !oldIds.has(record.id))).toBe(true);
    expect(rotated.every((record) => record.encrypted.keyVersion === 2)).toBe(true);
    const raw = JSON.stringify(rotated);
    for (const secret of [
      canary,
      original.diagram.name,
      original.diagram.id,
      original.nodes[0].id,
      originalPassword,
      newPassword,
      recovery,
    ])
      expect(raw).not.toContain(secret);

    const unlockStarted = performance.now();
    await session.unlock(newPassword);
    await destination.open();
    const destinationRepo = new Repository(destination);
    const reopened = await destinationRepo.getGraph(original.diagram.id);
    const unlockAndReadMilliseconds = performance.now() - unlockStarted;
    expect(reopened.diagram).toEqual(original.diagram);
    expect(reopened.nodes).toEqual(original.nodes);
    expect(reopened.dataset!.rows).toHaveLength(rows);
    expect(reopened.dataset!.rows).toEqual(original.dataset!.rows);
    expect(reopened.dataset!.columns).toEqual(original.dataset!.columns);

    const encoded = vi.spyOn(codec, 'encode');
    const geometryStarted = performance.now();
    const moved = await destinationRepo.saveGraph(
      {
        ...reopened,
        nodes: reopened.nodes.map((node) => ({ ...node, x: node.x + 60, y: node.y + 30 })),
      },
      reopened.diagram.version,
    );
    const geometryMilliseconds = performance.now() - geometryStarted;
    expect(moved.diagram.version).toBe(reopened.diagram.version + 1);
    expect(moved.nodes[0].x).toBe(reopened.nodes[0].x + 60);
    expect(moved.dataset).toBe(reopened.dataset);
    expect(encoded.mock.calls.some(([, store]) => store === 'datasets')).toBe(false);
    expect(encoded.mock.calls.some(([, store]) => store === 'nodes')).toBe(true);
    expect(encoded.mock.calls.some(([, store]) => store === 'diagrams')).toBe(true);
    const geometryPhysical = await rawRecords(physical.name);
    expect(geometryPhysical.filter((record) => record.store === 'datasets')).toEqual(
      rotated.filter((record) => record.store === 'datasets'),
    );
    expect((await sourceRepo.getGraph(original.diagram.id)).dataset!.rows).toEqual(
      original.dataset!.rows,
    );
    expect((await sourceRepo.getGraph(original.diagram.id)).diagram).toEqual(original.diagram);
    process.stdout.write(
      `EW-13 representative CSV verification ${JSON.stringify({
        rows,
        columns,
        cells: rows * columns,
        csvBytes,
        importMilliseconds,
        backupMilliseconds,
        migrationMilliseconds,
        rotationMilliseconds,
        unlockAndReadMilliseconds,
        geometryMilliseconds,
        migrated: counts(migrated),
        rotated: counts(rotated),
        geometryDatasetEncodeCalls: encoded.mock.calls.filter(([, store]) => store === 'datasets')
          .length,
      })}\n`,
    );
  } finally {
    vi.restoreAllMocks();
    destination.dispose();
    await session.dispose();
    cipher.destroyKeys(vault.keys);
    await source.delete();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(physical.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Performance fixture retained a database handle.'));
    });
    vi.unstubAllGlobals();
  }
}, 300_000);
