import { describe, expect, it } from 'vitest';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph } from '../src/simulation/document';
import {
  ProcessProjection,
  getSimulationProcessId,
  simulationProcessCardId,
} from '../src/simulation/process-projection';
import { ProcessModelEditor } from '../src/simulation/editor/ProcessEditor';
import { applyScenarioDraft, addDraftNode } from '../src/simulation/editor/draft';
import { resolveScenario } from '../src/simulation/schema';
import { SimulationEngine } from '../src/simulation/engine';
import { simulationProcessTraffic } from '../src/simulation/process-traffic';
import { indexSimulationParticleView } from '../src/simulation/particle-view';
import { buildSimulationParticleScene, MAX_QUEUE_SAMPLE } from '../src/simulation/particle-scene';
import { SimulationPresentationSlots } from '../src/simulation/presentation-slots';

function fixture(particles = 20) {
  const model = createBasicModel({ particles, processingSeconds: 60 });
  model.processes = [
    { id: 'delivery', name: 'Delivery' },
    { id: 'assembly', name: 'Assembly', parentId: 'delivery' },
  ];
  model.nodes[1].processId = 'assembly';
  model.nodes[2].processId = 'delivery';
  model.edges.forEach((edge) => {
    edge.travelSeconds = 5;
  });
  const graph = createSimulationGraph('Hierarchical delivery', model);
  return {
    graph,
    model: graph.simulation!,
    projector: new ProcessProjection(graph.simulation!),
    work: graph.simulation!.nodes.find((node) => node.type === 'work')!,
  };
}

describe('read-only process hierarchy projection', () => {
  it('shows main processes and external arrivals without persisting virtual containers', () => {
    const { graph, projector } = fixture();
    const before = structuredClone(graph);
    const projected = projector.project(graph, { mode: 'hierarchy' });
    expect(projected.active).toBe(true);
    expect(
      projected.graph.nodes.map((node) => getSimulationProcessId(node)).filter(Boolean),
    ).toEqual(['delivery']);
    expect(
      projected.graph.nodes.find((node) => getSimulationProcessId(node) === 'delivery')?.metadata
        .simulationProcessNodeIds,
    ).toHaveLength(2);
    expect(projected.graph.edges).toHaveLength(1);
    expect(projected.graph.edges[0].metadata.simulationLogicalEdgeIds).toEqual([graph.edges[0].id]);
    expect(graph).toEqual(before);
    expect(projected.graph.simulation).toBe(graph.simulation);
  });
  it('opens nested process groups then actual work with connected boundary context', () => {
    const { graph, projector, work } = fixture();
    const parent = projector.project(graph, { mode: 'hierarchy', processId: 'delivery' });
    expect(parent.graph.nodes.some((node) => getSimulationProcessId(node) === 'assembly')).toBe(
      true,
    );
    expect(parent.graph.nodes.some((node) => node.id === work.id)).toBe(false);
    const child = projector.project(graph, { mode: 'hierarchy', processId: 'assembly' });
    expect(child.graph.nodes.some((node) => node.id === work.id)).toBe(true);
    expect(child.graph.nodes.some((node) => getSimulationProcessId(node) === 'assembly')).toBe(
      false,
    );
    expect(child.graph.edges).toHaveLength(2);
    const outside = child.graph.nodes.find((node) => getSimulationProcessId(node) === 'delivery')!;
    expect(outside.metadata.simulationProcessBoundary).toBe(true);
    expect(outside.metadata.simulationProcessRepresentedNodeIds).not.toContain(work.id);
  });
  it('returns the complete original graph for all steps and for flat legacy documents', () => {
    const { graph, projector } = fixture();
    expect(projector.project(graph, { mode: 'all' }).graph).toBe(graph);
    const flat = createSimulationGraph('Legacy', createBasicModel());
    expect(
      new ProcessProjection(flat.simulation!).project(flat, { mode: 'hierarchy' }),
    ).toMatchObject({ graph: flat, active: false });
  });
  it('retains empty main processes and safely returns to overview after deleting the open scope', () => {
    const { graph, model } = fixture();
    const empty = {
      ...model,
      processes: [...model.processes!, { id: 'future', name: 'Future process' }],
    };
    const projector = new ProcessProjection(empty);
    const projected = projector.project(
      { ...graph, simulation: empty },
      { mode: 'hierarchy', processId: 'deleted' },
    );
    expect(projected.processId).toBeUndefined();
    expect(
      projected.graph.nodes.some((node) => node.id === simulationProcessCardId('future')),
    ).toBe(true);
  });
  it('groups boundary connections but keeps every original engine edge identifiable', () => {
    const { graph, model } = fixture();
    const source = model.nodes.find((node) => node.type === 'source')!;
    const outcome = model.nodes.find((node) => node.type === 'outcome')!;
    const extra = {
      ...model.edges[0],
      id: crypto.randomUUID(),
      sourceNodeId: source.id,
      targetNodeId: outcome.id,
    };
    const additionalShape = { ...graph.edges[0], id: extra.id, targetNodeId: outcome.id };
    const extended = { ...model, edges: [...model.edges, extra] };
    const projected = new ProcessProjection(extended).project(
      { ...graph, simulation: extended, edges: [...graph.edges, additionalShape] },
      { mode: 'hierarchy' },
    );
    expect(projected.graph.edges).toHaveLength(1);
    expect(projected.graph.edges[0].label).toBe('2 connections');
    expect(projected.graph.edges[0].metadata.simulationLogicalEdgeIds).toEqual([
      graph.edges[0].id,
      extra.id,
    ]);
    const indexed = indexSimulationParticleView(projected.graph);
    expect(indexed.edges.get(extra.id)?.[0]).toBe(projected.graph.edges[0]);
  });
  it('renders only true crossing particles and bounded actual queue samples in collapsed processes', () => {
    const { graph, model, projector } = fixture(200);
    const projected = projector.project(graph, { mode: 'hierarchy' }).graph;
    const engine = new SimulationEngine(model);
    const slots = new SimulationPresentationSlots();
    const index = indexSimulationParticleView(projected);
    engine.advance(1);
    let state = engine.state();
    let scene = buildSimulationParticleScene(index, model, state, slots.reconcile('run', state));
    expect(scene.transit.length).toBeGreaterThan(0);
    expect(
      scene.transit.every(({ edge }) => edge.targetNodeId === simulationProcessCardId('delivery')),
    ).toBe(true);
    engine.advance(6);
    state = engine.state();
    scene = buildSimulationParticleScene(index, model, state, slots.reconcile('run', state));
    expect(state.processes?.delivery.queue.current).toBe(199);
    expect(scene.processing).toHaveLength(0);
    expect(scene.transit).toHaveLength(0);
    expect(scene.queues).toHaveLength(MAX_QUEUE_SAMPLE);
    expect(scene.queues.every(({ particle }) => particle.status === 'queued')).toBe(true);
    expect(scene.paths[0].traffic.level).toBe('congested');
  });
  it('exposes a constrained child even if aggregate utilization is diluted by idle siblings', () => {
    const { model } = fixture();
    const engine = new SimulationEngine(model);
    engine.advance(6);
    const state = engine.state();
    expect(simulationProcessTraffic('delivery', model, state)).toMatchObject({
      level: 'congested',
      queue: 19,
    });
    expect(simulationProcessTraffic('delivery', model, state).reason).toContain('Work');
  });
});

