import { describe, expect, it } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import {
  assignPresentationNumber,
  autoNumber,
  getPresentation,
  presentationNumber,
  prunePresentation,
  remapPresentation,
  setPresentation,
} from '../src/presentation/definition';
import { emptyPresentation, validatePresentation } from '../src/presentation/types';

function fixture() {
  const graph = blankGraph('Presentation');
  graph.nodes = ['A', 'B', 'C'].map((title) => newNode(graph.diagram.id, { title }));
  return graph;
}
describe('canonical presentation sequence', () => {
  it('starts clipboard copies unnumbered while preserving the original ordered sequence', () => {
    const original = autoNumber(fixture());
    const clip = copySelection(
      original,
      original.nodes.map((node) => node.id),
    );
    const pasted = pasteSelection(clip, original);
    const graph = { ...original, nodes: [...original.nodes, ...pasted.nodes] };
    expect(getPresentation(graph).nodeIds).toEqual(original.nodes.map((node) => node.id));
    for (const node of pasted.nodes) expect(presentationNumber(graph, node.id)).toBeNull();
    expect(() => validateGraph(graph)).not.toThrow();
    const other = fixture();
    const copied = pasteSelection(clip, other);
    const target = { ...other, nodes: [...other.nodes, ...copied.nodes] };
    expect(getPresentation(target).nodeIds).toEqual([]);
  });
  it('provides independent empty defaults without changing graphs', () => {
    const graph = fixture();
    const a = getPresentation(graph),
      b = getPresentation(graph);
    expect(a).toEqual({ version: 1, nodeIds: [], secondsPerNode: 8, transitionMs: 1200 });
    a.nodeIds.push(graph.nodes[0].id);
    expect(b.nodeIds).toEqual([]);
    expect(graph.diagram.settings.presentation).toBeUndefined();
    expect(presentationNumber(graph, graph.nodes[0].id)).toBeNull();
  });
  it('inserts, reorders and removes without gaps or changing node identity', () => {
    const source = fixture();
    const [a, b, c] = source.nodes.map((node) => node.id);
    let graph = assignPresentationNumber(source, b, 1);
    graph = assignPresentationNumber(graph, a, 1);
    graph = assignPresentationNumber(graph, c, 2);
    expect(getPresentation(graph).nodeIds).toEqual([a, c, b]);
    expect(presentationNumber(graph, c)).toBe(2);
    graph = assignPresentationNumber(graph, b, 1);
    expect(getPresentation(graph).nodeIds).toEqual([b, a, c]);
    graph = assignPresentationNumber(graph, a, null);
    expect(getPresentation(graph).nodeIds).toEqual([b, c]);
    expect(presentationNumber(graph, c)).toBe(2);
    expect(graph.nodes).toBe(source.nodes);
    expect(source.diagram.settings.presentation).toBeUndefined();
    expect(() => assignPresentationNumber(graph, a, 4)).toThrow(/contiguous/);
    expect(() => assignPresentationNumber(graph, crypto.randomUUID(), 1)).toThrow(/belong/);
  });
  it('auto-numbers in stable input order, copies definitions and prunes/remaps references', () => {
    const source = fixture();
    const [a, b, c] = source.nodes.map((node) => node.id);
    const graph = autoNumber(source, [c, a, c, b]);
    expect(getPresentation(graph).nodeIds).toEqual([c, a, b]);
    expect(getPresentation(autoNumber(source)).nodeIds).toEqual([a, b, c]);
    const pruned = prunePresentation({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== a),
    });
    expect(getPresentation(pruned).nodeIds).toEqual([c, b]);
    const map = new Map(source.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const remapped = remapPresentation(
      { ...graph, nodes: graph.nodes.map((node) => ({ ...node, id: map.get(node.id)! })) },
      map,
    );
    expect(getPresentation(remapped).nodeIds).toEqual([map.get(c), map.get(a), map.get(b)]);
    const definition = emptyPresentation();
    const saved = setPresentation(source, definition);
    definition.nodeIds.push(a);
    expect(getPresentation(saved).nodeIds).toEqual([]);
  });
  it.each([
    { version: 2 },
    { extra: true },
    { nodeIds: ['bad'] },
    { secondsPerNode: 1 },
    { secondsPerNode: 601 },
    { secondsPerNode: NaN },
    { transitionMs: -1 },
    { transitionMs: 10001 },
    { transitionMs: Infinity },
  ])('rejects malformed definitions atomically: %j', (patch) => {
    const graph = fixture();
    expect(() => validatePresentation({ ...emptyPresentation(), ...patch }, graph)).toThrow();
    expect(graph.diagram.settings.presentation).toBeUndefined();
  });
  it('rejects duplicate, missing and excessive node references at graph validation', () => {
    const graph = fixture();
    const id = graph.nodes[0].id;
    for (const nodeIds of [
      [id, id],
      [crypto.randomUUID()],
      Array.from({ length: 20001 }, () => crypto.randomUUID()),
    ]) {
      graph.diagram.settings.presentation = { ...emptyPresentation(), nodeIds };
      expect(() => validateGraph(graph)).toThrow();
    }
    graph.diagram.settings.presentation = {
      ...emptyPresentation(),
      nodeIds: [id],
      secondsPerNode: 2,
      transitionMs: 0,
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });
});
