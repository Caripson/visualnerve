import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../src/canvas/projection';
import { instantiate } from '../src/templates/templates';
import { SimulationSummaryContext } from '../src/simulation/summary-context';
import { ResourcePoolCard } from '../src/simulation/ResourcePoolCard';
import { SimulationEngine } from '../src/simulation/engine';
import { ProcessProjection } from '../src/simulation/process-projection';
import type { SimulationView } from '../src/simulation/service';
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  Handle: () => null,
}));

describe('typed hierarchy resource pools', () => {
  it('shows actual link units and transfer totals without invented capacity units', () => {
    const graph = instantiate('network-multi-site-capacity', 'Links');
    const model = graph.simulation!,
      engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    const config = model.nodes.find((node) => node.type === 'resource')!;
    if (config.type !== 'resource') throw Error('pool');
    const node = graph.nodes.find((node) => node.id === config.id)!;
    const view = { state, run: { model, options: {}, id: 'synthetic-pool-run' } } as SimulationView;
    const { container } = render(
      <SimulationSummaryContext.Provider value={{ diagramId: graph.diagram.id, model, view }}>
        <ResourcePoolCard
          {...({
            id: node.id,
            type: 'simulation-resource-pool',
            selected: false,
            dragging: false,
            draggable: false,
            selectable: true,
            deletable: false,
            zIndex: 0,
            isConnectable: false,
            positionAbsoluteX: node.x,
            positionAbsoluteY: node.y,
            width: node.width,
            height: node.height,
            data: { node, owners: [], childCount: 0, exporting: true },
          } as NodeProps<CanvasNode>)}
        />
      </SimulationSummaryContext.Provider>,
    );
    expect(screen.getByText('Bandwidth pool')).toBeVisible();
    expect(screen.getAllByText('50 Mbps')).toHaveLength(2);
    expect(screen.getByText(/active transfers · fair sharing/)).toBeVisible();
    expect(container.querySelector('.simulation-traffic-badge')).toHaveAttribute(
      'title',
      '2 active transfers · fair sharing',
    );
    expect(screen.getByText(/Transferred payload:/)).toHaveTextContent('MiB');
    expect(container.querySelector('.simulation-pool-units')).toBeNull();
    expect(container.textContent).not.toMatch(/\+42|\+92/);
  });
  it('keeps one typed pool and reserves enough hierarchy space for its domain summary', () => {
    const graph = instantiate('network-multi-site-capacity', 'Hierarchy');
    const projected = new ProcessProjection(graph.simulation!).project(graph, {
      mode: 'hierarchy',
    }).graph;
    const pools = projected.nodes.filter((node) => node.metadata.simulationPoolSummary);
    expect(pools).toHaveLength(2);
    for (const node of pools) {
      expect(node.metadata.simulationPoolDimension).toBe('bandwidth');
      expect(node.width).toBe(280);
      expect(node.height).toBe(260);
      expect(node.metadata.simulationCapacityHidden).toBeUndefined();
    }
    expect(Math.abs(pools[0].x - pools[1].x)).toBeGreaterThan(pools[0].width);
  });
});

it('keeps the aggregate database canvas queue clear while CPU admission is blocked', () => {
  const graph = instantiate('api-compute-capacity', 'DB queue'),
    model = graph.simulation!;
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
  const config = model.nodes.find((node) => node.type === 'resource' && node.resourceId === 'db')!,
    node = graph.nodes.find((node) => node.id === config.id)!;
  const view = { state, run: { id: 'synthetic-free-db', model, options: {} } } as SimulationView;
  const { container } = render(
    <SimulationSummaryContext.Provider value={{ diagramId: graph.diagram.id, model, view }}>
      <ResourcePoolCard
        {...({
          id: node.id,
          type: 'simulation-resource-pool',
          selected: false,
          dragging: false,
          draggable: false,
          selectable: true,
          deletable: false,
          zIndex: 0,
          isConnectable: false,
          positionAbsoluteX: node.x,
          positionAbsoluteY: node.y,
          data: { node, owners: [], childCount: 0, exporting: true },
        } as NodeProps<CanvasNode>)}
      />
    </SimulationSummaryContext.Provider>,
  );
  expect(state.resources.db.queue.current).toBe(5);
  expect(container.querySelector('.simulation-pool-summary')).toHaveAttribute('data-queue', '0');
  expect(container.querySelector('.simulation-pool-summary')).toHaveAttribute(
    'data-traffic',
    'clear',
  );
  expect(container.querySelector('.simulation-pool-values > span:last-child')).toHaveTextContent(
    'Queued0',
  );
  expect(container.textContent).not.toContain('Queued demand');
});
