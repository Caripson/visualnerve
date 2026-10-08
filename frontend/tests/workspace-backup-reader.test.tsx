import { webcrypto } from 'node:crypto';
import { StrictMode } from 'react';
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceBackupReader } from '../src/security/useWorkspaceBackupReader';
import { VaultCrypto, type VaultKeys } from '../src/security/vault-crypto';
import { VaultStorageError } from '../src/security/vault-storage';
import { VaultCryptoError } from '../src/security/vault-errors';
import { MIN_BACKUP_CHUNK_BYTES, type EncryptedVaultBackup } from '../src/security/vault-schema';
import type { WorkspaceBackup } from '../src/storage/database';
import type { WorkspaceOperation, WorkspaceStorage } from '../src/storage/contracts';
import { blankGraph, newNode } from '../src/model/types';

// Multiple real password derivations run in this suite. Keep the production
// KDF work factor and allow contention rather than replacing cryptography.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const mocks = vi.hoisted(() => ({ capture: vi.fn(), limit: vi.fn(() => 50 * 1024 * 1024) }));
vi.mock('../src/storage/runtime', () => ({
  workspaceStorage: { captureOperation: mocks.capture },
}));
vi.mock('../src/imports/preference', () => ({ currentImportLimitBytes: mocks.limit }));

const originalPassword = 'Original exported backup password';
const currentPassword = 'Changed current workspace password';
const fixtureCipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let encrypted: EncryptedVaultBackup;
let backup: WorkspaceBackup;
let reader: ReturnType<typeof useWorkspaceBackupReader>;
const operations: ReturnType<typeof operation>[] = [];

