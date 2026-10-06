import { expect, it } from 'vitest';
import { projectCanonicalOverview } from '../src/overview/projection';
import { overviewId } from '../src/overview/types';
import { overviewFixture } from './overview-fixture';
it('reports a reproducible 10,000-node / 30,000-relationship overview benchmark', () => {
  const graph = overviewFixture(),
    times: number[] = [];
  // Warm once, then report five repetitions. Timing is diagnostic rather than a machine-specific pass threshold.
  projectCanonicalOverview(graph, { zoom: 1.5 });
  let view = projectCanonicalOverview(graph, { zoom: 1.5 });
  for (let iteration = 0; iteration < 5; iteration++) {
    const start = performance.now();
    view = projectCanonicalOverview(graph, { zoom: 1.5 });
    times.push(performance.now() - start);
  }
  const fingerprint = overviewId(
    '',
    JSON.stringify([
      view.nodes.map((n) => n.id),
      Object.entries(view.nodeMap).sort(),
      view.relationships.map((r) => [r.id, r.edgeIds]),
    ]),
  );
  const reversed = projectCanonicalOverview(
    { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
    { zoom: 1.5 },
  );
  expect(reversed.nodes.map((n) => n.id)).toEqual(view.nodes.map((n) => n.id));
  expect(reversed.nodeMap).toEqual(view.nodeMap);
  expect(Object.keys(view.nodeMap)).toHaveLength(10000);
  expect(Object.keys(view.edgeMap)).toHaveLength(30000);
  console.info(
    JSON.stringify({
      benchmark: 'semantic-overview-v1',
      nodes: 10000,
      edges: 30000,
      zoom: 1.5,
      displayedCards: view.nodes.length,
      displayedRelations: view.edges.length,
      medianMs: Math.round([...times].sort((a, b) => a - b)[2]),
      runsMs: times.map((t) => Math.round(t)),
      fingerprint,
    }),
  );
}, 30000);
