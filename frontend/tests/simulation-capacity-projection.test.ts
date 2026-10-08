import { describe, expect, it } from 'vitest';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import {
  getSimulationCapacityCard,
  logicalNodeId,
  MAX_ADDITIONAL_CAPACITY_CARDS,
  MAX_CAPACITY_CARDS_PER_BANK,
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import type { SimulationModel } from '../src/simulation/types';
import {
  CAPACITY_CARD_GAP,
  layoutCapacityBanks,
  type CapacityBankGeometry,
} from '../src/simulation/capacity-layout';
import { SimulationCardSizing } from '../src/simulation/card-sizing';

function fixture(model: SimulationModel = createBasicModel({ capacity: 3 })) {
  const graph = createSimulationGraph('Capacity cards', model);
  const frozen = { model: structuredClone(graph.simulation!), options: { seed: 42 } };
  const projection = projectSimulationRenderModel(graph, frozen);
  return {
    graph,
    frozen,
    projection,
    work: graph.nodes.find((node) => node.externalId === 'work')!,
  };
}

describe('runtime full capacity cards', () => {
  it('keeps exact prior collision rules across negative coordinates, unequal banks and very wide imported shapes', () => {
    const { work } = fixture();
    const banks: CapacityBankGeometry[] = Array.from({ length: 60 }, (_, index) => ({
      node: {
        ...work,
        id: `layout-${index}`,
        x: (index % 5) * 150 - 400,
        y: Math.floor(index / 5) * 80 - 220,
        width: 90 + (index % 3) * 45,
        height: 70 + (index % 4) * 30,
      },
      cards: index % 13 === 0 ? 3 : 1,
    }));
    banks.unshift({
      node: { ...work, id: 'wide', x: -1_000_000, y: -1000, width: 2_000_000, height: 30 },
      cards: 2,
    });
    banks.push({
      node: {
        ...work,
        id: 'frame',
        nodeType: 'group',
        x: -700,
        y: -800,
        width: 10_000,
        height: 10_000,
      },
      cards: 1,
    });
    const expected = new Map<string, { x: number; y: number }>();
    const occupied: { x: number; y: number; width: number; height: number }[] = [];
    for (const { node } of banks)
      if (node.nodeType === 'group') expected.set(node.id, { x: node.x, y: node.y });
    for (const { node, cards } of banks
      .filter(({ node }) => node.nodeType !== 'group')
      .sort(
        (a, b) => a.node.y - b.node.y || a.node.x - b.node.x || a.node.id.localeCompare(b.node.id),
      )) {
      const height = cards * node.height + (cards - 1) * CAPACITY_CARD_GAP;
      let y = node.y;
      while (true) {
        const collisions = occupied.filter(
          (box) =>
            node.x < box.x + box.width + CAPACITY_CARD_GAP &&
            node.x + node.width + CAPACITY_CARD_GAP > box.x &&
            y < box.y + box.height + CAPACITY_CARD_GAP &&
            y + height + CAPACITY_CARD_GAP > box.y,
        );
        if (!collisions.length) break;
        y = Math.max(...collisions.map((box) => box.y + box.height + CAPACITY_CARD_GAP));
      }
      expected.set(node.id, { x: node.x, y });
      occupied.push({ x: node.x, y, width: node.width, height });
    }
    expect(layoutCapacityBanks(banks)).toEqual(expected);
    expect(layoutCapacityBanks(banks).get('frame')).toEqual({ x: -700, y: -800 });
  });

  it('places 7,000 process nodes with deterministic nonoverlap using nearby candidates instead of all-node scans', () => {
    const { work } = fixture();
    const banks: CapacityBankGeometry[] = Array.from({ length: 7000 }, (_, index) => ({
      node: {
        ...work,
        id: `large-${index}`,
        x: (index % 20) * 280,
        y: Math.floor(index / 20) * 220,
      },
      cards: index === 0 ? 8 : 1,
    }));
    const stats = { candidateChecks: 0, bucketQueries: 0 };
    const positions = layoutCapacityBanks(banks, stats);
    expect(positions.size).toBe(7000);
    expect(stats.candidateChecks).toBeGreaterThan(1000);
    expect(stats.candidateChecks).toBeLessThan(1_000_000);
    expect(positions).toEqual(layoutCapacityBanks(banks));
    const columns = new Map<number, CapacityBankGeometry[]>();
    for (const bank of banks) columns.set(bank.node.x, [...(columns.get(bank.node.x) ?? []), bank]);
    for (const column of columns.values()) {
      column.sort((a, b) => positions.get(a.node.id)!.y - positions.get(b.node.id)!.y);
      for (let index = 1; index < column.length; index++) {
        const previous = column[index - 1];
        const end =
          positions.get(previous.node.id)!.y +
          previous.cards * previous.node.height +
          previous.cards * CAPACITY_CARD_GAP;
        expect(positions.get(column[index].node.id)!.y).toBeGreaterThanOrEqual(end);
      }
    }
    expect(positions.get('large-0')).toEqual({ x: 0, y: 0 });
    expect(banks[20].node.y).toBe(220);
  });

  it('projects full native styled cards with stable logical identity without changing the document', () => {
    const { graph, projection, work } = fixture();
    work.color = '#ae2345';
    work.metadata.areaIcon = 'truck';
    work.description = 'Full native description';
    work.status = 'done';
    const original = structuredClone(graph);
    const view = projectSimulationCapacityNodes(graph, projection);
    const group = view.capacityGroups.get(work.id)!;
    expect(group).toMatchObject({ actualCapacity: 3, hidden: 0 });
    expect(group.cardIds[0]).toBe(work.id);
    expect(group.cardIds).toHaveLength(3);
    group.cardIds.forEach((id, index) => {
      const node = view.nodes.find((node) => node.id === id)!;
      expect(node).toMatchObject({
        title: `Work ${index + 1}`,
        nodeType: work.nodeType,
        color: work.color,
        width: work.width,
        height: new SimulationCardSizing().fit(
          work,
          graph.simulation!.nodes.find((node) => node.id === work.id),
        ).height,
        description: work.description,
        status: work.status,
        metadata: { areaIcon: 'truck', simulationProjected: true },
      });
      expect(logicalNodeId(node)).toBe(work.id);
      expect(getSimulationCapacityCard(node)).toEqual({
        logicalId: work.id,
        unit: index + 1,
        total: 3,
        hidden: 0,
      });
    });
    expect(logicalNodeId(work)).toBe(work.id);
    expect(getSimulationCapacityCard(work)).toBeUndefined();
    expect(graph).toEqual(original);
    expect(view.model).toBe(projection.model);
    expect(view.model.nodes).toHaveLength(3);
  });

  it('reserves whole banks and moves colliding lower nodes only in the read-only view', () => {
    const { graph, projection, work } = fixture();
    const outcome = graph.nodes.find((node) => node.externalId === 'outcome')!;
    outcome.x = work.x;
    outcome.y = work.y + work.height + 12;
    const original = structuredClone(graph);
    const view = projectSimulationCapacityNodes(graph, projection);
    const cards = view.capacityGroups
      .get(work.id)!
      .cardIds.map((id) => view.nodes.find((node) => node.id === id)!);
    const moved = view.nodes.find((node) => node.id === outcome.id)!;
    for (const card of cards) expect(card.y + card.height).toBeLessThan(moved.y);
    expect(moved.metadata.simulationProjected).toBe(true);
    expect(cards[0].y).toBe(work.y);
    expect(new Set(cards.map((card) => card.y)).size).toBe(3);
    expect(graph).toEqual(original);
  });

  it('uses actual live capacities, reuses geometry across busy/clock changes, and contracts on scale-down', () => {
    const { graph, frozen, projection, work } = fixture(createBasicModel());
    const state = new SimulationEngine(frozen.model).state();
    state.nodes[work.id].capacity = 3;
    const expanded = projectSimulationCapacityNodes(graph, projection, state);
    expect(expanded.capacityGroups.get(work.id)!.cardIds).toHaveLength(3);
    const later = structuredClone(state);
    later.timeSeconds = 100;
    later.nodes[work.id].busy = 2;
    expect(projectSimulationCapacityNodes(graph, projection, later)).toBe(expanded);
    later.nodes[work.id].capacity = 1;
    const contracted = projectSimulationCapacityNodes(graph, projection, later);
    expect(contracted.capacityGroups.get(work.id)!.cardIds).toEqual([work.id]);
    expect(contracted.nodes.find((node) => node.id === work.id)!.title).toBe('Work');
    expect(expanded.capacityGroups.get(work.id)!.cardIds).toHaveLength(3);
  });

  it('includes configured efficiency capacity increases before a state snapshot is available', () => {
    const model = createBasicModel();
    model.improvements.push({
      id: 'extra',
      name: 'Extra capacity',
      enabled: true,
      nodeId: 'work',
      investmentCost: 0,
      capacityIncrease: 2,
    });
    const { graph, projection, work } = fixture(model);
    expect(
      projectSimulationCapacityNodes(graph, projection).capacityGroups.get(work.id)!.actualCapacity,
    ).toBe(3);
  });

  it('bounds banks and total extra cards while retaining exact capacity and overflow', () => {
    const model = createBasicModel({ capacity: 100 });
    for (let index = 0; index < 50; index++)
      model.nodes.push({
        id: `extra-${index}`,
        name: `Work ${index}`,
        type: 'work',
        work: { capacity: 100, processingSeconds: 1 },
      });
    const { graph, projection } = fixture(model);
    const view = projectSimulationCapacityNodes(graph, projection);
    expect(view.nodes.length - graph.nodes.length).toBe(MAX_ADDITIONAL_CAPACITY_CARDS);
    for (const [id, group] of view.capacityGroups) {
      expect(group.cardIds.length).toBeLessThanOrEqual(MAX_CAPACITY_CARDS_PER_BANK);
      expect(group.actualCapacity).toBe(100);
      expect(group.hidden).toBe(100 - group.cardIds.length);
      expect(
        view.nodes.find((node) => node.id === group.cardIds.at(-1))!.metadata
          .simulationCapacityHidden,
      ).toBe(group.hidden);
      expect(group.cardIds[0]).toBe(id);
    }
  });

  it('projects linear fan branches with semantic edge provenance and source-unit departures into one shared input', () => {
    const model = createBasicModel({ capacity: 3 });
    model.nodes.push({
      id: 'second-work',
      name: 'Second work',
      type: 'work',
      work: { capacity: 3, processingSeconds: 1 },
    });
    model.edges[1].targetNodeId = 'second-work';
    model.edges.push({ id: 'second-out', sourceNodeId: 'second-work', targetNodeId: 'outcome' });
    const { graph, projection, work } = fixture(model);
    const view = projectSimulationCapacityNodes(graph, projection);
    const second = graph.nodes.find((node) => node.externalId === 'second-work')!;
    const native = graph.edges.find(
      (edge) => edge.sourceNodeId === work.id && edge.targetNodeId === second.id,
    )!;
    const branches = view.edges.filter(
      (edge) => edge.metadata.simulationLogicalEdgeId === native.id,
    );
    expect(branches).toHaveLength(5);
    expect(
      branches.some(
        (edge) =>
          edge.metadata.simulationSourceCapacityUnit === 2 &&
          edge.metadata.simulationTargetCapacityUnit === 1,
      ),
    ).toBe(true);
    for (const edge of branches) {
      expect(edge.metadata).toMatchObject({
        simulationProjected: true,
        simulationLogicalSourceNodeId: work.id,
        simulationLogicalTargetNodeId: second.id,
      });
      expect(
        edge.metadata.simulationSourceCapacityUnit === 1 ||
          edge.metadata.simulationTargetCapacityUnit === 1,
      ).toBe(true);
      expect(view.nodes.some((node) => node.id === edge.sourceNodeId)).toBe(true);
      expect(view.nodes.some((node) => node.id === edge.targetNodeId)).toBe(true);
    }
    expect(branches[0].id).toBe(native.id);
    expect(new Set(view.edges.map((edge) => edge.id)).size).toBe(view.edges.length);
  });

  it('keeps one shared resource pool and semantic requirement behind its readable unit links', () => {
    const model = createBasicModel({ capacity: 3 });
    model.resources.push({ id: 'staff', name: 'Staff', capacity: 2, unit: 'employee' });
    model.nodes.push({ id: 'staff-display', name: 'Staff', type: 'resource', resourceId: 'staff' });
    const work = model.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    const { graph, projection } = fixture(model);
    const view = projectSimulationCapacityNodes(graph, projection);
    expect(view.resourceEdges).toHaveLength(4);
    expect(
      view.resourceEdges.every(
        (edge) =>
          edge.label === '1 employee · shared pool' &&
          edge.metadata.simulationResourcePool === true &&
          edge.metadata.simulationResourceUnits === 1,
      ),
    ).toBe(true);
    expect(view.model.resources).toHaveLength(1);
    expect(view.model.nodes.find((node) => node.type === 'work')).toMatchObject({
      work: { resourceRequirements: [{ resourceId: 'staff', units: 1 }] },
    });
  });

  it('retains a zero-capacity logical hub without claiming there is an active unit', () => {
    const { graph, projection, work } = fixture(createBasicModel({ capacity: 0 }));
    const view = projectSimulationCapacityNodes(graph, projection);
    expect(view.capacityGroups.get(work.id)).toEqual({
      cardIds: [work.id],
      actualCapacity: 0,
      hidden: 0,
    });
    expect(view.nodes.find((node) => node.id === work.id)).toMatchObject({
      title: 'Work',
      metadata: { simulationCapacityTotal: 0 },
    });
  });
});
