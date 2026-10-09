import { expect, it } from 'vitest';
import { ParallelFlowDraft } from '../src/simulation/editor/parallel-flow-draft';
import { ParallelDeliveryExample } from '../src/simulation/parallel-delivery-example';
import { validateSimulationModel } from '../src/simulation/schema';
import { validateGraph } from '../src/model/validation';
import { runSimulation } from '../src/simulation/engine';
import { parallelModel, nestedParallelModel } from './helpers/parallel-model';

it('removes a complete parallel region, preserves outside pools and reconnects the original case route', () => {
  const model = parallelModel({ particles: 5, resourceCapacity: 2 });
  const removed = new ParallelFlowDraft().remove(model, 'join');
  validateSimulationModel(removed);
  expect(removed.nodes.map((node) => node.id)).toEqual(['source', 'outcome']);
  expect(removed.edges).toEqual([
    { id: 'to-fork', sourceNodeId: 'source', targetNodeId: 'outcome' },
  ]);
  expect(removed.resources).toEqual(model.resources);
  expect(model.nodes).toHaveLength(6);
  expect(runSimulation(removed, { untilComplete: true }).metrics).toMatchObject({
    created: 5,
    completed: 5,
    realizedRevenue: 500,
  });
});
it('removes all nested pairs with one explicit block removal and never leaves hidden dangling synchronizers', () => {
  const model = nestedParallelModel(4);
  const removed = new ParallelFlowDraft().remove(model, 'fork-0');
  validateSimulationModel(removed);
  expect(removed.nodes.map((node) => node.id)).toEqual(['source', 'outcome']);
  expect(runSimulation(removed, { untilComplete: true }).metrics.completed).toBe(1);
});
it('creates complete editable pairs and maintains all mandatory outgoing branch identities', () => {
  const model = parallelModel();
  const added = new ParallelFlowDraft().add(model);
  validateSimulationModel(added.model);
  const fork = added.model.nodes.find((node) => node.id === added.id)!;
  expect(fork).toMatchObject({ type: 'fork', fork: { branchEdgeIds: expect.any(Array) } });
  expect(added.model.nodes.filter((node) => node.type === 'join')).toHaveLength(2);
  const synced = new ParallelFlowDraft().synchronize(added.model);
  expect(synced).toEqual(added.model);
});
it('bundles an editable SD-WAN example with three genuine branches, one revenue outcome and separately paid capacity', () => {
  const example = new ParallelDeliveryExample(),
    graph = example.graph(),
    model = example.model();
  validateGraph(graph);
  validateSimulationModel(model);
  expect(graph.nodes).toHaveLength(10);
  expect(graph.nodes.find((node) => node.externalId === 'site')).toMatchObject({ x: 180, y: 580 });
  const baseline = runSimulation(model, { seed: 42 }),
    again = runSimulation(model, { seed: 42 });
  expect(again).toEqual(baseline);
  expect(baseline.metrics).toMatchObject({
    created: 8,
    completed: 8,
    realizedRevenue: 96000,
    abandoned: 0,
  });
  const intervention = runSimulation(model, { scenarioId: 'extra-engineers', seed: 42 });
  expect(intervention.metrics.completed).toBe(8);
  expect(intervention.metrics.realizedRevenue).toBe(baseline.metrics.realizedRevenue);
  expect(intervention.metrics.resourceCost).toBeGreaterThan(baseline.metrics.resourceCost);
  expect(intervention.metrics.ttr.average).toBeLessThan(baseline.metrics.ttr.average);
  expect(model.resources[0].capacity).toBe(2);
});
