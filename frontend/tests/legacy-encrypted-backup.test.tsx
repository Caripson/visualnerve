import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { blankGraph, newNode } from '../src/model/types';
import { VaultCrypto } from '../src/security/vault-crypto';
import { parseEncryptedVaultBackup } from '../src/security/vault-schema';
import { parseLogicalJson } from '../src/security/vault-logical-json';
import {
  prepareLegacyEncryptedBackup,
  type LegacyBackupSource,
} from '../src/security/legacy-encrypted-backup';
import { LegacyEncryptedBackup } from '../src/security/LegacyEncryptedBackup';
import { useWorkspaceBackupReader } from '../src/security/useWorkspaceBackupReader';

const fixture = vi.hoisted(() => ({
  source: undefined as unknown as LegacyBackupSource,
  download: vi.fn(),
}));
vi.mock('../src/export/semantic', () => ({ download: fixture.download }));
vi.mock('../src/storage/workspace', () => ({
  workspace: {
    get repo() {
      return fixture.source.repo;
    },
    settled: () => fixture.source.settled(),
  },
}));
vi.mock('../src/storage/runtime', () => ({
  workspaceStorage: {
    captureOperation: () => fixture.source.repo.db.captureOperation(),
  },
}));
vi.mock('../src/imports/preference', () => ({ currentImportLimitBytes: () => 50 * 1024 * 1024 }));
const password = 'A dedicated transfer-only passphrase';
let db: WorkspaceDatabase;
let reader: ReturnType<typeof useWorkspaceBackupReader>;
function Reader() {
  reader = useWorkspaceBackupReader();
  return reader.backupDialog;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function raw() {
  return JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  fixture.download.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('unrelated', 'preserved');
  db = new WorkspaceDatabase(`legacy-transfer-${crypto.randomUUID()}`);
  const graph = blankGraph('PRIVATE transfer canary');
  graph.nodes = [newNode(graph.diagram.id, { title: 'PRIVATE source text' })];
  await db.diagrams.put(graph.diagram);
  await db.nodes.bulkPut(graph.nodes);
  await db.templates.put({
    id: 'custom-template',
    name: 'Private template',
    graph,
    builtin: false,
  });
  await db.settings.bulkPut([
    { key: 'theme', value: 'dark' },
    { key: 'mcp-access', value: 'write' },
    { key: 'bridge-url', value: 'ws://127.0.0.1:4317/bridge' },
    { key: 'storage-consent', value: true },
    { key: 'vault-password', value: 'existing forbidden metadata' },
    { key: 'project-source-file-limit', value: 1000 },
  ]);
  fixture.source = { repo: { db: db.asStorage() }, settled: vi.fn(async () => {}) };
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.delete();
  vi.unstubAllGlobals();
});

it('creates the authenticated transfer container without changing source storage or retaining temporary keys/bytes', async () => {
  const before = await raw();
  const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
  const encrypt = vi.spyOn(cipher, 'encryptBackup');
  const artifact = await prepareLegacyEncryptedBackup(fixture.source, password, { cipher });
  const recovery = artifact.recoveryKey;
  expect(recovery.startsWith('VNREC1-')).toBe(true);
  expect(JSON.stringify(artifact)).not.toContain(recovery);
  expect(fixture.download).not.toHaveBeenCalled();
  const [header, keys, buffer] = encrypt.mock.calls[0];
  expect(buffer.every((byte) => byte === 0)).toBe(true);
  await expect(cipher.encryptBackup(header, keys, new Uint8Array())).rejects.toMatchObject({
    code: 'KEY_DESTROYED',
  });
  await artifact.download();
  const output = String(fixture.download.mock.calls[0][1]);
  expect(output).not.toContain('PRIVATE transfer canary');
  expect(output).not.toContain(password);
  expect(output).not.toContain(recovery);
  const container = parseEncryptedVaultBackup(JSON.parse(output));
  for (const credentials of ['password', 'recovery'] as const) {
    const readCipher = new VaultCrypto(webcrypto as unknown as Crypto);
    const readKeys =
      credentials === 'password'
        ? await readCipher.unlockWithPassword(container.header, password)
        : await readCipher.unlockWithRecovery(container.header, recovery);
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readCipher.decryptBackup(readKeys, container);
      const backup = parseLogicalJson(new TextDecoder().decode(bytes), { bytes: 0, values: 0 }) as {
        diagrams: unknown[];
        templates: unknown[];
        settings: { key: string }[];
      };
      expect(backup.diagrams).toHaveLength(1);
      expect(backup.templates).toHaveLength(1);
      expect(backup.settings.map((value) => value.key)).toEqual(['theme']);
    } finally {
      bytes?.fill(0);
      readCipher.destroyKeys(readKeys);
    }
  }
  expect(artifact.recoveryKey).toBe('');
  expect(await raw()).toBe(before);
  expect(localStorage.getItem('unrelated')).toBe('preserved');
  expect(sessionStorage.length).toBe(0);
});

