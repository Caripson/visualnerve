import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { LegacyWorkspaceStorage, WorkspaceDatabase } from '../src/storage/database';
import type { WorkspaceScope, WorkspaceStoreName } from '../src/storage/contracts';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { getCodeAnalysis, getProjectDirectory } from '../src/code/schema';
import type { CodeImportResult } from '../src/code/types';
import type { Graph } from '../src/model/types';
import * as archiveClient from '../src/code/project/client';

const archive = zipSync({
  'service/src/main.ts': strToU8(
    'import { helper } from "./utils/helper"; export function run() { const value="PRIVATE-CODE-LITERAL"; return helper(); }',
  ),
  'service/src/utils/helper.ts': strToU8('export function helper() { return 1; }'),
  'service/README.md': strToU8('[Usage](docs/usage.md)\nPRIVATE-DOCUMENT-PARAGRAPH'),
  'service/docs/usage.md': strToU8('[Home](../README.md#start)'),
  'service/node_modules/other/index.js': strToU8('throw new Error("EXCLUDED-DEPENDENCY-CODE")'),
  'service/.env': strToU8('KEY=EXCLUDED-PRIVATE-KEY'),
});
const input = {
  name: 'Service folders',
  data: Buffer.from(archive).toString('base64'),
  mode: 'folders',
};
let db: WorkspaceDatabase, controller: Workspace;
beforeEach(async () => {
  vi.stubGlobal('Worker', undefined);
  db = new WorkspaceDatabase(`project-api-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.put({ key: 'storage-consent', value: true });
  useEditor.getState().setGraph(null);
  useEditor.setState({
    privacyAcknowledged: false,
    mcpAccess: 'off',
    status: 'saved',
    message: '',
    owners: [],
    diagrams: [],
  });
  controller = new Workspace(new Repository(db));
  await controller.start();
  await controller.setPreference('mcp-access', 'read');
});
afterEach(async () => {
  controller.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});

it('previews ZIP topology read-only and saves the same semantic analysis without source or archive bytes', async () => {
  const preview = await controller.external<CodeImportResult>(
    '/code/project/preview',
    'POST',
    input,
  );
  expect(preview.fileCount).toBe(4);
  expect(preview.mode).toBe('folders');
  expect(preview.project).toMatchObject({
    name: input.name,
    ignoredEntries: 2,
    ignoredReasons: { private: 1, dependency: 1 },
  });
  expect(
    preview.graph.nodes
      .map(getProjectDirectory)
      .filter(Boolean)
      .map((node) => node!.path),
  ).toEqual(['.', 'src', 'src/utils', 'docs']);
  expect(await db.diagrams.count()).toBe(0);
  expect(useEditor.getState().graph).toBeNull();
  await expect(controller.external('/code/project/diagrams', 'POST', input)).rejects.toThrow(
    /read-only/,
  );
  await expect(
    controller.external('/code/project/preview?save=true', 'POST', input),
  ).rejects.toThrow(/read-only/);
  await controller.setPreference('mcp-access', 'write');
  const graph = await controller.external<Graph>('/api/v1/code/project/diagrams', 'POST', input);
  expect(getCodeAnalysis(graph)).toEqual(getCodeAnalysis(preview.graph));
  expect(useEditor.getState().graph?.diagram.id).toBe(graph.diagram.id);
  const stored = await controller.external<Graph>(`/diagrams/${graph.diagram.id}`, 'GET');
  expect(stored.nodes.map(getProjectDirectory)).toEqual(graph.nodes.map(getProjectDirectory));
  const json = JSON.stringify(stored);
  for (const value of [
    'PRIVATE-CODE-LITERAL',
    'PRIVATE-DOCUMENT-PARAGRAPH',
    'EXCLUDED-DEPENDENCY-CODE',
    'EXCLUDED-PRIVATE-KEY',
    input.data,
  ])
    expect(json).not.toContain(value);
});

it.each([
  { ...input, surprise: true },
  { ...input, mode: ['folders'] },
  { ...input, mode: 'automatic' },
  { ...input, focus: '' },
  { ...input, data: 'data:application/zip;base64,' + input.data },
  { ...input, data: 'not base64' },
])('rejects invalid project inputs without storing anything', async (value) => {
  await expect(controller.external('/code/project/preview', 'POST', value)).rejects.toThrow();
  expect(await db.diagrams.count()).toBe(0);
});

it('revocation cancels the archive stage and prevents a late result from writing or navigating', async () => {
  await controller.setPreference('mcp-access', 'write');
  const scanned = await archiveClient.parseProjectArchiveAsync({
    name: input.name,
    data: input.data,
  });
  let resolve!: (value: typeof scanned) => void;
  let signal: AbortSignal | undefined;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  vi.spyOn(archiveClient, 'parseProjectArchiveAsync').mockImplementation((_input, options) => {
    signal = options?.signal;
    entered();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = controller.external('/code/project/diagrams', 'POST', input);
  const rejected = expect(pending).rejects.toThrow();
  await started;
  await controller.setPreference('mcp-access', 'off');
  expect(signal?.aborted).toBe(true);
  resolve(scanned);
  await rejected;
  expect(await db.diagrams.count()).toBe(0);
  expect(useEditor.getState().graph).toBeNull();
});

it('checks live authorization inside the final import transaction after collision reads', async () => {
  await controller.setPreference('mcp-access', 'write');
  const atomic = LegacyWorkspaceStorage.prototype.atomic,
    lookup = vi.fn();
  vi.spyOn(LegacyWorkspaceStorage.prototype, 'atomic').mockImplementation(function <T>(
    this: LegacyWorkspaceStorage,
    mode: 'r' | 'rw',
    stores: readonly WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    return atomic.call(this, mode, stores, async (scope) => {
      if (mode === 'rw' && stores.includes('nodes')) {
        const bulkGet = scope.nodes.bulkGet.bind(scope.nodes);
        vi.spyOn(scope.nodes, 'bulkGet').mockImplementation((keys) =>
          bulkGet(keys).then((nodes) => {
            expect(scope.inTransaction).toBe(true);
            expect(keys.length).toBeGreaterThan(0);
            lookup(keys);
            // Revoke only after the real collision lookup has resolved, while
            // still inside the transaction that would publish the import.
            useEditor.setState({ mcpAccess: 'read' });
            return nodes;
          }),
        );
      }
      return work(scope);
    }) as Promise<T>;
  });
  await expect(controller.external('/code/project/diagrams', 'POST', input)).rejects.toThrow(
    /read-only/,
  );
  expect(lookup).toHaveBeenCalled();
  expect(useEditor.getState().mcpAccess).toBe('read');
  expect(await db.diagrams.count()).toBe(0);
  expect(await db.nodes.count()).toBe(0);
  expect(useEditor.getState().graph).toBeNull();
});

it('supports explicit per-file language overrides for ambiguous ZIPs', async () => {
  const ambiguous = {
    data: Buffer.from(
      zipSync({ 'project/include/types.h': strToU8('int process(int value);') }),
    ).toString('base64'),
  };
  await expect(controller.external('/code/project/preview', 'POST', ambiguous)).rejects.toThrow(
    /language/i,
  );
  const result = await controller.external<CodeImportResult>('/code/project/preview', 'POST', {
    ...ambiguous,
    languages: { 'include/types.h': 'c' },
  });
  expect(result.languages).toEqual(['c']);
  await expect(
    controller.external('/code/project/preview', 'POST', {
      ...ambiguous,
      languages: { 'project/include/types.h': 'c' },
    }),
  ).rejects.toThrow(/path/i);
  expect(await db.diagrams.count()).toBe(0);
});

it('discovers and applies a saved ZIP-only source count through the authoritative UI/API preference', async () => {
  const large = {
    name: 'Large folders',
    mode: 'folders',
    data: Buffer.from(
      zipSync(
        Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => [`repo/src/file${index}.py`, strToU8('pass')]),
        ),
      ),
    ).toString('base64'),
  };
  const capabilities = await controller.external<Record<string, unknown>>(
    '/code/capabilities',
    'GET',
  );
  expect(capabilities).toMatchObject({
    sourceFiles: { maximum: 500 },
    zipProjects: {
      maximumEntries: 10000,
      sourceFileLimit: {
        setting: 'project-source-file-limit',
        default: 500,
        minimum: 500,
        maximum: 10000,
      },
    },
    analysis: { maximumNodes: 5000 },
  });
  expect(await controller.external('/settings/project-source-file-limit', 'GET')).toBe(500);
  await expect(controller.external('/code/project/preview', 'POST', large)).rejects.toThrow(
    'more than 500 analyzable files',
  );
  await expect(
    controller.external('/settings/project-source-file-limit', 'PUT', { value: 1000 }),
  ).rejects.toThrow(/read-only/);
  await controller.setPreference('mcp-access', 'write');
  for (const value of [
    { value: 499 },
    { value: 10001 },
    { value: 500.5 },
    { value: '1000' },
    { value: 1000, extra: true },
  ])
    await expect(
      controller.external('/settings/project-source-file-limit', 'PUT', value),
    ).rejects.toMatchObject({ status: 422 });
  expect(await controller.external('/settings/project-source-file-limit', 'GET')).toBe(500);
  await controller.external('/settings/project-source-file-limit', 'PUT', { value: 1000 });
  expect(useEditor.getState().projectSourceFileLimit).toBe(1000);
  expect(await controller.external('/settings/project-source-file-limit', 'GET')).toBe(1000);
  const graph = await controller.external<Graph>('/code/project/diagrams', 'POST', large);
  expect(getCodeAnalysis(graph)).toMatchObject({
    fileCount: 501,
    project: { sourceFileLimit: 1000 },
  });
  await expect(
    controller.external('/code/project/preview', 'POST', { ...large, fileLimit: 10000 }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    controller.external('/code/preview', 'POST', {
      files: Array.from({ length: 501 }, (_, index) => ({
        path: `file${index}.py`,
        content: 'pass',
      })),
      mode: 'folders',
    }),
  ).rejects.toMatchObject({ status: 422 });
  await controller.external('/settings/project-source-file-limit', 'PUT', { value: 500 });
  await controller.refresh();
  const stored = await controller.external<Graph>(`/diagrams/${graph.diagram.id}`, 'GET');
  expect(getCodeAnalysis(stored)).toMatchObject({
    fileCount: 501,
    project: { sourceFileLimit: 1000 },
  });
});

it('captures the stored count once before archive work even if Settings changes while it runs', async () => {
  await controller.setPreference('project-source-file-limit', 1000);
  const scanned = await archiveClient.parseProjectArchiveAsync(
    { name: input.name, data: input.data },
    { fileLimit: 1000 },
  );
  let resolve!: (value: typeof scanned) => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const scan = vi
    .spyOn(archiveClient, 'parseProjectArchiveAsync')
    .mockImplementation((_input, options) => {
      expect(options?.fileLimit).toBe(1000);
      entered();
      return new Promise((done) => {
        resolve = done;
      });
    });
  const pending = controller.external<CodeImportResult>('/code/project/preview', 'POST', input);
  await started;
  await controller.setPreference('project-source-file-limit', 500);
  resolve(scanned);
  expect((await pending).project?.sourceFileLimit).toBe(1000);
  expect(scan).toHaveBeenCalledOnce();
});

it('rejects aliases and unsupported methods for the ZIP source-file setting without saving a value', async () => {
  await controller.setPreference('mcp-access', 'write');
  for (const path of [
    '/settings/project-source-file-limit/extra',
    '/settings/project-source-file-limit?value=1000',
    '/settings/project-source-file-limit#edit',
  ])
    await expect(controller.external(path, 'PUT', { value: 1000 })).rejects.toMatchObject({
      status: 404,
    });
  for (const method of ['POST', 'PATCH', 'DELETE'])
    await expect(
      controller.external('/settings/project-source-file-limit', method, { value: 1000 }),
    ).rejects.toMatchObject({ status: 405 });
  expect(await controller.external('/settings/project-source-file-limit', 'GET')).toBe(500);
});