describe('atomic process settings edits', () => {
  it('adds, nests and reassigns groups without altering work assumptions or creating duplicate resources', () => {
    const { model, work } = fixture();
    let next = new ProcessModelEditor(model).create('assembly', 'inspection');
    next = new ProcessModelEditor(next).assign(work.id, 'inspection');
    expect(next.nodes.find((node) => node.id === work.id)).toMatchObject({
      processId: 'inspection',
      work: { capacity: 1, processingSeconds: 60 },
    });
    expect(model.nodes.find((node) => node.id === work.id)?.processId).toBe('assembly');
    expect(next.resources).toBe(model.resources);
    expect(
      new ProcessModelEditor(next).parentChoices('assembly').map((process) => process.id),
    ).not.toContain('inspection');
    expect(() =>
      new ProcessModelEditor(next).update('assembly', { parentId: 'inspection' }),
    ).toThrow(/cycle/);
  });
  it('deletes only the container and promotes member work and child scopes to its parent', () => {
    const { model, work } = fixture();
    const nested = new ProcessModelEditor(model).create('assembly', 'inspection');
    const next = new ProcessModelEditor(nested).remove('assembly');
    expect(next.nodes.find((node) => node.id === work.id)?.processId).toBe('delivery');
    expect(next.processes?.find((process) => process.id === 'inspection')?.parentId).toBe(
      'delivery',
    );
    expect(next.nodes).toHaveLength(model.nodes.length);
    expect(next.edges).toHaveLength(model.edges.length);
  });
  it('supports detached scenario hierarchy changes and inherited new node membership', () => {
    const { model, work } = fixture();
    const base = { ...model, scenarios: [{ id: 'a', name: 'Scenario A', overrides: {} }] };
    const draft = new ProcessModelEditor(base).update('assembly', { name: 'Fast assembly' });
    const next = applyScenarioDraft(base, draft, 'a');
    expect(next.processes?.find((process) => process.id === 'assembly')?.name).toBe('Assembly');
    expect(
      resolveScenario(next, 'a').processes?.find((process) => process.id === 'assembly')?.name,
    ).toBe('Fast assembly');
    const added = addDraftNode(model, 'work', work.processId);
    expect(added.model.nodes.find((node) => node.id === added.id)?.processId).toBe('assembly');
  });
});