it.each(['password', 'recovery'] as const)(
  'the existing encrypted backup reader opens a transfer with its %s credential',
  async (kind) => {
    const artifact = await prepareLegacyEncryptedBackup(fixture.source, password);
    const recovery = artifact.recoveryKey;
    await artifact.download();
    const content = String(fixture.download.mock.calls[0][1]);
    const file = new File([content], 'transfer.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => content });
    render(<Reader />);
    let reading!: ReturnType<typeof reader.readBackup>;
    await act(async () => {
      reading = reader.readBackup(file);
      void reading.catch(() => undefined);
      await Promise.resolve();
    });
    await screen.findByLabelText('Backup password');
    if (kind === 'recovery')
      fireEvent.change(screen.getByLabelText('Backup credential type'), {
        target: { value: 'recovery' },
      });
    fireEvent.change(
      screen.getByLabelText(kind === 'password' ? 'Backup password' : 'Backup recovery key'),
      { target: { value: kind === 'password' ? password : recovery } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Read backup' }));
    const backup = await reading;
    expect(backup.diagrams[0].name).toBe('PRIVATE transfer canary');
  },
);

it('requires password confirmation and saved-recovery acknowledgement before the optional UI downloads', async () => {
  const close = vi.fn(),
    complete = vi.fn();
  const before = await raw();
  render(<LegacyEncryptedBackup close={close} complete={complete} />);
  fireEvent.change(screen.getByLabelText('Transfer backup password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Confirm transfer password'), {
    target: { value: 'wrong' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare encrypted backup' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('matching confirmation');
  expect(fixture.download).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm transfer password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare encrypted backup' }));
  expect(screen.getByLabelText('Transfer backup password')).toHaveValue('');
  expect(screen.getByLabelText('Confirm transfer password')).toHaveValue('');
  await screen.findByLabelText('Recovery key — keep it private', {}, { timeout: 5000 });
  const button = screen.getByRole('button', { name: 'Download encrypted backup' });
  expect(button).toBeDisabled();
  expect(screen.getByLabelText('Save your backup recovery key')).toHaveTextContent(
    'unlock your encrypted backup',
  );
  expect(fixture.download).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I have saved my recovery key in a protected location.' }),
  );
  fireEvent.click(button);
  await waitFor(() => expect(fixture.download).toHaveBeenCalledOnce());
  expect(complete).toHaveBeenCalledWith(expect.stringMatching(/^visual-nerve-encrypted-transfer-/));
  expect(close).toHaveBeenCalledOnce();
  expect(await raw()).toBe(before);
});

it.each(['cancel', 'unmount'] as const)(
  'discards a deferred backup read after %s without recovery or a late download',
  async (action) => {
    const gate = deferred<void>();
    fixture.source.settled = vi.fn(() => gate.promise);
    const rendered = render(<LegacyEncryptedBackup close={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Transfer backup password'), {
      target: { value: password },
    });
    fireEvent.change(screen.getByLabelText('Confirm transfer password'), {
      target: { value: password },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare encrypted backup' }));
    await waitFor(() => expect(fixture.source.settled).toHaveBeenCalledOnce());
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    else rendered.unmount();
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(screen.queryByLabelText('Recovery key — keep it private')).not.toBeInTheDocument();
    expect(fixture.download).not.toHaveBeenCalled();
  },
);

it('zeroes bytes and destroys temporary keys when cancellation arrives during encryption', async () => {
  const controller = new AbortController(),
    gate = deferred<void>(),
    entered = deferred<void>();
  const cipher = new VaultCrypto(webcrypto as unknown as Crypto),
    encrypt = cipher.encryptBackup.bind(cipher);
  const spy = vi.spyOn(cipher, 'encryptBackup').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await gate.promise;
    return encrypt(...args);
  });
  const result = prepareLegacyEncryptedBackup(fixture.source, password, {
    cipher,
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toBeDefined();
  await entered.promise;
  controller.abort();
  gate.resolve();
  await rejected;
  expect(spy.mock.calls[0][2].every((byte) => byte === 0)).toBe(true);
  await expect(
    cipher.encryptBackup(spy.mock.calls[0][0], spy.mock.calls[0][1], new Uint8Array()),
  ).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
  expect(fixture.download).not.toHaveBeenCalled();
});

it('discards an acknowledged artifact when its original workspace generation closes', async () => {
  const invalidated = vi.fn();
  const artifact = await prepareLegacyEncryptedBackup(fixture.source, password, {
    onInvalidated: invalidated,
  });
  fixture.source.repo.db.close();
  await fixture.source.repo.db.open();
  expect(invalidated).toHaveBeenCalledOnce();
  expect(artifact.recoveryKey).toBe('');
  await expect(artifact.download()).rejects.toBeDefined();
  expect(fixture.download).not.toHaveBeenCalled();
});

it.each(['artifact', 'download'] as const)(
  'blocks %s publication when cancellation runs after the last awaited check resolves',
  async (publication) => {
    const controller = new AbortController();
    const capture = fixture.source.repo.db.captureOperation.bind(fixture.source.repo.db);
    let armed = false;
    let checks = 0;
    vi.spyOn(fixture.source.repo.db, 'captureOperation').mockImplementationOnce(async () => {
      const operation = await capture();
      return {
        ...operation,
        check: async () => {
          await operation.check();
          if (armed && ++checks === (publication === 'artifact' ? 1 : 2)) {
            // check's own continuation succeeds first. The second microtask aborts before
            // its caller resumes, reproducing the gap at the actual publication boundary.
            queueMicrotask(() => queueMicrotask(() => controller.abort()));
          }
        },
      };
    });
    const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
    const encrypt = cipher.encryptBackup.bind(cipher);
    vi.spyOn(cipher, 'encryptBackup').mockImplementationOnce(async (...args) => {
      const result = await encrypt(...args);
      if (publication === 'artifact') armed = true;
      return result;
    });
    const preparing = prepareLegacyEncryptedBackup(fixture.source, password, {
      cipher,
      signal: controller.signal,
    });
    if (publication === 'artifact')
      await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    else {
      const artifact = await preparing;
      armed = true;
      await expect(artifact.download()).rejects.toMatchObject({ name: 'AbortError' });
      expect(artifact.recoveryKey).toBe('');
    }
    expect(controller.signal.aborted).toBe(true);
    expect(fixture.download).not.toHaveBeenCalled();
  },
);
