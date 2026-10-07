import { describe, expect, it } from 'vitest';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import { indexSimulationParticleView } from '../src/simulation/particle-view';
import {
  buildSimulationParticleScene,
  MAX_QUEUE_SAMPLE,
  MAX_RENDERED_PARTICLES,
  MAX_RENDERED_TRAFFIC_EDGES,
  particleTransitFraction,
} from '../src/simulation/particle-scene';
import { SimulationPresentationSlots } from '../src/simulation/presentation-slots';
import type { ParticleSnapshot } from '../src/simulation/types';
import { projectSimulationRenderModel } from '../src/simulation/render-model';

function fixture(particles = 100) {
  const input = createBasicModel({ particles, processingSeconds: 5 });
  input.edges[0].travelSeconds = 3;
  input.edges[1].travelSeconds = 3;
  const graph = createSimulationGraph('Traffic scene', input);
  const engine = new SimulationEngine(graph.simulation!);
  const view = indexSimulationParticleView(graph);
  const slots = new SimulationPresentationSlots();
  const scene = (time: number) => {
    engine.advance(time);
    const state = engine.state();
    return {
      state,
      scene: buildSimulationParticleScene(
        view,
        graph.simulation!,
        state,
        slots.reconcile('run', state),
      ),
    };
  };
  return { graph, engine, view, slots, scene };
}

