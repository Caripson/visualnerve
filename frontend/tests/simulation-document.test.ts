import { afterEach, describe, expect, it } from 'vitest';
import { instantiate, templates } from '../src/templates/templates';
import { validateGraph } from '../src/model/validation';
import { newEdge, newNode } from '../src/model/types';
import {
  createSimulationGraph,
  reconcileSimulationGraph,
  setSimulationModel,
} from '../src/simulation/document';
import { createBasicModel, createKioskModel } from '../src/simulation/examples';
import { resolveScenario } from '../src/simulation/schema';
import { applyDelta, diffGraph } from '../src/state/history';
import { useEditor } from '../src/state/editor';
import { copySelection, pasteSelection } from '../src/state/clipboard';

afterEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});

describe('first-class Process Simulator documents', () => {
  it('creates the normal template with canonical identities and explicit kiosk assumptions', () => {
    expect(templates.find((template) => template.key === 'process-simulator')?.name).toBe(
      'Kiosk + package pickup',
    );
    const first = instantiate('process-simulator', 'Kiosk'),
      second = instantiate('process-simulator', 'Kiosk');
    validateGraph(first);
    validateGraph(second);
    expect(first.diagram.type).toBe('process-simulator');
    expect(first.simulation?.schemaVersion).toBe(1);
    expect(first.simulation?.nodes.map((node) => node.id)).toEqual(
      first.nodes.map((node) => node.id),
    );
    expect(first.nodes[0].id).not.toBe(second.nodes[0].id);
    const core = first.simulation!.nodes.find(
      (node) => node.type === 'source' && node.source.particleTypeId === 'core-customer',
    );
    expect(core?.type === 'source' && core.source.ratePerHour).toBe(25);
    expect(core?.type === 'source' && core.source.schedule).toEqual([
      { startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 },
    ]);
    expect(first.edges.filter((edge) => edge.edgeType === 'simulation-resource')).toHaveLength(4);
    expect(first.simulation!.edges).toHaveLength(4);
  });
  it('updates semantics and shapes together while retaining their layout and resource bindings', () => {
    const graph = createSimulationGraph('Kiosk');
    graph.nodes[0] = { ...graph.nodes[0], x: 945, y: 721, color: '#123456' };
    const model = structuredClone(graph.simulation!);
    model.nodes[0].name = 'New arrivals';
    const next = setSimulationModel(graph, model);
    expect(next.nodes[0]).toMatchObject({
      id: graph.nodes[0].id,
      title: 'New arrivals',
      x: 945,
      y: 721,
      color: '#123456',
    });
    expect(next.edges.map((edge) => edge.id)).toEqual(graph.edges.map((edge) => edge.id));
    validateGraph(next);
  });
  it('keeps canvas connections and title edits authoritative for the semantic model', () => {
    const graph = createSimulationGraph('Basic', createBasicModel());
    const extra = newNode(graph.diagram.id, { title: 'Extra work', nodeType: 'process' });
    const edge = newEdge(graph.diagram.id, graph.nodes[1].id, extra.id);
    const next = reconcileSimulationGraph(graph, {
      ...graph,
      nodes: [
        ...graph.nodes.map((node, index) => (index === 1 ? { ...node, title: 'Assembly' } : node)),
        extra,
      ],
      edges: [...graph.edges, edge],
    });
    expect(next.simulation!.nodes.find((node) => node.id === graph.nodes[1].id)?.name).toBe(
      'Assembly',
    );
    expect(next.simulation!.nodes.find((node) => node.id === extra.id)).toMatchObject({
      type: 'work',
      work: { capacity: 1, processingSeconds: 60 },
    });
    expect(next.simulation!.edges.find((item) => item.id === edge.id)).toMatchObject({
      sourceNodeId: graph.nodes[1].id,
      targetNodeId: extra.id,
    });
    validateGraph(next);
  });
  it('rejects deleting a shared resource while remaining Work nodes require it', () => {
    const graph = createSimulationGraph('Kiosk');
    const resource = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
    expect(() =>
      reconcileSimulationGraph(graph, {
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== resource.id),
        edges: graph.edges.filter(
          (edge) => edge.sourceNodeId !== resource.id && edge.targetNodeId !== resource.id,
        ),
      }),
    ).toThrow('Disconnect this shared resource');
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([resource.id]);
    useEditor.getState().remove();
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().message).toContain('Disconnect this shared resource');
    expect(useEditor.getState().history).toHaveLength(0);
  });
  it('explicit allocation connections consume one shared logical resource and disconnect cleanly', () => {
    const graph = createSimulationGraph('Kiosk');
    const binding = graph.edges.find((edge) => edge.edgeType === 'simulation-resource')!;
    const next = reconcileSimulationGraph(graph, {
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== binding.id),
    });
    const work = next.simulation!.nodes.find((node) => node.id === binding.targetNodeId)!;
    const resource = graph.simulation!.nodes.find((node) => node.id === binding.sourceNodeId)!;
    expect(resource.type).toBe('resource');
    expect(
      work.type === 'work' &&
        work.work.resourceRequirements?.some(
          (item) => resource.type === 'resource' && item.resourceId === resource.resourceId,
        ),
    ).toBe(false);
    expect(next.simulation!.edges.some((edge) => edge.id === binding.id)).toBe(false);
    expect(next.simulation!.resources).toHaveLength(graph.simulation!.resources.length);
    validateGraph(next);
  });
  it('does not create semantic revisions for a canvas move and restores assumptions through Undo/Redo', () => {
    const graph = createSimulationGraph('Basic', createBasicModel());
    useEditor.getState().setGraph(graph);
    useEditor.getState().updateNode(graph.nodes[1].id, { x: 900 });
    expect(useEditor.getState().graph!.simulation).toBe(graph.simulation);
    const moved = useEditor.getState().graph!;
    const model = structuredClone(moved.simulation!);
    const work = model.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') work.work.capacity = 8;
    useEditor
      .getState()
      .command('Change capacity', (current) => setSimulationModel(current, model));
    const changed = useEditor.getState().graph!;
    const delta = diffGraph(moved, changed, 'Capacity');
    expect(delta.simulation).toBeDefined();
    expect(applyDelta(changed, delta, false).simulation).toEqual(moved.simulation);
    useEditor.getState().undo();
    expect(useEditor.getState().graph!.simulation).toEqual(moved.simulation);
    useEditor.getState().redo();
    expect(useEditor.getState().graph!.simulation).toEqual(changed.simulation);
  });
  it('remaps router/overflow/improvement/scenario references with copied template identities', () => {
    const original = createSimulationGraph('Kiosk');
    const firstWork = original.simulation!.nodes.find((node) => node.type === 'work')!;
    original.simulation!.improvements.push({
      id: 'automation',
      name: 'Automation',
      enabled: false,
      nodeId: firstWork.id,
      investmentCost: 1000,
    });
    original.simulation!.scenarios.push({
      id: 'automation-test',
      name: 'Automation',
      overrides: { improvements: { automation: { nodeId: firstWork.id, enabled: true } } },
    });
    const copied = instantiate('process-simulator', 'Copy', original);
    validateGraph(copied);
    expect(copied.simulation!.improvements[0].nodeId).not.toBe(firstWork.id);
    expect(copied.simulation!.scenarios.at(-1)!.overrides.improvements!.automation.nodeId).toBe(
      copied.simulation!.improvements[0].nodeId,
    );
    expect(Object.keys(copied.simulation!.scenarios[1].overrides.nodes!)[0]).toBe(
      copied.simulation!.nodes[1].id,
    );
  });
  it('resolves independent scenarios without mutating the saved baseline', () => {
    const graph = createSimulationGraph('Kiosk', createKioskModel());
    const baseline = structuredClone(graph.simulation);
    const stressed = resolveScenario(graph.simulation!, 'package-stress');
    const intervention = resolveScenario(graph.simulation!, 'package-worker');
    expect(graph.simulation).toEqual(baseline);
    expect(stressed.resources.find((item) => item.id === 'package-staff')?.capacity).toBe(0);
    expect(intervention.resources.find((item) => item.id === 'package-staff')?.capacity).toBe(1);
  });
  it('preserves copied processing/cost/shared-resource assumptions rather than replacing them with defaults', () => {
    const graph = createSimulationGraph('Kiosk');
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const clip = copySelection(graph, [work.id]);
    useEditor.getState().setGraph(graph);
    useEditor.getState().paste(clip);
    const next = useEditor.getState().graph!;
    const copied = next.simulation!.nodes.at(-1)!;
    expect(copied.type).toBe('work');
    expect(copied.type === 'work' && copied.work).toEqual(work.type === 'work' && work.work);
    expect(next.simulation!.resources).toEqual(graph.simulation!.resources);
    expect(next.nodes.at(-1)!.id).toBe(copied.id);
    validateGraph(next);
    const target = createSimulationGraph('Other', createBasicModel());
    const pasted = pasteSelection(clip, target);
    const imported = setSimulationModel(
      {
        ...target,
        nodes: [...target.nodes, ...pasted.nodes],
        edges: [...target.edges, ...pasted.edges],
      },
      pasted.simulation!,
    );
    validateGraph(imported);
    const importedWork = imported.simulation!.nodes.at(-1)!;
    expect(importedWork.type === 'work' && importedWork.work.processingSeconds).toBe(120);
    expect(
      importedWork.type === 'work' &&
        importedWork.work.resourceRequirements?.every((requirement) =>
          imported.simulation!.resources.some((resource) => resource.id === requirement.resourceId),
        ),
    ).toBe(true);
  });
});
