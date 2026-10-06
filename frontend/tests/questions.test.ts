import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { questionGraph } from '../src/questions/evidence';
import { answerDiagramQuestion } from '../src/questions/answer';
import { normalizeQuestion } from '../src/questions/types';

function chain(count: number) {
  const graph = blankGraph('Supply chain', 'dependency');
  graph.nodes = Array.from({ length: count }, (_, index) =>
    newNode(graph.diagram.id, { title: `Object ${index}` }),
  );
  graph.edges = graph.nodes
    .slice(1)
    .map((node, index) => newEdge(graph.diagram.id, graph.nodes[index].id, node.id));
  return graph;
}
describe('Evidence-backed diagram questions', () => {
  it('finds multi-step chains, handles cycles and identifies a depth boundary without changing the graph', () => {
    const graph = chain(6);
    graph.edges.push(newEdge(graph.diagram.id, graph.nodes[4].id, graph.nodes[1].id));
    const before = JSON.stringify(graph);
    const result = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'downstream',
      maxDepth: 3,
    });
    expect(result.total).toBe(3);
    expect(result.depthLimited).toBe(true);
    expect(result.answers[2].nodeIds).toEqual(graph.nodes.slice(0, 4).map((node) => node.id));
    expect(result.evidence).toHaveLength(3);
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('respects reverse arrows and distinguishes upstream paths from undirected associations', () => {
    const graph = chain(3);
    graph.edges[0].direction = 'backward';
    graph.edges[1].direction = 'none';
    const fromFirst = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'downstream',
    });
    expect(fromFirst.total).toBe(0);
    const upstream = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'upstream',
    });
    expect(upstream.answers.map((answer) => answer.nodeId)).toEqual([graph.nodes[1].id]);
    expect(upstream.evidence[0].direction).toBe('backward');
  });
  it('reports heuristic source locations, propagates uncertainty and can exclude uncertain paths', () => {
    const graph = chain(3);
    graph.edges[0].metadata.codeRelation = {
      version: 1,
      kind: 'calls',
      confidence: 'heuristic',
      evidence: { path: 'src/fleet.ts', line: 42 },
    };
    const result = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'downstream',
    });
    expect(result.answers[1].confidence).toBe('heuristic');
    expect(result.evidence[0]).toMatchObject({ source: 'code', path: 'src/fleet.ts', line: 42 });
    expect(result.warnings.join(' ')).toContain('heuristic');
    expect(
      answerDiagramQuestion(questionGraph(graph), {
        startId: graph.nodes[0].id,
        kind: 'downstream',
        includeUncertain: false,
      }).total,
    ).toBe(0);
  });
  it('preserves JOIN evidence and unresolved SQL reference confidence', () => {
    const graph = chain(2);
    graph.edges[0].metadata.sqlQueryRelationship = {
      version: 1,
      scope: 'q1',
      kind: 'join',
      joinType: 'LEFT JOIN',
      condition: 'fleet.id = service.fleet_id',
      references: [{ sourceAlias: 'fleet', column: 'id', resolution: 'ambiguous' }],
    };
    const result = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'path',
      targetId: graph.nodes[1].id,
    });
    expect(result.found).toBe(true);
    expect(result.evidence[0]).toMatchObject({ source: 'sql', confidence: 'unresolved' });
    expect(result.evidence[0].description).toContain('fleet.id = service.fleet_id');
  });
  it('pages all results rather than limiting the analysis to the visible answer page', () => {
    const graph = chain(1);
    for (let index = 0; index < 2000; index++) {
      const node = newNode(graph.diagram.id);
      graph.nodes.push(node);
      graph.edges.push(newEdge(graph.diagram.id, graph.nodes[0].id, node.id));
    }
    const result = answerDiagramQuestion(questionGraph(graph), {
      startId: graph.nodes[0].id,
      kind: 'downstream',
      offset: 1975,
      limit: 25,
    });
    expect(result.total).toBe(2000);
    expect(result.answers).toHaveLength(25);
    expect(result.hasMore).toBe(false);
    expect(result.evidence).toHaveLength(25);
  });
  it('limits analysis to requested relationship types and rejects unknown inputs', () => {
    const graph = chain(3);
    graph.edges[1].edgeType = 'service';
    expect(
      answerDiagramQuestion(questionGraph(graph), {
        startId: graph.nodes[0].id,
        kind: 'downstream',
        edgeTypes: ['relationship'],
      }).total,
    ).toBe(1);
    expect(() =>
      normalizeQuestion({ startId: graph.nodes[0].id, kind: 'downstream', execute: true }),
    ).toThrow();
    expect(() => normalizeQuestion({ startId: graph.nodes[0].id, kind: 'path' })).toThrow();
    expect(() =>
      normalizeQuestion({ startId: graph.nodes[0].id, kind: 'downstream', maxDepth: 65 }),
    ).toThrow();
  });
});