describe('semantic particle scenes', () => {
  it('uses valid flow edges and engine phases, never completing Work early', () => {
    const { scene, graph } = fixture(2);
    const incoming = scene(1);
    expect(incoming.scene.transit).toHaveLength(2);
    expect(incoming.scene.processing).toHaveLength(0);
    expect(incoming.scene.transit.every(({ edge }) => edge.id === graph.edges[0].id)).toBe(true);
    expect(particleTransitFraction(incoming.scene.transit[0].particle, 1)).toBeCloseTo(1 / 3);
    const processing = scene(4);
    expect(processing.scene.transit).toHaveLength(0);
    expect(processing.scene.processing).toHaveLength(1);
    expect(processing.scene.queues).toHaveLength(1);
    expect(processing.scene.paths[0].traffic.level).toBe('congested');
    const leaving = scene(9);
    expect(leaving.scene.transit).toHaveLength(1);
    expect(leaving.scene.transit[0].edge.id).toBe(graph.edges[1].id);
    const particle = leaving.scene.transit[0].particle;
    const observedProcessingEnd = processing.scene.processing[0].particle.processingEndsAtSeconds!;
    expect(particle.departedAtSeconds).toBe(observedProcessingEnd);
    expect(particleTransitFraction(particle, observedProcessingEnd - 0.1)).toBeUndefined();
    const completed = scene(17);
    expect(completed.scene.processing).toHaveLength(0);
    expect(completed.scene.transit).toHaveLength(0);
    expect(completed.scene.queues).toHaveLength(0);
    expect(completed.state.metrics.completed).toBe(2);
  });

  it('samples only retained queued particles, while metrics still describe the full queue', () => {
    const { graph, view, engine, slots } = fixture(1000);
    engine.advance(4);
    const state = engine.state();
    expect(state.metrics.queue.current).toBe(999);
    let result = buildSimulationParticleScene(
      view,
      graph.simulation!,
      state,
      slots.reconcile('run', state),
    );
    expect(result.queues).toHaveLength(MAX_QUEUE_SAMPLE);
    expect(result.queues.every(({ particle }) => particle.status === 'queued')).toBe(true);
    state.particles = state.particles.filter((particle) => particle.status !== 'queued');
    result = buildSimulationParticleScene(
      view,
      graph.simulation!,
      state,
      slots.reconcile('run', state),
    );
    expect(result.queues).toHaveLength(0); // no grey invented stand-ins for omitted snapshots
    expect(state.metrics.queue.current).toBe(999);
  });

  it('never animates zero-time or invalid transfers, abandoned work, or resource connectors', () => {
    const { graph, view, engine, slots } = fixture(2);
    engine.advance(1);
    const state = engine.state();
    const first = state.particles[0];
    state.particles = [
      { ...first, edgeId: 'missing' },
      { ...first, id: 3, status: 'abandoned', completedAtSeconds: 1 },
      { ...first, id: 4, arrivesAtSeconds: first.departedAtSeconds },
    ];
    const result = buildSimulationParticleScene(
      view,
      graph.simulation!,
      state,
      slots.reconcile('run', state),
    );
    expect(result.transit).toHaveLength(0);
    expect(result.losses).toHaveLength(1);
    const model = createBasicModel({ particles: 1 });
    const work = model.nodes[1];
    if (work.type !== 'work') throw Error('Work fixture');
    work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.resources.push({ id: 'staff', name: 'Staff', capacity: 1, unit: 'worker' });
    model.nodes.push({ id: 'pool', name: 'Staff', type: 'resource', resourceId: 'staff' });
    const resourceGraph = createSimulationGraph('Pool', model);
    const projection = projectSimulationRenderModel(resourceGraph);
    const resourceView = indexSimulationParticleView({ ...resourceGraph, edges: projection.edges });
    const poolEngine = new SimulationEngine(resourceGraph.simulation!);
    poolEngine.advance(1);
    const poolState = poolEngine.state();
    const poolResult = buildSimulationParticleScene(
      resourceView,
      resourceGraph.simulation!,
      poolState,
      slots.reconcile('pool', poolState),
    );
    expect(poolResult.paths.some((path) => path.resource)).toBe(true);
    expect(poolResult.transit.some(({ edge }) => edge.edgeType === 'simulation-resource')).toBe(
      false,
    );
    expect(resourceView.flowEdges.every((edge) => edge.edgeType !== 'simulation-resource')).toBe(
      true,
    );
  });

  it('excludes hidden and off-screen nodes, without changing complete-population metrics', () => {
    const { graph, engine, slots } = fixture(100);
    engine.advance(4);
    const state = engine.state();
    const hidden = indexSimulationParticleView(graph, { nodeIds: new Set(), edgeIds: new Set() });
    const result = buildSimulationParticleScene(
      hidden,
      graph.simulation!,
      state,
      slots.reconcile('run', state),
    );
    expect(result).toMatchObject({
      processing: [],
      transit: [],
      queues: [],
      losses: [],
      paths: [],
    });
    const elsewhere = buildSimulationParticleScene(
      indexSimulationParticleView(graph),
      graph.simulation!,
      state,
      slots,
      { left: 100000, top: 100000, right: 101000, bottom: 101000 },
    );
    expect(elsewhere).toMatchObject({
      processing: [],
      transit: [],
      queues: [],
      losses: [],
      paths: [],
    });
    expect(state.metrics.created).toBe(100);
  });

  it('bounds rendered particles and paths for large workloads and topologies', () => {
    const { graph, engine, slots } = fixture(100000);
    engine.advance(1);
    const state = engine.state();
    const edges = Array.from({ length: 2000 }, (_, index) => ({
      ...graph.edges[0],
      id: index === 0 ? graph.edges[0].id : `flow-${index}`,
    }));
    const model = {
      ...graph.simulation!,
      edges: edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        travelSeconds: 3,
      })),
    };
    const view = indexSimulationParticleView({ ...graph, edges });
    const result = buildSimulationParticleScene(view, model, state, slots.reconcile('run', state));
    const count =
      result.processing.length +
      result.transit.length +
      result.queues.length +
      result.losses.length;
    expect(count).toBeLessThanOrEqual(MAX_RENDERED_PARTICLES);
    expect(result.transit.length).toBeGreaterThan(0);
    expect(result.paths).toHaveLength(MAX_RENDERED_TRAFFIC_EDGES);
    expect(state.metrics.created).toBe(100000);
  });
});

it('transit fractions are bounded by actual timestamps and valid status', () => {
  const particle = {
    status: 'transit',
    departedAtSeconds: 5,
    arrivesAtSeconds: 10,
  } as ParticleSnapshot;
  expect(particleTransitFraction(particle, 4)).toBeUndefined();
  expect(particleTransitFraction(particle, 5)).toBe(0);
  expect(particleTransitFraction(particle, 7.5)).toBe(0.5);
  expect(particleTransitFraction(particle, 10)).toBeUndefined();
  expect(particleTransitFraction({ ...particle, status: 'completed' }, 7.5)).toBeUndefined();
  expect(particleTransitFraction({ ...particle, arrivesAtSeconds: NaN }, 7.5)).toBeUndefined();
});
