import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { instantiate } from '../src/templates/templates';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import {
  projectSimulationRenderModel,
  projectSimulationCapacityNodes,
  logicalNodeId,
} from '../src/simulation/render-model';
import { simulationNodeTraffic } from '../src/simulation/traffic';
import { SimulationEngine } from '../src/simulation/engine';
import { SimulationPresentationSlots } from '../src/simulation/presentation-slots';
import { buildSimulationParticleScene } from '../src/simulation/particle-scene';
import { indexSimulationParticleView } from '../src/simulation/particle-view';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import { SimulationSummaryContext } from '../src/simulation/summary-context';
import type { SimulationView } from '../src/simulation/service';

const keys = [
  'api-compute-capacity',
  'network-multi-site-capacity',
  'energy-power-capacity',
  'datacenter-capacity',
];
describe('infrastructure concurrency presentation', () => {
  it.each(keys)(
    'keeps each %s Work as one logical card with exact capacity and no replica overflow',
    (key) => {
      const graph = instantiate(key, 'Capacity'),
        before = structuredClone(graph.simulation);
      const projected = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
      for (const config of graph.simulation!.nodes.filter((node) => node.type === 'work')) {
        if (config.type !== 'work') throw Error('Work');
        const cards = projected.nodes.filter((node) => logicalNodeId(node) === config.id);
        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe(config.name);
        expect(projected.capacityGroups.get(config.id)).toMatchObject({
          actualCapacity: config.work.capacity,
          hidden: 0,
          aggregate: true,
        });
        expect(cards[0].metadata.simulationAggregateCapacity).toBe(true);
      }
      for (const resource of graph.simulation!.nodes.filter((node) => node.type === 'resource'))
        expect(projected.nodes.filter((node) => logicalNodeId(node) === resource.id)).toHaveLength(
          1,
        );
      expect(graph.simulation).toEqual(before);
    },
  );
  it('preserves legacy workstation replica banks', () => {
    const graph = createSimulationGraph('Legacy', createBasicModel({ capacity: 3 }));
    const config = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const projected = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    expect(projected.nodes.filter((node) => logicalNodeId(node) === config.id)).toHaveLength(3);
    expect(projected.capacityGroups.get(config.id)?.aggregate).not.toBe(true);
  });
  it('displays actual active/queued counts and bounded distinct real processing samples on one Work card', () => {
    const graph = instantiate('api-compute-capacity', 'Processing'),
      model = graph.simulation!;
    const source = model.nodes.find((node) => node.type === 'source')!;
    if (source.type !== 'source') throw Error('Source');
    source.source = { ...source.source, ratePerHour: 0, burst: 6, maxCount: 6 };
    model.resources.find((pool) => pool.infrastructure?.kind === 'cpu')!.capacity = 4;
    model.resources.find((pool) => pool.infrastructure?.kind === 'memory')!.capacity = 2048;
    const work = model.nodes.find((node) => node.type === 'work' && node.work.infrastructure?.cpu)!;
    if (work.type !== 'work') throw Error('Work');
    work.work.infrastructure!.cpu!.coreSeconds = 10;
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state(),
      before = structuredClone(state);
    const projection = projectSimulationCapacityNodes(
      graph,
      projectSimulationRenderModel(graph),
      state,
    );
    const node = projection.nodes.find((node) => node.id === work.id)!;
    const view = {
      state,
      run: { id: 'synthetic-aggregate-run', model, options: {} },
    } as SimulationView;
    const { container } = render(
      <SimulationSummaryContext.Provider value={{ diagramId: graph.diagram.id, model, view }}>
        <SimulationNodeSummary id={node.id} node={node} />
      </SimulationSummaryContext.Provider>,
    );
    expect(screen.getByText('4 active / 32 in-flight slots')).toBeVisible();
    expect(container.querySelector('.simulation-capacity-card-unit')).toBeNull();
    expect(container.querySelector('.simulation-capacity-units')).toBeNull();
    const slots = new SimulationPresentationSlots().reconcile(view.run.id, state);
    const scene = buildSimulationParticleScene(
      indexSimulationParticleView({ ...graph, nodes: projection.nodes, edges: projection.edges }),
      model,
      state,
      slots,
    );
    const marks = scene.processing.filter((mark) => mark.node.id === work.id);
    expect(marks).toHaveLength(4);
    expect(marks.map((mark) => mark.index)).toEqual([0, 1, 2, 3]);
    expect(marks.map((mark) => mark.particle.id)).toEqual(
      state.particles
        .filter((particle) => particle.nodeId === work.id && particle.status === 'processing')
        .map((particle) => particle.id),
    );
    expect(state).toEqual(before);
  });
});

