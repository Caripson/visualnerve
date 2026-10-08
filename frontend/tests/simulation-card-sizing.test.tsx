import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationCardSizing } from '../src/simulation/card-sizing';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import { CAPACITY_CARD_GAP } from '../src/simulation/capacity-layout';
import { useEditor } from '../src/state/editor';
import type { SimulationView } from '../src/simulation/service';

let view: SimulationView | undefined;
vi.mock('../src/simulation/useSimulation', () => ({ useSimulation: () => view }));
afterEach(() => {
  cleanup();
  view = undefined;
  useEditor.getState().setGraph(null);
});

describe('simulation content geometry and readable details', () => {
  it('gives small legacy cards room without changing saved sizes or shrinking larger user nodes', () => {
    const graph = createSimulationGraph('Small legacy cards', createBasicModel());
    const before = structuredClone(graph);
    const sizing = new SimulationCardSizing();
    const work = graph.nodes.find((node) => node.externalId === 'work')!;
    const semantic = graph.simulation!.nodes.find((node) => node.id === work.id)!;
    const sized = sizing.fit(work, semantic);
    expect(work.height).toBe(170);
    expect(sized).toMatchObject({ ...work, height: 280 });
    const enlarged = { ...work, height: 420 };
    expect(sizing.fit(enlarged, semantic)).toBe(enlarged);
    expect(sizing.fit(work)).toBe(work);
    expect(graph).toEqual(before);
  });
  it('keeps grown kiosk cards apart even when every capacity bank has only one unit', () => {
    const graph = createSimulationGraph('Kiosk');
    const before = structuredClone(graph);
    const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const work = graph.nodes.find((node) => node.externalId === 'core-sales')!;
    expect(projection.nodes.find((node) => node.id === work.id)!.height).toBe(280);
    expect(projection.capacityGroups.get(work.id)!.cardIds).toHaveLength(1);
    for (let index = 0; index < projection.nodes.length; index++)
      for (const other of projection.nodes.slice(index + 1)) {
        const node = projection.nodes[index];
        expect(
          node.x < other.x + other.width &&
            node.x + node.width > other.x &&
            node.y < other.y + other.height &&
            node.y + node.height > other.y,
        ).toBe(false);
      }
    expect(graph).toEqual(before);
    expect(projection.model).toBe(graph.simulation);
  });
  it('uses the actual grown height for every bank stride and leaves engine counts/economics unchanged', () => {
    const graph = createSimulationGraph('Four slots', createBasicModel({ capacity: 4 }));
    const before = structuredClone(graph);
    const result = runSimulation(graph.simulation!);
    const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const work = graph.nodes.find((node) => node.externalId === 'work')!;
    const cards = projection.capacityGroups
      .get(work.id)!
      .cardIds.map((id) => projection.nodes.find((node) => node.id === id)!);
    expect(cards).toHaveLength(4);
    for (let index = 1; index < cards.length; index++)
      expect(cards[index].y - cards[index - 1].y).toBe(cards[index - 1].height + CAPACITY_CARD_GAP);
    expect(runSimulation(graph.simulation!).metrics).toEqual(result.metrics);
    expect(graph).toEqual(before);
  });
  it('exposes full touch-readable resources with stable status and queue outside the scroll area', () => {
    const model = createBasicModel({ particles: 3 });
    const work = model.nodes.find((node) => node.type === 'work')!;
    if (work.type !== 'work') throw Error('Work fixture');
    const resourceName =
      'Shared staff with a long, complete name that must remain readable without hovering on a phone';
    model.resources.push({ id: 'staff', name: resourceName, capacity: 1, unit: 'employee' });
    work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    const graph = createSimulationGraph('Readable shared staff', model);
    const engine = new SimulationEngine(graph.simulation!);
    engine.advance(1);
    view = {
      run: {
        id: 'content-test',
        diagramId: graph.diagram.id,
        model: graph.simulation!,
        options: { seed: 42, durationSeconds: graph.simulation!.defaults.durationSeconds },
        status: 'running',
        createdAt: '',
        updatedAt: '',
      },
      state: engine.state(),
    };
    useEditor.getState().setGraph(graph);
    const node = projectSimulationCapacityNodes(
      graph,
      projectSimulationRenderModel(graph),
    ).nodes.find((entry) => entry.externalId === 'work')!;
    const bubbled = vi.fn();
    const { container } = render(
      <div onKeyDown={bubbled}>
        <SimulationNodeSummary id={node.id} node={node} />
      </div>,
    );
    const details = screen.getByRole('region', { name: 'Simulation details for Work' });
    expect(details).toHaveAttribute('tabindex', '0');
    expect(details).toHaveAttribute('data-node-scroll');
    expect(details).toHaveTextContent(resourceName);
    expect(details).not.toHaveTextContent('…');
    const status = container.querySelector('.simulation-node-state')!;
    const queue = screen.getByText(/^Queue 2/);
    expect(details.contains(status)).toBe(false);
    expect(details.contains(queue)).toBe(false);
    fireEvent.keyDown(details, { key: 'ArrowDown' });
    expect(bubbled).not.toHaveBeenCalled();
  });
});
