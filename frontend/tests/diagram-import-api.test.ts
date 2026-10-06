import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { projectGraph } from '../src/canvas/projection';
import * as client from '../src/imports/diagram/client';
import { parseDrawio } from '../src/imports/diagram/drawio';
import type { DiagramImportResult } from '../src/imports/diagram/types';
import type { Graph } from '../src/model/types';
import { vsdxFixture } from './fixtures/vsdx';

const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Before" vertex="1" parent="1"><mxGeometry x="40" y="30" width="160" height="80" as="geometry"/></mxCell><mxCell id="b" value="After" vertex="1" parent="1"><mxGeometry x="300" y="30" width="160" height="80" as="geometry"/></mxCell><mxCell id="e" value="Next" edge="1" source="a" target="b" parent="1" style="strokeColor=#ff0000;strokeWidth=3;dashed=1;endArrow=classic;"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`;
const input = {
  format: 'drawio' as const,
  data: `<mxfile><diagram id="one" name="First">${model}</diagram><diagram id="two" name="Second">${model}</diagram></mxfile>`,
  name: 'workflow.drawio',
};
let db: WorkspaceDatabase;
let repo: Repository;
let workspace: Workspace | undefined;
beforeEach(async () => {
  db = new WorkspaceDatabase(`diagram-import-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  useEditor.getState().setGraph(null);
  useEditor.setState({
    privacyAcknowledged: true,
    mcpAccess: 'off',
    status: 'saved',
    message: '',
    diagrams: [],
    owners: [],
  });
});
afterEach(async () => {
  workspace?.stop();
  workspace = undefined;
  vi.restoreAllMocks();
  await db.delete();
});
async function snapshot() {
  return db.transaction('r', db.tables, async () =>
    Object.fromEntries(
      await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
    ),
  );
}
async function controller() {
  workspace = new Workspace(repo);
  await db.settings.put({ key: 'storage-consent', value: true });
  await workspace.start();
  return workspace;
}

describe('native diagram file commands', () => {
  it('previews multiple pages without writes and imports exactly the chosen page with editable directed links', async () => {
    const before = await snapshot();
    const preview = await repo.request<DiagramImportResult>(
      '/diagram-files/preview',
      'POST',
      input,
    );
    expect(preview.pages.map((page) => page.id)).toEqual(['one', 'two']);
    expect(preview.pages[1].graph.nodes.map((node) => node.title)).toEqual(['Before', 'After']);
    expect(await snapshot()).toEqual(before);
    await expect(repo.request('/import', 'POST', input)).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    const graph = await repo.request<Graph>('/import', 'POST', { ...input, pageId: 'two' });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({
      label: 'Next',
      direction: 'forward',
      style: 'dashed',
      sourceNodeId: graph.nodes[0].id,
      targetNodeId: graph.nodes[1].id,
    });
    expect(graph.diagram.metadata.diagramImport).toMatchObject({ format: 'drawio', pageId: 'two' });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    expect(projectGraph(graph, []).edges[0].style).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 3,
    });
    expect(JSON.stringify(await snapshot())).not.toContain('<mxGraphModel>');
    const exported = await repo.request<Graph>('/export', 'POST', {
      diagramId: graph.diagram.id,
      format: 'json',
    });
    expect(exported.nodes).toEqual(graph.nodes);
  });
  it('imports a Visio OPC package through strict base64 and preserves native geometry', async () => {
    const data = Buffer.from(vsdxFixture()).toString('base64');
    const preview = await repo.request<DiagramImportResult>(
      '/api/v1/diagram-files/preview',
      'POST',
      { format: 'vsdx', data },
    );
    const graph = await repo.request<Graph>('/api/v1/import', 'POST', {
      format: 'vsdx',
      data,
      pageId: preview.pages[0].id,
    });
    expect(graph.nodes[0]).toMatchObject({ title: 'Hello', x: 96, y: 624, width: 192, height: 96 });
    expect(JSON.stringify(await snapshot())).not.toContain(data);
  });
  it.each([
    null,
    [],
    { ...input, extra: true },
    { ...input, format: { toString: 'bad' } },
    { ...input, name: '' },
    { format: 'vsdx', data: 'UEsD BA==' },
    { format: 'vsdx', data: 'YWJj' },
    { format: 'drawio', data: '<broken>' },
    { ...input, data: input.data.replace('id="one"', 'id=" "') },
  ])('rejects malformed inputs atomically', async (payload) => {
    const before = await snapshot();
    await expect(repo.request('/diagram-files/preview', 'POST', payload)).rejects.toMatchObject({
      status: 422,
    });
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    '/diagram-files/preview/',
    '/diagram-files/preview/extra',
    '/diagram-files/preview?x=1',
    '/diagram-files/preview#fragment',
  ])('rejects an inexact preview route %s', async (path) => {
    await expect(repo.request(path, 'POST', input)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects an unknown selected page and unsafe imported styling without external CSS', async () => {
    await expect(
      repo.request('/import', 'POST', { ...input, pageId: 'missing' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await db.diagrams.count()).toBe(0);
    const graph = parseDrawio(model, 'Safe').pages[0].graph;
    graph.edges[0].metadata.diagramImport = {
      format: 'drawio',
      strokeColor: 'url(https://bad.test/a)',
      strokeWidth: Infinity,
    };
    expect(projectGraph(graph, []).edges[0].style).toMatchObject({
      stroke: '#8a9694',
      strokeWidth: 1.6,
    });
  });
});
describe('browser grants and cancellation', () => {
  it('permits a read-only preview without saving and requires write access before import opens the native graph', async () => {
    const local = await controller();
    await local.setPreference('mcp-access', 'read');
    const before = await snapshot();
    const preview = await local.external<DiagramImportResult>(
      '/diagram-files/preview',
      'POST',
      input,
    );
    expect(preview.pages).toHaveLength(2);
    expect(await snapshot()).toEqual(before);
    await expect(
      local.external('/import', 'POST', { ...input, pageId: 'one' }),
    ).rejects.toMatchObject({ status: 403 });
    await local.setPreference('mcp-access', 'write');
    const graph = await local.external<Graph>('/import', 'POST', { ...input, pageId: 'one' });
    expect(useEditor.getState().graph?.diagram.id).toBe(graph.diagram.id);
  });
  it('cancels in-flight import after revocation and rechecks persisted grants before saving', async () => {
    const local = await controller();
    await local.setPreference('mcp-access', 'write');
    let resolve!: (result: DiagramImportResult) => void;
    let signal: AbortSignal | undefined;
    const parsed = parseDrawio(input.data, input.name);
    vi.spyOn(client, 'parseDiagramAsync').mockImplementation((_input, options) => {
      signal = options?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const promise = local.external('/import', 'POST', { ...input, pageId: 'one' });
    const rejected = expect(promise).rejects.toMatchObject({ status: 403 });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await local.setPreference('mcp-access', 'read');
    expect(signal?.aborted).toBe(true);
    resolve(parsed);
    await rejected;
    expect(await db.diagrams.count()).toBe(0);
  });
});
