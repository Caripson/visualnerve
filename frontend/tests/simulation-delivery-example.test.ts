import { describe, expect, it } from 'vitest';
import { DeliveryNetworkExample } from '../src/simulation/delivery-example';
import { runSimulation } from '../src/simulation/engine';
import { validateSimulationGraph } from '../src/simulation/document';
import { instantiate } from '../src/templates/templates';

describe('complex hierarchical delivery example', () => {
  it('is a runnable first-class template with nested editable scopes and shared pools', () => {
    const graph = instantiate('delivery-network-simulator', 'Business operations');
    validateSimulationGraph(graph);
    expect(graph.nodes).toHaveLength(23);
    expect(graph.simulation!.processes).toHaveLength(11);
    expect(graph.simulation!.particleTypes).toHaveLength(3);
    expect(graph.simulation!.resources).toHaveLength(5);
    const result = runSimulation(graph.simulation!);
    expect(result.metrics.created).toBeGreaterThan(150);
    expect(result.processes!['fulfilment'].queue.maximum).toBeGreaterThan(0);
    expect(result.processes!['warehouse'].queue.maximum).toBeGreaterThan(0);
    expect(result.processes!['delivery'].nodeIds).toHaveLength(4);
    expect(result.processes!['fulfilment'].realizedRevenue).toBeGreaterThan(0);
    expect(result.processes!['returns'].resourceIds).toContain('technicians');
    expect(result.processes!['fulfilment'].resourceIds).toContain('technicians');
    expect(result.metrics.resourceCost).toBeCloseTo(29800, 6);
  });
  it('keeps scenarios isolated and adds actual costs when expanding capacity', () => {
    const model = new DeliveryNetworkExample().model();
    const original = structuredClone(model);
    const baseline = runSimulation(model);
    const expanded = runSimulation(model, { scenarioId: 'whole-flow-capacity' });
    const returnsRush = runSimulation(model, { scenarioId: 'returns-rush' });
    expect(model).toEqual(original);
    expect(expanded.metrics.completed).toBeGreaterThan(baseline.metrics.completed);
    expect(expanded.metrics.resourceCost).toBeGreaterThan(baseline.metrics.resourceCost);
    expect(returnsRush.particleTypes['return'].created).toBeGreaterThan(
      baseline.particleTypes['return'].created,
    );
    expect(returnsRush.resources['technicians'].queue.maximum).toBeGreaterThan(
      baseline.resources['technicians'].queue.maximum,
    );
    expect(
      returnsRush.particleTypes.standard.completed + returnsRush.particleTypes.enterprise.completed,
    ).toBeLessThan(
      baseline.particleTypes.standard.completed + baseline.particleTypes.enterprise.completed,
    );
    expect(runSimulation(model)).toEqual(baseline);
  });
});
