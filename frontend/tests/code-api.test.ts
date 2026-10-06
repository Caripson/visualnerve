import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { getCodeObject } from '../src/code/schema';
import { codeLanguageIds, type CodeImportResult } from '../src/code/types';
import * as client from '../src/code/client';

const input = {
  name: 'Service outline',
  mode: 'symbols',
  files: [
    {
      path: 'app.py',
      content:
        'from utils import clean\n# SECRET-COMMENT\ndef run():\n    clean()\n    value = "SECRET-VALUE"\n',
      language: 'python',
    },
    { path: 'utils.py', content: 'def clean():\n    return 1\n', language: 'python' },
  ],
};
let db: WorkspaceDatabase, repo: Repository;
const workspaces: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`code-api-${crypto.randomUUID()}`);
  repo = new Repository(db);
  vi.stubGlobal('Worker', undefined);
  useEditor.getState().setGraph(null);
  useEditor.setState({
    privacyAcknowledged: false,
    mcpAccess: 'off',
    status: 'saved',
    message: '',
    owners: [],
    diagrams: [],
  });
  await db.initialize();
});
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) workspace.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});
async function workspace(access: 'read' | 'write' = 'read') {
  await db.settings.put({ key: 'storage-consent', value: true });
  const result = new Workspace(repo);
  workspaces.push(result);
  await result.start();
  await result.setPreference('mcp-access', access);
  return result;
}
async function snapshot() {
  return db.transaction('r', db.tables, async () =>
    Object.fromEntries(
      await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
    ),
  );
}

describe('code analysis REST and MCP contracts', () => {
  it('discovers all 50 language ids and previews without changing storage, navigation or title drafts', async () => {
    const controller = await workspace();
    const current = blankGraph('Current');
    current.nodes = [newNode(current.diagram.id, { title: 'Draft' })];
    await controller.create(current);
    useEditor.getState().beginEditing(current.nodes[0].id);
    useEditor.setState({ editingTitle: 'Keep this draft' });
    const before = await snapshot();
    const languages = await controller.external<{ id: string }[]>('/api/v1/code/languages', 'GET');
    expect(languages.map((entry) => entry.id)).toEqual([...codeLanguageIds]);
    const preview = await controller.external<CodeImportResult>(
      '/api/v1/code/preview',
      'POST',
      input,
    );
    expect(preview.graph.nodes.some((node) => getCodeObject(node)?.name === 'run')).toBe(true);
    expect(preview.graph.edges.length).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
    expect(useEditor.getState().graph?.diagram.id).toBe(current.diagram.id);
    expect(useEditor.getState().editingTitle).toBe('Keep this draft');
  });
  it('requires write access, then saves and opens a source-free canonical graph', async () => {
    const controller = await workspace();
    await expect(controller.external('/code/diagrams', 'POST', input)).rejects.toThrow(/read-only/);
    await controller.setPreference('mcp-access', 'write');
    const graph = await controller.external<Graph>('/code/diagrams', 'POST', input);
    expect(useEditor.getState().graph?.diagram.id).toBe(graph.diagram.id);
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    expect(JSON.stringify(graph)).not.toContain('SECRET-');
    const backup = await db.backup();
    expect(JSON.stringify(backup)).not.toContain('SECRET-');
    expect(backup.nodes.some((node) => getCodeObject(node)?.path === 'utils.py')).toBe(true);
  });
  it.each([
    ['/code/preview/extra', input],
    ['/code/preview?save=true', input],
    ['/code/preview#save', input],
    ['/code/preview', { ...input, execute: true }],
    ['/code/preview', { files: [] }],
    ['/code/preview', { ...input, mode: 'runtime' }],
    ['/code/preview', { ...input, name: '' }],
    ['/code/preview', { ...input, files: [{ ...input.files[0], secret: 'unknown' }] }],
    ['/code/preview', { ...input, files: [{ ...input.files[0], language: 'unknown' }] }],
  ])('rejects invalid input or non-exact paths atomically: %s', async (path, data) => {
    const before = await snapshot();
    await expect(repo.request(path, 'POST', data)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('cancels analysis if the grant is revoked and blocks its first write', async () => {
    const controller = await workspace('write');
    let enter!: () => void, complete!: (value: CodeImportResult) => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const result = new Promise<CodeImportResult>((resolve) => {
      complete = resolve;
    });
    let signal: AbortSignal | undefined;
    vi.spyOn(client, 'parseCodeAsync').mockImplementation(async (_input, options) => {
      signal = options?.signal;
      enter();
      return result;
    });
    const pending = controller.external<Graph>('/code/diagrams', 'POST', input);
    const rejection = expect(pending).rejects.toThrow();
    await entered;
    await controller.setPreference('mcp-access', 'off');
    expect(signal?.aborted).toBe(true);
    const graph = blankGraph('Cancelled result');
    complete({
      graph,
      version: 1,
      languages: ['python'],
      mode: 'files',
      fileCount: 1,
      symbolCount: 0,
      dependencyCount: 0,
      unresolvedCount: 0,
      warnings: [],
    });
    await rejection;
    expect(await db.diagrams.count()).toBe(0);
  });
  it('rechecks persisted storage acceptance immediately before saving', async () => {
    const controller = await workspace('write');
    vi.spyOn(client, 'parseCodeAsync').mockImplementation(async () => {
      await db.settings.delete('storage-consent');
      return {
        graph: blankGraph('No acceptance'),
        version: 1,
        languages: ['python'],
        mode: 'files',
        fileCount: 1,
        symbolCount: 0,
        dependencyCount: 0,
        unresolvedCount: 0,
        warnings: [],
      };
    });
    await expect(controller.external('/code/diagrams', 'POST', input)).rejects.toThrow(/accept/i);
    expect(await db.diagrams.count()).toBe(0);
  });
});
