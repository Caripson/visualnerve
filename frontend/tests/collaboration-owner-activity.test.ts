import { afterEach, beforeEach, expect, it } from 'vitest';
import { blankGraph, newNode, type Graph, type Owner } from '../src/model/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { collaborationPermissions } from '../src/collaboration/access';

let db: WorkspaceDatabase;
let repo: Repository;
let graph: Graph;
let owner: Owner;
let profileId: string;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  db = new WorkspaceDatabase(`owner-activity-${crypto.randomUUID()}`);
  repo = new Repository(db);
  owner = await repo.owner({ name: 'Responsibility owner' });
  graph = blankGraph('Owner feed');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'One', ownerIds: [owner.id] }),
    newNode(graph.diagram.id, { title: 'Two', ownerIds: [owner.id] }),
  ];
  graph.owners = [owner];
  graph = await repo.saveGraph(graph, 0);
  graph = await repo.request<Graph>(`/diagrams/${graph.diagram.id}/collaboration/actions`, 'POST', {
    baseVersion: graph.diagram.version,
    action: { type: 'profile.create', profile: { name: 'Document participant' } },
  });
  profileId = graph.diagram.collaboration!.profiles[0].id;
});
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  await db.delete();
});

it('records one generic actor-bound event per affected enabled diagram and leaves legacy diagrams disabled', async () => {
  let legacy = blankGraph('Legacy');
  legacy.nodes = [newNode(legacy.diagram.id, { title: 'Legacy node', ownerIds: [owner.id] })];
  legacy.owners = [owner];
  legacy = await repo.saveGraph(legacy, 0);
  const count = graph.diagram.collaboration!.activity.length;
  await repo.owner(
    {
      version: owner.version,
      name: 'Private renamed responsibility',
      metadata: { email: 'private@example.invalid' },
    },
    owner.id,
  );
  const saved = await repo.getGraph(graph.diagram.id);
  expect(saved.diagram.version).toBe(graph.diagram.version + 1);
  expect(saved.diagram.collaboration!.activity).toHaveLength(count + 1);
  const event = saved.diagram.collaboration!.activity.at(-1)!;
  expect(event).toMatchObject({
    kind: 'owners.updated',
    authorId: profileId,
    source: 'api',
    summary: 'Diagram responsibility owners updated.',
  });
  expect(JSON.stringify(event)).not.toContain('Private renamed');
  expect(JSON.stringify(event)).not.toContain('private@example.invalid');
  expect((await repo.getGraph(legacy.diagram.id)).diagram.collaboration).toBeUndefined();
});

it('does not add semantic activity for a no-op responsibility owner patch', async () => {
  await repo.owner({ version: owner.version, name: owner.name }, owner.id);
  expect((await repo.getGraph(graph.diagram.id)).diagram.collaboration!.activity).toEqual(
    graph.diagram.collaboration!.activity,
  );
});

it('records responsibility deletion in the same diagram update that removes all references', async () => {
  await repo.request(`/owners/${owner.id}`, 'DELETE');
  const saved = await repo.getGraph(graph.diagram.id);
  expect(saved.nodes.every((node) => !node.ownerIds.length)).toBe(true);
  expect(saved.owners).toEqual([]);
  expect(saved.diagram.collaboration!.activity).toHaveLength(
    graph.diagram.collaboration!.activity.length + 1,
  );
  expect(saved.diagram.collaboration!.activity.at(-1)).toMatchObject({
    kind: 'owners.updated',
    authorId: profileId,
  });
});

it('retains the highest 500 logical events when a responsibility update appends history', async () => {
  const template = graph.diagram.collaboration!.activity[0];
  graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
    ...template,
    id: crypto.randomUUID(),
    sequence: index + 1,
  }));
  graph = await repo.saveGraph(graph, graph.diagram.version);
  await repo.owner({ version: owner.version, name: 'Changed' }, owner.id);
  const activity = (await repo.getGraph(graph.diagram.id)).diagram.collaboration!.activity;
  expect(activity).toHaveLength(500);
  expect(activity[0].sequence).toBe(2);
  expect(activity.at(-1)).toMatchObject({ sequence: 501, kind: 'owners.updated' });
});

it('does not change the owner, diagram or feed when a write guard rejects the transaction', async () => {
  await expect(
    repo.owner({ version: owner.version, name: 'Rejected' }, owner.id, async (scope) => {
      await scope.settings.put({ key: 'owner-activity-guard', value: 'rollback' });
      throw new Error('Grant revoked');
    }),
  ).rejects.toThrow('Grant revoked');
  expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  expect(await db.owners.get(owner.id)).toEqual(owner);
  expect(await db.settings.get('owner-activity-guard')).toBeUndefined();
});

it('keeps referenced live-room owner changes blocked before adding activity', async () => {
  cleanups.push(
    collaborationPermissions.bind(graph.diagram.id, {
      role: 'owner',
      check() {},
      hasSharedChanges() {
        return true;
      },
    }),
  );
  await expect(
    repo.owner({ version: owner.version, name: 'Blocked' }, owner.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(repo.request(`/owners/${owner.id}`, 'DELETE')).rejects.toMatchObject({
    status: 409,
  });
  expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
});
