import { webcrypto } from 'node:crypto';
import { createElement, type ComponentProps } from 'react';
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
import { App } from '../src/App';
import { Workspace } from '../src/storage/workspace';
import { Repository } from '../src/storage/repository';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { reanalyzeDataModel, setAnalysisForDataset } from '../src/data/model';
import { copySelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import type { Graph } from '../src/model/types';
import type { useImportFiles } from '../src/imports/useImportFiles';
import type { CsvImportDialog } from '../src/components/CsvImportDialog';
import type { Properties } from '../src/components/Properties';

// These UI continuations run against the actual password-derived vault, not a KDF mock.
configure({ asyncUtilTimeout: 10_000 });

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown as Workspace,
  imports: undefined as unknown as Parameters<typeof useImportFiles>[0],
  csv: undefined as unknown as ComponentProps<typeof CsvImportDialog>,
  properties: undefined as unknown as ComponentProps<typeof Properties>,
  analyze: vi.fn(),
  reanalyze: vi.fn(),
}));
vi.mock('../src/storage/workspace', async (original) => {
  const actual = await original<typeof import('../src/storage/workspace')>();
  return {
    ...actual,
    get workspace() {
      return fixture.workspace;
    },
  };
});
vi.mock('../src/imports/useImportFiles', () => ({
  useImportFiles: (handlers: Parameters<typeof useImportFiles>[0]) => {
    fixture.imports = handlers;
    return { importFile: async () => {}, draggingFile: false };
  },
}));
vi.mock('../src/data/client', () => ({ analyzeCsv: fixture.analyze }));
vi.mock('../src/data/modelClient', () => ({ reanalyzeDataModelAsync: fixture.reanalyze }));
vi.mock('../src/components/CsvImportDialog', () => ({
  CsvImportDialog: (props: ComponentProps<typeof CsvImportDialog>) => {
    fixture.csv = props;
    return null;
  },
}));
vi.mock('../src/components/Properties', () => ({
  Properties: (props: ComponentProps<typeof Properties>) => {
    fixture.properties = props;
    return null;
  },
}));
vi.mock('../src/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../src/components/Toolbar', () => ({ Toolbar: () => null, FilterBar: () => null }));
vi.mock('../src/canvas/Canvas', () => ({ Canvas: () => null }));
vi.mock('../src/presentation/PresentationFeature', () => ({ PresentationFeature: () => null }));
vi.mock('../src/simulation/SimulationFeature', () => ({ SimulationFeature: () => null }));
vi.mock('../src/components/UnderstandingDialogs', () => ({ UnderstandingDialogs: () => null }));
vi.mock('../src/components/DataPrivacy', () => ({
  LocalBadge: () => null,
  PrivacyIntro: () => null,
  RestoreBackup: () => null,
}));
vi.mock('../src/security/useWorkspaceBackupReader', () => ({
  useWorkspaceBackupReader: () => ({ readBackup: async () => {}, backupDialog: null }),
}));
vi.mock('../src/components/Dialogs', () => ({
  NewDiagram: () => null,
  ExportDialog: () => null,
  OwnersDialog: () => null,
  SearchDialog: () => null,
  SettingsDialog: () => null,
  DeleteDialog: () => null,
  ConnectDialog: () => null,
}));

