import { afterEach, describe, expect, it } from 'vitest';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { mutateCollaboration, type CollaborationActionContext } from '../src/collaboration/model';
const opened: CollaborativeDocument[] = [];
afterEach(() => opened.splice(0).forEach((document) => document.destroy()));
const owner: CollaborationActionContext = {
  role: 'owner',
  source: 'ui',
  now: '2026-10-11T10:00:00.000Z',
};
const writable = { canWrite: true, assertActive() {} };
function fixture() {
  let graph = blankGraph('Workflow', 'flowchart');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Review' })];
  graph = mutateCollaboration(graph, { type: 'profile.create', profile: { name: 'Alex' } }, owner);
  graph = mutateCollaboration(graph, { type: 'profile.create', profile: { name: 'Jamie' } }, owner);
  const [left, right] = ['Alex', 'Jamie'].map((name) => ({
    ...owner,
    profileId: graph.diagram.collaboration!.profiles.find((profile) => profile.name === name)!.id,
  }));
  return { graph, left, right };
}
function peers(graph: Graph) {
  const a = new CollaborativeDocument(graph);
  const b = new CollaborativeDocument(graph, a.scope, a.encodedState());
  opened.push(a, b);
  return { a, b };
}
function merge(graph: Graph, left: Graph, right: Graph) {
  const { a, b } = peers(graph);
  const one = a.applyLocal(graph, left, writable);
  const two = b.applyLocal(graph, right, writable);
  a.applyRemote(two.update, left);
  b.applyRemote(one.update, right);
  expect(a.graph(graph)).toEqual(b.graph(graph));
  return a.graph(graph);
}
describe('concurrent document work', () => {
  it('retains simultaneous independently authored comments and activity', () => {
    const { graph, left, right } = fixture();
    const one = mutateCollaboration(
      graph,
      { type: 'comment.create', nodeId: graph.nodes[0].id, text: 'Check capacity' },
      left,
    );
    const two = mutateCollaboration(graph, { type: 'comment.create', text: 'Check cost' }, right);
    const result = merge(graph, one, two).diagram.collaboration!;
    expect(
      result.comments.flatMap((thread) => thread.messages.map((message) => message.text)).sort(),
    ).toEqual(['Check capacity', 'Check cost']);
    expect(result.activity.filter((event) => event.kind === 'comment.created')).toHaveLength(2);
  });
  it('retains simultaneous replies inside the same thread', () => {
    const f = fixture();
    const graph = mutateCollaboration(
      f.graph,
      { type: 'comment.create', text: 'Review this' },
      f.left,
    );
    const id = graph.diagram.collaboration!.comments[0].id;
    const one = mutateCollaboration(
      graph,
      { type: 'comment.reply', id, text: 'Capacity ready' },
      f.left,
    );
    const two = mutateCollaboration(
      graph,
      { type: 'comment.reply', id, text: 'Cost ready' },
      f.right,
    );
    const result = merge(graph, one, two).diagram.collaboration!;
    expect(result.comments[0].messages.map((message) => message.text).sort()).toEqual([
      'Capacity ready',
      'Cost ready',
      'Review this',
    ]);
  });
  it('converges concurrent own-message removals to an absent thread across replay and reload', () => {
    const f = fixture();
    const left: CollaborationActionContext = { ...f.left, role: 'editor' };
    const right: CollaborationActionContext = { ...f.right, role: 'editor' };
    let graph = mutateCollaboration(f.graph, { type: 'comment.create', text: 'Alex' }, left);
    const id = graph.diagram.collaboration!.comments[0].id;
    graph = mutateCollaboration(graph, { type: 'comment.reply', id, text: 'Jamie' }, right);
    const [alex, jamie] = graph.diagram.collaboration!.comments[0].messages;
    const one = mutateCollaboration(
      graph,
      { type: 'comment.remove', id, messageId: alex.id },
      left,
    );
    const two = mutateCollaboration(
      graph,
      { type: 'comment.remove', id, messageId: jamie.id },
      right,
    );
    expect(
      one.diagram.collaboration!.comments[0].messages.map((message) => message.authorId),
    ).toEqual([right.profileId]);
    expect(
      two.diagram.collaboration!.comments[0].messages.map((message) => message.authorId),
    ).toEqual([left.profileId]);
    const { a, b } = peers(graph);
    const first = a.applyLocal(graph, one, writable);
    const second = b.applyLocal(graph, two, writable);
    a.applyRemote(second.update, one);
    b.applyRemote(first.update, two);
    const merged = a.graph(graph);
    expect(merged).toEqual(b.graph(graph));
    expect(merged.diagram.collaboration!.comments).toEqual([]);
    expect(
      merged.diagram.collaboration!.activity.filter((event) => event.kind === 'comment.removed'),
    ).toHaveLength(2);
    // Duplicate delivery and reloading retain the deletion outcome.
    a.applyRemote(second.update, merged);
    b.applyRemote(first.update, merged);
    expect(a.graph(graph).diagram.collaboration!.comments).toEqual([]);
    expect(b.graph(graph)).toEqual(a.graph(graph));
    const reloaded = new CollaborativeDocument(merged, a.scope, a.encodedState());
    opened.push(reloaded);
    expect(reloaded.graph(merged)).toEqual(merged);
  });
  it('keeps an explicit thread removal dominant over a concurrent reply', () => {
    const f = fixture();
    const graph = mutateCollaboration(f.graph, { type: 'comment.create', text: 'Thread' }, f.left);
    const id = graph.diagram.collaboration!.comments[0].id;
    const removed = mutateCollaboration(graph, { type: 'comment.remove', id }, f.left);
    const reply = mutateCollaboration(
      graph,
      { type: 'comment.reply', id, text: 'Concurrent reply' },
      { ...f.right, role: 'editor' },
    );
    expect(merge(graph, removed, reply).diagram.collaboration!.comments).toEqual([]);
  });
  it('merges separate task fields without overwriting the other editor', () => {
    const f = fixture();
    const graph = mutateCollaboration(
      f.graph,
      { type: 'task.create', task: { nodeId: f.graph.nodes[0].id, title: 'Review capacity' } },
      f.left,
    );
    const id = graph.diagram.collaboration!.tasks[0].id;
    const one = mutateCollaboration(
      graph,
      { type: 'task.update', id, patch: { assigneeId: f.right.profileId } },
      f.left,
    );
    const two = mutateCollaboration(
      graph,
      { type: 'task.update', id, patch: { status: 'in-progress' } },
      f.right,
    );
    expect(merge(graph, one, two).diagram.collaboration!.tasks[0]).toMatchObject({
      assigneeId: f.right.profileId,
      status: 'in-progress',
    });
  });
  it('bounds converged concurrent history to 500 entries', () => {
    const { graph, left, right } = fixture();
    const template = graph.diagram.collaboration!.activity[0];
    graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
      ...template,
      id: crypto.randomUUID(),
      timestamp: new Date(Date.parse(owner.now!) + index).toISOString(),
    }));
    const one = mutateCollaboration(
      graph,
      { type: 'comment.create', text: 'One' },
      { ...left, now: '2026-10-11T11:00:00.000Z' },
    );
    const two = mutateCollaboration(
      graph,
      { type: 'comment.create', text: 'Two' },
      { ...right, now: '2026-10-11T11:00:00.000Z' },
    );
    const result = merge(graph, one, two).diagram.collaboration!;
    expect(result.activity).toHaveLength(500);
    expect(result.activity.filter((event) => event.kind === 'comment.created')).toHaveLength(2);
  });
});
