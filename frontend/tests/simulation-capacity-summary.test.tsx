import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import { useEditor } from '../src/state/editor';
import type { SimulationView } from '../src/simulation/service';
import { getSimulationPresentationSlots } from '../src/simulation/presentation-slots';

let view: SimulationView | undefined;
vi.mock('../src/simulation/useSimulation', () => ({ useSimulation: () => view }));
afterEach(() => {
  cleanup();
  view = undefined;
  useEditor.getState().setGraph(null);
});

function fixture(capacity = 3) {
  const graph = createSimulationGraph('Capacity summaries', createBasicModel({ capacity }));
  const frozen = {
    model: structuredClone(graph.simulation!),
    options: { seed: 42, durationSeconds: 86400 },
  };
  const engine = new SimulationEngine(frozen.model);
  engine.advance(1);
  const state = engine.state();
  view = {
    run: {
      ...frozen,
      id: `capacity-summary-${capacity}`,
      diagramId: graph.diagram.id,
      status: 'running',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    },
    state,
  };
  useEditor.getState().setGraph(graph);
  const projection = projectSimulationCapacityNodes(
    graph,
    projectSimulationRenderModel(graph, frozen),
    state,
  );
  const logicalId = graph.nodes.find((node) => node.externalId === 'work')!.id;
  const cards = projection.capacityGroups
    .get(logicalId)!
    .cardIds.map((id) => projection.nodes.find((node) => node.id === id)!);
  return { graph, logicalId, cards };
}

describe('capacity card node summaries', () => {
  it('uses physical selectors, one shared queue, and real processing occupancy without nested tiny boxes', () => {
    const { logicalId, cards } = fixture();
    const { container } = render(
      <>
        {cards.map((node) => (
          <SimulationNodeSummary key={node.id} id={node.id} node={node} />
        ))}
      </>,
    );
    expect(screen.getByText('Unit 1 of 3 · occupied')).toBeInTheDocument();
    expect(screen.getByText('Unit 2 of 3 · occupied')).toBeInTheDocument();
    expect(screen.getByText('Unit 3 of 3 · occupied')).toBeInTheDocument();
    expect(screen.getAllByText(/^Queue 7/)).toHaveLength(1);
    expect(container.querySelectorAll('.simulation-capacity-units')).toHaveLength(0);
    expect(container.querySelectorAll(`[data-simulation-node="${logicalId}"]`)).toHaveLength(1);
    expect(
      container.querySelectorAll(`[data-simulation-logical-node="${logicalId}"]`),
    ).toHaveLength(3);
    expect(container.querySelectorAll('[data-queue]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-capacity-occupied="true"]')).toHaveLength(3);
  });

  it('labels aggregated overflow explicitly while retaining actual capacity', () => {
    const { cards } = fixture(20);
    render(<SimulationNodeSummary id={cards.at(-1)!.id} node={cards.at(-1)!} />);
    expect(screen.getByText(/Capacity 20/)).toBeInTheDocument();
    expect(screen.getByLabelText('12 additional capacity units aggregated')).toHaveTextContent(
      '+12 units aggregated',
    );
    expect(screen.queryByText(/^Queue/)).not.toBeInTheDocument();
  });

  it('includes an occupied hidden slot in the final card after the global card budget is exhausted', () => {
    const model = createBasicModel({ particles: 1, capacity: 3 });
    const work = model.nodes.find((node) => node.type === 'work')!;
    model.particleTypes.push({
      ...model.particleTypes[0],
      id: 'complex',
      name: 'Complex',
      complexity: { min: 2, max: 2 },
    });
    model.nodes = model.nodes.filter((node) => node !== work);
    for (let index = 0; index < 37; index++)
      model.nodes.push({
        id: `bank-${index}`,
        name: `Bank ${index}`,
        type: 'work',
        work: { capacity: 8, processingSeconds: 1 },
      });
    model.nodes.push(
      {
        id: 'complex-source',
        name: 'Complex arrivals',
        type: 'source',
        source: { particleTypeId: 'complex', burst: 1 },
      },
      work,
    );
    model.edges.push({
      id: 'complex-work',
      sourceNodeId: 'complex-source',
      targetNodeId: 'work',
      travelSeconds: 0,
    });
    const graph = createSimulationGraph('Global budget', model);
    const frozen = {
      model: structuredClone(graph.simulation!),
      options: { seed: 42, durationSeconds: 86400 },
    };
    const engine = new SimulationEngine(frozen.model);
    const logicalId = graph.nodes.find((node) => node.externalId === 'work')!.id;
    engine.advance(1);
    expect(
      getSimulationPresentationSlots('global-card-budget', engine.state()).occupancy(logicalId)
        .displayedBusyUnits,
    ).toEqual([1, 2]);
    engine.advance(61);
    const state = engine.state();
    expect(
      getSimulationPresentationSlots('global-card-budget', state).occupancy(logicalId)
        .displayedBusyUnits,
    ).toEqual([2]);
    view = {
      run: {
        ...frozen,
        id: 'global-card-budget',
        diagramId: graph.diagram.id,
        status: 'running',
        createdAt: '2026-10-07T00:00:00Z',
        updatedAt: '2026-10-07T00:00:00Z',
      },
      state,
    };
    useEditor.getState().setGraph(graph);
    const projection = projectSimulationCapacityNodes(
      graph,
      projectSimulationRenderModel(graph, frozen),
      state,
    );
    expect(projection.capacityGroups.get(logicalId)).toMatchObject({
      cardIds: [logicalId],
      actualCapacity: 3,
      hidden: 2,
    });
    const card = projection.nodes.find((node) => node.id === logicalId)!;
    const { container } = render(<SimulationNodeSummary id={card.id} node={card} />);
    expect(screen.getByText('Unit 1 of 3 · occupied')).toBeInTheDocument();
    expect(screen.getByLabelText('2 additional capacity units aggregated')).toBeInTheDocument();
    expect(container.querySelector('[data-capacity-occupied="true"]')).toBeInTheDocument();
  });

  it('renders a disabled zero-capacity input hub without a working unit or occupancy claim', () => {
    const { cards } = fixture(0);
    const { container } = render(<SimulationNodeSummary id={cards[0].id} node={cards[0]} />);
    expect(screen.getByText('No active capacity')).toBeInTheDocument();
    expect(screen.getByText(/Capacity 0/)).toBeInTheDocument();
    expect(screen.queryByText(/^Unit /)).not.toBeInTheDocument();
    expect(container.querySelector('[data-capacity-occupied]')).not.toBeInTheDocument();
  });

  it('keeps the existing compact capacity summary outside the full-card projection', () => {
    const { logicalId } = fixture();
    const { container } = render(<SimulationNodeSummary id={logicalId} />);
    expect(container.querySelector('.simulation-capacity-units')).toBeInTheDocument();
    expect(screen.queryByText(/^Unit /)).not.toBeInTheDocument();
  });
});
