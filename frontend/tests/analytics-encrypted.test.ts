import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { blankGraph } from '../src/model/types';
import { growthChurnInput } from '../src/analytics/example';
import { archiveResult } from '../src/analytics/document';
import { measure } from '../src/analytics/engine';
import { parseImport } from '../src/export/semantic';
import { executeAnalysis } from '../src/analytics/engine';
import type { AnalysisJobRequest } from '../src/analytics/types';
import { AnalyticsError } from '../src/analytics/validation';
import { clearAnalyticsIfLoaded } from '../src/analytics/lifecycle';

class ValidationWorker {
  static instances: ValidationWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  request?: AnalysisJobRequest;
  terminated = false;
  constructor() {
    ValidationWorker.instances.push(this);
  }
  postMessage(message: { request: AnalysisJobRequest }) {
    this.request = structuredClone(message.request);
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    try {
      const value = structuredClone(executeAnalysis(this.request!));
      this.onmessage?.({ data: { kind: 'result', value } } as MessageEvent);
    } catch (error) {
      this.onmessage?.({
        data: {
          kind: 'error',
          code: error instanceof AnalyticsError ? error.code : 'INVALID_ANALYTICS',
          message: error instanceof Error ? error.message : 'Validation failed.',
        },
      } as MessageEvent);
    }
  }
}

const password = 'Synthetic analytics acceptance test passphrase';
const secret = 'PRIVATE_ANALYTICS_SENTINEL_739105';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage,
  session: VaultSession,
  db: EncryptedWorkspaceDatabase,
  repo: Repository;
