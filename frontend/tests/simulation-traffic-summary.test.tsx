import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationEngine } from '../src/simulation/engine';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import type { SimulationView } from '../src/simulation/service';
import { useEditor } from '../src/state/editor';

let view: SimulationView | undefined;
vi.mock('../src/simulation/useSimulation', () => ({ useSimulation: () => view }));
afterEach(() => {
  cleanup();
  view = undefined;
  useEditor.getState().setGraph(null);
});

it('labels real resource contention with text and an anchored queue even with spare Work capacity', () => {
  const model = createBasicModel({ particles: 2, capacity: 2 });
  const work = model.nodes[1];
  if (work.type !== 'work') throw Error('Work fixture');
  work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
  model.resources.push({ id: 'staff', name: 'Store staff', capacity: 1, unit: 'employee' });
  const graph = createSimulationGraph('Shared staff', model);
  const engine = new SimulationEngine(graph.simulation!);
  engine.advance(1);
  view = {
    run: {
      id: 'traffic-summary',
      diagramId: graph.diagram.id,
      model: graph.simulation!,
      options: { seed: 42, durationSeconds: 60 },
      status: 'running',
      createdAt: '',
      updatedAt: '',
    },
    state: engine.state(),
  };
  useEditor.getState().setGraph(graph);
  const node = graph.nodes.find((node) => node.externalId === 'work')!;
  const { container } = render(<SimulationNodeSummary id={node.id} node={node} />);
  const summary = container.querySelector('.simulation-node-summary')!;
  expect(summary).toHaveAttribute('data-traffic', 'congested');
  expect(summary).toHaveAttribute('data-queue', '1');
  expect(
    screen.getByLabelText('Resource blocked: Waiting for Store staff · 1 queued'),
  ).toHaveTextContent('Resource blocked');
  expect(screen.getByText(/^Queue 1/)).toHaveClass('simulation-node-queue');
  expect(screen.getByText(/Capacity 2 · 50%/)).toBeInTheDocument();
  expect(container.querySelector('.simulation-utilization-track')).toHaveStyle({
    '--simulation-utilization': '50%',
  });
  expect(screen.getByLabelText('Required resources: Store staff')).toBeInTheDocument();
});

it('uses a clearly labeled ready state before the first run, preserving ordinary diagram compatibility', () => {
  const graph = createSimulationGraph('New simulation', createBasicModel());
  useEditor.getState().setGraph(graph);
  const node = graph.nodes.find((node) => node.externalId === 'work')!;
  const { container } = render(<SimulationNodeSummary id={node.id} node={node} />);
  expect(container.querySelector('.simulation-node-summary')).toHaveAttribute(
    'data-traffic',
    'inactive',
  );
  expect(screen.getByLabelText('Ready: Run to observe traffic')).toBeInTheDocument();
  expect(screen.queryByText(/^Queue/)).not.toBeInTheDocument();
  useEditor.getState().setGraph({ ...graph, simulation: undefined });
  cleanup();
  expect(
    render(<SimulationNodeSummary id={node.id} node={node} />).container,
  ).toBeEmptyDOMElement();
});
