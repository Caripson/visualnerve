import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import {
  projectSimulationRenderModel,
  resolveSimulationRenderModel,
} from '../src/simulation/render-model';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import { useEditor } from '../src/state/editor';
import type { SimulationView } from '../src/simulation/service';
import type { Graph } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';

let view: SimulationView | undefined;
vi.mock('../src/simulation/useSimulation', () => ({ useSimulation: () => view }));
afterEach(() => {
  cleanup();
  view = undefined;
  useEditor.getState().setGraph(null);
});

function run(graph: Graph, scenarioId = 'dedicated-package-counter') {
  return {
    model: structuredClone(graph.simulation!),
    options: { scenarioId, durationSeconds: 600, seed: 42 },
  };
}

describe('truthful scenario resource rendering', () => {
  it('scopes resource efficiency to its requirement and applies a dual Work/resource feature only once', () => {
    const graph = createSimulationGraph('Kiosk'),
      frozen = run(graph, 'baseline');
    const work = graph.nodes.find((node) => node.externalId === 'core-sales')!;
    frozen.model.improvements.push({
      id: 'staff-efficiency',
      name: 'Staff efficiency',
      enabled: true,
      resourceId: 'store-staff',
      investmentCost: 100,
      resourceUnitsMultiplier: 0.5,
    });
    const bindings = projectSimulationRenderModel(graph, frozen).resourceEdges.filter(
      (edge) => edge.targetNodeId === work.id,
    );
    expect(
      bindings.find((edge) => edge.metadata.simulationResourceId === 'store-staff'),
    ).toMatchObject({ label: '0.5 employee', metadata: { simulationResourceUnits: 0.5 } });
    expect(
      bindings.find((edge) => edge.metadata.simulationResourceId === 'shared-counter'),
    ).toMatchObject({ label: '1 counter', metadata: { simulationResourceUnits: 1 } });
    const additional = structuredClone(frozen);
    additional.model.improvements.push({
      id: 'work-and-staff',
      name: 'Dual effect',
      enabled: true,
      nodeId: work.id,
      resourceId: 'store-staff',
      investmentCost: 100,
      resourceUnitsMultiplier: 0.8,
    });
    const combined = projectSimulationRenderModel(graph, additional).resourceEdges.filter(
      (edge) => edge.targetNodeId === work.id,
    );
    expect(
      combined.find((edge) => edge.metadata.simulationResourceId === 'store-staff')?.label,
    ).toBe('0.4 employee');
    expect(
      combined.find((edge) => edge.metadata.simulationResourceId === 'shared-counter')?.label,
    ).toBe('0.8 counter');
    expect(
      graph.edges.find((edge) => edge.targetNodeId === work.id && edge.label?.includes('employee'))
        ?.label,
    ).toBe('1 employee');
  });
  it('keeps the native baseline untouched while hiding resource links not used by the frozen scenario', () => {
    const graph = createSimulationGraph('Kiosk'),
      original = structuredClone(graph);
    const projected = projectSimulationRenderModel(graph, run(graph));
    const packageNode = graph.nodes.find((node) => node.externalId === 'package-counter')!;
    expect(projected.edges).toHaveLength(6);
    expect(projected.resourceEdges).toHaveLength(2);
    expect(projected.resourceEdges.some((edge) => edge.targetNodeId === packageNode.id)).toBe(
      false,
    );
    expect(
      projected.resourceEdges.every((edge) => edge.metadata.simulationProjected === true),
    ).toBe(true);
    const nativeFlow = graph.edges.filter((edge) => edge.edgeType !== 'simulation-resource');
    expect(projected.edges.slice(0, 4)).toEqual(nativeFlow);
    nativeFlow.forEach((edge, index) => expect(projected.edges[index]).toBe(edge));
    expect(graph).toEqual(original);
    expect(graph.edges).toHaveLength(8);
    const canvas = projectGraph(
      { ...graph, edges: projected.edges },
      [],
      [],
      projected.resourceEdges.map((edge) => edge.id),
    );
    for (const binding of projected.resourceEdges)
      expect(canvas.edges.find((edge) => edge.id === binding.id)).toMatchObject({
        selected: false,
        selectable: false,
        reconnectable: false,
      });
    expect(canvas.edges.find((edge) => edge.id === nativeFlow[0].id)).toMatchObject({
      selectable: true,
      reconnectable: true,
    });
  });
  it('connects visible dedicated resource displays using actual scenario requirements with stable read-only IDs', () => {
    const base = createSimulationGraph('Kiosk'),
      model = structuredClone(base.simulation!);
    model.nodes.push(
      {
        id: 'dedicated-staff-display',
        name: 'Package staff',
        type: 'resource',
        resourceId: 'package-staff',
      },
      {
        id: 'dedicated-counter-display',
        name: 'Package counter',
        type: 'resource',
        resourceId: 'package-service-counter',
      },
    );
    const graph = setSimulationModel(base, model),
      frozen = run(graph);
    const projection = projectSimulationRenderModel(graph, frozen);
    const work = graph.nodes.find((node) => node.externalId === 'package-counter')!;
    const bindings = projection.resourceEdges.filter((edge) => edge.targetNodeId === work.id);
    expect(bindings).toHaveLength(2);
    expect(bindings.map((edge) => edge.metadata.simulationResourceId)).toEqual([
      'package-staff',
      'package-service-counter',
    ]);
    expect(bindings.every((edge) => edge.id.startsWith('simulation-resource-view:'))).toBe(true);
    expect(
      projectSimulationRenderModel(graph, { ...frozen, options: { ...frozen.options, seed: 99 } }),
    ).toBe(projection);
    expect(
      graph.edges.filter(
        (edge) => edge.targetNodeId === work.id && edge.edgeType === 'simulation-resource',
      ),
    ).toHaveLength(2);
  });
  it('uses the frozen run instead of later baseline changes and preserves unprojected native geometry without a run', () => {
    const graph = createSimulationGraph('Kiosk'),
      frozen = run(graph);
    const model = structuredClone(graph.simulation!);
    const work = model.nodes.find(
      (node) =>
        node.type === 'work' &&
        node.id === graph.nodes.find((shape) => shape.externalId === 'package-counter')!.id,
    )!;
    if (work.type === 'work') work.work.resourceRequirements = [];
    const edited = setSimulationModel(graph, model);
    const projected = projectSimulationRenderModel(edited, frozen);
    expect(projected.model.nodes.find((node) => node.id === work.id)).toMatchObject({
      work: {
        resourceRequirements: [
          { resourceId: 'package-staff', units: 1 },
          { resourceId: 'package-service-counter', units: 1 },
        ],
      },
    });
    const normal = projectSimulationRenderModel(edited);
    expect(normal.model).toBe(edited.simulation);
    expect(normal.edges).toBe(edited.edges);
  });
  it('caches scenario resolution across clock/seed/duration updates and distinguishes demand assumptions', () => {
    const model = createSimulationGraph('Kiosk').simulation!;
    const first = resolveSimulationRenderModel(model, { scenarioId: 'package-worker', seed: 42 });
    expect(
      resolveSimulationRenderModel(model, {
        scenarioId: 'package-worker',
        seed: 99,
        durationSeconds: 3600,
      }),
    ).toBe(first);
    expect(
      resolveSimulationRenderModel(model, { scenarioId: 'package-worker', demandMultiplier: 2 }),
    ).not.toBe(first);
    expect(resolveSimulationRenderModel(model)).toBe(model);
  });
  it('shows complete dedicated resource names in a touch and keyboard readable Work detail region', () => {
    const graph = createSimulationGraph('Kiosk');
    const model = structuredClone(graph.simulation!);
    const staff = model.resources.find((resource) => resource.id === 'package-staff')!;
    staff.name = 'Dedicated package employee with a deliberately long descriptive name';
    const frozen = run({ ...graph, simulation: model });
    view = {
      run: {
        ...frozen,
        id: 'view-run',
        diagramId: graph.diagram.id,
        status: 'running',
        createdAt: '2026-10-07T00:00:00Z',
        updatedAt: '2026-10-07T00:00:00Z',
      },
    };
    useEditor.getState().setGraph(graph);
    render(
      <SimulationNodeSummary
        id={graph.nodes.find((node) => node.externalId === 'package-counter')!.id}
      />,
    );
    const full = `Required resources: ${staff.name}, Dedicated package counter`;
    const label = screen.getByLabelText(full);
    expect(label).toHaveAttribute('title', full);
    expect(label).toHaveClass('simulation-node-resources');
    expect(label).toHaveTextContent(`Resources: ${staff.name}, Dedicated package counter`);
    expect(label.closest('[data-node-scroll]')).toHaveAttribute('tabindex', '0');
    expect(label.closest('[data-node-scroll]')).toHaveAttribute('role', 'region');
    expect(screen.getByText(/Capacity 2/)).toBeInTheDocument();
  });
});
