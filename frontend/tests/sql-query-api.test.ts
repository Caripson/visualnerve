import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { parseSql } from '../src/sql/parser';
import * as sqlClient from '../src/sql/client';
import { getSqlQueryResult, getSqlQuerySource } from '../src/sql/query-schema';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';

const sql = `-- private-comment-not-to-be-stored
SELECT DISTINCT b.bu_id, invoice_org.bu_name AS invoice_name,
  CASE WHEN totals.amount IS NULL THEN 0 ELSE totals.amount END AS amount
FROM business b
LEFT JOIN business invoice_org ON b.bu_send_bills_to = invoice_org.bu_id
LEFT JOIN (
  SELECT customer_id, SUM(amount) AS amount FROM invoices
  WHERE state <> 'Cancelled' GROUP BY customer_id
) totals ON b.bu_id = totals.customer_id
WHERE b.active = 1;`;

let db: WorkspaceDatabase;
let repo: Repository;
const controllers: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`sql-api-${crypto.randomUUID()}`);
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
  for (const workspace of controllers) workspace.stop();
  controllers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});
async function snapshot() {
  return db.transaction('r', db.tables, async () =>
    Object.fromEntries(
      await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
    ),
  );
}
async function controller(consent = true) {
  const workspace = new Workspace(repo);
  controllers.push(workspace);
  if (consent) await db.settings.put({ key: 'storage-consent', value: true });
  await workspace.start();
  return workspace;
}