let name: string;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  ValidationWorker.instances = [];
  name = `analytics-encrypted-${crypto.randomUUID()}`;
  physical = new VaultRecordStorage(name);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(
    session,
    new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
  );
  repo = new Repository(db);
});
afterEach(async () => {
  clearAnalyticsIfLoaded();
  vi.unstubAllGlobals();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

it('encrypts the extension, reloads it and preserves complete native/full-backup round trips', async () => {
  const graph = blankGraph(secret, 'freeform');
  let model = growthChurnInput();
  model.measurements[0].note = secret;
  model = archiveResult(
    model,
    measure(model, model.measurements[0]),
    { measurement: model.measurements[0] },
    1,
  );
  graph.diagram.analytics = model;
  const saved = await repo.importGraph(graph);
  const backup = await db.backup();
  expect(backup.schemaVersion).toBe(8);
  const copy = await repo.importGraph(parseImport('json', JSON.stringify(saved)));
  expect(copy.diagram.id).not.toBe(saved.diagram.id);
  expect(copy.diagram.analytics!.datasets[0].id).not.toBe(saved.diagram.analytics!.datasets[0].id);
  expect(copy.diagram.analytics!.results[0].inputSnapshot.datasets[0].observations).toHaveLength(
    model.datasets[0].observations.length,
  );
  expect(copy.diagram.analytics!.measurements[0].note).toBe(secret);
  await repo.restore(backup, 'replace');
  expect((await repo.getGraph(saved.diagram.id)).diagram.analytics).toEqual(model);
  await session.lock();
  await expect(repo.getGraph(saved.diagram.id)).rejects.toMatchObject({ status: 423 });
  await session.unlock(password);
  expect(
    (await repo.getGraph(saved.diagram.id)).diagram.analytics!.results[0].inputSnapshot.datasets[0]
      .version,
  ).toBe(1);
  const native = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = native.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(JSON.stringify(records)).not.toContain('churn-rate');
    expect(localStorage.getItem(secret)).toBeNull();
  } finally {
    native.close();
  }
}, 20000);

it('commits the independent worker-validated payload rather than a later caller mutation', async () => {
  const source = blankGraph('Worker-owned analytics');
  source.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(source);
  const changed = structuredClone(saved);
  changed.diagram.analytics!.measurements[0].name = 'Validated change';
  vi.stubGlobal('Worker', ValidationWorker);
  const pending = repo.saveGraph(changed, saved.diagram.version);
  await vi.waitFor(() => expect(ValidationWorker.instances[0]?.request?.kind).toBe('validate'));
  changed.diagram.analytics!.datasets[0].observations[0].value = Infinity;
  ValidationWorker.instances[0].finish();
  const result = await pending;
  expect(result.diagram.analytics!.measurements[0].name).toBe('Validated change');
  expect(Number.isFinite(result.diagram.analytics!.datasets[0].observations[0].value)).toBe(true);
  expect((await repo.getGraph(saved.diagram.id)).diagram.analytics).toEqual(
    result.diagram.analytics,
  );
});

it('checks the original vault lease after delayed validation even after a fresh unlock', async () => {
  const source = blankGraph('Validation lease');
  source.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(source);
  const changed = structuredClone(saved);
  changed.diagram.analytics!.measurements[0].name = 'Must not commit after lock';
  vi.stubGlobal('Worker', ValidationWorker);
  const outcome = repo.saveGraph(changed, saved.diagram.version).catch((error) => error);
  await vi.waitFor(() => expect(ValidationWorker.instances[0]?.request?.kind).toBe('validate'));
  await session.lock();
  await session.unlock(password);
  ValidationWorker.instances[0].finish();
  expect(await outcome).toMatchObject({ status: 423 });
  expect((await repo.getGraph(saved.diagram.id)).diagram.version).toBe(saved.diagram.version);
  expect((await repo.getGraph(saved.diagram.id)).diagram.analytics!.measurements[0].name).not.toBe(
    'Must not commit after lock',
  );
});

it('rechecks document version inside the transaction after worker validation waits', async () => {
  const source = blankGraph('Validation version');
  source.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(source);
  const changed = structuredClone(saved);
  changed.diagram.analytics!.measurements[0].name = 'Stale delayed change';
  vi.stubGlobal('Worker', ValidationWorker);
  const outcome = repo.saveGraph(changed, saved.diagram.version).catch((error) => error);
  await vi.waitFor(() => expect(ValidationWorker.instances[0]?.request?.kind).toBe('validate'));
  await db.atomic('rw', ['diagrams'], async (scope) => {
    const current = (await scope.diagrams.get(saved.diagram.id))!;
    await scope.diagrams.put({
      ...current,
      name: 'Concurrent retained change',
      version: current.version + 1,
    });
  });
  ValidationWorker.instances[0].finish();
  expect(await outcome).toMatchObject({ status: 409 });
  const retained = await repo.getGraph(saved.diagram.id);
  expect(retained.diagram.name).toBe('Concurrent retained change');
  expect(retained.diagram.analytics!.measurements[0].name).not.toBe('Stale delayed change');
});

it('aborts private save validation when the originating request is revoked', async () => {
  const source = blankGraph('Validation cancellation');
  source.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(source);
  const controller = new AbortController();
  vi.stubGlobal('Worker', ValidationWorker);
  const outcome = repo
    .saveGraph(saved, saved.diagram.version, undefined, undefined, undefined, controller.signal)
    .catch((error) => error);
  await vi.waitFor(() => expect(ValidationWorker.instances[0]?.request?.kind).toBe('validate'));
  controller.abort();
  expect(await outcome).toMatchObject({ code: 'CANCELLED' });
  expect(ValidationWorker.instances[0].terminated).toBe(true);
  ValidationWorker.instances[0].finish();
  expect((await repo.getGraph(saved.diagram.id)).diagram.version).toBe(saved.diagram.version);
});

it('rejects invalid analytics inside the worker without opening a partial write', async () => {
  const source = blankGraph('Validation rejection');
  source.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(source);
  const invalid = structuredClone(saved);
  invalid.diagram.analytics!.datasets[0].observations[0].value = Infinity;
  vi.stubGlobal('Worker', ValidationWorker);
  const outcome = repo.saveGraph(invalid, saved.diagram.version).catch((error) => error);
  await vi.waitFor(() => expect(ValidationWorker.instances[0]?.request?.kind).toBe('validate'));
  ValidationWorker.instances[0].finish();
  expect(await outcome).toMatchObject({ code: 'INVALID_ANALYTICS' });
  expect((await repo.getGraph(saved.diagram.id)).diagram.version).toBe(saved.diagram.version);
});

it('commits analytics atomically, rejects stale versions and preserves omitted extensions from older graph clients', async () => {
  const graph = blankGraph('Analytics');
  graph.diagram.analytics = growthChurnInput();
  const saved = await repo.importGraph(graph);
  const path = `/diagrams/${saved.diagram.id}/analytics`;
  const value = structuredClone(saved.diagram.analytics!);
  value.measurements[0].name = 'Updated measure';
  const receipt = await repo.request<{ baseVersion: number }>(path, 'PUT', {
    baseVersion: saved.diagram.version,
    value,
  });
  expect(receipt.baseVersion).toBe(saved.diagram.version + 1);
  await expect(
    repo.request(path, 'PUT', { baseVersion: saved.diagram.version, value }),
  ).rejects.toMatchObject({ status: 409 });
  const latest = await repo.getGraph(saved.diagram.id);
  const legacy = structuredClone(latest);
  delete legacy.diagram.analytics;
  const retained = await repo.request<typeof latest>(`/diagrams/${saved.diagram.id}/graph`, 'PUT', {
    baseVersion: latest.diagram.version,
    graph: legacy,
  });
  expect(retained.diagram.analytics!.measurements[0].name).toBe('Updated measure');
  const invalid = structuredClone(value);
  invalid.datasets[0].observations[0].value = Infinity;
  await expect(
    repo.request(path, 'PUT', { baseVersion: retained.diagram.version, value: invalid }),
  ).rejects.toMatchObject({ status: 422 });
  expect((await repo.getGraph(saved.diagram.id)).diagram.version).toBe(retained.diagram.version);
}, 20000);