function operation() {
  const controller = new AbortController();
  const check = vi.fn(async () => {
    if (controller.signal.aborted)
      throw new VaultStorageError(423, 'WORKSPACE_LOCKED', 'The workspace is locked.');
  });
  const dispose = vi.fn(() => controller.abort());
  return {
    controller,
    signal: controller.signal,
    storage: {} as WorkspaceStorage,
    check,
    dispose,
  } satisfies WorkspaceOperation & { controller: AbortController };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function file(value: unknown, text?: () => Promise<string>) {
  const content = JSON.stringify(value);
  const result = new File([content], 'workspace.json', { type: 'application/json' });
  Object.defineProperty(result, 'text', { value: vi.fn(text ?? (async () => content)) });
  return result;
}
function Harness() {
  reader = useWorkspaceBackupReader();
  return reader.backupDialog;
}
function mount(strict = false) {
  return render(
    strict ? (
      <StrictMode>
        <Harness />
      </StrictMode>
    ) : (
      <Harness />
    ),
  );
}
async function begin(input = file(encrypted)) {
  let promise!: Promise<WorkspaceBackup>;
  await act(async () => {
    promise = reader.readBackup(input);
    // The caller normally displays failures; observe immediately to avoid orphaned rejections.
    void promise.catch(() => undefined);
  });
  return { promise };
}
async function submit(secret: string, recovery = false) {
  await screen.findByRole('dialog', { name: 'Unlock encrypted backup' });
  if (recovery)
    fireEvent.change(screen.getByLabelText('Backup credential type'), {
      target: { value: 'recovery' },
    });
  fireEvent.change(screen.getByLabelText(recovery ? 'Backup recovery key' : 'Backup password'), {
    target: { value: secret },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Read backup' }));
}
function cancel() {
  fireEvent.click(screen.getByRole('button', { name: 'Cancel backup import' }));
}

beforeAll(async () => {
  vault = await fixtureCipher.createVault(originalPassword);
  const graph = blankGraph('Private backup diagram', 'flowchart');
  graph.nodes.push(
    newNode(graph.diagram.id, { title: 'Private step', description: 'Confidential description' }),
  );
  backup = {
    format: 'visual-nerve-workspace',
    formatVersion: 1,
    schemaVersion: 8,
    diagrams: [graph.diagram],
    nodes: graph.nodes,
    edges: [],
    owners: [],
    settings: [{ key: 'large-private-note', value: 'Private contents '.repeat(10000) }],
    templates: [],
    datasets: [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(backup));
  try {
    encrypted = await fixtureCipher.encryptBackup(vault.header, vault.keys, bytes, {
      chunkSize: MIN_BACKUP_CHUNK_BYTES,
    });
  } finally {
    bytes.fill(0);
  }
  expect(encrypted.chunks.length).toBeGreaterThan(2);
});
afterAll(() => fixtureCipher.destroyKeys(vault.keys));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  mocks.capture.mockReset().mockImplementation(async () => {
    const captured = operation();
    operations.push(captured);
    return captured;
  });
  mocks.limit.mockReset().mockReturnValue(50 * 1024 * 1024);
});
afterEach(() => {
  cleanup();
  for (const captured of operations.splice(0)) captured.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser-only workspace backup reader', () => {
  it('preserves legacy readable backups and leaves entity validation to the restore controller', async () => {
    mount(true);
    const { promise } = await begin(file(backup));
    await expect(promise).resolves.toEqual(backup);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(operations[0].check).toHaveBeenCalled();
    expect(operations[0].dispose).toHaveBeenCalledOnce();
  });

  it('rejects invalid headers and file limits before publishing any restore result', async () => {
    mount();
    const malformed = await begin(file({ ...backup, nodes: {} }));
    await expect(malformed.promise).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_WORKSPACE_BACKUP',
    });
    mocks.capture.mockClear();
    mocks.limit.mockReturnValue(10);
    const oversized = file(backup);
    const limited = await begin(oversized);
    await expect(limited.promise).rejects.toMatchObject({ status: 422 });
    expect(oversized.text).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enforces the decrypted size budget independently of the container file budget', async () => {
    mount();
    // Simulate a file adapter reporting a smaller container, while its declared plaintext is larger.
    const input = file(encrypted);
    Object.defineProperty(input, 'size', { value: 100 });
    mocks.limit.mockReturnValue(1000);
    const { promise } = await begin(input);
    await expect(promise).rejects.toMatchObject({ status: 422 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requires the original export password after the current workspace password has changed', async () => {
    const changed = await fixtureCipher.changePassword(vault.header, vault.keys, currentPassword);
    const currentKeys = await fixtureCipher.unlockWithPassword(changed, currentPassword);
    fixtureCipher.destroyKeys(currentKeys);
    await expect(fixtureCipher.unlockWithPassword(changed, originalPassword)).rejects.toMatchObject(
      { code: 'AUTHENTICATION_FAILED' },
    );
    const nativeDecrypt = VaultCrypto.prototype.decryptBackup;
    const plaintext: Uint8Array[] = [];
    const decrypt = vi
      .spyOn(VaultCrypto.prototype, 'decryptBackup')
      .mockImplementation(async function (this: VaultCrypto, keys, input) {
        const output = await nativeDecrypt.call(this, keys, input);
        plaintext.push(output);
        return output;
      });
    const unlock = vi.spyOn(VaultCrypto.prototype, 'unlockWithPassword');
    const destroy = vi.spyOn(VaultCrypto.prototype, 'destroyKeys');
    mount();
    const { promise } = await begin();
    await submit(currentPassword);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not authenticate');
    expect(screen.getByLabelText('Backup password')).toHaveValue('');
    expect(decrypt).not.toHaveBeenCalled();
    await submit(originalPassword);
    await expect(promise).resolves.toEqual(backup);
    expect(unlock.mock.contexts[0]).not.toBe(unlock.mock.contexts[1]);
    const restoreCipher = unlock.mock.contexts[1];
    expect(restoreCipher).not.toBe(fixtureCipher);
    expect(decrypt.mock.contexts[0]).toBe(restoreCipher);
    expect(destroy.mock.contexts).toContain(restoreCipher);
    expect(plaintext).toHaveLength(1);
    expect(plaintext[0].every((byte) => byte === 0)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('accepts the original backup recovery key without using any current workspace keys', async () => {
    const recovery = vi.spyOn(VaultCrypto.prototype, 'unlockWithRecovery');
    const password = vi.spyOn(VaultCrypto.prototype, 'unlockWithPassword');
    const decrypt = vi.spyOn(VaultCrypto.prototype, 'decryptBackup');
    const destroy = vi.spyOn(VaultCrypto.prototype, 'destroyKeys');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    mount();
    const { promise } = await begin();
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'Older encrypted backups can still be opened',
    );
    await submit(vault.recoveryKey, true);
    await expect(promise).resolves.toEqual(backup);
    expect(password).not.toHaveBeenCalled();
    expect(recovery).toHaveBeenCalledOnce();
    expect(recovery.mock.contexts[0]).not.toBe(fixtureCipher);
    expect(decrypt.mock.contexts[0]).toBe(recovery.mock.contexts[0]);
    expect(destroy.mock.contexts).toContain(recovery.mock.contexts[0]);
    expect(write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticates the complete container before resolving and never exposes an authenticated prefix', async () => {
    const corrupt = JSON.parse(JSON.stringify(encrypted)) as EncryptedVaultBackup;
    const chunk = corrupt.chunks.at(-1)!;
    Object.assign(chunk, {
      ciphertext: `${chunk.ciphertext[0] === 'A' ? 'B' : 'A'}${chunk.ciphertext.slice(1)}`,
    });
    let resolved = false;
    mount();
    const { promise } = await begin(file(corrupt));
    void promise.then(
      () => {
        resolved = true;
      },
      () => undefined,
    );
    await submit(originalPassword);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not authenticate the encrypted workspace or its contents.',
    );
    expect(alert).not.toHaveTextContent(originalPassword);
    expect(document.body).not.toHaveTextContent('Confidential description');
    expect(resolved).toBe(false);
    expect(screen.getByLabelText('Backup password')).toHaveValue('');
    cancel();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels before credential submission and clears inputs when the same backup is reopened', async () => {
    mount();
    const first = await begin();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Backup password'), {
      target: { value: originalPassword },
    });
    cancel();
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const second = await begin();
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Backup password')).toHaveValue('');
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(second.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(operations.every((captured) => captured.signal.aborted)).toBe(true);
  });

  it('destroys keys that arrive after cancellation during password derivation', async () => {
    const release = deferred<void>();
    const keysReady = deferred<VaultKeys>();
    const nativeUnlock = VaultCrypto.prototype.unlockWithPassword;
    const unlock = vi
      .spyOn(VaultCrypto.prototype, 'unlockWithPassword')
      .mockImplementation(async function (this: VaultCrypto, header, secret) {
        const keys = await nativeUnlock.call(this, header, secret);
        keysReady.resolve(keys);
        await release.promise;
        return keys;
      });
    const destroy = vi.spyOn(VaultCrypto.prototype, 'destroyKeys');
    const decrypt = vi.spyOn(VaultCrypto.prototype, 'decryptBackup');
    mount();
    const { promise } = await begin();
    await submit(originalPassword);
    const keys = await keysReady.promise;
    expect(screen.getByLabelText('Backup password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Verifying entire backup…' })).toBeDisabled();
    cancel();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {
      release.resolve();
    });
    await waitFor(() => expect(destroy).toHaveBeenCalledWith(keys));
    expect(destroy.mock.contexts[0]).toBe(unlock.mock.contexts[0]);
    expect(decrypt).not.toHaveBeenCalled();
    await expect(
      (unlock.mock.contexts[0] as VaultCrypto).decryptBackup(keys, encrypted),
    ).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
  });

  it('rejects a locked context and zeroes plaintext that arrives after revocation', async () => {
    const release = deferred<void>();
    const bytesReady = deferred<Uint8Array<ArrayBuffer>>();
    const nativeDecrypt = VaultCrypto.prototype.decryptBackup;
    vi.spyOn(VaultCrypto.prototype, 'decryptBackup').mockImplementation(async function (
      this: VaultCrypto,
      keys,
      input,
    ) {
      const bytes = await nativeDecrypt.call(this, keys, input);
      bytesReady.resolve(bytes);
      await release.promise;
      return bytes;
    });
    mount();
    const { promise } = await begin();
    await submit(originalPassword);
    const bytes = await bytesReady.promise;
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
    await act(async () => {
      operations[0].controller.abort();
    });
    await expect(promise).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      release.resolve();
    });
    await waitFor(() => expect(bytes.every((byte) => byte === 0)).toBe(true));
  });

  it('ignores file IO completing after unmount and disposes its originating operation', async () => {
    const text = deferred<string>();
    const input = file(encrypted, () => text.promise);
    const view = mount();
    const { promise } = await begin(input);
    expect(input.text).toHaveBeenCalledOnce();
    view.unmount();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {
      text.resolve(JSON.stringify(encrypted));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(operations[0].dispose).toHaveBeenCalledOnce();
  });

  it('cancels older readers and never delivers stale plaintext when their IO resumes', async () => {
    const text = deferred<string>();
    mount();
    const first = await begin(file(backup, () => text.promise));
    const second = await begin(file(backup));
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second.promise).resolves.toEqual(backup);
    await act(async () => {
      text.resolve(JSON.stringify(backup));
    });
    expect(operations).toHaveLength(2);
    expect(operations.every((captured) => captured.dispose.mock.calls.length === 1)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disposes captures arriving after their reader was replaced and rejects unsafe encrypted schemas', async () => {
    const late = deferred<WorkspaceOperation>();
    mocks.capture.mockImplementationOnce(() => late.promise);
    mount();
    const first = await begin();
    const second = await begin(file({ ...encrypted, version: 2 }));
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second.promise).rejects.toBeInstanceOf(VaultCryptoError);
    const captured = operation();
    operations.push(captured);
    await act(async () => {
      late.resolve(captured);
    });
    expect(captured.dispose).toHaveBeenCalledOnce();
    expect(captured.check).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
