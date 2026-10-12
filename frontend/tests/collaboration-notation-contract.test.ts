import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { StorageError } from '../src/model/errors';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { encodeCollaborationUpdate } from '../src/collaboration/document/update-envelope';

const writable = { canWrite: true, assertActive() {} };
const documents: CollaborativeDocument[] = [];
afterEach(() => {
  for (const document of documents.splice(0)) document.destroy();
});
function fixture() {
  const graph = blankGraph('Notation collaboration');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Order' }),
    newNode(graph.diagram.id, { title: 'Line' }),
  ];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  return graph;
}
function document(graph: Graph, state?: Uint8Array, protectedWorkflow = false) {
  const result = new CollaborativeDocument(graph, undefined, state, protectedWorkflow);
  documents.push(result);
  return result;
}
function contract(document: CollaborativeDocument) {
  const raw = new Y.Doc();
  try {
    Y.applyUpdate(raw, document.encodedState());
    return raw.getMap('contract').toJSON() as Record<string, unknown>;
  } finally {
    raw.destroy();
  }
}
function notationGraph() {
  const graph = fixture();
  graph.diagram.notation = { schemaVersion: 1, collection: 'uml', diagramKind: 'class' };
  graph.nodes[0].notation = { collection: 'uml', symbol: 'class' };
  graph.edges[0].notation = {
    collection: 'uml',
    symbol: 'association',
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
  };
  return graph;
}
function forgedUpdate(document: CollaborativeDocument, modify: (raw: Y.Doc) => void) {
  const raw = new Y.Doc();
  try {
    Y.applyUpdate(raw, document.encodedState());
    const vector = Y.encodeStateVector(raw);
    modify(raw);
    return {
      update: encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(raw, vector)),
      state: Y.encodeStateAsUpdate(raw),
    };
  } finally {
    raw.destroy();
  }
}

