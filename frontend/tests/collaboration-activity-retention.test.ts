import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blankGraph, type Graph } from '../src/model/types';
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
  let graph = blankGraph('Activity retention', 'flowchart');
  for (const name of ['Alex', 'Jamie'])
    graph = mutateCollaboration(graph, { type: 'profile.create', profile: { name } }, owner);
  const [left, right] = graph.diagram.collaboration!.profiles.map((profile) => ({
    ...owner,
    profileId: profile.id,
  }));
  const template = graph.diagram.collaboration!.activity[0];
  graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
    ...template,
    id: crypto.randomUUID(),
    sequence: index + 1,
  }));
  const a = new CollaborativeDocument(graph);
  const b = new CollaborativeDocument(graph, a.scope, a.encodedState());
  opened.push(a, b);
  return { graph, a, b, left, right };
}

function rawActivityEntities(state: Uint8Array): number {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return [...doc.getMap('fields').keys()].filter((key) => {
      const path = JSON.parse(key) as string[];
      return (
        path.length === 4 &&
        path[0] === 'diagram' &&
        path[1] === 'collaboration' &&
        path[2] === 'activity'
      );
    }).length;
  } finally {
    doc.destroy();
  }
}

function append(graph: Graph, context: CollaborationActionContext, text: string) {
  return mutateCollaboration(graph, { type: 'comment.create', text }, context);
}

describe('shared activity path retention', () => {
  it('prunes clipped raw entries after repeated concurrent appends only when the save commits', () => {
    const { a, b, left, right, graph: initial } = fixture();
    let graph = initial;
    for (let round = 0; round < 3; round++) {
      const current = a.graph(graph);
      const oneGraph = append(current, left, `Alex ${round}`);
      const twoGraph = append(current, right, `Jamie ${round}`);
      const one = a.applyLocal(current, oneGraph, writable);
      const two = b.applyLocal(current, twoGraph, writable);
      a.applyRemote(two.update, oneGraph);
      b.applyRemote(one.update, twoGraph);
      graph = a.graph(graph);
      expect(graph).toEqual(b.graph(graph));
      expect(graph.diagram.collaboration!.activity).toHaveLength(500);
      expect(rawActivityEntities(a.encodedState())).toBeGreaterThan(500);
    }

    const acceptedState = a.encodedState();
    const current = a.graph(graph);
    const next = append(current, left, 'Single follow-up');
    const prepared = a.prepareLocal(current, next, writable);
    expect(a.encodedState()).toEqual(acceptedState);
    expect(rawActivityEntities(prepared.state)).toBe(500);
    expect(prepared.graph.diagram.collaboration!.activity).toHaveLength(500);

    prepared.commit();
    b.applyRemote(prepared.update, current);
    expect(a.graph(graph)).toEqual(b.graph(graph));
    expect(rawActivityEntities(a.encodedState())).toBe(500);
    expect(rawActivityEntities(b.encodedState())).toBe(500);
    const reloaded = new CollaborativeDocument(a.graph(graph), a.scope, a.encodedState());
    opened.push(reloaded);
    expect(reloaded.graph(graph)).toEqual(a.graph(graph));
  });

  it('retains newer peer activity when pruning a save prepared from an older graph baseline', () => {
    const { a, b, left, right, graph } = fixture();
    const localRequest = append(graph, left, 'Local request');
    const peerGraph = append(graph, right, 'Unseen peer request');
    const peer = b.applyLocal(graph, peerGraph, writable);
    a.applyRemote(peer.update, graph);
    const peerEvent = peerGraph.diagram.collaboration!.activity.find(
      (event) => event.entityId === peerGraph.diagram.collaboration!.comments[0].id,
    )!;

    const acceptedState = a.encodedState();
    const prepared = a.prepareLocal(graph, localRequest, writable);
    expect(a.encodedState()).toEqual(acceptedState);
    expect(
      prepared.graph.diagram.collaboration!.activity.some((event) => event.id === peerEvent.id),
    ).toBe(true);
    expect(rawActivityEntities(prepared.state)).toBe(500);
    prepared.commit();
    b.applyRemote(prepared.update, peerGraph);
    expect(a.graph(graph)).toEqual(b.graph(graph));
    expect(
      a.graph(graph).diagram.collaboration!.activity.some((event) => event.id === peerEvent.id),
    ).toBe(true);
  });
});