describe('local SQL query API and MCP permissions', () => {
  it('previews logical SELECT structure without writing or navigating with a read-only grant', async () => {
    const workspace = await controller();
    const existing = blankGraph('Current work');
    existing.nodes = [newNode(existing.diagram.id, { title: 'Still editing' })];
    await workspace.create(existing);
    await workspace.setPreference('mcp-access', 'read');
    useEditor.getState().beginEditing(existing.nodes[0].id);
    useEditor.setState({ editingTitle: 'Keep this draft' });
    const before = await snapshot();
    const preview = await workspace.external<ReturnType<typeof parseSql>>(
      '/api/v1/sql/preview',
      'POST',
      { sql, name: 'Invoice flow' },
    );
    expect(preview.graph.diagram.name).toBe('Invoice flow');
    expect(
      preview.graph.nodes.filter((node) => getSqlQuerySource(node)?.kind === 'table'),
    ).toHaveLength(3);
    const outputs = preview.graph.nodes.map(getSqlQueryResult).filter((value) => !!value);
    expect(outputs.some((value) => value.distinct && value.columns.length === 3)).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(useEditor.getState().graph?.diagram.id).toBe(existing.diagram.id);
    expect(useEditor.getState().editingTitle).toBe('Keep this draft');
    expect(useEditor.getState().editingNode).toBe(existing.nodes[0].id);
  });

  it('saves and opens scoped query objects and retains expressions through reload, JSON import and backup restore', async () => {
    const workspace = await controller();
    await workspace.setPreference('mcp-access', 'write');
    const saved = await workspace.external<Graph>('/sql/diagrams', 'POST', {
      sql,
      name: 'Invoice flow',
    });
    expect(useEditor.getState().graph?.diagram.id).toBe(saved.diagram.id);
    expect(useEditor.getState().status).toBe('saved');
    const aliases = saved.nodes.map(getSqlQuerySource).filter((value) => !!value);
    expect(aliases.map((value) => value.alias)).toEqual(
      expect.arrayContaining(['b', 'invoice_org', 'totals']),
    );
    expect(aliases.filter((value) => value.qualifiedName.at(-1) === 'business')).toHaveLength(2);
    const queryMetadata = (graph: Graph) => ({
      nodes: graph.nodes.map((node) => node.metadata),
      edges: graph.edges.map((edge) => edge.metadata),
    });
    expect(JSON.stringify(saved)).toContain('Cancelled');
    expect(JSON.stringify(saved)).not.toContain('private-comment-not-to-be-stored');
    db.close();
    await db.open();
    expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
    const imported = await repo.request<Graph>('/import', 'POST', {
      format: 'json',
      data: JSON.parse(JSON.stringify(saved)),
    });
    expect(imported.diagram.id).not.toBe(saved.diagram.id);
    expect(queryMetadata(imported)).toEqual(queryMetadata(saved));
    const backup = await db.backup();
    const restored = await repo.restore(backup);
    expect(
      restored.some(
        (graph) => JSON.stringify(queryMetadata(graph)) === JSON.stringify(queryMetadata(saved)),
      ),
    ).toBe(true);
  });

  it('uses the same preview/create endpoints for existing DDL without persisting the raw script', async () => {
    const preview = await repo.request<ReturnType<typeof parseSql>>('/sql/preview', 'POST', {
      sql: 'CREATE TABLE customers (id INT PRIMARY KEY);',
    });
    expect(preview.tableCount).toBe(1);
    expect(await db.diagrams.count()).toBe(0);
    const graph = await repo.request<Graph>('/sql/diagrams', 'POST', {
      sql: 'CREATE TABLE customers (id INT PRIMARY KEY);',
    });
    expect(graph.nodes[0].metadata.sqlTable).toBeDefined();
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  });

  it('rejects malformed input, unsupported routes and invalid parsed graphs without partial writes', async () => {
    const before = await snapshot();
    for (const payload of [
      null,
      [],
      {},
      { sql: '' },
      { sql: 1 },
      { sql, extra: true },
      { sql, name: '' },
      { sql, name: 'x'.repeat(501) },
    ]) {
      await expect(repo.request('/sql/diagrams', 'POST', payload)).rejects.toMatchObject({
        status: expect.any(Number),
      });
    }
    for (const path of ['/sql/preview?save=true', '/sql/preview/extra', '/sql/diagrams#save'])
      await expect(repo.request(path, 'POST', { sql })).rejects.toMatchObject({ status: 404 });
    await expect(repo.request('/sql/preview', 'GET')).rejects.toMatchObject({ status: 405 });
    await expect(
      repo.request('/sql/diagrams', 'POST', { sql: 'SELECT FROM broken' }),
    ).rejects.toThrow();
    const malformed = parseSql('CREATE TABLE valid (id INT);');
    malformed.graph.edges.push(
      newEdge(malformed.graph.diagram.id, malformed.graph.nodes[0].id, crypto.randomUUID()),
    );
    vi.spyOn(sqlClient, 'parseSqlAsync').mockResolvedValue(malformed);
    await expect(repo.request('/sql/diagrams', 'POST', { sql })).rejects.toMatchObject({
      status: 422,
    });
    await expect(repo.request('/sql/preview', 'POST', { sql })).rejects.toMatchObject({
      status: 422,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('requires storage acceptance and both committed/current grants before SQL creation or preview', async () => {
    const workspace = await controller(false);
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    useEditor.setState({ mcpAccess: 'write' });
    await expect(workspace.external('/sql/preview', 'POST', { sql })).rejects.toMatchObject({
      status: 403,
    });
    await workspace.acceptStorage();
    await workspace.setPreference('mcp-access', 'read');
    await expect(workspace.external('/sql/diagrams', 'POST', { sql })).rejects.toMatchObject({
      status: 403,
    });
    await workspace.setPreference('mcp-access', 'write');
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    useEditor.setState({ mcpAccess: 'write' });
    await expect(workspace.external('/sql/diagrams', 'POST', { sql })).rejects.toMatchObject({
      status: 403,
    });
    expect(await db.diagrams.count()).toBe(0);
  });

  it('terminates a pending SQL worker when read/write access is revoked', async () => {
    const workspace = await controller();
    await workspace.setPreference('mcp-access', 'write');
    class PendingWorker {
      static instances: PendingWorker[] = [];
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        PendingWorker.instances.push(this);
      }
    }
    vi.stubGlobal('Worker', PendingWorker);
    const pending = workspace.external('/sql/diagrams', 'POST', { sql });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(PendingWorker.instances).toHaveLength(1));
    await workspace.setPreference('mcp-access', 'read');
    await rejected;
    expect(PendingWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(await db.diagrams.count()).toBe(0);
  });

  it('checks a revoked committed grant again after asynchronous analysis before importing', async () => {
    const workspace = await controller();
    await workspace.setPreference('mcp-access', 'write');
    let finish!: (result: ReturnType<typeof parseSql>) => void;
    const analysis = new Promise<ReturnType<typeof parseSql>>((resolve) => {
      finish = resolve;
    });
    const parse = vi.spyOn(sqlClient, 'parseSqlAsync').mockReturnValue(analysis);
    const pending = workspace.external('/sql/diagrams', 'POST', { sql });
    const rejected = expect(pending).rejects.toMatchObject({ status: 403 });
    await vi.waitFor(() => expect(parse).toHaveBeenCalled());
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    finish(parseSql('CREATE TABLE valid (id INT);'));
    await rejected;
    expect(await db.diagrams.count()).toBe(0);
  });

  it('preserves an inline draft in the previous diagram when creation opens the SQL result', async () => {
    const workspace = await controller();
    const old = blankGraph('Previous work');
    old.nodes = [newNode(old.diagram.id, { title: 'Original' })];
    await workspace.create(old);
    await workspace.setPreference('mcp-access', 'write');
    useEditor.getState().beginEditing(old.nodes[0].id);
    useEditor.setState({ editingTitle: 'Saved before switching' });
    const created = await workspace.external<Graph>('/sql/diagrams', 'POST', { sql });
    expect((await repo.getGraph(old.diagram.id)).nodes[0].title).toBe('Saved before switching');
    expect(useEditor.getState().graph?.diagram.id).toBe(created.diagram.id);
    expect(useEditor.getState().editingNode).toBeNull();
  });
});
