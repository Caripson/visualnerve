import { expect, it } from 'vitest';
import { blankGraph, emptyFilters, newNode, newEdge } from '../src/model/types';
import { projectGraph, projectedBounds, type RenderCache } from '../src/canvas/projection';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
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

it('honors deleted CSV branches and arrow directions on edited hierarchy connections', () => {
  const dataset = parseCsv('Region,Amount\nNorth,10', 'sales.csv');
  const graph = csvGraph(dataset, defaultAnalysis(dataset));
  const edge = graph.edges[0];
  edge.direction = 'both';
  const directed = projectGraph(graph, []).edges.find((item) => item.id === edge.id)!;
  expect(directed.markerStart).toBeDefined();
  expect(directed.markerEnd).toBeDefined();
  expect(directed.reconnectable).toBe(true);
  graph.edges = [];
  expect(projectGraph(graph, []).edges).toEqual([]);
});

it('projects only the current CSV view, preserves manual objects and restores their retained links', () => {
  const dataset = parseCsv('Region,Amount\nNorth,10\nSouth,20', 'sales.csv');
  const graph = csvGraph(dataset, defaultAnalysis(dataset));
  const north = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
  const south = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
  const root = graph.nodes.find((node) => getCsvNode(node)?.path.length === 0)!;
  const note = newNode(graph.diagram.id, { title: 'My note', x: 500, y: 300 });
  const retainedLink = newEdge(graph.diagram.id, north.id, south.id, { label: 'My relation' });
  const currentLink = newEdge(graph.diagram.id, north.id, note.id, { label: 'Visible relation' });
  const parentRelation = newEdge(graph.diagram.id, root.id, north.id, {
    label: 'Own parent relation',
  });
  graph.nodes.push(note);
  graph.edges.push(retainedLink, currentLink, parentRelation);
  const data = new Map();
  const cache: RenderCache = { nodes: new Map(), edges: new Map() };
  const initial = projectGraph(graph, [], [], [], emptyFilters, false, undefined, data, cache);
  const ownRelation = initial.edges.find((edge) => edge.id === parentRelation.id)!;
  expect(ownRelation.type).toBe('default');
  expect(ownRelation.markerEnd).toBeDefined();
  expect(ownRelation.reconnectable).toBe(true);
  expect(
    initial.edges.find(
      (edge) =>
        edge.id !== parentRelation.id && edge.source === root.id && edge.target === north.id,
    )?.type,
  ).toBe('mindmap-branch');
  graph.nodes = graph.nodes.map((node) =>
    node.id === root.id || node.id === south.id
      ? {
          ...node,
          x: 10000,
          metadata: { ...node.metadata, csv: { ...getCsvNode(node)!, visible: false } },
        }
      : node,
  );
  const canonicalNodes = graph.nodes;
  const canonicalEdges = graph.edges;
  const view = projectGraph(
    graph,
    [],
    [],
    [],
    emptyFilters,
    false,
    undefined,
    data,
    cache,
    graph.nodes,
  );
  expect(view.nodes.map((node) => node.id)).toEqual([north.id, note.id]);
  expect(view.nodes[0].data.mindmap?.depth).toBe(0);
  expect(view.edges.map((edge) => edge.id)).toEqual([currentLink.id]);
  expect(view.edges[0].type).toBe('default');
  expect(data.has(south.id)).toBe(false);
  expect(cache.nodes.has(root.id)).toBe(false);
  expect(cache.edges.has(retainedLink.id)).toBe(false);
  const exported = projectGraph(
    graph,
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
  expect(exported.nodes.map((node) => node.id)).toEqual([north.id, note.id]);
  expect(exported.edges.map((edge) => edge.id)).toEqual([currentLink.id]);
  expect(projectedBounds(exported.nodes).width).toBeLessThan(10000);
  expect(graph.nodes).toBe(canonicalNodes);
  expect(graph.edges).toBe(canonicalEdges);
  expect(graph.edges).toContain(retainedLink);

  graph.nodes = graph.nodes.map((node) =>
    getCsvNode(node)?.visible === false
      ? { ...node, metadata: { ...node.metadata, csv: { ...getCsvNode(node)!, visible: true } } }
      : node,
  );
  const restored = projectGraph(graph, []);
  expect(restored.nodes.find((node) => node.id === north.id)?.data.mindmap?.depth).toBe(1);
  expect(restored.edges.find((edge) => edge.id === retainedLink.id)?.label).toBe('My relation');
});
