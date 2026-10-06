import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode, newEdge, type Graph } from '../src/model/types';
import { parseCsv, defaultAnalysis } from '../src/data/csv';
import { compareHistoryGraphs } from '../src/history/compare';
import { historyDigest, historyJsonBytes } from '../src/history/codec';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
function fixture(): Graph {
  const graph = blankGraph('Truck lifecycle');
  graph.nodes = ['Build', 'Drive', 'Service', 'Dispose'].map((title) =>
    newNode(graph.diagram.id, { title }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id),
    newEdge(graph.diagram.id, graph.nodes[1].id, graph.nodes[2].id),
    newEdge(graph.diagram.id, graph.nodes[2].id, graph.nodes[3].id),
  ];
  return graph;
}
const compare = (before: Graph, after: Graph) =>
  compareHistoryGraphs(before, after, {
    fromSnapshotId: crypto.randomUUID(),
    toSnapshotId: 'current',
    currentVersion: after.diagram.version,
  });
it('ignores persistence timestamps, entity versions and current camera movement', () => {
  const before = fixture(),
    after = structuredClone(before);
  after.diagram.version++;
  after.diagram.updatedAt = new Date(Date.now() + 1000).toISOString();
  after.nodes[0].version++;
  after.nodes[0].updatedAt = after.diagram.updatedAt;
  after.diagram.settings.viewport = { x: 400, y: 200, zoom: 0.5 };
  after.diagram.settings.spatialView = {
    version: 1,
    mode: '3d',
    camera: { position: { x: 3, y: 4, z: 5 }, target: { x: 0, y: 0, z: 0 } },
  } as Graph['diagram']['settings']['spatialView'];
  before.diagram.settings.spatialView = {
    version: 1,
    mode: '3d',
    camera: { position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 } },
  } as Graph['diagram']['settings']['spatialView'];
  expect(compare(before, after).totalChanges).toBe(0);
});
it('reports layout changes but limits downstream impact to semantic changes along modeled arrows', () => {
  const before = fixture(),
    after = structuredClone(before);
  after.nodes[0].x += 100;
  after.nodes[1].description = 'Changed capability';
  after.nodes[1].metadata.contract = { version: 2 };
  before.nodes[1].metadata.contract = { version: 1 };
  const result = compare(before, after);
  expect(result.counts.node.changed).toBe(2);
  expect(result.changes.find((change) => change.id === before.nodes[1].id)!.fields).toEqual([
    'description',
    'metadata.contract.version',
  ]);
  expect(result.affectedNodeIds).toEqual(before.nodes.slice(1).map((node) => node.id));
  expect(result.affectedTotal).toBe(3);
  expect(result.warnings[0]).toContain('not an execution plan');
});
it('captures additions, removals, connection rewiring and impact through both old and new relationships', () => {
  const before = fixture(),
    after = structuredClone(before),
    added = newNode(before.diagram.id, { title: 'New supplier' });
  after.nodes = [...after.nodes.slice(0, 3), added];
  after.edges = [{ ...after.edges[0], sourceNodeId: added.id }, after.edges[1]];
  const result = compare(before, after);
  expect(result.counts.node).toEqual({ added: 1, removed: 1, changed: 0 });
  expect(result.counts.edge).toEqual({ added: 0, removed: 1, changed: 1 });
  expect(new Set(result.affectedNodeIds)).toEqual(
    new Set([...before.nodes.map((node) => node.id), added.id]),
  );
});
it('reports raw source/analysis changes without mistaking equivalent copied rows for new data', () => {
  const before = fixture();
  before.dataset = {
    ...parseCsv('Name,Cost\nTruck,10', 'trucks.csv'),
    diagramId: before.diagram.id,
  };
  before.nodes[0].metadata.csv = { datasetId: before.dataset.id };
  before.diagram.settings.csvAnalysis = defaultAnalysis(before.dataset);
  const after = structuredClone(before);
  expect(compare(before, after).counts.source.changed).toBe(0);
  after.dataset!.rows[0][1] = '20';
  after.diagram.settings.csvAnalysis!.decimalSeparator = ',';
  const result = compare(before, after);
  expect(result.counts.source.changed).toBe(1);
  expect(result.counts.diagram.changed).toBe(1);
  expect(result.changes.find((change) => change.entity === 'source')!.fields).toEqual(['rows']);
  expect(result.affectedTotal).toBe(4);
});
it('bounds detailed changes and affected IDs while retaining complete counts', () => {
  const before = blankGraph('Large'),
    after = structuredClone(before);
  after.nodes = Array.from({ length: 2500 }, (_, index) =>
    newNode(after.diagram.id, { title: `Node ${index}` }),
  );
  const result = compare(before, after);
  expect(result.totalChanges).toBe(2500);
  expect(result.counts.node.added).toBe(2500);
  expect(result.changes).toHaveLength(500);
  expect(result.changesTruncated).toBe(true);
  expect(result.affectedTotal).toBe(2500);
  expect(result.affectedNodeIds).toHaveLength(2000);
  expect(result.affectedTruncated).toBe(true);
});
it('checks JSON UTF-8 capacity before serialization including escaping, sparse arrays and surrogate pairs', () => {
  const value = { text: 'å🧠\n"\\\ud800', rows: [['a'], undefined, , null] };
  expect(historyJsonBytes(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).byteLength);
  const stringify = vi.spyOn(JSON, 'stringify');
  expect(() => historyJsonBytes({ value: '🧠'.repeat(1000) }, 32)).toThrow(/capacity/);
  expect(stringify).not.toHaveBeenCalled();
  stringify.mockRestore();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => historyJsonBytes(cyclic)).toThrow(/cycle/);
});
it('hashes object key order consistently without changing array order', async () => {
  expect(await historyDigest({ z: 1, a: { b: 2, a: 3 } })).toBe(
    await historyDigest({ a: { a: 3, b: 2 }, z: 1 }),
  );
  expect(await historyDigest(['a', 'b'])).not.toBe(await historyDigest(['b', 'a']));
});
