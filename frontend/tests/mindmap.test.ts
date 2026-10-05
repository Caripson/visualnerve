import { beforeEach, expect, it } from 'vitest';
import { blankGraph, emptyFilters, newEdge, newNode } from '../src/model/types';
import { branchColors, mindmapTopics } from '../src/mindmap/tree';
import { layoutGraph } from '../src/layouts/layout';
import { projectGraph, type RenderCache } from '../src/canvas/projection';
import { useEditor } from '../src/state/editor';
import { instantiate } from '../src/templates/templates';

beforeEach(() => useEditor.getState().setGraph(null));
it('balances branches around the root, reserves subtree space and preserves semantic data', async () => {
  const graph = instantiate('mind-map', 'A central idea');
  const before = structuredClone(graph);
  const positions = await layoutGraph(graph, 'BALANCED');
  const root = graph.nodes[0];
  expect(positions.get(root.id)).toEqual({ x: root.x, y: root.y });
  const branches = graph.nodes.filter((node) => node.parentId === root.id);
  expect(branches.some((node) => positions.get(node.id)!.x < root.x)).toBe(true);
  expect(branches.some((node) => positions.get(node.id)!.x > root.x + root.width)).toBe(true);
  for (const node of graph.nodes) {
    const p = positions.get(node.id)!;
    for (const other of graph.nodes.filter((n) => n.id !== node.id)) {
      const q = positions.get(other.id)!;
      expect(
        p.x + node.width <= q.x ||
          q.x + other.width <= p.x ||
          p.y + node.height <= q.y ||
          q.y + other.height <= p.y,
      ).toBe(true);
    }
    if (node.parentId && node.parentId !== root.id) {
      const parent = positions.get(node.parentId)!;
      expect(Math.sign(p.x - parent.x)).toBe(Math.sign(parent.x - root.x));
    }
  }
  expect(graph).toEqual(before);
});

it('inherits branch colors through descendants and respects explicit overrides', () => {
  const graph = instantiate('mind-map', 'Colors');
  const root = graph.nodes[0];
  const branches = graph.nodes.filter((node) => node.parentId === root.id);
  const topics = mindmapTopics(graph.nodes);
  expect(topics.get(branches[0].id)?.color).toBe(branchColors[0]);
  expect(new Set(branches.map((branch) => topics.get(branch.id)?.color)).size).toBe(
    branches.length,
  );
  graph.nodes = graph.nodes.map((node) =>
    node.id === branches[1].id ? { ...node, color: '#abcdef' } : node,
  );
  const recolored = mindmapTopics(graph.nodes);
  for (const leaf of graph.nodes.filter((node) => node.parentId === branches[1].id)) {
    expect(recolored.get(leaf.id)?.color).toBe('#abcdef');
    expect(recolored.get(leaf.id)?.side).toBe('left');
  }
});

it('renders curved hierarchy without arrows while keeping cross-link semantics and mode switching correct', () => {
  const graph = blankGraph('Mode switch', 'mindmap');
  const root = newNode(graph.diagram.id);
  const child = newNode(graph.diagram.id, { parentId: root.id, x: -300 });
  const other = newNode(graph.diagram.id, { parentId: root.id, x: 300 });
  graph.nodes = [root, child, other];
  graph.edges = [
    newEdge(graph.diagram.id, root.id, child.id, { edgeType: 'hierarchy' }),
    newEdge(graph.diagram.id, child.id, other.id, { label: 'Related' }),
  ];
  const before = structuredClone(graph);
  const data = new Map();
  const cache: RenderCache = { nodes: new Map(), edges: new Map() };
  const map = projectGraph(graph, [], [], [], emptyFilters, false, undefined, data, cache);
  expect(map.nodes.every((node) => node.type === 'mindmap-topic')).toBe(true);
  expect(map.edges[0].type).toBe('mindmap-branch');
  expect(map.edges[0].sourceHandle).toBe('source-left');
  expect(map.edges[0].targetHandle).toBe('target-right');
  expect(map.edges[0].markerEnd).toBeUndefined();
  expect(map.edges[1].markerEnd).toBeDefined();
  expect(map.edges[1].label).toBe('Related');
  expect(map.edges).toHaveLength(3); // parentId also renders a branch without an explicit edge.
  const same = projectGraph(graph, [], [], [], emptyFilters, false, undefined, data, cache);
  expect(same.nodes[1]).toBe(map.nodes[1]);
  expect(same.edges[0]).toBe(map.edges[0]);
  const diagram = projectGraph(
    { ...graph, diagram: { ...graph.diagram, type: 'flowchart' } },
    [],
    [],
    [],
    emptyFilters,
    false,
    undefined,
    data,
    cache,
  );
  expect(diagram.nodes[0].type).toBe('generic');
  expect(diagram.edges[0].type).toBe('smoothstep');
  expect(diagram.edges[0].markerEnd).toBeDefined();
  expect(graph).toEqual(before);
});

it('keeps the branch appearance when exporting only a selected descendant', () => {
  const graph = instantiate('mind-map', 'Export');
  const leaf = graph.nodes.find((node) => mindmapTopics(graph.nodes).get(node.id)?.depth === 2)!;
  const selected = projectGraph(
    { ...graph, nodes: [leaf], edges: [] },
    [],
    [],
    [],
    emptyFilters,
    true,
    undefined,
    undefined,
    undefined,
    graph.nodes,
  );
  expect(selected.nodes[0].data.mindmap).toEqual(mindmapTopics(graph.nodes).get(leaf.id));
  expect(selected.nodes[0].data.exporting).toBe(true);
});

it('adds children outward and siblings on the same side, avoids collisions and undoes complete creation', () => {
  const graph = instantiate('mind-map', 'Create topics');
  useEditor.getState().setGraph(graph);
  const topics = mindmapTopics(graph.nodes);
  const left = graph.nodes.find(
    (node) => topics.get(node.id)?.depth === 1 && topics.get(node.id)?.side === 'left',
  )!;
  useEditor.getState().select([left.id]);
  const id = useEditor.getState().child()!;
  const child = useEditor.getState().graph!.nodes.find((node) => node.id === id)!;
  expect(child.parentId).toBe(left.id);
  expect(child.x + child.width).toBeLessThan(left.x);
  const siblingId = useEditor.getState().child(true)!;
  const sibling = useEditor.getState().graph!.nodes.find((node) => node.id === siblingId)!;
  expect(sibling.parentId).toBe(left.id);
  expect(sibling.x).toBe(child.x);
  expect(sibling.y).toBeGreaterThanOrEqual(child.y + child.height + 24);
  expect(
    useEditor
      .getState()
      .graph!.nodes.slice(0, graph.nodes.length)
      .map((node) => [node.id, node.x, node.y]),
  ).toEqual(graph.nodes.map((node) => [node.id, node.x, node.y]));
  useEditor.getState().undo();
  useEditor.getState().undo();
  expect(useEditor.getState().graph).toEqual(graph);
});