describe('pinned notation collaboration contract', () => {
  it.each(['diagram', 'node', 'edge'] as const)(
    'requires version3 when the initial %s contains notation',
    (kind) => {
      const graph = fixture();
      const source = notationGraph();
      if (kind === 'diagram') graph.diagram.notation = source.diagram.notation;
      if (kind === 'node') graph.nodes[0].notation = source.nodes[0].notation;
      if (kind === 'edge') graph.edges[0].notation = source.edges[0].notation;
      for (const protectedWorkflow of [false, true]) {
        const owner = document(graph, undefined, protectedWorkflow);
        const value = contract(owner);
        expect(value.version).toBe(3);
        expect(value.workflowAuthority).toBe(protectedWorkflow ? 'owner' : undefined);
        // Pre-notation clients require exactly v1 or protected v2 and therefore
        // reject this snapshot before their graph projection or persistence.
        expect(value.version).not.toBe(protectedWorkflow ? 2 : 1);
        const peer = document(graph, owner.encodedState(), protectedWorkflow);
        expect(peer.graph(graph)).toEqual(owner.graph(graph));
      }
    },
  );

  it.each([false, true])(
    'keeps the old contract until a new room is created (protected=%s)',
    (protectedWorkflow) => {
      const graph = fixture();
      const owner = document(graph, undefined, protectedWorkflow);
      expect(contract(owner).version).toBe(protectedWorkflow ? 2 : 1);
      const original = owner.encodedState();
      for (const kind of ['diagram', 'node', 'edge'] as const) {
        const next = structuredClone(graph);
        if (kind === 'diagram') next.diagram.notation = notationGraph().diagram.notation;
        if (kind === 'node') next.nodes[0].notation = notationGraph().nodes[0].notation;
        if (kind === 'edge') next.edges[0].notation = notationGraph().edges[0].notation;
        expect(() => owner.prepareLocal(graph, next, writable)).toThrow(
          expect.objectContaining({ code: 'COLLABORATION_NOTATION_REQUIRED', status: 409 }),
        );
        expect(
          () => new CollaborativeDocument(next, owner.scope, original, protectedWorkflow),
        ).toThrow('Refresh all participants');
        expect(() => owner.graph(next)).toThrow('older document contract');
        expect(owner.encodedState()).toEqual(original);
        const fresh = document(next, undefined, protectedWorkflow);
        expect(contract(fresh).version).toBe(3);
      }
      const ordinary = structuredClone(graph);
      ordinary.nodes[0].title = 'Ordinary edits still work';
      owner.applyLocal(graph, ordinary, writable);
      expect(owner.graph(ordinary).nodes.find((node) => node.id === graph.nodes[0].id)!.title).toBe(
        'Ordinary edits still work',
      );
    },
  );

  it('rejects remote notation and contract upgrades on a legacy room without changing state', () => {
    const graph = fixture();
    const owner = document(graph, undefined, true);
    const original = owner.encodedState();
    const originalGraph = owner.graph(graph);
    const injected = forgedUpdate(owner, (raw) => {
      const fields = raw.getMap('fields');
      fields.set(JSON.stringify(['nodes', graph.nodes[0].id, 'notation']), ['object']);
      fields.set(JSON.stringify(['nodes', graph.nodes[0].id, 'notation', 'collection']), [
        'value',
        'uml',
      ]);
      fields.set(JSON.stringify(['nodes', graph.nodes[0].id, 'notation', 'symbol']), [
        'value',
        'class',
      ]);
    });
    expect(() => owner.prepareRemote(injected.update, graph)).toThrow(
      expect.objectContaining({ code: 'COLLABORATION_NOTATION_REQUIRED', status: 409 }),
    );
    expect(() => owner.mergeNativeSnapshot(injected.state, graph)).toThrow(
      'older document contract',
    );
    const upgraded = forgedUpdate(owner, (raw) => raw.getMap('contract').set('version', 3));
    expect(() => owner.prepareRemote(upgraded.update, graph)).toThrow(
      expect.objectContaining({ code: 'COLLABORATION_DOCUMENT_VERSION', status: 409 }),
    );
    expect(() => owner.mergeNativeSnapshot(upgraded.state, graph)).toThrow('contract changed');
    expect(owner.encodedState()).toEqual(original);
    expect(owner.graph(graph)).toEqual(originalGraph);
  });

  it('preserves concurrent notation and title edits and reloads cleared v3 state', () => {
    const graph = notationGraph();
    graph.nodes[0].metadata = { privateEvidence: 'Local source' };
    const owner = document(graph, undefined, true);
    const peer = document(graph, owner.encodedState(), true);
    const shaped = structuredClone(graph);
    shaped.nodes[0].notation!.properties = { abstract: true };
    const titled = structuredClone(graph);
    titled.nodes[0].title = 'Order domain';
    const left = owner.applyLocal(graph, shaped, writable);
    const right = peer.applyLocal(graph, titled, writable);
    owner.applyRemote(right.update, shaped);
    peer.applyRemote(left.update, titled);
    const merged = owner.graph(graph);
    expect(merged).toEqual(peer.graph(graph));
    expect(merged.nodes.find((node) => node.id === graph.nodes[0].id)).toMatchObject({
      title: 'Order domain',
      notation: { collection: 'uml', symbol: 'class', properties: { abstract: true } },
      metadata: { privateEvidence: 'Local source' },
    });
    const cleared = structuredClone(merged);
    delete cleared.diagram.notation;
    for (const node of cleared.nodes) delete node.notation;
    for (const edge of cleared.edges) delete edge.notation;
    peer.applyRemote(owner.applyLocal(merged, cleared, writable).update, merged);
    expect(contract(owner).version).toBe(3);
    expect(peer.graph(cleared)).toEqual(owner.graph(cleared));
    const rejoined = document(cleared, owner.encodedState(), true);
    expect(contract(rejoined).version).toBe(3);
    const next = structuredClone(cleared);
    next.nodes[1].notation = {
      collection: 'bpmn',
      symbol: 'task',
      properties: { taskType: 'user' },
    };
    rejoined.applyLocal(cleared, next, writable);
    expect(
      rejoined.graph(next).nodes.find((node) => node.id === next.nodes[1].id)!.notation,
    ).toEqual(next.nodes[1].notation);
  });

  it('retains viewer, revoked-lease and owner workflow boundaries for v3', () => {
    const graph = notationGraph();
    const owner = document(graph, undefined, true);
    const before = owner.encodedState();
    const next = structuredClone(graph);
    next.nodes[0].title = 'Changed';
    expect(() => owner.prepareLocal(graph, next, { ...writable, canWrite: false })).toThrow(
      expect.objectContaining({ code: 'COLLABORATION_READ_ONLY', status: 403 }),
    );
    expect(() =>
      owner.prepareLocal(graph, next, {
        canWrite: true,
        assertActive() {
          throw new StorageError(423, 'Workspace locked');
        },
      }),
    ).toThrow('Workspace locked');
    const forged = forgedUpdate(owner, (raw) => {
      raw
        .getMap('fields')
        .set('["diagram","collaboration","profiles","forged","name"]', ['value', 'Forged']);
    });
    expect(() => owner.prepareRemote(forged.update, graph)).toThrow('private field');
    const authority = forgedUpdate(owner, (raw) =>
      raw.getMap('contract').set('workflowAuthority', 'editor'),
    );
    expect(() => owner.prepareRemote(authority.update, graph)).toThrow('sharing scope');
    expect(
      () => new CollaborativeDocument(graph, owner.scope, owner.encodedState(), false),
    ).toThrow('sharing scope');
    const unknown = forgedUpdate(owner, (raw) => raw.getMap('contract').set('version', 99));
    expect(() => new CollaborativeDocument(graph, owner.scope, unknown.state, true)).toThrow(
      expect.objectContaining({ code: 'COLLABORATION_DOCUMENT_VERSION', status: 409 }),
    );
    const downgrade = forgedUpdate(owner, (raw) => raw.getMap('contract').set('version', 2));
    expect(() => owner.prepareRemote(downgrade.update, graph)).toThrow('contract changed');
    expect(() => owner.mergeNativeSnapshot(downgrade.state, graph)).toThrow('contract changed');
    expect(owner.encodedState()).toEqual(before);
  });
});
