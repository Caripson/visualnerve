import { afterEach, expect, it, vi } from 'vitest';
import { blankGraph, emptyFilters, newEdge, newNode, type Graph } from '../src/model/types';
import { projectCanonicalOverview, projectOverview } from '../src/overview/projection';
import {
  defaultOverview,
  getOverviewConfig,
  setOverviewConfig,
  validateOverviewConfig,
  overviewNodeGroup,
  overviewLimits,
} from '../src/overview/types';
import { projectGraph } from '../src/canvas/projection';
import { overviewRenderGraph } from '../src/overview/layout';
import { projectSpatialGraph, spatialPlanarGeometry } from '../src/spatial/layout';
import { overviewGrouping } from '../src/overview/grouping';
import { remapOverview } from '../src/overview/copy';
import { renderedScene } from '../src/export/rendered';
import { useEditor } from '../src/state/editor';
import { expandOverviewGroup } from '../src/overview/OverviewNode';
import {
  publishOverview,
  renderedOverview,
  clearRenderedOverview,
  revealOverview,
  releaseOverview,
  useOverviewPreview,
  OVERVIEW_RESTORE_VIEW,
  overviewProjectionReady,
} from '../src/overview/runtime';
import { overviewFixture } from './overview-fixture';
import { normalizedOverviewZoom } from '../src/overview/useZoom';
import { revealOverviewTargets } from '../src/overview/reveal';
import { overviewSelection } from '../src/overview/selection';
import { collapseOverviewLevel, lastOverviewExpansion } from '../src/overview/expansion';
import * as THREE from 'three';
import {
  createSpatialBatches,
  selectSpatialBatches,
  disposeSpatialScene,
} from '../src/spatial/scene';

function enabled(graph: Graph, grouping = 'tags' as const) {
  return setOverviewConfig(graph, { ...defaultOverview(), enabled: true, grouping });
}
function fixture() {
  let graph = blankGraph('Tagged processes', 'process');
  graph.nodes = ['A1', 'A2', 'B1', 'B2'].map((title, index) =>
    newNode(graph.diagram.id, {
      title,
      tags: [index < 2 ? 'A' : 'B'],
      status: index % 2 ? 'done' : 'blocked',
      x: 1000 + index * 555,
      y: 800 + index * 333,
      color: index < 2 ? '#345678' : '#458854',
    }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[2].id, {
      edgeType: 'calls',
      label: 'First call',
    }),
    newEdge(graph.diagram.id, graph.nodes[1].id, graph.nodes[3].id, {
      edgeType: 'calls',
      label: 'Second call',
    }),
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { edgeType: 'inside' }),
  ];
  return enabled(graph);
}
afterEach(() => {
  releaseOverview();
  useEditor.getState().setGraph(null);
  vi.unstubAllGlobals();
});
it('normalizes semantic zoom to the readable initial fit and reaches deep detail within normal 3× canvas magnification', () => {
  expect(normalizedOverviewZoom(0.4, 0.4)).toBeCloseTo(0.1);
  expect(normalizedOverviewZoom(1, 1)).toBeCloseTo(0.1);
  expect(normalizedOverviewZoom(0.6, 0.4)).toBeGreaterThan(0.2);
  expect(normalizedOverviewZoom(0.8, 0.4)).toBeGreaterThan(0.55);
  expect(normalizedOverviewZoom(3, 1)).toBeGreaterThan(1.2);
  expect(normalizedOverviewZoom(3, 1, true)).toBe(0.1);
});

