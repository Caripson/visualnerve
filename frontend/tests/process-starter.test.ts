import { describe, expect, it } from 'vitest';
import { createSimulationGraph } from '../src/simulation/document';
import { runSimulation, SimulationEngine } from '../src/simulation/engine';
import {
  createEmptySimulationModel,
  createStarterGraph,
  starterDefaults,
  starterValues,
} from '../src/simulation/starter';
import { validateSimulationModel } from '../src/simulation/schema';

describe('guided process setup produces executable semantic documents', () => {
  it('builds a complete finite flow with modeled transfer time and deterministic results', () => {
    const empty = createSimulationGraph('Starter', createEmptySimulationModel());
    empty.diagram.settings.viewport = { x: 10000, y: 10000, zoom: 0.3 };
    empty.diagram.settings.viewportDevice = 'touch';
    const draft = { ...starterDefaults(), arrivalMode: 'batch' as const, processingMinutes: '1' };
    const graph = createStarterGraph(empty, draft);
    validateSimulationModel(graph.simulation);
    expect(graph.diagram.type).toBe('process-simulator');
    expect(graph.simulation!.nodes.map((node) => node.type)).toEqual(['source', 'work', 'outcome']);
    expect(graph.simulation!.edges.map((edge) => edge.travelSeconds)).toEqual([5, 5]);
    expect(graph.nodes.map((node) => node.x)).toEqual([60, 410, 760]);
    expect(graph.diagram.settings.viewport).toBeUndefined();
    expect(graph.diagram.settings.viewportDevice).toBeUndefined();
    expect(empty.simulation!.nodes).toHaveLength(0);
    const first = runSimulation(graph.simulation!, { seed: 42, untilComplete: true });
    const second = runSimulation(graph.simulation!, { seed: 42, untilComplete: true });
    expect(first).toEqual(second);
    expect(first.metrics).toMatchObject({
      created: 10,
      completed: 10,
      realizedRevenue: 1000,
      abandoned: 0,
    });
    expect(first.completedAtSeconds).toBe(610);
    expect(first.metrics.ttr.maximum).toBe(610);
  });
  it('enforces real shared-resource contention and accounts for its cost', () => {
    const empty = createSimulationGraph('Shared', createEmptySimulationModel());
    const graph = createStarterGraph(empty, {
      ...starterDefaults(),
      arrivalMode: 'batch',
      batchCount: '2',
      processingMinutes: '1',
      capacity: '2',
      sharedResource: true,
      resourceCapacity: '1',
      resourceCostPerHour: '180',
    });
    const resource = graph.simulation!.resources[0];
    const engine = new SimulationEngine(graph.simulation!, { untilComplete: true });
    engine.advance(6);
    expect(engine.state().resources[resource.id].busy).toBe(1);
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    expect(engine.state().nodes[work.id].queue.current).toBe(1);
    const result = runSimulation(graph.simulation!, { untilComplete: true });
    expect(result.completedAtSeconds).toBe(130);
    expect(result.metrics.resourceCost).toBeCloseTo(6.5);
    expect(graph.edges.filter((edge) => edge.edgeType === 'simulation-resource')).toHaveLength(1);
  });
  it('uses declared minutes/hours and optional abandonment without implicit conversions', () => {
    const values = starterValues({
      ...starterDefaults(),
      durationHours: '0.5',
      processingMinutes: '1.5',
      patienceMinutes: '4',
    });
    expect(values).toMatchObject({
      durationSeconds: 1800,
      processingSeconds: 90,
      patienceSeconds: 240,
    });
    expect(starterValues(starterDefaults()).patienceSeconds).toBeUndefined();
  });
  it('rejects corrupted inputs and an attempt to replace an existing process', () => {
    for (const patch of [
      { capacity: '-1' },
      { processingMinutes: '0' },
      { capacity: '1.5' },
      { itemName: ' ' },
      { currency: 'sek' },
      { transferSeconds: '-1' },
      { sharedResource: true, resourceCapacity: '0' },
    ])
      expect(() => starterValues({ ...starterDefaults(), ...patch })).toThrow();
    const graph = createStarterGraph(
      createSimulationGraph('Starter', createEmptySimulationModel()),
      starterDefaults(),
    );
    expect(() => createStarterGraph(graph, starterDefaults())).toThrow('empty Process Simulator');
  });
  it('retains independent resource/type definitions in an empty document', () => {
    const model = createEmptySimulationModel();
    model.particleTypes.push({
      id: 'existing-item',
      name: 'Existing item',
      color: '#123456',
      revenue: 0,
      complexity: { min: 1, max: 1 },
      priority: 0,
    });
    model.resources.push({
      id: 'existing-resource',
      name: 'Existing resource',
      capacity: 1,
      unit: 'machine',
    });
    const graph = createStarterGraph(createSimulationGraph('Preserved', model), starterDefaults());
    expect(graph.simulation!.particleTypes.some((type) => type.id === 'existing-item')).toBe(true);
    expect(
      graph.simulation!.resources.some((resource) => resource.id === 'existing-resource'),
    ).toBe(true);
  });
});