it('observes a real common database constraint with spare CPU rather than inventing database I/O physics', () => {
  const model = instantiate('api-compute-capacity', 'DB bottleneck').simulation!;
  const source = model.nodes.find((node) => node.type === 'source')!;
  if (source.type !== 'source') throw Error('Source');
  source.source = { ...source.source, ratePerHour: 0, burst: 6, maxCount: 6 };
  model.resources.find((resource) => resource.id === 'cpu')!.capacity = 4;
  model.resources.find((resource) => resource.id === 'ram')!.capacity = 2048;
  model.resources.find((resource) => resource.id === 'db')!.capacity = 1;
  const work = model.nodes.find((node) => node.type === 'work' && node.work.infrastructure?.cpu)!;
  if (work.type !== 'work') throw Error('Work');
  work.work.infrastructure!.cpu!.coreSeconds = 10;
  const engine = new SimulationEngine(model);
  engine.advance(1);
  const state = engine.state();
  expect(state.nodes[work.id]).toMatchObject({ busy: 1, blockedResourceIds: ['db'] });
  expect(state.resources.db).toMatchObject({ capacity: 1, busy: 1, blockedNodeIds: [work.id] });
  expect(state.resources.cpu).toMatchObject({ capacity: 4, busy: 1, blockedNodeIds: [] });
  expect(state.infrastructure!.cpu.cpu.reservedCores).toBe(1);
  const display = model.nodes.find((node) => node.type === 'resource' && node.resourceId === 'db')!;
  expect(simulationNodeTraffic(display, state, model)).toMatchObject({
    level: 'congested',
    label: 'Constrained',
    queue: 5,
  });
});

it('does not turn free database connections into queued demand when only CPU admission is blocked', () => {
  const graph = instantiate('api-compute-capacity', 'CPU blocker');
  const model = graph.simulation!;
  const source = model.nodes.find((node) => node.type === 'source')!;
  if (source.type !== 'source') throw Error('Source');
  source.source = { ...source.source, ratePerHour: 0, burst: 6, maxCount: 6 };
  model.resources.find((resource) => resource.id === 'cpu')!.capacity = 1;
  model.resources.find((resource) => resource.id === 'ram')!.capacity = 2048;
  const work = model.nodes.find((node) => node.type === 'work' && node.work.infrastructure?.cpu)!;
  if (work.type !== 'work') throw Error('Work');
  work.work.infrastructure!.cpu!.coreSeconds = 10;
  const engine = new SimulationEngine(model);
  engine.advance(1);
  const state = engine.state();
  expect(state.nodes[work.id].blockedResourceIds).toEqual(['cpu']);
  expect(state.resources.db.queue.current).toBe(5); // Preserved raw all-consumer history.
  expect(state.resources.db.blockedNodeIds).toEqual([]);
  const display = model.nodes.find((node) => node.type === 'resource' && node.resourceId === 'db')!;
  expect(simulationNodeTraffic(display, state, model)).toMatchObject({
    level: 'clear',
    label: 'Clear',
    queue: 0,
  });
  const node = graph.nodes.find((node) => node.id === display.id)!;
  const view = { state, run: { id: 'synthetic-db-queue', model, options: {} } } as SimulationView;
  const { container } = render(
    <SimulationSummaryContext.Provider
      value={{ diagramId: graph.diagram.id, model: graph.simulation, view }}
    >
      <SimulationNodeSummary id={node.id} node={node} />
    </SimulationSummaryContext.Provider>,
  );
  expect(container.querySelector('[data-queue]')).toHaveAttribute('data-queue', '0');
  expect(container.textContent).not.toContain('Queued demand');
  expect(container.querySelector('.simulation-node-queue')).toHaveTextContent('0');
});