const password = 'test-only App session password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let original: Graph;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount() {
  let mounted!: ReturnType<typeof render>;
  await act(async () => {
    mounted = render(createElement(App));
  });
  await waitFor(() => expect(useEditor.getState().graph?.diagram.id).toBe(original.diagram.id));
  return mounted;
}
async function reunlock() {
  await act(async () => {
    await session.lock();
    await session.unlock(password);
    await fixture.workspace.start();
    await fixture.workspace.open(original.diagram.id);
  });
  expect(useEditor.getState().graph?.diagram.id).toBe(original.diagram.id);
}
async function selectCsv(file = new File(['Company,Amount\nAAA,10'], 'Private source.csv')) {
  const dataset = parseCsv('Company,Amount\nAAA,10\nBBB,20', 'Private source.csv');
  act(() => fixture.imports.csv(dataset, file));
  await waitFor(() => expect(fixture.csv?.dataset.id).toBe(dataset.id));
  return dataset;
}
function unchanged(before: Graph) {
  expect(useEditor.getState().graph?.diagram.id).toBe(before.diagram.id);
  expect(useEditor.getState().graph?.nodes).toEqual(before.nodes);
  expect(useEditor.getState().history).toEqual([]);
  expect(useEditor.getState().status).toBe('saved');
  expect(useEditor.getState().message).toBe('');
}
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  fixture.analyze.mockReset();
  fixture.reanalyze.mockReset();
  fixture.csv = undefined as unknown as typeof fixture.csv;
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, clipboard: null, status: 'saved', message: '' });
  physical = new VaultRecordStorage(`vault-app-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  const repo = new Repository(db);
  fixture.workspace = new Workspace(repo);
  session.onLock(() => fixture.workspace.clearUnlockedState());
  await db.settings.put({ key: 'storage-consent', value: true });
  const dataset = parseCsv('Company,Amount\nAAA,10\nBBB,20', 'Original private CSV');
  original = await repo.saveGraph(csvGraph(dataset, defaultAnalysis(dataset)), 0);
  await db.settings.put({ key: 'last-diagram', value: original.diagram.id });
});
afterEach(async () => {
  cleanup();
  fixture.workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('App fixture retained an open database.'));
  });
  vi.unstubAllGlobals();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('App async content retains its originating vault session', () => {
  it('does not create from a CSV worker result after lock and unlock', async () => {
    await mount();
    const dataset = await selectCsv();
    const result = deferred<Graph>();
    fixture.analyze.mockReturnValue(result.promise);
    const create = vi.spyOn(fixture.workspace, 'create');
    let completion!: Promise<void>;
    act(() => {
      completion = fixture.csv.apply(defaultAnalysis(dataset), 'Old session CSV');
    });
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fixture.analyze).toHaveBeenCalledOnce());
    await reunlock();
    const before = useEditor.getState().graph!;
    await act(async () => {
      result.resolve(csvGraph(dataset, defaultAnalysis(dataset)));
      await rejected;
    });
    expect(create).not.toHaveBeenCalled();
    unchanged(before);
    expect(await db.diagrams.count()).toBe(1);
  });

  it('creates a normal CSV result through the original borrowed capability', async () => {
    await mount();
    const dataset = await selectCsv();
    fixture.analyze.mockResolvedValue(csvGraph(dataset, defaultAnalysis(dataset)));
    const create = vi.spyOn(fixture.workspace, 'create');
    await act(async () => {
      await fixture.csv.apply(defaultAnalysis(dataset), 'New CSV diagram');
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][1]).toBeDefined();
    expect(useEditor.getState().graph?.diagram.name).toBe('New CSV diagram');
    expect(await db.diagrams.count()).toBe(2);
  });

  it('does not import a legacy CSV file whose read finishes in a later session', async () => {
    await mount();
    const read = deferred<string>();
    const file = new File([''], 'Legacy.csv');
    Object.defineProperty(file, 'text', { value: vi.fn(() => read.promise) });
    await selectCsv(file);
    const create = vi.spyOn(fixture.workspace, 'create');
    let completion!: Promise<void>;
    act(() => {
      completion = fixture.csv.legacyImport!();
    });
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(file.text).toHaveBeenCalledOnce());
    await reunlock();
    const before = useEditor.getState().graph!;
    await act(async () => {
      read.resolve('id,label\n1,Old secret');
      await rejected;
    });
    expect(create).not.toHaveBeenCalled();
    unchanged(before);
    expect(await db.diagrams.count()).toBe(1);
  });

  it('does not update an existing same-ID CSV graph from an old worker result', async () => {
    await mount();
    act(() => fixture.properties.editCsv?.());
    await waitFor(() => expect(fixture.csv?.previous?.diagram.id).toBe(original.diagram.id));
    const dataset = original.dataset!;
    const result = deferred<Graph>();
    fixture.analyze.mockReturnValue(result.promise);
    let completion!: Promise<void>;
    act(() => {
      completion = fixture.csv.apply(defaultAnalysis(dataset), 'Old view name');
    });
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fixture.analyze).toHaveBeenCalledOnce());
    await reunlock();
    const before = useEditor.getState().graph!;
    await act(async () => {
      result.resolve({ ...before, nodes: [] });
      await rejected;
    });
    unchanged(before);
    expect((await db.graph(original.diagram.id))?.diagram).toEqual(before.diagram);
  });

  it('aborts linked-model work and does not publish its result after re-unlock', async () => {
    const customers = original.dataset!;
    const orders = parseCsv('Company,Order\nAAA,one\nBBB,two', 'Orders.csv');
    orders.diagramId = original.diagram.id;
    const linked = setAnalysisForDataset(
      { ...original, datasets: [orders] },
      orders.id,
      defaultAnalysis(orders),
    );
    linked.diagram.settings.csvDatasetOrder = [customers.id, orders.id];
    linked.diagram.settings.csvRelationships = [
      {
        id: crypto.randomUUID(),
        sourceDatasetId: customers.id,
        sourceColumnId: 'c0',
        targetDatasetId: orders.id,
        targetColumnId: 'c0',
      },
    ];
    original = await fixture.workspace.repo.saveGraph(
      reanalyzeDataModel(linked),
      original.diagram.version,
    );
    await mount();
    const result = deferred<Graph>();
    fixture.reanalyze.mockReturnValue(result.promise);
    act(() => fixture.properties.focusCsv?.([{ columnId: 'c0', value: 'AAA' }], customers.id));
    await waitFor(() => expect(fixture.reanalyze).toHaveBeenCalledOnce());
    const signal = fixture.reanalyze.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await reunlock();
    expect(signal.aborted).toBe(true);
    const before = useEditor.getState().graph!;
    await act(async () => {
      result.resolve({ ...before, nodes: [] });
      await result.promise;
    });
    unchanged(before);
    expect((await db.graph(original.diagram.id))?.nodes).toEqual(before.nodes);
  });

  it.each(['resolve', 'reject'] as const)(
    'does not paste or fallback after same-ID lock/unlock when clipboard %ss',
    async (outcome) => {
      await mount();
      const read = deferred<string>();
      const clip = copySelection(original, [original.nodes[0].id]);
      useEditor.setState({ clipboard: clip });
      const readText = vi.fn(() => read.promise);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
      fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
      await waitFor(() => expect(readText).toHaveBeenCalledOnce());
      await reunlock();
      const before = useEditor.getState().graph!;
      // A new session may have a new in-memory clipboard; the old rejection must not paste it either.
      useEditor.setState({ clipboard: clip });
      const paste = vi.spyOn(useEditor.getState(), 'paste');
      await act(async () => {
        if (outcome === 'resolve') read.resolve(JSON.stringify(clip));
        else read.reject(new Error('Clipboard denied'));
        await read.promise.catch(() => {});
      });
      expect(paste).not.toHaveBeenCalled();
      unchanged(before);
      expect((await db.graph(original.diagram.id))?.nodes).toEqual(before.nodes);
    },
  );

  it('discards old mounted-component CSV completion after a new App mounts', async () => {
    const mounted = await mount();
    const dataset = await selectCsv();
    const result = deferred<Graph>();
    fixture.analyze.mockReturnValue(result.promise);
    let completion!: Promise<void>;
    act(() => {
      completion = fixture.csv.apply(defaultAnalysis(dataset), 'Unmounted CSV');
    });
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fixture.analyze).toHaveBeenCalledOnce());
    act(() => mounted.unmount());
    await mount();
    const before = useEditor.getState().graph!;
    const create = vi.spyOn(fixture.workspace, 'create');
    await act(async () => {
      result.resolve(csvGraph(dataset, defaultAnalysis(dataset)));
      await rejected;
    });
    expect(create).not.toHaveBeenCalled();
    unchanged(before);
  });

  it('does not publish a delayed CSV navigation error into the re-unlocked session', async () => {
    await mount();
    const result = deferred<Graph>();
    fixture.analyze.mockReturnValue(result.promise);
    act(() => fixture.properties.pageCsv?.('next'));
    await waitFor(() => expect(fixture.analyze).toHaveBeenCalledOnce());
    await reunlock();
    const before = useEditor.getState().graph!;
    await act(async () => {
      result.reject(new Error('Old session analysis failure'));
      await result.promise.catch(() => {});
    });
    unchanged(before);
  });

  it('does not publish a delayed conflict action error into a later session', async () => {
    await mount();
    const result = deferred<void>();
    const resolve = vi.spyOn(fixture.workspace, 'resolve').mockReturnValue(result.promise);
    act(() => useEditor.setState({ status: 'conflict', message: 'Original session conflict' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save local copy' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('copy'));
    await reunlock();
    const before = useEditor.getState().graph!;
    await act(async () => {
      result.reject(new Error('Private old conflict failure'));
      await result.promise.catch(() => {});
    });
    unchanged(before);
  });
});
