import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceTransferBoundary,
  useWorkspaceTransfer,
} from '../src/security/WorkspaceTransferBoundary';
import { Workspace } from '../src/storage/workspace';
import { Repository } from '../src/storage/repository';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import type { WorkspaceBackup } from '../src/storage/database';
import { bridge } from '../src/integration/bridge';
import type { WorkspaceMigrationSummary } from '../src/storage/migration';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown as Workspace,
  db: undefined as EncryptedWorkspaceDatabase | undefined,
  open: undefined as unknown as (backup: WorkspaceBackup) => Promise<void>,
  migrate: vi.fn(),
  verify: vi.fn(),
  simulation: vi.fn(),
  presentation: vi.fn(),
  speech: vi.fn(),
  video: vi.fn(),
  csv: vi.fn(),
  model: vi.fn(),
}));
vi.mock('../src/storage/runtime', async (original) => {
  const actual = await original<typeof import('../src/storage/runtime')>();
  return {
    ...actual,
    get workspaceStorage() {
      return fixture.db ?? actual.workspaceStorage;
    },
  };
});
vi.mock('../src/storage/workspace', async (original) => {
  const actual = await original<typeof import('../src/storage/workspace')>();
  return {
    ...actual,
    get workspace() {
      return fixture.workspace;
    },
  };
});
vi.mock('../src/storage/migration', () => ({
  migrateWorkspace: fixture.migrate,
  verifyPendingMigration: fixture.verify,
}));
vi.mock('../src/data/client', async (original) => ({
  ...(await original<typeof import('../src/data/client')>()),
  disposeCsvWorker: fixture.csv,
}));
vi.mock('../src/data/modelClient', async (original) => ({
  ...(await original<typeof import('../src/data/modelClient')>()),
  disposeDataModelWorker: fixture.model,
}));
vi.mock('../src/simulation/service', async (original) => ({
  ...(await original<typeof import('../src/simulation/service')>()),
  simulationService: { dispose: fixture.simulation },
}));
vi.mock('../src/presentation/service', async (original) => ({
  ...(await original<typeof import('../src/presentation/service')>()),
  presentation: { close: fixture.presentation, settled: vi.fn(async () => {}) },
}));
vi.mock('../src/presentation/video-service', () => ({ disposeVideoExport: fixture.video }));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { dispose: fixture.speech },
}));

const password = 'test-only transfer boundary password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let backup: WorkspaceBackup;
function Editor() {
  fixture.open = useWorkspaceTransfer()!;
  return <div data-testid="unlocked-editor">Private editor</div>;
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function mountTransfer() {
  render(
    <WorkspaceTransferBoundary>
      <Editor />
    </WorkspaceTransferBoundary>,
  );
  expect(screen.getByTestId('unlocked-editor')).toBeInTheDocument();
  await act(async () => {
    await fixture.open(backup);
  });
  expect(screen.queryByTestId('unlocked-editor')).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Move an existing workspace' })).toBeInTheDocument();
}
function confirmTransfer() {
  fireEvent.click(screen.getByRole('checkbox', { name: /I have kept the source workspace/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Transfer and verify' }));
}
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.clearAllMocks();
  fixture.migrate.mockReset();
  fixture.verify.mockReset();
  fixture.verify.mockResolvedValue(undefined);
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, status: 'saved', message: '' });
  physical = new VaultRecordStorage(`vault-transfer-boundary-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  fixture.db = db;
  fixture.workspace = new Workspace(new Repository(db));
  session.onLock(() => fixture.workspace.clearUnlockedState());
  await db.settings.put({ key: 'storage-consent', value: true });
  const graph = blankGraph('Existing destination');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Destination private node' })];
  const saved = await fixture.workspace.repo.saveGraph(graph, 0);
  await fixture.workspace.start();
  await fixture.workspace.open(saved.diagram.id);
  backup = await db.backup();
});
afterEach(async () => {
  cleanup();
  fixture.workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  fixture.db = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('workspace transfer isolation and verified editor reopening', () => {
  it('revokes integration and stops every private runtime before replacing the editor', async () => {
    await fixture.workspace.setPreference('mcp-access', 'write');
    const disconnect = vi.spyOn(bridge, 'disconnect');
    await mountTransfer();
    expect((await db.settings.get('mcp-access'))?.value).toBe('off');
    expect(useEditor.getState()).toMatchObject({
      graph: null,
      mcpAccess: 'off',
      privacyAcknowledged: false,
    });
    expect(disconnect).toHaveBeenCalled();
    for (const stop of [
      fixture.simulation,
      fixture.presentation,
      fixture.speech,
      fixture.video,
      fixture.csv,
      fixture.model,
    ])
      expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps the editor closed when failed post-commit verification is followed by Cancel', async () => {
    fixture.migrate.mockRejectedValue(new Error('Post-commit verification failed'));
    fixture.verify.mockRejectedValue(new Error('Pending encrypted snapshot is invalid'));
    await mountTransfer();
    confirmTransfer();
    await screen.findByText('Post-commit verification failed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('The editor remains closed: Pending encrypted snapshot is invalid');
    expect(fixture.verify).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('unlocked-editor')).toBeNull();
    expect(useEditor.getState().graph).toBeNull();
    const bound = fixture.verify.mock.calls[0][0] as EncryptedWorkspaceDatabase;
    expect(bound).toBeInstanceOf(EncryptedWorkspaceDatabase);
    expect(bound).not.toBe(db);
    expect(bound.session).toBe(session);
  });

  it('waits for successful verification even when the transfer modal is dismissed without migration', async () => {
    const pending = gate<undefined>();
    fixture.verify.mockReturnValue(pending.promise);
    await mountTransfer();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fixture.verify).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('unlocked-editor')).toBeNull();
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    await screen.findByTestId('unlocked-editor');
    expect(fixture.migrate).not.toHaveBeenCalled();
  });

  it('does not reopen from a verification result belonging to the previous unlock', async () => {
    const pending = gate<undefined>();
    fixture.verify.mockReturnValue(pending.promise);
    await mountTransfer();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fixture.verify).toHaveBeenCalledOnce());
    const bound = fixture.verify.mock.calls[0][0] as EncryptedWorkspaceDatabase;
    await act(async () => {
      await session.lock();
      await session.unlock(password);
    });
    await expect(bound.settings.get('storage-consent')).rejects.toMatchObject({ status: 423 });
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    expect(screen.queryByTestId('unlocked-editor')).toBeNull();
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('uses originating bound storage for migration and checks again before reopening a verified transfer', async () => {
    fixture.migrate.mockResolvedValue({
      version: 1,
      status: 'verified',
      sourceSchemaVersion: 8,
      counts: Object.fromEntries(
        db.tables.map((table) => [table.name, table.name === 'diagrams' ? 1 : 0]),
      ),
    } as WorkspaceMigrationSummary);
    await mountTransfer();
    confirmTransfer();
    await screen.findByRole('button', { name: 'Open transferred workspace' });
    const bound = fixture.migrate.mock.calls[0][0] as EncryptedWorkspaceDatabase;
    expect(bound).toBeInstanceOf(EncryptedWorkspaceDatabase);
    expect(bound).not.toBe(db);
    expect(bound.session).toBe(session);
    fixture.verify.mockRejectedValue(new Error('Failed final readback'));
    fireEvent.click(screen.getByRole('button', { name: 'Open transferred workspace' }));
    await screen.findByText('The editor remains closed: Failed final readback');
    expect(screen.queryByTestId('unlocked-editor')).toBeNull();
  });
});
