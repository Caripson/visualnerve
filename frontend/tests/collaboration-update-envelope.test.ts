import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { collaborationDocumentLimits } from '../src/collaboration/document/scope';
import {
  decodeCollaborationUpdate,
  encodeCollaborationUpdate,
} from '../src/collaboration/document/update-envelope';

describe('bounded causal update framing', () => {
  it('round-trips binary deltas and vectors, including sliced Uint8Arrays', () => {
    const doc = new Y.Doc();
    doc.getMap('fields').set('name', 'Diagram');
    const vector = Y.encodeStateVector(doc),
      delta = Y.encodeStateAsUpdate(doc);
    const frame = encodeCollaborationUpdate(vector, delta);
    const padded = new Uint8Array(frame.length + 7);
    padded.set(frame, 3);
    const decoded = decodeCollaborationUpdate(padded.subarray(3, frame.length + 3));
    expect(decoded.baseVector).toEqual(vector);
    expect(decoded.delta).toEqual(delta);
    expect(decoded.dependencies).toEqual(Y.decodeStateVector(vector));
    doc.destroy();
  });
  it.each([
    new Uint8Array(),
    new Uint8Array([86, 78, 67, 2]),
    new Uint8Array([86, 78, 67, 1, 255, 255, 255, 255, 0, 0, 0, 0]),
    new Uint8Array([86, 78, 67, 1, 0, 0, 0, 1, 0, 0, 0, 0, 128]),
    new Uint8Array([86, 78, 67, 1, 0, 0, 0, 2, 0, 0, 0, 0, 129, 32]),
  ])('rejects malformed lengths/version/vectors before document cloning', (frame) => {
    const graph = blankGraph('Safe document');
    graph.nodes = [newNode(graph.diagram.id)];
    const doc = new CollaborativeDocument(graph);
    const allocation = vi.spyOn(doc, 'encodedState');
    expect(() => doc.prepareRemote(frame, graph)).toThrow('envelope');
    expect(allocation).not.toHaveBeenCalled();
    doc.destroy();
  });
  it('rejects duplicate actors, truncated varints and trailing vector bytes', () => {
    for (const vector of [
      new Uint8Array([2, 1, 1, 1, 2]),
      new Uint8Array([1, 128]),
      new Uint8Array([0, 0]),
    ])
      expect(() => encodeCollaborationUpdate(vector, new Uint8Array([0, 0]))).toThrow('envelope');
  });
  it('reuses one actor across repeated field edits rather than accumulating a client per command', () => {
    let graph = blankGraph('Repeated edits');
    graph.nodes = [newNode(graph.diagram.id)];
    const doc = new CollaborativeDocument(graph);
    for (let i = 0; i < 100; i++) {
      const next = structuredClone(graph);
      next.nodes[0].x = i + 1;
      doc.applyLocal(graph, next, { canWrite: true, assertActive() {} });
      graph = next;
    }
    expect(Y.decodeStateVector(doc.stateVector()).size).toBeLessThanOrEqual(2);
    doc.destroy();
  });
  it('allows bounded full-state frames only with the canonical empty base vector', () => {
    const native = new Uint8Array(9 * 1024 * 1024);
    const frame = encodeCollaborationUpdate(new Uint8Array([0]), native);
    expect(decodeCollaborationUpdate(frame).delta.byteLength).toBe(native.byteLength);
    expect(() => encodeCollaborationUpdate(new Uint8Array([1, 1, 1]), native)).toThrow('envelope');
    // An overlong zero varint does not grant the full-state exception.
    expect(() => encodeCollaborationUpdate(new Uint8Array([128, 0]), native)).toThrow('envelope');
  });
  it('rejects oversize full states and causal deltas before cloning a document', () => {
    const graph = blankGraph('Safe bounded document');
    const document = new CollaborativeDocument(graph);
    const allocation = vi.spyOn(document, 'encodedState');
    for (const [vector, size] of [
      [new Uint8Array([0]), collaborationDocumentLimits.stateBytes + 1],
      [document.stateVector(), collaborationDocumentLimits.updateBytes + 1],
      [new Uint8Array([128, 0]), collaborationDocumentLimits.updateBytes + 1],
    ] as const) {
      const frame = new Uint8Array(12 + vector.byteLength + size);
      frame.set([86, 78, 67, 1]);
      const header = new DataView(frame.buffer);
      header.setUint32(4, vector.byteLength);
      header.setUint32(8, size);
      frame.set(vector, 12);
      expect(() => document.prepareRemote(frame, graph)).toThrow('envelope');
    }
    expect(allocation).not.toHaveBeenCalled();
    document.destroy();
  });
});
