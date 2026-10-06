import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { applyDelta, diffGraph, mergeDelta } from '../src/state/history';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import { mindmapTopics } from '../src/mindmap/tree';

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
  it('restores middle deletions in their original node and connection order and branch colors', () => {
    const original = blankGraph('Ordered branches', 'mindmap');
    const root = newNode(original.diagram.id, { title: 'Root' });
    const children = ['First', 'Middle', 'Last'].map((title) =>
      newNode(original.diagram.id, { title, parentId: root.id }),
    );
    original.nodes = [root, ...children];
    original.edges = children.map((node) => newEdge(original.diagram.id, root.id, node.id));
    const colors = mindmapTopics(original.nodes);
    const deleted = {
      ...original,
      nodes: original.nodes.filter((node) => node !== children[1]),
      edges: original.edges.filter((edge) => edge.targetNodeId !== children[1].id),
    };
    const delta = diffGraph(original, deleted, 'Delete middle branch');
    const restored = applyDelta(deleted, delta, false);
    expect(restored).toEqual(original);
    expect(mindmapTopics(restored.nodes)).toEqual(colors);
    expect(applyDelta(restored, delta, true)).toEqual(deleted);
  });
  it('records a pure order change as an undoable editor command without copying entities', () => {
    const original = blankGraph('Reorder');
    original.nodes = ['First', 'Middle', 'Last'].map((title) =>
      newNode(original.diagram.id, { title }),
    );
    original.edges = [
      newEdge(original.diagram.id, original.nodes[0].id, original.nodes[1].id),
      newEdge(original.diagram.id, original.nodes[0].id, original.nodes[2].id),
    ];
    useEditor.getState().setGraph(original);
    useEditor.getState().command('Reorder', (graph) => ({
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    }));
    const reordered = useEditor.getState().graph!;
    expect(reordered.nodes.map((node) => node.id)).toEqual(
      original.nodes.map((node) => node.id).reverse(),
    );
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().history[0].nodes).toEqual([]);
    expect(useEditor.getState().history[0].edges).toEqual([]);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(original);
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(reordered);
  });
  it('coalesces order changes from the first ordering to the last ordering', () => {
    const original = blankGraph('Coalesced order');
    original.nodes = ['First', 'Middle', 'Last'].map((title) =>
      newNode(original.diagram.id, { title }),
    );
    original.edges = [
      newEdge(original.diagram.id, original.nodes[0].id, original.nodes[1].id),
      newEdge(original.diagram.id, original.nodes[0].id, original.nodes[2].id),
    ];
    const second = {
      ...original,
      nodes: [original.nodes[1], original.nodes[0], original.nodes[2]],
      edges: [...original.edges].reverse(),
    };
    const last = {
      ...second,
      nodes: [original.nodes[2], original.nodes[1], original.nodes[0]],
    };
    const delta = mergeDelta(
      diffGraph(original, second, 'Reorder'),
      diffGraph(second, last, 'Reorder'),
    );
    expect(applyDelta(last, delta, false)).toEqual(original);
    expect(applyDelta(original, delta, true)).toEqual(last);
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
