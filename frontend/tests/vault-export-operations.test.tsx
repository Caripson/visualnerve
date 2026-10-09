import { webcrypto } from 'node:crypto';
import { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '../src/components/Dialogs';
import { Workspace } from '../src/storage/workspace';
import { Repository } from '../src/storage/repository';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { assertExportActive, checkExportActive, waitForExport } from '../src/export/guard';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown as Workspace,
  download: vi.fn(),
  setViewport: vi.fn(),
  toSvg: vi.fn(),
  decode: vi.fn(),
  vector: vi.fn(),
  pdfImage: vi.fn(),
  hasNodes: false,
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
vi.mock('../src/export/semantic', async (original) => {
  const actual = await original<typeof import('../src/export/semantic')>();
  return { ...actual, download: fixture.download };
});
vi.mock('html-to-image', () => ({ toSvg: fixture.toSvg }));
vi.mock('../src/export/vector-svg', () => ({ vectorSVG: fixture.vector }));
vi.mock('../src/nodes/registry', () => ({ nodeTypes: {} }));
vi.mock('../src/mindmap/Branch', () => ({ edgeTypes: {} }));
vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    addImage = fixture.pdfImage;
    output = () => new Blob(['Private PDF']);
  },
}));
vi.mock('@xyflow/react', async (original) => {
  const actual = await original<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ViewportPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({ children, nodes }: { children: ReactNode; nodes: { id: string }[] }) => {
      fixture.hasNodes = nodes.length > 0;
      return <div className="react-flow">{children}</div>;
    },
    useNodesInitialized: () => fixture.hasNodes,
    useReactFlow: () => ({ viewportInitialized: true, setViewport: fixture.setViewport }),
  };
});
const password = 'test-only diagram export password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let original: Graph;
let click: ReturnType<typeof vi.spyOn>;
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
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
async function open(format = 'json') {
  const close = vi.fn();
  const mounted = render(<ExportDialog close={close} />);
  fireEvent.change(screen.getByLabelText('Export format'), { target: { value: format } });
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  return { mounted, close };
}
function noDownload() {
  expect(fixture.download).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
}
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  fixture.setViewport.mockResolvedValue(true);
  fixture.toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,Private raster scene');
  fixture.decode.mockResolvedValue(undefined);
  fixture.vector.mockReturnValue('<svg>Private vector scene</svg>');
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    'Image',
    class {
      width = 640;
      height = 480;
      onload?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
      decode = fixture.decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,Private',
  );
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, status: 'saved', message: '' });
  physical = new VaultRecordStorage(`vault-export-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  const repo = new Repository(db);
  fixture.workspace = new Workspace(repo);
  session.onLock(() => fixture.workspace.clearUnlockedState());
  await db.settings.put({ key: 'storage-consent', value: true });
  const graph = blankGraph('Original private diagram');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Private originating node' })];
  original = await repo.saveGraph(graph, 0);
  await fixture.workspace.start();
  await fixture.workspace.open(original.diagram.id);
});
afterEach(async () => {
  cleanup();
  fixture.workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Export fixture retained an open database.'));
  });
  vi.unstubAllGlobals();
  if (fonts) Object.defineProperty(document, 'fonts', fonts);
  else Reflect.deleteProperty(document, 'fonts');
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('readable diagram downloads are bound to the original vault session', () => {
  it.each(['viewport', 'fonts'])(
    'revokes an API SVG render at the %s wait and removes private DOM before a fresh unlock',
    async (stage) => {
      const waiting = gate<void>();
      if (stage === 'viewport') fixture.setViewport.mockReturnValue(waiting.promise);
      else
        Object.defineProperty(document, 'fonts', {
          configurable: true,
          value: { ready: waiting.promise },
        });
      const pending = fixture.workspace.repo.request('/export', 'POST', {
        diagramId: original.diagram.id,
        format: 'svg',
      });
      const outcome = pending.then(
        () => ({ status: 'unexpected completion' }),
        (error: unknown) => error,
      );
      await waitFor(() => expect(document.querySelector('.export-canvas')).not.toBeNull());
      await waitFor(() => expect(fixture.setViewport).toHaveBeenCalled());
      await reunlock();
      await waitFor(() => expect(document.querySelector('.export-canvas')).toBeNull());
      expect(await outcome).toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
      waiting.resolve();
      await act(async () => {
        await waiting.promise;
      });
      expect(fixture.vector).not.toHaveBeenCalled();
      noDownload();
    },
  );

  it.each(['json', 'markdown', 'svg', 'png', 'pdf'])(
    'never exports %s into a later session after a pending save wait',
    async (format) => {
      const waiting = gate<void>();
      const settled = vi.spyOn(fixture.workspace, 'settled').mockReturnValueOnce(waiting.promise);
      await open(format);
      await waitFor(() => expect(settled).toHaveBeenCalled());
      settled.mockRestore();
      await reunlock();
      await act(async () => {
        waiting.resolve();
        await waiting.promise;
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
      noDownload();
    },
  );

  it.each(['svg', 'png', 'pdf'])(
    'removes an isolated %s render host immediately on lock and cannot download its late completion',
    async (format) => {
      const waiting = gate<boolean>();
      fixture.setViewport.mockReturnValue(waiting.promise);
      await open(format);
      await waitFor(() => expect(document.querySelector('.export-canvas')).not.toBeNull());
      await waitFor(() => expect(fixture.setViewport).toHaveBeenCalled());
      await reunlock();
      expect(document.querySelector('.export-canvas')).toBeNull();
      await act(async () => {
        waiting.resolve(true);
        await waiting.promise;
      });
      noDownload();
      expect(fixture.toSvg).not.toHaveBeenCalled();
      expect(fixture.vector).not.toHaveBeenCalled();
    },
  );

  it('does not paint or download a PNG whose native decoder is pending when locked', async () => {
    const waiting = gate<void>();
    fixture.decode.mockReturnValue(waiting.promise);
    await open('png');
    await waitFor(() => expect(fixture.decode).toHaveBeenCalledOnce());
    await reunlock();
    expect(document.querySelector('.export-canvas')).toBeNull();
    await act(async () => {
      waiting.resolve();
      await waiting.promise;
    });
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    noDownload();
  });

  it('aborts an unmounted dialog even when its vault session remains unlocked', async () => {
    const waiting = gate<boolean>();
    fixture.setViewport.mockReturnValue(waiting.promise);
    const { mounted } = await open('svg');
    await waitFor(() => expect(fixture.setViewport).toHaveBeenCalled());
    mounted.unmount();
    await waitFor(() => expect(document.querySelector('.export-canvas')).toBeNull());
    await act(async () => {
      waiting.resolve(true);
      await waiting.promise;
    });
    expect(session.getSnapshot().status).toBe('unlocked');
    noDownload();
  });

  it('exports the immutable originating graph rather than a diagram opened during its save wait', async () => {
    const waiting = gate<void>();
    const settled = vi.spyOn(fixture.workspace, 'settled').mockReturnValueOnce(waiting.promise);
    await open('json');
    await waitFor(() => expect(settled).toHaveBeenCalled());
    settled.mockRestore();
    const replacement = blankGraph('Different newly opened diagram');
    replacement.nodes = [newNode(replacement.diagram.id, { title: 'Unrelated private node' })];
    // Navigate through the real persisted workspace. An arbitrary unsaved ID
    // injected into editor state can correctly be cleared by a delayed refresh.
    await act(async () => {
      await fixture.workspace.create(replacement);
      await fixture.workspace.refresh();
    });
    const reopened = await fixture.workspace.repo.getGraph(replacement.diagram.id);
    expect(reopened.nodes[0].title).toBe('Unrelated private node');
    expect(useEditor.getState().graph?.diagram.id).toBe(replacement.diagram.id);
    await act(async () => {
      waiting.resolve();
      await waiting.promise;
    });
    await waitFor(() => expect(fixture.download).toHaveBeenCalledOnce());
    const exported = JSON.parse(fixture.download.mock.calls[0][1]) as Graph;
    expect(exported.diagram.id).toBe(original.diagram.id);
    expect(exported.nodes[0].title).toBe('Private originating node');
    expect(useEditor.getState().graph?.diagram.id).toBe(replacement.diagram.id);
  });

  it.each(['svg', 'png', 'pdf'])(
    'keeps normal %s output and cleans its render host',
    async (format) => {
      const { close } = await open(format);
      await waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(document.querySelector('.export-canvas')).toBeNull();
      if (format === 'png') expect(click).toHaveBeenCalledOnce();
      else expect(fixture.download).toHaveBeenCalledOnce();
    },
  );

  it('rejects cancellation scheduled by the final authorization check before publication', async () => {
    const operation = await db.captureOperation();
    const local = new AbortController();
    const guard = {
      signal: AbortSignal.any([operation.signal, local.signal]),
      check: async () => {
        await operation.check();
        queueMicrotask(() => local.abort());
      },
      assertCurrent: () => {},
    };
    await expect(checkExportActive(guard)).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => assertExportActive(guard)).toThrow('Diagram export cancelled.');
    const deferred = gate<string>();
    await expect(waitForExport(deferred.promise, guard)).rejects.toMatchObject({
      name: 'AbortError',
    });
    deferred.resolve('Late private pixels');
    operation.dispose();
    noDownload();
  });
});
