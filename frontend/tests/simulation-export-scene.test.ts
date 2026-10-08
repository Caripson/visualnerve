import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderedScene } from '../src/export/rendered';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import {
  logicalNodeId,
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { simulationService, type SimulationView } from '../src/simulation/service';
import { simulationProcessCardId } from '../src/simulation/process-projection';

afterEach(() => vi.restoreAllMocks());

describe('simulation image/PDF scene geometry', () => {
  it('uses the same readable bank dimensions, positions and edges as the full 2D simulation', () => {
    const graph = createSimulationGraph('Kiosk export');
    const saved = structuredClone(graph);
    const live = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const scene = renderedScene(graph, 'complete', []);
    for (const node of live.nodes) {
      const exported = scene.nodes.find((entry) => entry.id === node.id)!;
      expect(exported.data.node).toMatchObject({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
    }
    expect(scene.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual(
      live.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId]),
    );
    expect(graph).toEqual(saved);
  });

  it('exports a selected projected capacity unit as its real editable work bank rather than an empty image', () => {
    const graph = createSimulationGraph('Three slots', createBasicModel({ capacity: 3 }));
    const work = graph.nodes.find((node) => node.externalId === 'work')!;
    const scene = renderedScene(graph, 'selected', [`simulation-capacity:${work.id}:2`]);
    expect(scene.nodes).toHaveLength(3);
    expect(scene.nodes.every((node) => logicalNodeId(node.data.node) === work.id)).toBe(true);
    expect(scene.nodes.every((node) => node.height === 280)).toBe(true);
    expect(scene.edges).toHaveLength(0);
    expect(scene.bounds.height).toBe(3 * 280 + 2 * 24);
    expect(graph.nodes).toHaveLength(3);
    expect(work.height).toBe(170);
  });

  it('uses selected scenario/live capacities and real resource connections without changing the base model', () => {
    const graph = createSimulationGraph('Scenario slots', createBasicModel());
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    graph.simulation!.scenarios = [
      {
        id: 'three-workers',
        name: 'Three workers',
        overrides: { nodes: { [work.id]: { work: { capacity: 3 } } } },
      },
    ];
    const run = {
      id: 'scenario-export',
      diagramId: graph.diagram.id,
      model: graph.simulation!,
      options: {
        scenarioId: 'three-workers',
        seed: 42,
        durationSeconds: graph.simulation!.defaults.durationSeconds,
      },
      status: 'paused' as const,
      createdAt: '',
      updatedAt: '',
    };
    const engine = new SimulationEngine(run.model, run.options);
    engine.advance(1);
    const view: SimulationView = { run, state: engine.state() };
    vi.spyOn(simulationService, 'current').mockReturnValue(view);
    const live = projectSimulationCapacityNodes(
      graph,
      projectSimulationRenderModel(graph, run),
      view.state,
    );
    const scene = renderedScene(graph, 'complete', []);
    expect(scene.nodes.map((node) => node.id)).toEqual(live.nodes.map((node) => node.id));
    expect(scene.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual(
      live.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId]),
    );
    expect(scene.nodes.filter((node) => logicalNodeId(node.data.node) === work.id)).toHaveLength(3);
    expect(work.type === 'work' && work.work.capacity).toBe(1);
  });

  it('keeps complete exports as real full flow and resolves a selected group to its true descendants', () => {
    const model = createBasicModel({ capacity: 2 });
    model.processes = [
      { id: 'delivery', name: 'Delivery' },
      { id: 'assembly', name: 'Assembly', parentId: 'delivery' },
    ];
    model.nodes[1].processId = 'assembly';
    model.nodes[2].processId = 'delivery';
    const graph = createSimulationGraph('Full hierarchy flow', model);
    const work = graph.nodes.find((node) => node.externalId === 'work')!;
    const outcome = graph.nodes.find((node) => node.externalId === 'outcome')!;
    const complete = renderedScene(graph, 'complete', []);
    expect(complete.nodes).toHaveLength(4);
    expect(complete.nodes.some((node) => node.type === 'simulation-process')).toBe(false);
    const selected = renderedScene(graph, 'selected', [simulationProcessCardId('delivery')]);
    expect(new Set(selected.nodes.map((node) => logicalNodeId(node.data.node)))).toEqual(
      new Set([work.id, outcome.id]),
    );
    expect(selected.edges).toHaveLength(2);
    expect(selected.edges.every((edge) => edge.target === outcome.id)).toBe(true);
    expect(graph.nodes).toHaveLength(3);
  });

  it('ignores an API-selected captured run after semantic topology changes, before a canvas mounts to detach it', () => {
    const graph = createSimulationGraph('Changed flow export', createBasicModel());
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    graph.simulation!.scenarios = [
      {
        id: 'three-workers',
        name: 'Three workers',
        overrides: { nodes: { [work.id]: { work: { capacity: 3 } } } },
      },
    ];
    const captured = structuredClone(graph.simulation!);
    const run = {
      id: 'api-captured-export',
      diagramId: graph.diagram.id,
      model: captured,
      options: {
        scenarioId: 'three-workers',
        seed: 42,
        durationSeconds: captured.defaults.durationSeconds,
        animated: false,
      },
      status: 'paused' as const,
      createdAt: '',
      updatedAt: '',
    };
    const engine = new SimulationEngine(run.model, run.options);
    engine.advance(1);
    const view: SimulationView = { run, state: engine.state() };
    vi.spyOn(simulationService, 'current').mockReturnValue(view);
    const changedModel = structuredClone(graph.simulation!);
    const outcome = changedModel.nodes.find((node) => node.type === 'outcome')!;
    // The latest model routes the source straight to the outcome. The archived
    // run still owns its earlier work bank; it must not size the changed flow.
    changedModel.edges[0].targetNodeId = outcome.id;
    const changedGraph = setSimulationModel(graph, changedModel);
    const expected = projectSimulationCapacityNodes(
      changedGraph,
      projectSimulationRenderModel(changedGraph),
    );
    const scene = renderedScene(changedGraph, 'complete', []);
    expect(scene.nodes.map((node) => node.id)).toEqual(expected.nodes.map((node) => node.id));
    expect(scene.nodes.filter((node) => logicalNodeId(node.data.node) === work.id)).toHaveLength(1);
    expect(scene.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual(
      expected.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId]),
    );
    expect(view.state?.nodes[work.id].capacity).toBe(3);
    expect(view.run.model).toEqual(captured);
  });
});
