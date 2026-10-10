import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { base, blankGraph, newNode, newEdge, type Graph } from '../src/model/types';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { createSimulationGraph } from '../src/simulation/document';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { sharedGraph } from '../src/collaboration/document/scope';
import {
  decodeCollaborationUpdate,
  encodeCollaborationUpdate,
} from '../src/collaboration/document/update-envelope';

const writable = { canWrite: true, assertActive() {} };
const documents: CollaborativeDocument[] = [];
afterEach(() => {
  for (const document of documents.splice(0)) document.destroy();
});
function graph() {
  const value = blankGraph('Collaborative architecture', 'flowchart');
  value.nodes = [
    newNode(value.diagram.id, { title: 'Orders' }),
    newNode(value.diagram.id, { title: 'Delivery', x: 300 }),
  ];
  value.edges = [newEdge(value.diagram.id, value.nodes[0].id, value.nodes[1].id)];
  return value;
}
function peers(
  value = graph(),
  scope = { shareMetadata: false, shareOwners: false, shareDatasets: false },
) {
  const a = new CollaborativeDocument(value, scope);
  const b = new CollaborativeDocument(value, scope, a.encodedState());
  documents.push(a, b);
  return { a, b, value };
}
function edit(value: Graph, patch: (value: Graph) => void) {
  const next = structuredClone(value);
  patch(next);
  return next;
}

