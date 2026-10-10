import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { mergeCollaborationSnapshot } from '../src/collaboration/document/merge-snapshot';

const scope = { shareMetadata: false, shareOwners: false, shareDatasets: false };
const writable = { canWrite: true, assertActive() {} };
function graph() {
  const graph = blankGraph('Same room', 'flowchart');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
  return graph;
}

describe('validated fresh-device snapshot recovery', () => {
  it('merges owner and persisted offline edits field by field while retaining local view', () => {
    const base = graph(),
      owner = new CollaborativeDocument(base, scope);
    const prior = owner.encodedState();
    const current = structuredClone(base);
    current.nodes[0].description = 'Owner change after disconnection';
    owner.applyLocal(base, current, writable);
    const local = structuredClone(base);
    local.nodes[0].title = 'My saved offline title';
    local.diagram.settings.viewport = { x: 7, y: 8, zoom: 2 };
    local.diagram.folder = 'Private folder';
    const result = mergeCollaborationSnapshot(current, owner.encodedState(), local, prior, scope);
    expect(result.graph.nodes[0]).toMatchObject({
      title: local.nodes[0].title,
      description: current.nodes[0].description,
    });
    expect(result.graph.diagram.settings.viewport).toEqual(local.diagram.settings.viewport);
    expect(result.graph.diagram.folder).toBe(local.diagram.folder);
    const reopened = new CollaborativeDocument(result.graph, scope, result.state);
    expect(reopened.graph(result.graph)).toEqual(result.graph);
    owner.destroy();
    reopened.destroy();
  });
  it('does not reintroduce saved viewer changes when local rebasing is disabled', () => {
    const base = graph(),
      owner = new CollaborativeDocument(base, scope);
    const unpublished = new CollaborativeDocument(base, scope, owner.encodedState()),
      local = structuredClone(base);
    local.nodes[0].title = 'Unapproved viewer change';
    local.diagram.settings.viewport = { x: 7, y: 8, zoom: 2 };
    unpublished.applyLocal(base, local, writable);
    const prior = unpublished.encodedState();
    const result = mergeCollaborationSnapshot(
      base,
      owner.encodedState(),
      local,
      prior,
      scope,
      false,
    );
    expect(result.graph.nodes[0].title).toBe('Original');
    expect(result.graph.diagram.settings.viewport).toEqual(local.diagram.settings.viewport);
    unpublished.destroy();
    owner.destroy();
  });
  it('accepts a native snapshot above the incremental 8 MiB bound without constructing a delta envelope', () => {
    const base = graph(),
      owner = new CollaborativeDocument(base, scope);
    const prior = owner.encodedState(),
      native = new Y.Doc({ gc: false });
    Y.applyUpdate(native, prior);
    const fields = native.getMap('fields'),
      title = JSON.stringify(['nodes', base.nodes[0].id, 'title']);
    // A full snapshot can retain a large valid update history while the visible graph stays small.
    for (let index = 0; index < 9; index++)
      fields.set(title, ['value', `${index}${'x'.repeat(1024 * 1024)}`]);
    fields.set(title, ['value', 'Owner final title']);
    const state = Y.encodeStateAsUpdate(native);
    expect(state.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const current = structuredClone(base);
    current.nodes[0].title = 'Owner final title';
    const result = mergeCollaborationSnapshot(current, state, base, prior, scope);
    expect(result.graph.nodes[0].title).toBe('Owner final title');
    owner.destroy();
    native.destroy();
  });
  it('rejects scope/document mismatches, invalid models and hidden roots without changing saved inputs', () => {
    const base = graph(),
      owner = new CollaborativeDocument(base, scope);
    const state = owner.encodedState(),
      corrupt = new Y.Doc();
    Y.applyUpdate(corrupt, state);
    corrupt.getMap('covert').set('private', 'hidden payload');
    expect(() =>
      mergeCollaborationSnapshot(base, Y.encodeStateAsUpdate(corrupt), base, state, scope),
    ).toThrow('hidden root');
    expect(() => mergeCollaborationSnapshot(base, state, graph(), state, scope)).toThrow(
      'sharing scope',
    );
    expect(() =>
      mergeCollaborationSnapshot(base, state, base, state, { ...scope, shareMetadata: true }),
    ).toThrow('sharing scope');
    const invalid = new Y.Doc();
    Y.applyUpdate(invalid, state);
    invalid
      .getMap('fields')
      .set(JSON.stringify(['nodes', base.nodes[0].id, 'width']), ['value', -1]);
    expect(() =>
      mergeCollaborationSnapshot(base, Y.encodeStateAsUpdate(invalid), base, state, scope),
    ).toThrow();
    expect(owner.encodedState()).toEqual(state);
    expect(base.nodes[0].title).toBe('Original');
    invalid.destroy();
    corrupt.destroy();
    owner.destroy();
  });
});
