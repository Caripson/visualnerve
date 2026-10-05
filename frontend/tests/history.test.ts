import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { applyDelta, diffGraph } from '../src/state/history';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';

describe('command history', () => {
  it('reverses creation, deletion, movement, resizing, properties, edges and grouping', () => {
    const a = blankGraph('Launch');
    const n = newNode(a.diagram.id);
    const b = { ...a, nodes: [n] };
    expect(applyDelta(b, diffGraph(a, b, 'Add node'), false)).toEqual(a);
    const group = newNode(a.diagram.id, { nodeType: 'group' });
    const c = {
      ...b,
      nodes: [{ ...n, x: 200, width: 310, title: 'Research', parentId: group.id }, group],
      edges: [newEdge(a.diagram.id, n.id, group.id)],
    };
    const delta = diffGraph(b, c, 'Group and edit');
    expect(applyDelta(c, delta, false)).toEqual(b);
    expect(applyDelta(b, delta, true)).toEqual(c);
    const deleted = { ...c, nodes: [], edges: [] };
    expect(applyDelta(deleted, diffGraph(c, deleted, 'Delete'), false)).toEqual(c);
  });
  it('stores changed entities only', () => {
    const a = blankGraph('Big');
    a.nodes = Array.from({ length: 1000 }, () => newNode(a.diagram.id));
    const b = { ...a, nodes: a.nodes.map((n, i) => (i === 4 ? { ...n, x: 12 } : n)) };
    expect(diffGraph(a, b, 'Move').nodes).toHaveLength(1);
  });
  it('copies metadata, internal edges and hierarchy with new UUIDs', () => {
    const g = blankGraph('Copy');
    const n = newNode(g.diagram.id, { metadata: { nested: { value: 2 } } });
    const child = newNode(g.diagram.id, { parentId: n.id });
    g.nodes = [n, child];
    g.edges = [newEdge(g.diagram.id, n.id, child.id)];
    const pasted = pasteSelection(copySelection(g, [n.id, child.id]), g.diagram.id);
    expect(pasted.nodes[0].id).not.toBe(n.id);
    expect(pasted.nodes[0].metadata).toEqual(n.metadata);
    expect(pasted.nodes[1].parentId).toBe(pasted.nodes[0].id);
    expect(pasted.edges[0].sourceNodeId).toBe(pasted.nodes[0].id);
  });
  it('moves descendants when group coordinates are edited in properties', () => {
    const graph = blankGraph('Group');
    const group = newNode(graph.diagram.id, { nodeType: 'group', x: 100, y: 100 });
    const child = newNode(graph.diagram.id, { parentId: group.id, x: 140, y: 160 });
    graph.nodes = [group, child];
    useEditor.getState().setGraph(graph);
    useEditor.getState().updateNode(group.id, { x: 200, y: 300 });
    expect(useEditor.getState().graph?.nodes[1].x).toBe(240);
    expect(useEditor.getState().graph?.nodes[1].y).toBe(360);
    useEditor.getState().undo();
    expect(useEditor.getState().graph?.nodes[1].x).toBe(140);
  });
});
