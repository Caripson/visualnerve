import { expect, it } from 'vitest';
import { blankGraph, emptyFilters, newNode, newEdge } from '../src/model/types';
import { projectGraph, projectedBounds, type RenderCache } from '../src/canvas/projection';
it('declares frame dimensions so virtualized offscreen nodes can participate in fitting', () => {
  const graph = blankGraph('Offscreen fit');
  graph.nodes = [
    newNode(graph.diagram.id),
    newNode(graph.diagram.id, { x: 12000, y: 6000, width: 300, height: 140 }),
  ];
  const projected = projectGraph(graph, []);
  expect(projected.nodes[1].measured).toEqual({ width: 300, height: 140 });
  expect(projectedBounds(projected.nodes)).toEqual({ x: 0, y: 0, width: 12300, height: 6140 });
});
it('reuses unchanged canvas objects while selection and one node change', () => {
  const graph = blankGraph('Projection identity');
  graph.nodes = [newNode(graph.diagram.id), newNode(graph.diagram.id, { x: 300 })];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  const data = new Map();
  const cache: RenderCache = { nodes: new Map(), edges: new Map() };
  const before = projectGraph(graph, [], [], [], emptyFilters, false, undefined, data, cache);
  const selected = projectGraph(
    graph,
    [],
    [graph.nodes[0].id],
    [],
    emptyFilters,
    false,
    undefined,
    data,
    cache,
  );
  expect(selected.nodes[0]).not.toBe(before.nodes[0]);
  expect(selected.nodes[1]).toBe(before.nodes[1]);
  expect(selected.edges[0]).toBe(before.edges[0]);
  graph.nodes[0] = { ...graph.nodes[0], title: 'Changed' };
  const edited = projectGraph(
    graph,
    [],
    [graph.nodes[0].id],
    [],
    emptyFilters,
    false,
    undefined,
    data,
    cache,
  );
  expect(edited.nodes[0].data.node.title).toBe('Changed');
  expect(edited.nodes[1]).toBe(selected.nodes[1]);
  const edgeSelected = projectGraph(
    graph,
    [],
    [],
    [graph.edges[0].id],
    emptyFilters,
    false,
    undefined,
    data,
    cache,
  );
  expect(edgeSelected.edges[0].selected).toBe(true);
  expect(edgeSelected.edges[0]).not.toBe(edited.edges[0]);
});
it('calculates export bounds in absolute coordinates for nested groups', () => {
  const graph = blankGraph('Nested export');
  const outer = newNode(graph.diagram.id, {
    nodeType: 'group',
    x: 1200,
    y: 700,
    width: 500,
    height: 300,
  });
  const inner = newNode(graph.diagram.id, {
    nodeType: 'group',
    parentId: outer.id,
    x: 1300,
    y: 800,
    width: 250,
    height: 150,
  });
  const child = newNode(graph.diagram.id, {
    parentId: inner.id,
    x: 1500,
    y: 900,
    width: 240,
    height: 120,
  });
  graph.nodes = [child, inner, outer];
  expect(projectedBounds(projectGraph(graph, [], [], [], emptyFilters, true).nodes)).toEqual({
    x: 1200,
    y: 700,
    width: 540,
    height: 320,
  });
});
it('projects group coordinates and collapse without deleting canonical data', () => {
  const g = blankGraph('Groups');
  const group = newNode(g.diagram.id, {
    nodeType: 'group',
    x: 200,
    y: 100,
    width: 500,
    height: 300,
  });
  const child = newNode(g.diagram.id, { parentId: group.id, x: 260, y: 170 });
  g.nodes = [child, group];
  const p = projectGraph(g, []);
  expect(p.nodes[0].id).toBe(group.id);
  expect(p.nodes[1].position).toEqual({ x: 60, y: 70 });
  group.collapsed = true;
  expect(projectGraph(g, []).nodes[1].hidden).toBe(true);
  expect(g.nodes).toHaveLength(2);
  expect(projectGraph(g, [], [], [], emptyFilters, true).nodes[1].hidden).toBe(false);
});
it('hides or dims unrelated nodes and hides incident edges', () => {
  const g = blankGraph('Filter');
  const a = newNode(g.diagram.id, { status: 'done' });
  const b = newNode(g.diagram.id, { status: 'planned' });
  g.nodes = [a, b];
  g.edges = [newEdge(g.diagram.id, a.id, b.id)];
  const hidden = projectGraph(g, [], [], [], { ...emptyFilters, status: 'done', mode: 'hide' });
  expect(hidden.nodes[1].hidden).toBe(true);
  expect(hidden.edges[0].hidden).toBe(true);
  expect(
    projectGraph(g, [], [], [], { ...emptyFilters, status: 'done' }).nodes[1].style?.opacity,
  ).toBe(0.2);
});
