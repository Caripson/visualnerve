import { expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { exploreRelationships, relationshipGraph } from '../src/analysis/relationships';
import type { RelationshipExploration } from '../src/analysis/types';
import { projectGraph } from '../src/canvas/projection';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';

function fixture() {
  const graph = blankGraph('Connections');
  graph.nodes = ['A', 'B', 'C', 'D', 'Association'].map((title) =>
    newNode(graph.diagram.id, { title }),
  );
  const [a, b, c, d, association] = graph.nodes;
  graph.edges = [
    newEdge(graph.diagram.id, a.id, b.id),
    newEdge(graph.diagram.id, c.id, b.id, { direction: 'backward' }),
    newEdge(graph.diagram.id, c.id, d.id, { direction: 'both' }),
    newEdge(graph.diagram.id, a.id, association.id, { direction: 'none' }),
  ];
  return { graph, a, b, c, d, association };
}
function config(
  startId: string,
  patch: Partial<RelationshipExploration> = {},
): RelationshipExploration {
  return {
    version: 1,
    mode: 'neighbors',
    startId,
    direction: 'all',
    steps: 1,
    directed: true,
    includeHidden: false,
    ...patch,
  };
}
it('follows arrow direction for incoming/outgoing, backward and both edges, including two-step reachability', () => {
  const { graph, a, b, c, d, association } = fixture();
  const data = relationshipGraph(graph);
  expect(exploreRelationships(data, config(a.id, { direction: 'outgoing' })).nodeIds).toEqual([
    a.id,
    b.id,
  ]);
  expect(exploreRelationships(data, config(b.id, { direction: 'incoming' })).nodeIds).toEqual([
    b.id,
    a.id,
  ]);
  expect(
    exploreRelationships(data, config(b.id, { direction: 'outgoing', steps: 2 })).nodeIds,
  ).toEqual([b.id, c.id, d.id]);
  expect(exploreRelationships(data, config(a.id)).nodeIds).toEqual([a.id, b.id, association.id]);
});
it('finds a shortest directed or undirected path and reports unreachable targets honestly', () => {
  const { graph, a, b, c, d, association } = fixture();
  const data = relationshipGraph(graph);
  expect(
    exploreRelationships(data, config(a.id, { mode: 'path', targetId: d.id })).nodeIds,
  ).toEqual([a.id, b.id, c.id, d.id]);
  expect(exploreRelationships(data, config(d.id, { mode: 'path', targetId: a.id })).found).toBe(
    false,
  );
  expect(
    exploreRelationships(data, config(d.id, { mode: 'path', targetId: a.id, directed: false }))
      .nodeIds,
  ).toEqual([d.id, c.id, b.id, a.id]);
  expect(
    exploreRelationships(data, config(a.id, { mode: 'path', targetId: association.id })).found,
  ).toBe(false);
  expect(
    exploreRelationships(
      data,
      config(a.id, { mode: 'path', targetId: association.id, directed: false }),
    ).edgeIds,
  ).toEqual([graph.edges[3].id]);
});
it('keeps bounded neighborhoods, rejects falsely shortened long paths, and never changes canonical manual links', () => {
  const graph = blankGraph('Large');
  graph.nodes = Array.from({ length: 1000 }, (_, i) =>
    newNode(graph.diagram.id, { title: `N${i}` }),
  );
  graph.edges = graph.nodes
    .slice(1)
    .map((node, i) => newEdge(graph.diagram.id, graph.nodes[i].id, node.id));
  const original = JSON.stringify(graph);
  const all = exploreRelationships(
    relationshipGraph({
      ...graph,
      edges: graph.nodes
        .slice(1)
        .map((node) => newEdge(graph.diagram.id, graph.nodes[0].id, node.id)),
    }),
    config(graph.nodes[0].id),
  );
  expect(all.nodeIds).toHaveLength(500);
  expect(all.totalNodes).toBe(1000);
  expect(all.truncated).toBe(true);
  const path = exploreRelationships(
    relationshipGraph(graph),
    config(graph.nodes[0].id, { mode: 'path', targetId: graph.nodes[999].id }),
  );
  expect(path).toMatchObject({ nodeIds: [], found: true, truncated: true, totalNodes: 1000 });
  expect(JSON.stringify(graph)).toBe(original);
});
it('requires explicit opt-in to show retained CSV groups and annotates their earlier measures in the projection', () => {
  const source = parseCsv('Region,Amount\nNorth,12\nSouth,34', 'regions.csv');
  const graph = csvGraph(source, defaultAnalysis(source));
  const north = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
  const south = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
  south.metadata = { ...south.metadata, csv: { ...getCsvNode(south)!, visible: false } };
  const manual = newEdge(graph.diagram.id, north.id, south.id, {
    label: 'Manual dependency',
    style: 'dashed',
    direction: 'both',
  });
  graph.edges.push(manual);
  const defaultResult = exploreRelationships(relationshipGraph(graph), config(north.id));
  expect(defaultResult.nodeIds).not.toContain(south.id);
  const explicit = exploreRelationships(
    relationshipGraph(graph),
    config(north.id, { includeHidden: true, mode: 'path', targetId: south.id }),
  );
  expect(explicit.outsideViewIds).toEqual([south.id]);
  const projected = projectGraph(
    graph,
    [],
    [],
    [],
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    explicit,
  );
  expect(projected.nodes.find((node) => node.id === south.id)?.className).toBe(
    'analysis-outside-data-view',
  );
  expect(projected.edges.find((edge) => edge.id === manual.id)).toMatchObject({
    label: 'Manual dependency',
    style: { strokeDasharray: '7 4' },
  });
  expect(projectGraph(graph, []).nodes.some((node) => node.id === south.id)).toBe(false);
  expect(graph.edges).toContain(manual);
});
it('explores derived mindmap parent relationships and opens collapsed results without editing collapse state', () => {
  const graph = blankGraph('Tree');
  graph.diagram.type = 'mindmap';
  const parent = newNode(graph.diagram.id, { collapsed: true });
  const child = newNode(graph.diagram.id, { parentId: parent.id });
  graph.nodes = [parent, child];
  const result = exploreRelationships(
    relationshipGraph(graph),
    config(parent.id, { direction: 'outgoing' }),
  );
  expect(result.nodeIds).toEqual([parent.id, child.id]);
  const projected = projectGraph(
    graph,
    [],
    [],
    [],
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    result,
  );
  expect(projected.nodes.every((node) => !node.hidden)).toBe(true);
  expect(projected.edges[0].id).toBe(`hierarchy:${child.id}`);
  expect(parent.collapsed).toBe(true);
});