it('keeps the original rendering exactly when disabled and changes only settings when configured', () => {
  const graph = fixture(),
    original = JSON.stringify(graph),
    config = getOverviewConfig(graph);
  const disabled = setOverviewConfig(graph, { ...config, enabled: false });
  expect(disabled.nodes).toBe(graph.nodes);
  expect(disabled.edges).toBe(graph.edges);
  const native = projectGraph(disabled, []),
    view = projectOverview(disabled, native.nodes, native.edges);
  expect(view.nodes).toBe(native.nodes);
  expect(view.edges).toBe(native.edges);
  expect(view.active).toBe(false);
  expect(JSON.stringify(graph)).toBe(original);
});
it('rejects invalid settings, duplicate or malformed proxy IDs, unknown keys and excess expansions', () => {
  const config = { ...defaultOverview(), enabled: true };
  for (const patch of [
    { version: 2 },
    { grouping: 'owner' },
    { expanded: ['abc'] },
    { expanded: ['overview-group:0123456789abcdef', 'overview-group:0123456789abcdef'] },
    { extra: true },
    {
      expanded: Array.from(
        { length: 2001 },
        (_, i) => `overview-group:${i.toString(16).padStart(16, '0')}`,
      ),
    },
  ])
    expect(() => validateOverviewConfig({ ...config, ...patch })).toThrow(
      'Invalid semantic overview',
    );
});
it('keeps stable group IDs, source mappings, native colors and deterministic layout across input order and count/status changes', () => {
  const graph = fixture();
  const first = projectCanonicalOverview(graph, { zoom: 0.3 });
  const reverse = projectCanonicalOverview(
    { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
    { zoom: 0.3 },
  );
  expect(reverse.nodes.map((n) => [n.id, n.position, n.data.node.color])).toEqual(
    first.nodes.map((n) => [n.id, n.position, n.data.node.color]),
  );
  expect(reverse.relationships).toEqual(first.relationships);
  expect(reverse.nodeMap).toEqual(first.nodeMap);
  expect(first.nodes.every((node) => node.draggable === false && node.connectable === false)).toBe(
    true,
  );
  const group = overviewNodeGroup(first.nodes.find((n) => n.data.node.title === 'A')!)!;
  expect(group.statusCounts).toEqual({ blocked: 1, done: 1 });
  expect(group.nodeIds).toHaveLength(2);
  const changed = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, status: 'done' })) };
  expect(projectCanonicalOverview(changed, { zoom: 0.3 }).groups.map((g) => g.id)).toEqual(
    first.groups.map((g) => g.id),
  );
});
it('uses declared hierarchy before tags and source; fallback partitions are clearly identified', () => {
  const graph = fixture(),
    parent = newNode(graph.diagram.id, { nodeType: 'group', title: 'Warehouse' });
  graph.nodes.push(parent);
  graph.nodes[0] = {
    ...graph.nodes[0],
    parentId: parent.id,
    metadata: {
      codeObject: {
        version: 1,
        language: 'python',
        path: 'apps/job.py',
        name: 'fn',
        kind: 'function',
      },
    },
  };
  expect(overviewGrouping(graph, 'auto')(graph.nodes[0]).map((p) => p.reason)).toEqual([
    'hierarchy',
    'hierarchy',
  ]);
  expect(overviewGrouping(graph, 'tags')(graph.nodes[0]).map((p) => p.reason)).toEqual([
    'tag',
    'tag',
  ]);
  expect(overviewGrouping(graph, 'source')(graph.nodes[0]).map((p) => p.reason)).toEqual([
    'source',
    'source',
    'source',
  ]);
  expect(
    overviewGrouping(
      graph,
      'auto',
    )({ ...graph.nodes[1], tags: [], metadata: {} }).map((p) => p.reason),
  ).toEqual(['kind', 'area']);
});
it('expands one explicit level at a time, semantic zoom opens deeper boundaries and reveal is view-only', () => {
  const graph = fixture(),
    original = JSON.stringify(graph),
    initial = projectCanonicalOverview(graph);
  expect(initial.nodes).toHaveLength(1);
  const root = initial.groups.find((g) => g.id === initial.nodes[0].id)!;
  const expanded = setOverviewConfig(graph, { ...getOverviewConfig(graph), expanded: [root.id] });
  const one = projectCanonicalOverview(expanded);
  expect(one.nodes.map((n) => n.data.node.title)).toEqual(['A', 'B']);
  const more = projectCanonicalOverview(graph, { zoom: 0.8 });
  expect(more.nodes).toHaveLength(4);
  expect(more.nodes.every((n) => graph.nodes.some((o) => o.id === n.id))).toBe(true);
  const revealed = projectCanonicalOverview(graph, { revealNodeIds: [graph.nodes[0].id] });
  expect(revealed.nodeMap[graph.nodes[0].id]).toBe(graph.nodes[0].id);
  expect(JSON.stringify(graph)).toBe(original);
});
it('steps back through manual branches without closing a sibling or changing the canonical graph', () => {
  let graph = fixture();
  const groups = projectCanonicalOverview(graph).groups;
  const ids = ['Tags', 'A', 'B'].map((label) => groups.find((group) => group.label === label)!.id);
  graph = setOverviewConfig(graph, { ...getOverviewConfig(graph), expanded: ids });
  const canonicalNodes = graph.nodes,
    canonicalEdges = graph.edges;
  for (const remaining of [[ids[0], ids[1]], [ids[0]], []]) {
    const view = projectCanonicalOverview(graph),
      previous = getOverviewConfig(graph);
    expect(lastOverviewExpansion(previous, view.groups)).toBeDefined();
    graph = setOverviewConfig(graph, collapseOverviewLevel(previous, view.groups));
    expect(getOverviewConfig(graph).expanded).toEqual(remaining);
    expect(Object.keys(projectCanonicalOverview(graph).nodeMap)).toHaveLength(4);
  }
  expect(graph.nodes).toBe(canonicalNodes);
  expect(graph.edges).toBe(canonicalEdges);
  const config = getOverviewConfig(graph),
    view = projectCanonicalOverview(graph, { zoom: 1.5 });
  expect(lastOverviewExpansion(config, view.groups)).toBeUndefined();
  expect(collapseOverviewLevel(config, view.groups)).toBe(config);
});
it('preserves every typed, directed relationship and internal connection with exact source IDs and arrow direction', () => {
  const graph = fixture(),
    [a, , b] = graph.nodes;
  graph.edges.push(
    newEdge(graph.diagram.id, b.id, a.id, { edgeType: 'calls' }),
    newEdge(graph.diagram.id, a.id, b.id, { edgeType: 'reads' }),
    newEdge(graph.diagram.id, a.id, b.id, { edgeType: 'calls', direction: 'backward' }),
    newEdge(graph.diagram.id, a.id, b.id, {
      edgeType: 'calls',
      direction: 'both',
      style: 'dotted',
    }),
    newEdge(graph.diagram.id, b.id, a.id, {
      edgeType: 'calls',
      direction: 'both',
      style: 'dotted',
    }),
  );
  const view = projectCanonicalOverview(graph, { zoom: 0.3 });
  expect(Object.keys(view.edgeMap)).toHaveLength(graph.edges.length);
  expect(view.relationships.flatMap((r) => r.edgeIds).sort()).toEqual(
    graph.edges.map((e) => e.id).sort(),
  );
  expect(
    view.relationships.find(
      (r) => r.edgeType === 'calls' && r.direction === 'forward' && r.source === view.nodeMap[a.id],
    )?.edgeIds,
  ).toHaveLength(2);
  expect(
    view.relationships.find((r) => r.edgeType === 'calls' && r.direction === 'both')?.edgeIds,
  ).toHaveLength(2);
  const backwards = view.edges.find(
    (e) =>
      e.data?.overviewRelationship &&
      (e.data.overviewRelationship as { direction: string }).direction === 'backward',
  )!;
  expect(backwards.markerStart).toBeDefined();
  expect(backwards.markerEnd).toBeUndefined();
  const internal = view.relationships.find((r) => r.internal)!;
  expect(internal.edgeIds).toEqual([graph.edges[2].id]);
  expect(view.groups.find((g) => g.id === internal.source)?.internalEdgeCount).toBe(1);
});
it('honors hide/dim filters and never counts hidden canonical objects as visible summaries', () => {
  const graph = fixture();
  graph.diagram.settings.analysisFilters = { ...emptyFilters, status: 'done', mode: 'hide' };
  const hidden = projectCanonicalOverview(graph, { zoom: 0.3 });
  expect(hidden.counts.originalNodes).toBe(2);
  expect(Object.keys(hidden.nodeMap).sort()).toEqual([graph.nodes[1].id, graph.nodes[3].id].sort());
  expect(
    hidden.groups
      .filter((g) => g.depth === 1)
      .every((g) => g.statusCounts.done === 1 && g.statusCounts.blocked === undefined),
  ).toBe(true);
  graph.diagram.settings.analysisFilters = { ...emptyFilters, status: 'done', mode: 'dim' };
  const dim = projectCanonicalOverview(graph, { zoom: 0.3 });
  expect(dim.counts.originalNodes).toBe(4);
  expect(dim.groups.filter((g) => g.depth === 1).every((g) => g.matchingNodeCount === 1)).toBe(
    true,
  );
});
it('handles custom prototype-like statuses as ordinary data', () => {
  const graph = fixture();
  graph.nodes[0].status = '__proto__';
  graph.nodes[1].status = 'constructor';
  const view = projectCanonicalOverview(graph, { zoom: 0.3 });
  expect(
    overviewNodeGroup(view.nodes.find((n) => n.data.node.title === 'A')!)?.statusCounts,
  ).toEqual(JSON.parse('{"__proto__":1,"constructor":1}'));
});
it('maps 10,000 objects and 30,000 edges without loss under the 2,000-card cap and deterministic broad-tree partitions', () => {
  const graph = overviewFixture(),
    original = JSON.stringify(graph),
    view = projectCanonicalOverview(graph, {
      zoom: 1.5,
      revealNodeIds: graph.nodes.map((n) => n.id),
    });
  expect(view.bounded).toBe(true);
  expect(view.nodes.length).toBeLessThanOrEqual(overviewLimits.visible);
  expect(Object.keys(view.nodeMap)).toHaveLength(10000);
  expect(Object.keys(view.edgeMap)).toHaveLength(30000);
  const targetIds = new Set(view.nodes.map((n) => n.id));
  expect(Object.values(view.nodeMap).every((id) => targetIds.has(id))).toBe(true);
  expect(view.relationships.reduce((sum, r) => sum + r.edgeIds.length, 0)).toBe(30000);
  expect(view.groups.some((g) => g.reason === 'partition')).toBe(true);
  expect(JSON.stringify(graph)).toBe(original);
}, 15000);
it('shares compact projected positions, dimensions and native styles across 2D, 3D relief and export without touching source layout', () => {
  const graph = fixture();
  graph.nodes[0].metadata.spatial = { version: 1, position: { x: 5, y: 9, z: 11 } };
  const original = JSON.stringify(graph),
    view = projectCanonicalOverview(graph, { zoom: 0.3 }),
    ephemeral = overviewRenderGraph(graph, view.nodes),
    relief = projectSpatialGraph(ephemeral),
    geometry = spatialPlanarGeometry(ephemeral);
  expect(ephemeral.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height, n.color])).toEqual(
    view.nodes.map((n) => [n.id, n.position.x, n.position.y, n.width, n.height, n.data.node.color]),
  );
  expect(ephemeral.nodes.every((n) => n.metadata.spatial === undefined && !n.parentId)).toBe(true);
  for (const node of ephemeral.nodes)
    expect(relief.positions.get(node.id)).toEqual({
      x: ((node.x + node.width / 2 - geometry.centerX) / 100) * geometry.scale,
      y: ((geometry.centerY - node.y - node.height / 2) / 100) * geometry.scale,
      z: 0,
    });
  publishOverview(graph, view);
  const exported = renderedScene(graph, 'complete', []);
  expect(exported.nodes.map((n) => [n.id, n.position])).toEqual(
    view.nodes.map((n) => [n.id, n.position]),
  );
  expect(exported.edges).toBe(view.edges);
  expect(exported.nodes.every((n) => n.data.exporting)).toBe(true);
  clearRenderedOverview(graph.diagram.id);
  expect(JSON.stringify(graph)).toBe(original);
});
it('highlights canonical storyboard objects and edges through the overview in both native detail cards and 3D aggregate batches', () => {
  const graph = fixture(),
    nodeIds = graph.nodes.slice(0, 3).map((n) => n.id),
    edgeIds = [graph.edges[0].id];
  const native = projectGraph(graph, [], nodeIds, edgeIds),
    view = projectOverview(graph, native.nodes, native.edges, { revealNodeIds: nodeIds });
  const card = view.nodes.find((n) => n.id === nodeIds[0])!;
  expect(card.selected).toBe(true);
  expect(card.className).toContain('overview-detail-card');
  expect(card.data.exporting).toBe(true);
  expect(card.data.resize).toBeUndefined();
  const aggregate = view.edges.find((e) => e.id === view.edgeMap[edgeIds[0]])!;
  expect(aggregate.selected).toBe(true);
  const mapped = overviewSelection(view, nodeIds, edgeIds);
  expect(mapped.edges).toEqual([aggregate.id]);
  expect(mapped.nodes).toEqual(nodeIds);
  const root = new THREE.Group(),
    relief = projectSpatialGraph(overviewRenderGraph(graph, view.nodes));
  const batches = createSpatialBatches(view.nodes, view.edges, relief.positions, relief.scale);
  root.add(batches.group);
  const edge = batches.edges.get(aggregate.id)!;
  const colors = Array.from(edge.line.geometry.getAttribute('color').array);
  selectSpatialBatches(batches, new Set(mapped.nodes), new Set(mapped.edges), new Set(), new Set());
  expect(Array.from(edge.line.geometry.getAttribute('color').array)).not.toEqual(colors);
  disposeSpatialScene(root);
  expect(edgeIds).toEqual([graph.edges[0].id]);
  expect(nodeIds).toEqual(graph.nodes.slice(0, 3).map((n) => n.id));
});
it('export fallback uses the same hidden-node filter as API rather than quietly exporting hidden sources', () => {
  const graph = fixture();
  graph.diagram.settings.analysisFilters = { ...emptyFilters, status: 'done', mode: 'hide' };
  const view = projectCanonicalOverview(graph),
    exported = renderedScene(graph, 'complete', []);
  expect(exported.nodes.map((n) => n.id)).toEqual(view.nodes.map((n) => n.id));
  expect(exported.nodes[0].data.node.metadata.overviewGroup).toEqual(
    view.nodes[0].data.node.metadata.overviewGroup,
  );
});
it('invalidates cached projections for configuration/filter changes even when source arrays retain their identity', () => {
  const graph = fixture(),
    view = projectCanonicalOverview(graph);
  publishOverview(graph, view);
  expect(renderedOverview(graph)).toBe(view);
  const changed = {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, analysisFilters: { ...emptyFilters, status: 'done' } },
    },
  };
  expect(renderedOverview(changed)).toBeUndefined();
  clearRenderedOverview(graph.diagram.id);
});
it('keeps expansion configuration undoable while source nodes/edges and positions stay canonical', () => {
  const graph = fixture();
  useEditor.getState().setGraph(graph);
  const root = projectCanonicalOverview(graph).nodes[0].id;
  expandOverviewGroup(root);
  const state = useEditor.getState();
  expect(getOverviewConfig(state.graph!).expanded).toEqual([root]);
  expect(state.graph!.nodes).toBe(graph.nodes);
  expect(state.graph!.edges).toBe(graph.edges);
  expect(state.history[0].nodes).toHaveLength(0);
  expect(state.history[0].edges).toHaveLength(0);
  state.undo();
  expect(getOverviewConfig(useEditor.getState().graph!).expanded).toEqual([]);
  useEditor.getState().redo();
  expect(getOverviewConfig(useEditor.getState().graph!).expanded).toEqual([root]);
});
it('remaps expanded hierarchy groups by represented original membership when a diagram is cloned/imported', () => {
  let source = fixture();
  const parent = newNode(source.diagram.id, { title: 'Team', nodeType: 'group' });
  source.nodes.push(parent);
  source.nodes[0].parentId = parent.id;
  source = setOverviewConfig(source, { ...getOverviewConfig(source), grouping: 'groups' });
  const group = projectCanonicalOverview(source).groups.find((g) => g.label === 'Team')!;
  source = setOverviewConfig(source, { ...getOverviewConfig(source), expanded: [group.id] });
  const targetId = crypto.randomUUID(),
    mapping = new Map(source.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const copy = {
    ...source,
    diagram: { ...source.diagram, id: targetId },
    nodes: source.nodes.map((n) => ({
      ...n,
      id: mapping.get(n.id)!,
      diagramId: targetId,
      parentId: n.parentId ? mapping.get(n.parentId) : undefined,
    })),
    edges: source.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      diagramId: targetId,
      sourceNodeId: mapping.get(e.sourceNodeId)!,
      targetNodeId: mapping.get(e.targetNodeId)!,
    })),
  };
  const remapped = remapOverview(copy, source, mapping),
    expected = projectCanonicalOverview(copy).groups.find((g) => g.label === 'Team')!;
  expect(getOverviewConfig(remapped).expanded).toEqual([expected.id]);
  expect(expected.id).not.toBe(group.id);
  expect(remapped.nodes).toBe(copy.nodes);
});
it('keeps temporary preview membership/zoom independent of saved expansions and restores the original overview camera on release', () => {
  const graph = fixture(),
    original = JSON.stringify(graph),
    baseline = { mode: '2d' as const, viewport: { x: 10, y: 25, zoom: 0.17 } };
  const restored = vi.fn();
  window.addEventListener(OVERVIEW_RESTORE_VIEW, restored);
  try {
    revealOverview(graph.diagram.id, [graph.nodes[0].id], 0.1, baseline);
    revealOverview(graph.diagram.id, [graph.nodes[1].id], 1.5, {
      ...baseline,
      viewport: { x: 100, y: 250, zoom: 1 },
    });
    expect(useOverviewPreview.getState()).toMatchObject({ zoom: 0.1, baseline });
    releaseOverview('other-diagram');
    expect(restored).not.toHaveBeenCalled();
    releaseOverview(graph.diagram.id);
    expect(restored).toHaveBeenCalledTimes(1);
    expect(restored.mock.calls[0][0].detail).toEqual(baseline);
    expect(useOverviewPreview.getState().diagramId).toBeNull();
    expect(JSON.stringify(graph)).toBe(original);
  } finally {
    window.removeEventListener(OVERVIEW_RESTORE_VIEW, restored);
  }
});
it('returns already-ready Details immediately without a transient preview mutation, camera capture or readiness RAF', async () => {
  const graph = setOverviewConfig(fixture(), defaultOverview()),
    original = JSON.stringify(graph),
    capture = vi.fn();
  const frame = vi.fn(() => {
    throw Error('No projection frame should be needed for ready Details.');
  });
  vi.stubGlobal('requestAnimationFrame', frame);
  const preview = useOverviewPreview.getState();
  await revealOverviewTargets(
    graph,
    graph.nodes.map((n) => n.id),
    { zoom: 0.1, ready: () => true, captureView: capture },
  );
  expect(frame).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  expect(useOverviewPreview.getState()).toBe(preview);
  expect(JSON.stringify(graph)).toBe(original);
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    revealOverviewTargets(graph, [], {
      zoom: 0.1,
      ready: () => true,
      captureView: capture,
      signal: aborted.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('keeps the projection-frame wait for an active overview even when canonical IDs were already revealed', async () => {
  const graph = fixture(),
    baseline = { mode: '2d' as const, viewport: { x: 0, y: 0, zoom: 0.5 } },
    capture = vi.fn(async () => baseline);
  let frame: FrameRequestCallback | undefined,
    settled = false;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      frame = fn;
      return 1;
    }),
  );
  const waiting = revealOverviewTargets(graph, [graph.nodes[0].id], {
    zoom: 0.1,
    ready: () => true,
    captureView: capture,
  }).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  expect(frame).toBeDefined();
  expect(useOverviewPreview.getState().nodeIds).toEqual([graph.nodes[0].id]);
  frame!(performance.now());
  await waiting;
  expect(settled).toBe(true);
});
it('aborts reveal readiness without retaining late RAF work or emitting arrival', async () => {
  const controller = new AbortController(),
    frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      frames.set(1, fn);
      return 1;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  const waiting = overviewProjectionReady(['node'], () => false, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  expect(frames.size).toBe(0);
});
