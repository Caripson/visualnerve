import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blankGraph, type Graph } from '../src/model/types';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { encodeCollaborationUpdate } from '../src/collaboration/document/update-envelope';
import {
  mutateCollaboration,
  validateCollaboration,
  type CollaborationActionContext,
} from '../src/collaboration/model';

const documents: CollaborativeDocument[] = [];
afterEach(() => documents.splice(0).forEach((document) => document.destroy()));
const writer: CollaborationActionContext = {
  role: 'owner',
  source: 'ui',
  now: '2026-10-11T12:00:00.000Z',
};
const writable = { canWrite: true, assertActive() {} };
function fixture(): { graph: Graph; writer: CollaborationActionContext } {
  const graph = mutateCollaboration(
    blankGraph('Logical order'),
    { type: 'profile.create', profile: { name: 'Alex' } },
    writer,
  );
  return { graph, writer: { ...writer, profileId: graph.diagram.collaboration!.profiles[0].id } };
}
it('retains a newly appended event with an earlier writer clock across CRDT projection', () => {
  const f = fixture();
  const template = f.graph.diagram.collaboration!.activity[0];
  f.graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
    ...template,
    sequence: index + 1,
    id: crypto.randomUUID(),
  }));
  const document = new CollaborativeDocument(f.graph);
  documents.push(document);
  const changed = mutateCollaboration(
    f.graph,
    { type: 'comment.create', text: 'Newest logical event' },
    { ...f.writer, now: '2026-01-01T00:00:00.000Z' },
  );
  document.applyLocal(f.graph, changed, writable);
  const activity = document.graph(f.graph).diagram.collaboration!.activity;
  expect(activity).toHaveLength(500);
  expect(activity.at(-1)).toMatchObject({
    kind: 'comment.created',
    sequence: 501,
    timestamp: '2026-01-01T00:00:00.000Z',
  });
});
it('keeps a reply after its question even when the replying clock runs earlier', () => {
  const f = fixture();
  const graph = mutateCollaboration(
    f.graph,
    { type: 'comment.create', text: 'Question' },
    f.writer,
  );
  const id = graph.diagram.collaboration!.comments[0].id;
  const document = new CollaborativeDocument(graph);
  documents.push(document);
  const changed = mutateCollaboration(
    graph,
    { type: 'comment.reply', id, text: 'Answer' },
    { ...f.writer, now: '2026-01-01T00:00:00.000Z' },
  );
  document.applyLocal(graph, changed, writable);
  expect(
    document
      .graph(graph)
      .diagram.collaboration!.comments[0].messages.map((message) => message.text),
  ).toEqual(['Question', 'Answer']);
});

it('prunes by logical sequence when a portable document has an arbitrary array order', () => {
  const f = fixture();
  const template = f.graph.diagram.collaboration!.activity[0];
  f.graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
    ...template,
    sequence: 500 - index,
    id: crypto.randomUUID(),
  }));
  const changed = mutateCollaboration(
    f.graph,
    { type: 'comment.create', text: 'Append' },
    f.writer,
  );
  expect(changed.diagram.collaboration!.activity[0].sequence).toBe(2);
  expect(changed.diagram.collaboration!.activity.at(-1)?.sequence).toBe(501);
});

it('rejects absent, noninteger and unsafe message/activity logical counters', () => {
  const f = fixture();
  const graph = mutateCollaboration(
    f.graph,
    { type: 'comment.create', text: 'Question' },
    f.writer,
  );
  for (const invalid of [undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    for (const kind of ['message', 'activity']) {
      const document = structuredClone(graph.diagram.collaboration!);
      const record = kind === 'message' ? document.comments[0].messages[0] : document.activity[0];
      record.sequence = invalid as never;
      expect(() => validateCollaboration(document)).toThrow('sequence');
    }
  }
});

it('rejects unknown fields on activity excluded by retention without changing the live CRDT', () => {
  const f = fixture();
  const template = f.graph.diagram.collaboration!.activity[0];
  f.graph.diagram.collaboration!.activity = Array.from({ length: 500 }, (_, index) => ({
    ...template,
    sequence: index + 1,
    id: crypto.randomUUID(),
  }));
  const document = new CollaborativeDocument(f.graph);
  documents.push(document);
  const before = document.encodedState();
  const corrupt = new Y.Doc();
  try {
    Y.applyUpdate(corrupt, before);
    const vector = Y.encodeStateVector(corrupt);
    const id = crypto.randomUUID();
    const path = ['diagram', 'collaboration', 'activity', id];
    const fields = corrupt.getMap('fields');
    fields.set(JSON.stringify(path), ['object']);
    for (const [key, value] of Object.entries({
      ...template,
      id,
      sequence: 0,
      credentialId: 'excluded session field',
    }))
      fields.set(JSON.stringify([...path, key]), ['value', value]);
    expect(() =>
      document.prepareRemote(
        encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
        f.graph,
      ),
    ).toThrow();
    expect(document.encodedState()).toEqual(before);
    expect(document.graph(f.graph).diagram.collaboration!.activity).toHaveLength(500);
  } finally {
    corrupt.destroy();
  }
});

it('rejects unknown message fields beneath a removed thread ancestor without changing the live CRDT', () => {
  const f = fixture();
  const graph = mutateCollaboration(f.graph, { type: 'comment.create', text: 'Thread' }, f.writer);
  const thread = graph.diagram.collaboration!.comments[0];
  const document = new CollaborativeDocument(graph);
  documents.push(document);
  const before = document.encodedState();
  const corrupt = new Y.Doc();
  try {
    Y.applyUpdate(corrupt, before);
    const vector = Y.encodeStateVector(corrupt);
    const path = ['diagram', 'collaboration', 'comments', thread.id];
    const fields = corrupt.getMap('fields');
    fields.delete(JSON.stringify(path));
    fields.set(JSON.stringify([...path, 'messages', thread.messages[0].id, 'credentialId']), [
      'value',
      'excluded session field',
    ]);
    expect(() =>
      document.prepareRemote(
        encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
        graph,
      ),
    ).toThrow();
    expect(document.encodedState()).toEqual(before);
    expect(document.graph(graph).diagram.collaboration!.comments).toHaveLength(1);
  } finally {
    corrupt.destroy();
  }
});

it('rejects inherited-object names as document collections with 422 and unchanged CRDT state', () => {
  const f = fixture();
  const document = new CollaborativeDocument(f.graph);
  documents.push(document);
  const before = document.encodedState();
  for (const collection of ['constructor', 'toString']) {
    const corrupt = new Y.Doc();
    try {
      Y.applyUpdate(corrupt, before);
      const vector = Y.encodeStateVector(corrupt);
      corrupt
        .getMap('fields')
        .set(JSON.stringify(['diagram', 'collaboration', collection]), ['object']);
      let failure: unknown;
      try {
        document.prepareRemote(
          encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
          f.graph,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ status: 422 });
      expect(document.encodedState()).toEqual(before);
    } finally {
      corrupt.destroy();
    }
  }
});
