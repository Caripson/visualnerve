import { expect, it } from 'vitest';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationEngine } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import {
  indexSimulationParticleView,
  particleCapacityCard,
  particleTransitEdge,
} from '../src/simulation/particle-view';
import { SimulationPresentationSlots } from '../src/simulation/presentation-slots';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { projectGraph, type RenderCache } from '../src/canvas/projection';
import { emptyFilters } from '../src/model/types';

function fixture(capacity = 3) {
  const model = createBasicModel({ particles: 4, capacity });
  model.nodes.push({
    id: 'second',
    name: 'Second',
    type: 'work',
    work: { capacity: 3, processingSeconds: 30 },
  });
  model.edges[1].targetNodeId = 'second';
  model.edges[1].travelSeconds = 10;
  model.edges.push({ id: 'second-out', sourceNodeId: 'second', targetNodeId: 'outcome' });
  const graph = createSimulationGraph('Particle paths', model);
  const run = { model: graph.simulation!, options: { seed: 42 } };
  const engine = new SimulationEngine(run.model);
  engine.advance(1);
  const state = engine.state();
  const projection = projectSimulationCapacityNodes(
    graph,
    projectSimulationRenderModel(graph, run),
    state,
  );
  const view = indexSimulationParticleView({
    ...graph,
    nodes: projection.nodes,
    edges: projection.edges,
  });
  const work = graph.nodes.find((node) => node.externalId === 'work')!;
  const second = graph.nodes.find((node) => node.externalId === 'second')!;
  return { graph, engine, state, projection, view, work, second };
}

it('follows only valid fan branches from observed processing slots into a shared input', () => {
  const { engine, state, view, work, second } = fixture();
  const slots = new SimulationPresentationSlots().reconcile('run', state);
  const processing = state.particles.find((particle) => particle.id === 2)!;
  expect(
    particleCapacityCard(view, work.id, slots.selectProcessingUnit(work.id, processing)),
  ).toMatchObject({ id: `simulation-capacity:${work.id}:2` });
  expect(particleTransitEdge(view, processing, slots)).toBeUndefined();
  engine.advance(61);
  const next = engine.state();
  slots.reconcile('run', next);
  const transit = next.particles.find((particle) => particle.id === 2)!;
  const edge = particleTransitEdge(view, transit, slots)!;
  expect(edge.sourceNodeId).toBe(`simulation-capacity:${work.id}:2`);
  expect(edge.targetNodeId).toBe(second.id);
  expect(edge.metadata.simulationLogicalEdgeId).toBe(transit.edgeId);
  expect(edge.metadata.simulationTargetCapacityUnit).toBe(1);
});

it('uses the logical hub when processing was not observed, and excludes shared-resource links', () => {
  const { engine, view, work, second } = fixture();
  engine.advance(61);
  const state = engine.state();
  const slots = new SimulationPresentationSlots().reconcile('reloaded', state);
  const transit = state.particles.find((particle) => particle.id === 2)!;
  expect(particleTransitEdge(view, transit, slots)).toMatchObject({
    sourceNodeId: work.id,
    targetNodeId: second.id,
  });
  expect(particleTransitEdge(view, { ...transit, edgeId: 'unknown' }, slots)).toBeUndefined();
  expect(particleTransitEdge(view, { ...transit, status: 'abandoned' }, slots)).toBeUndefined();
  expect(particleTransitEdge(view, { ...transit, nodeId: 'unrelated' }, slots)).toBeUndefined();
});

it('maps hidden presentation slots onto an explicitly aggregated real-capacity card', () => {
  const { view, work } = fixture(20);
  expect(particleCapacityCard(view, work.id, 1)?.id).toBe(work.id);
  expect(particleCapacityCard(view, work.id, 12)?.id).toBe(`simulation-capacity:${work.id}:8`);
  expect(particleCapacityCard(view, work.id, 21)).toBeUndefined();
});

it('omits filtered canvas nodes and edges rather than drawing hidden queue or transit geometry', () => {
  const { graph, projection, engine, work } = fixture();
  const shown = { ...graph, nodes: projection.nodes, edges: projection.edges };
  const view = indexSimulationParticleView(shown, {
    nodeIds: new Set(
      projection.nodes
        .filter((node) => node.metadata.simulationLogicalNodeId !== work.id)
        .map((node) => node.id),
    ),
    edgeIds: new Set(),
  });
  expect(particleCapacityCard(view, work.id)).toBeUndefined();
  expect(view.nodes.has(work.id)).toBe(false);
  engine.advance(61);
  const state = engine.state();
  const slots = new SimulationPresentationSlots().reconcile('filtered', state);
  expect(
    particleTransitEdge(view, state.particles.find((particle) => particle.id === 2)!, slots),
  ).toBeUndefined();
});

it('makes runtime cards and fan edges readonly while restoring editable canonical nodes', () => {
  const { graph, projection, work } = fixture();
  const cache: RenderCache = { nodes: new Map(), edges: new Map() };
  const data = new Map();
  const resize = () => {};
  const projected = projectGraph(
    { ...graph, nodes: projection.nodes, edges: projection.edges },
    [],
    [work.id],
    [],
    emptyFilters,
    false,
    resize,
    data,
    cache,
  );
  const cards = projected.nodes.filter(
    (node) => node.data.node.metadata.simulationLogicalNodeId === work.id,
  );
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    expect(card).toMatchObject({
      selected: true,
      draggable: false,
      selectable: false,
      connectable: false,
    });
    expect(card.data.resize).toBeUndefined();
  }
  expect(
    projected.edges.every((edge) => edge.selectable === false && edge.reconnectable === false),
  ).toBe(true);
  const canonical = projectGraph(
    graph,
    [],
    [work.id],
    [],
    emptyFilters,
    false,
    resize,
    data,
    cache,
  );
  const restored = canonical.nodes.find((node) => node.id === work.id)!;
  expect(restored.selected).toBe(true);
  expect(restored.draggable).toBeUndefined();
  expect(restored.data.resize).toBe(resize);
  expect(canonical.nodes.some((node) => node.id.startsWith('simulation-capacity:'))).toBe(false);
});

it('relationship exploration reveals all cards and valid fan branches belonging to the logical process', () => {
  const { graph, projection, work } = fixture();
  const edge = graph.edges.find((edge) => edge.targetNodeId === work.id)!;
  const explored = projectGraph(
    { ...graph, nodes: projection.nodes, edges: projection.edges },
    [],
    [],
    [],
    emptyFilters,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      nodeIds: [work.id, edge.sourceNodeId],
      edgeIds: [edge.id],
      totalNodes: 2,
      truncated: false,
      found: true,
      outsideViewIds: [],
      outsideViewEdgeIds: [],
    },
  );
  expect(explored.nodes).toHaveLength(4);
  expect(explored.edges).toHaveLength(3);
  expect(
    explored.nodes.filter((node) => node.data.node.metadata.simulationLogicalNodeId === work.id),
  ).toHaveLength(3);
});
