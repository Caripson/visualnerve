import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { collaborationPermissions } from '../src/collaboration/access';
import { documentProfilePreference } from '../src/collaboration/document-api';
let db: WorkspaceDatabase, repo: Repository, graph: Graph;
const cleanups: Array<() => void> = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`document-work-${crypto.randomUUID()}`);
  repo = new Repository(db);
  graph = blankGraph('Review', 'flowchart');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Capacity' })];
  graph = await repo.saveGraph(graph, 0);
});
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  await db.delete();
});
async function action(value: unknown, version = graph.diagram.version) {
  const result = await repo.request(`/diagrams/${graph.diagram.id}/collaboration/actions`, 'POST', {
    baseVersion: version,
    action: value,
  });
  graph = result as Graph;
  return graph;
}
async function profile(name = 'Alex') {
  await action({ type: 'profile.create', profile: { name } });
  return graph.diagram.collaboration!.profiles.find((profile) => profile.name === name)!.id;
}
describe('authoritative document workflow API/storage', () => {
  it.each([undefined, null, {}, Object.create(null)])(
    'accepts body-less document inspection input %j without changing saved work',
    async (input) => {
      await profile();
      const before = await repo.getGraph(graph.diagram.id);
      expect(
        await repo.request(`/diagrams/${graph.diagram.id}/collaboration/document`, 'GET', input),
      ).toEqual({
        diagramId: graph.diagram.id,
        baseVersion: before.diagram.version,
        document: before.diagram.collaboration,
      });
      expect(await repo.getGraph(graph.diagram.id)).toEqual(before);
    },
  );
  it.each([
    false,
    true,
    0,
    '',
    [],
    [{}],
    { authorId: 'untrusted' },
    new Date('2026-10-11T12:00:00Z'),
    Object.create({ argument: 'inherited' }),
    { [Symbol('argument')]: true },
    Object.defineProperty({}, 'argument', { value: true }),
  ])('rejects actual document inspection input %j without writes', async (input) => {
    const before = await repo.getGraph(graph.diagram.id);
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}/collaboration/document`, 'GET', input),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(before);
  });
  it('records direct bulk and node API edits in native transactions without an optional write guard', async () => {
    const authorId = await profile();
    graph.nodes[0].externalId = 'capacity';
    graph = await repo.saveGraph(graph, graph.diagram.version);
    graph = await repo.bulk(graph.diagram.id, {
      baseVersion: graph.diagram.version,
      upsert: true,
      nodes: [{ externalId: 'capacity', title: 'Bulk capacity' }],
    });
    expect(graph.nodes[0].title).toBe('Bulk capacity');
    expect(graph.diagram.collaboration!.activity.at(-1)).toMatchObject({
      authorId,
      kind: 'nodes.updated',
    });
    await repo.request(`/nodes/${graph.nodes[0].id}`, 'PATCH', {
      version: graph.nodes[0].version,
      title: 'API capacity',
    });
    const saved = await repo.getGraph(graph.diagram.id);
    expect(saved.nodes[0].title).toBe('API capacity');
    expect(saved.diagram.collaboration!.activity.at(-1)).toMatchObject({
      authorId,
      kind: 'nodes.updated',
    });
  });
  it('persists profiles, comments, tasks and history in the existing diagram record', async () => {
    const id = await profile();
    expect((await db.settings.get(documentProfilePreference(graph.diagram.id)))?.value).toBe(id);
    await action({ type: 'comment.create', nodeId: graph.nodes[0].id, text: 'Check demand' });
    await action({
      type: 'task.create',
      task: {
        nodeId: graph.nodes[0].id,
        title: 'Measure capacity',
        assigneeId: id,
        dueDate: '2026-11-01',
      },
    });
    const saved = structuredClone(graph.diagram.collaboration);
    db.close();
    await db.open();
    const inspected = (await repo.request(
      `/diagrams/${graph.diagram.id}/collaboration/document`,
      'GET',
    )) as { document: unknown; baseVersion: number };
    expect(inspected.document).toEqual(saved);
    expect(inspected.baseVersion).toBe(graph.diagram.version);
    expect(db.tables.map((table) => table.name)).not.toContain('collaborationDocuments');
  });
  it('restores enabled document work with native transaction settings available', async () => {
    await profile();
    await action({ type: 'comment.create', text: 'Keep this review' });
    const archived = await repo.history.create(graph.diagram.id, {
      name: 'Reviewed baseline',
      baseVersion: graph.diagram.version,
    });
    graph = await repo.saveGraph(
      { ...graph, nodes: graph.nodes.map((node) => ({ ...node, title: 'Changed' })) },
      graph.diagram.version,
    );
    const restored = await repo.history.restore(graph.diagram.id, archived.id, {
      baseVersion: graph.diagram.version,
    });
    expect(restored.graph.nodes[0].title).toBe('Capacity');
    expect(restored.graph.diagram.collaboration!.comments[0].messages[0].text).toBe(
      'Keep this review',
    );
    expect(await db.settings.get(documentProfilePreference(graph.diagram.id))).toBeDefined();
  });
  it('rejects stale and forged author/role writes without content changes', async () => {
    await profile();
    const version = graph.diagram.version;
    await action({ type: 'comment.create', text: 'Original' });
    const before = await repo.getGraph(graph.diagram.id);
    await expect(action({ type: 'comment.create', text: 'Stale' }, version)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      action({ type: 'comment.create', text: 'Forged', authorId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}/collaboration/actions`, 'POST', {
        baseVersion: graph.diagram.version,
        role: 'owner',
        action: { type: 'comment.create', text: 'Forged' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(before);
  });
  it('uses approved device context ahead of local profile preferences and refuses viewers', async () => {
    const ownerId = await profile();
    const editorId = await profile('Jamie');
    let role: 'editor' | 'viewer' = 'editor';
    cleanups.push(
      collaborationPermissions.bind(graph.diagram.id, {
        get role() {
          return role;
        },
        check() {},
        hasSharedChanges() {
          return true;
        },
        documentContext() {
          return { role, profileId: editorId, source: 'api' };
        },
      }),
    );
    await action({ type: 'comment.create', text: 'Editor author' });
    expect(graph.diagram.collaboration!.comments[0].authorId).toBe(editorId);
    expect(graph.diagram.collaboration!.comments[0].authorId).not.toBe(ownerId);
    role = 'viewer';
    await expect(
      action({
        type: 'comment.reply',
        id: graph.diagram.collaboration!.comments[0].id,
        text: 'Forbidden',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('retains orphan work and snapshots while native reimport remaps surviving nodes', async () => {
    await profile();
    const nodeId = graph.nodes[0].id;
    await action({ type: 'comment.create', nodeId, text: 'Node note' });
    await action({ type: 'task.create', task: { nodeId, title: 'Node task' } });
    const copy = await repo.importGraph(graph);
    expect(copy.diagram.id).not.toBe(graph.diagram.id);
    expect(copy.diagram.collaboration!.comments[0].nodeId).toBe(copy.nodes[0].id);
    expect(copy.diagram.collaboration!.tasks[0].nodeId).toBe(copy.nodes[0].id);
    const removed = { ...graph, nodes: [], edges: [] };
    const saved = await repo.saveGraph(removed, graph.diagram.version);
    expect(saved.diagram.collaboration!.tasks[0]).toMatchObject({ nodeId, nodeTitle: 'Capacity' });
    const orphanCopy = await repo.importGraph(saved);
    expect(orphanCopy.diagram.collaboration!.comments[0].nodeId).toBe(nodeId);
  });
  it('records semantic node edits once and keeps ordinary legacy diagrams annotation-free', async () => {
    const legacy = await repo.saveGraph(
      { ...graph, nodes: graph.nodes.map((node) => ({ ...node, title: 'Legacy edited' })) },
      graph.diagram.version,
    );
    expect(legacy.diagram.collaboration).toBeUndefined();
    graph = legacy;
    await profile();
    const originalCount = graph.diagram.collaboration!.activity.length;
    const moved = await repo.saveGraph(
      { ...graph, nodes: graph.nodes.map((node) => ({ ...node, x: 900 })) },
      graph.diagram.version,
    );
    expect(moved.diagram.collaboration!.activity).toHaveLength(originalCount);
    const renamed = await repo.saveGraph(
      { ...moved, nodes: moved.nodes.map((node) => ({ ...node, title: 'Reviewed' })) },
      moved.diagram.version,
    );
    expect(
      renamed.diagram.collaboration!.activity.filter((event) => event.kind === 'nodes.updated'),
    ).toHaveLength(1);
  });
  it('inherits document work for legacy graph PUT and rejects namespace replacement', async () => {
    await profile();
    await action({ type: 'comment.create', text: 'Keep this review' });
    const document = structuredClone(graph.diagram.collaboration);
    const legacy = structuredClone(graph);
    delete legacy.diagram.collaboration;
    legacy.nodes[0].title = 'Updated by an old client';
    const updated = (await repo.request(`/diagrams/${graph.diagram.id}/graph`, 'PUT', {
      baseVersion: graph.diagram.version,
      graph: legacy,
    })) as Graph;
    expect(updated.diagram.collaboration!.comments).toEqual(document!.comments);
    const tampered = structuredClone(updated);
    tampered.diagram.collaboration!.comments = [];
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}/graph`, 'PUT', {
        baseVersion: updated.diagram.version,
        graph: tampered,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}`, 'PATCH', {
        version: updated.diagram.version,
        collaboration: null,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect((await repo.getGraph(graph.diagram.id)).diagram.collaboration!.comments).toEqual(
      document!.comments,
    );
  });
  it('does not export or restore the private acting-profile selection', async () => {
    const id = await profile();
    const backup = await db.backup();
    expect(
      backup.settings.some((setting) => setting.key.startsWith('collaboration-profile:')),
    ).toBe(false);
    backup.settings.push({ key: documentProfilePreference(graph.diagram.id), value: id });
    const other = new WorkspaceDatabase(`restored-work-${crypto.randomUUID()}`);
    try {
      await new Repository(other).restore(backup);
      expect(await other.settings.get(documentProfilePreference(graph.diagram.id))).toBeUndefined();
      expect((await other.diagrams.toArray())[0].collaboration!.comments).toEqual(
        graph.diagram.collaboration!.comments,
      );
    } finally {
      await other.delete();
    }
  });
  it('refuses removal of a profile associated with an approved live device', async () => {
    await profile();
    const otherId = await profile('Jamie');
    cleanups.push(
      collaborationPermissions.bind(graph.diagram.id, {
        role: 'owner',
        check() {},
        hasSharedChanges() {
          return true;
        },
        activeProfileIds() {
          return [otherId];
        },
        documentContext() {
          return {
            role: 'owner',
            profileId: graph.diagram.collaboration!.profiles[0].id,
            source: 'ui',
          };
        },
      }),
    );
    await expect(action({ type: 'profile.remove', id: otherId })).rejects.toMatchObject({
      status: 409,
    });
  });
});
