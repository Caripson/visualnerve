import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { historyTables } from '../src/history/store';
import { useEditor } from '../src/state/editor';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { parseCsv } from '../src/data/csv';

let db: WorkspaceDatabase, repo: Repository, workspace: Workspace, original: Graph;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  db = new WorkspaceDatabase(`history-access-${crypto.randomUUID()}`);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  const graph = blankGraph('Reviewed lifecycle');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original step' })];
  graph.dataset = {
    ...parseCsv('Customer,Value\nAAA,10\nBBB,20', 'customers.csv'),
    diagramId: graph.diagram.id,
  };
  original = await repo.importGraph(graph);
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write', status: 'saved' });
});
afterEach(async () => {
  workspace.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});

const historyRecords = () => Promise.all(historyTables(db).map((table) => table.toArray()));
const deferredDigest = () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return digest(...args);
  });
  return { started, release };
};

describe('external history write authorization after asynchronous preparation', () => {
  it.each([
    ['create', 'grant'],
    ['create', 'consent'],
    ['restore', 'grant'],
    ['restore', 'consent'],
  ] as const)(
    'rejects %s when %s is revoked during hashing without any write',
    async (action, kind) => {
      let current = original;
      let path = `/diagrams/${original.diagram.id}/history`;
      if (action === 'restore') {
        const snapshot = await repo.history.create(original.diagram.id, {
          name: 'Reviewed baseline',
          baseVersion: original.diagram.version,
        });
        const draft = structuredClone(original);
        draft.nodes[0].title = 'Keep this current draft';
        draft.dataset!.rows[0][1] = '99';
        current = await repo.saveGraph(draft, original.diagram.version);
        path += `/${snapshot.id}/restore`;
      }
      const before = await historyRecords();
      const gate = deferredDigest();
      const pending = workspace.external(path, 'POST', {
        baseVersion: current.diagram.version,
        ...(action === 'create' ? { name: 'Must not be saved' } : {}),
      });
      try {
        await gate.started;
        if (kind === 'grant') {
          useEditor.setState({ mcpAccess: 'read' });
          await db.settings.put({ key: 'mcp-access', value: 'read' });
        } else {
          useEditor.setState({ privacyAcknowledged: false });
          await db.settings.put({ key: 'storage-consent', value: false });
        }
        gate.release();
        await expect(pending).rejects.toMatchObject({ status: 403 });
        expect(await repo.getGraph(original.diagram.id)).toEqual(current);
        expect(await historyRecords()).toEqual(before);
      } finally {
        gate.release();
      }
    },
  );

  it('keeps local snapshot and restore operations independent of an MCP grant', async () => {
    useEditor.setState({ mcpAccess: 'off' });
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    const snapshot = await repo.history.create(original.diagram.id, {
      name: 'Local baseline',
      baseVersion: original.diagram.version,
    });
    const draft = structuredClone(original);
    draft.nodes[0].title = 'Current local draft';
    const current = await repo.saveGraph(draft, original.diagram.version);
    const restored = await repo.history.restore(original.diagram.id, snapshot.id, {
      baseVersion: current.diagram.version,
    });
    expect(restored.graph.nodes[0].title).toBe('Original step');
    expect(
      (await repo.history.read(original.diagram.id, restored.safetySnapshot.id)).graph,
    ).toEqual({ ...current, datasets: current.datasets ?? [] });
    expect(await repo.history.list(original.diagram.id)).toHaveLength(2);
  });
});