describe('one semantic CRDT document', () => {
  it('merges simultaneous title and position edits without overwriting either field', () => {
    const { a, b, value } = peers();
    const title = edit(value, (graph) => {
      graph.nodes[0].title = 'Order acceptance';
    });
    const moved = edit(value, (graph) => {
      graph.nodes[0].x = 750;
    });
    const left = a.applyLocal(value, title, writable);
    const right = b.applyLocal(value, moved, writable);
    a.applyRemote(right.update, title);
    b.applyRemote(left.update, moved);
    expect(a.graph(value)).toEqual(b.graph(value));
    expect(a.graph(value).nodes.find((node) => node.id === value.nodes[0].id)).toMatchObject({
      title: 'Order acceptance',
      x: 750,
    });
  });
  it('accepts duplicate/out-of-order causal updates and converges after reconnect', () => {
    const { a, b, value } = peers();
    const first = edit(value, (graph) => {
      graph.nodes[0].title = 'First edit';
    });
    const one = a.applyLocal(value, first, writable);
    const second = edit(first, (graph) => {
      graph.nodes[1].description = 'Second edit';
    });
    const two = a.applyLocal(first, second, writable);
    expect(() => b.applyRemote(two.update, value)).toThrow('earlier shared update');
    b.applyRemote(one.update, value);
    b.applyRemote(two.update, value);
    b.applyRemote(one.update, value);
    b.applyRemote(a.diff(b.stateVector()), value);
    expect(b.graph(value)).toEqual(a.graph(value));
  });
  it('rebases a stale local edit onto already received changes using field deltas', () => {
    const { a, b, value } = peers();
    const remote = edit(value, (graph) => {
      graph.nodes[0].description = 'Remote description';
    });
    b.applyRemote(a.applyLocal(value, remote, writable).update, value);
    const stale = edit(value, (graph) => {
      graph.nodes[0].title = 'Local title';
    });
    b.applyLocal(value, stale, writable);
    expect(b.graph(value).nodes.find((node) => node.id === value.nodes[0].id)).toMatchObject({
      title: 'Local title',
      description: 'Remote description',
    });
  });
  it('keeps private clocks, camera, local folder, owners and source evidence off the wire', () => {
    const value = graph();
    value.diagram.folder = 'Private customer name';
    value.diagram.settings.viewport = { x: 999, y: 888, zoom: 2 };
    value.diagram.settings.spatialView = {
      version: 1,
      mode: '3d',
      camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
    };
    const owner = {
      ...base(),
      name: 'Private owner',
      email: 'private@example.com',
      kind: 'person' as const,
      color: '#31766c',
      metadata: {},
    };
    value.owners = [owner];
    value.nodes[0].ownerIds = [owner.id];
    value.nodes[0].metadata = { sourceEvidence: 'Private source file content' };
    const { a, b } = peers(value);
    const payload = JSON.stringify(sharedGraph(value, a.scope));
    expect(payload).not.toMatch(
      /Private owner|private@example|Private source|Private customer|createdAt|updatedAt|viewport|camera/,
    );
    const view = edit(value, (graph) => {
      graph.diagram.settings.viewport = { x: 5, y: 6, zoom: 1 };
      graph.diagram.version = 87;
    });
    const next = edit(value, (graph) => {
      graph.nodes[0].title = 'Shared title';
    });
    b.applyRemote(a.applyLocal(value, next, writable).update, view);
    expect(b.graph(view).diagram.settings.viewport).toEqual(view.diagram.settings.viewport);
    expect(b.graph(view).diagram.version).toBe(87);
    expect(b.graph(view).nodes.find((node) => node.id === value.nodes[0].id)?.ownerIds).toEqual([
      owner.id,
    ]);
  });
  it('requires explicit raw-data opt-in and restores a visual-only CSV document without a source', () => {
    const dataset = parseCsv('Category,Private\nA,secret-row-value', 'private.csv');
    const value = csvGraph(dataset, defaultAnalysis(dataset));
    const { a } = peers(value);
    expect(JSON.stringify(sharedGraph(value, a.scope))).not.toContain('secret-row-value');
    const recipient = blankGraph(value.diagram.name, value.diagram.type);
    recipient.diagram.id = value.diagram.id;
    const received = new CollaborativeDocument(recipient, a.scope, a.encodedState());
    documents.push(received);
    expect(received.graph(recipient).dataset).toBeUndefined();
    expect(received.graph(recipient).nodes.length).toBe(value.nodes.length);
    const opted = new CollaborativeDocument(value, {
      shareMetadata: false,
      shareOwners: false,
      shareDatasets: true,
    });
    documents.push(opted);
    expect(JSON.stringify(sharedGraph(value, opted.scope))).toContain('secret-row-value');
  });
  it('shares only referenced owner profiles after a human opt-in', () => {
    const value = graph();
    const owner = (name: string) => ({
      ...base(),
      name,
      kind: 'person' as const,
      color: '#31766c',
      metadata: {},
    });
    value.owners = [owner('Assigned reviewer'), owner('Unrelated private profile')];
    value.nodes[0].ownerIds = [value.owners[0].id];
    const { a } = peers(value, { shareMetadata: false, shareOwners: true, shareDatasets: false });
    expect(a.graph(value).owners.map((owner) => owner.name)).toEqual(['Assigned reviewer']);
    expect(JSON.stringify(sharedGraph(value, a.scope))).not.toContain('Unrelated private profile');
  });
  it('stages remote persistence before publication and rejects invalid updates atomically', () => {
    const { a, b, value } = peers();
    const next = edit(value, (graph) => {
      graph.nodes[0].title = 'After durable commit';
    });
    const accepted = b.prepareRemote(a.applyLocal(value, next, writable).update, value);
    expect(b.graph(value).nodes.find((node) => node.id === value.nodes[0].id)?.title).toBe(
      'Orders',
    );
    accepted.commit();
    expect(b.graph(value).nodes.find((node) => node.id === value.nodes[0].id)?.title).toBe(
      'After durable commit',
    );
    const before = b.encodedState();
    const corrupt = new Y.Doc();
    Y.applyUpdate(corrupt, before);
    const vector = Y.encodeStateVector(corrupt);
    corrupt
      .getMap('fields')
      .set(JSON.stringify(['nodes', value.nodes[0].id, 'width']), ['value', -3]);
    expect(() =>
      b.prepareRemote(
        encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
        value,
      ),
    ).toThrow();
    expect(b.encodedState()).toEqual(before);
    corrupt.destroy();
  });
  it('rejects injected private camera fields and a changed document sharing contract', () => {
    const { a, value } = peers();
    const corrupt = new Y.Doc();
    Y.applyUpdate(corrupt, a.encodedState());
    const vector = Y.encodeStateVector(corrupt);
    corrupt
      .getMap('fields')
      .set(JSON.stringify(['diagram', 'settings', 'viewport']), ['value', { x: 1, y: 2, zoom: 1 }]);
    expect(() =>
      a.applyRemote(
        encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
        value,
      ),
    ).toThrow('private field');
    corrupt
      .getMap('contract')
      .set('scope', { shareMetadata: true, shareOwners: false, shareDatasets: false });
    expect(() =>
      a.applyRemote(
        encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
        value,
      ),
    ).toThrow('sharing scope');
    corrupt.destroy();
  });
  it('prevents stale staged commits and revoked or viewer writes', () => {
    const { a, value } = peers();
    const next = edit(value, (graph) => {
      graph.nodes[0].title = 'Edit';
    });
    expect(() => a.prepareLocal(value, next, { ...writable, canWrite: false })).toThrow(
      'viewing access',
    );
    const pending = a.prepareLocal(value, next, writable);
    a.applyLocal(
      value,
      edit(value, (graph) => {
        graph.nodes[1].x = 500;
      }),
      writable,
    );
    expect(() => pending.commit()).toThrow('changed while saving');
    let active = true;
    const revoked = a.prepareLocal(value, next, {
      canWrite: true,
      assertActive() {
        if (!active) throw new Error('locked');
      },
    });
    active = false;
    expect(() => revoked.commit()).toThrow('locked');
    a.destroy();
    expect(() => a.encodedState()).toThrow('closed');
  });
  it('rejects hidden Yjs roots and list content without persisting or rebroadcasting them', () => {
    const { a, value } = peers();
    const before = a.encodedState();
    for (const inject of [
      (doc: Y.Doc) =>
        doc.getMap('hidden-private-records').set('secret', 'excluded private content'),
      (doc: Y.Doc) => doc.getText('fields').insert(0, 'hidden text inside map root'),
    ]) {
      const corrupt = new Y.Doc();
      Y.applyUpdate(corrupt, before);
      const vector = Y.encodeStateVector(corrupt);
      inject(corrupt);
      expect(() =>
        a.applyRemote(
          encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
          value,
        ),
      ).toThrow('hidden root');
      expect(a.encodedState()).toEqual(before);
      corrupt.destroy();
    }
  });
  it('checks private paths even when a deleted ancestor hides them from the rendered graph', () => {
    const { a, value } = peers();
    const before = a.encodedState(),
      missingNode = crypto.randomUUID();
    for (const path of [
      ['nodes', missingNode, 'metadata', 'sourceSecret'],
      ['nodes', missingNode, 'createdAt'],
      ['diagram', 'settings', 'viewport', 'private-coordinate'],
    ]) {
      const corrupt = new Y.Doc();
      Y.applyUpdate(corrupt, before);
      const vector = Y.encodeStateVector(corrupt);
      corrupt.getMap('fields').set(JSON.stringify(path), ['value', 'hidden private value']);
      expect(() =>
        a.applyRemote(
          encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(corrupt, vector)),
          value,
        ),
      ).toThrow('private field');
      expect(a.encodedState()).toEqual(before);
      corrupt.destroy();
    }
  });
  it('validates peer sync vectors before encoding a state diff', () => {
    const { a } = peers();
    for (const vector of [
      new Uint8Array(65537),
      new Uint8Array([0x81, 0x20]),
      new Uint8Array([1, 1]),
      new Uint8Array([2, 1, 1, 1, 2]),
      new Uint8Array([0, 1]),
    ])
      expect(() => a.diff(vector)).toThrow('Invalid collaboration update envelope');
    expect(a.diff(new Uint8Array([0])).byteLength).toBeGreaterThan(0);
  });
  it('rejects a compact delta that would overflow future causal actor vectors', () => {
    const { a, value } = peers(),
      before = a.encodedState();
    const corrupt = new Y.Doc();
    Y.applyUpdate(corrupt, before);
    const vector = Y.encodeStateVector(corrupt),
      fields = corrupt.getMap('fields');
    for (let actor = 0; actor < 4097; actor++) {
      corrupt.clientID = 100000 + actor;
      fields.set(JSON.stringify(['nodes', value.nodes[0].id, 'title']), [
        'value',
        `Revision ${actor}`,
      ]);
    }
    const delta = Y.encodeStateAsUpdate(corrupt, vector);
    expect(delta.byteLength).toBeLessThan(1024 * 1024);
    expect(() => a.applyRemote(encodeCollaborationUpdate(vector, delta), value)).toThrow(
      'Invalid collaboration update envelope',
    );
    expect(a.encodedState()).toEqual(before);
    corrupt.destroy();
  });
  it('undoes only local operations while retaining a remote edit on the same node', () => {
    const { a, b, value } = peers();
    const own = edit(value, (graph) => {
      graph.nodes[0].title = 'My title';
    });
    a.applyLocal(value, own, writable);
    const remote = edit(value, (graph) => {
      graph.nodes[0].description = 'Their description';
    });
    a.applyRemote(b.applyLocal(value, remote, writable).update, own);
    const reverted = a.undo(value, writable)!;
    expect(reverted.graph.nodes.find((node) => node.id === value.nodes[0].id)).toMatchObject({
      title: 'Orders',
      description: 'Their description',
    });
    expect(
      a.redo(value, writable)!.graph.nodes.find((node) => node.id === value.nodes[0].id)?.title,
    ).toBe('My title');
  });
  it('merges independent simulation assumptions per semantic entity/field', () => {
    const value = createSimulationGraph();
    const { a, b } = peers(value);
    const id = value.simulation!.nodes.find((node) => node.type === 'work')!.id;
    const first = edit(value, (graph) => {
      const node = graph.simulation!.nodes.find((node) => node.id === id)!;
      if (node.type === 'work') node.work.capacity = 3;
    });
    const second = edit(value, (graph) => {
      const node = graph.simulation!.nodes.find((node) => node.id === id)!;
      if (node.type === 'work') node.work.costPerHour = 50;
    });
    const left = a.applyLocal(value, first, writable),
      right = b.applyLocal(value, second, writable);
    a.applyRemote(right.update, first);
    b.applyRemote(left.update, second);
    expect(a.graph(value).simulation).toEqual(b.graph(value).simulation);
    expect(a.graph(value).simulation!.nodes.find((node) => node.id === id)).toMatchObject({
      work: { capacity: 3, costPerHour: 50 },
    });
  });
  it('stages and commits a valid 9 MiB full refresh without applying the incremental budget', () => {
    const value = graph();
    value.nodes[0].description = 'Before refresh';
    const receiver = new CollaborativeDocument(value);
    documents.push(receiver);
    const native = new Y.Doc();
    let sender: CollaborativeDocument;
    const text = 'x'.repeat(9 * 1024 * 1024);
    try {
      Y.applyUpdate(native, receiver.encodedState());
      native
        .getMap('fields')
        .set(JSON.stringify(['nodes', value.nodes[0].id, 'description']), ['value', text]);
      sender = new CollaborativeDocument(value, receiver.scope, Y.encodeStateAsUpdate(native));
    } finally {
      native.destroy();
    }
    documents.push(sender!);
    const refresh = sender!.diff(new Uint8Array([0]));
    expect(decodeCollaborationUpdate(refresh).delta.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const prepared = receiver.prepareRemote(refresh, value);
    expect(
      receiver.graph(value).nodes.find((node) => node.id === value.nodes[0].id)?.description,
    ).toBe('Before refresh');
    expect(prepared.graph.nodes.find((node) => node.id === value.nodes[0].id)?.description).toBe(
      text,
    );
    expect(decodeCollaborationUpdate(prepared.update).baseVector).toEqual(new Uint8Array([0]));
    prepared.commit();
    expect(
      receiver.graph(value).nodes.find((node) => node.id === value.nodes[0].id)?.description,
    ).toBe(text);
    expect(receiver.stateVector()).toEqual(sender!.stateVector());
    expect(() => sender!.diff(new Uint8Array([1, 123, 1]))).toThrow('size limit');
  });
  it('does not allow a full-state refresh to introduce a hidden root or private camera', () => {
    const value = graph();
    for (const hiddenRoot of [true, false]) {
      const { a } = peers(value);
      const before = a.encodedState();
      const native = new Y.Doc();
      try {
        Y.applyUpdate(native, before);
        if (hiddenRoot) native.getMap('hidden').set('private', 'Not shared');
        else
          native
            .getMap('fields')
            .set(JSON.stringify(['diagram', 'settings', 'viewport']), [
              'value',
              { x: 1, y: 2, zoom: 1 },
            ]);
        expect(() =>
          a.prepareRemote(
            encodeCollaborationUpdate(new Uint8Array([0]), Y.encodeStateAsUpdate(native)),
            value,
          ),
        ).toThrow(/hidden root|private field/);
        expect(a.encodedState()).toEqual(before);
      } finally {
        native.destroy();
      }
    }
  });
});
