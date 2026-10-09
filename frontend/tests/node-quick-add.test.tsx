import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { addConnectedNode, connectedNodeChoices } from '../src/nodes/connected-node';
import { NodeQuickAdd } from '../src/nodes/NodeQuickAdd';
import { useEditor } from '../src/state/editor';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationEngine } from '../src/simulation/engine';
import {
  createEmptySimulationModel,
  createStarterGraph,
  starterDefaults,
} from '../src/simulation/starter';
import type { ReactNode } from 'react';

vi.mock('@xyflow/react', async (actual) => ({
  ...(await actual<typeof import('@xyflow/react')>()),
  NodeToolbar: ({ children, position }: { children: ReactNode; position: string }) => (
    <div data-testid="node-toolbar" data-position={position}>
      {children}
    </div>
  ),
}));

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});
const basic = () => createSimulationGraph('Process', createBasicModel({ particles: 1 }));
const id = (graph: Graph, alias: string) =>
  graph.nodes.find((node) => node.externalId === alias)!.id;

describe('creating a connected node', () => {
  it('adds a connected process without overlapping adjacent nodes or mutating the original', () => {
    const graph = blankGraph('Build', 'flowchart');
    const anchor = newNode(graph.diagram.id, { title: 'Start', x: 0, y: 0, color: '#123456' });
    graph.nodes = [
      anchor,
      newNode(graph.diagram.id, { x: 320, y: 0, width: 200, height: 100 }),
      newNode(graph.diagram.id, { x: 320, y: 164, width: 200, height: 100 }),
    ];
    const before = structuredClone(graph);
    const added = addConnectedNode(graph, anchor.id)!;
    const node = added.graph.nodes.find((node) => node.id === added.nodeId)!;
    expect(node).toMatchObject({ nodeType: 'process', color: '#123456', x: 320 });
    expect(added.graph.edges).toMatchObject([{ sourceNodeId: anchor.id, targetNodeId: node.id }]);
    for (const other of graph.nodes)
      expect(
        node.x + node.width <= other.x ||
          node.x >= other.x + other.width ||
          node.y + node.height <= other.y ||
          node.y >= other.y + other.height,
      ).toBe(true);
    expect(graph).toEqual(before);
    validateGraph(added.graph);
  });

  it('creates, selects, saves and undoes the node with its connection as one command', () => {
    const graph = blankGraph('Build', 'flowchart');
    const anchor = newNode(graph.diagram.id);
    graph.nodes = [anchor];
    useEditor.getState().setGraph(graph);
    const added = useEditor.getState().addConnectedNode(anchor.id, 'decision');
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().selectedNodes).toEqual([added]);
    expect(useEditor.getState().focusNode).toBe(added);
    expect(useEditor.getState().status).toBe('saving');
    expect(useEditor.getState().graph!.nodes).toHaveLength(2);
    expect(useEditor.getState().graph!.edges).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    expect(useEditor.getState().graph!.nodes).toHaveLength(2);
    expect(useEditor.getState().graph!.edges).toHaveLength(1);
  });

  it('inserts a simulation step into its existing flow and preserves route properties', () => {
    const graph = basic();
    const workId = id(graph, 'work');
    const previous = graph.simulation!.edges.find((edge) => edge.sourceNodeId === workId)!;
    previous.weight = 0.75;
    previous.particleTypeIds = ['work-item'];
    previous.travelSeconds = 17;
    graph.edges.find((edge) => edge.id === previous.id)!.label = 'Deliver';
    graph.edges.find((edge) => edge.id === previous.id)!.style = 'dashed';
    const before = structuredClone(graph);
    const added = addConnectedNode(graph, workId, 'work')!;
    const inserted = added.graph.simulation!.nodes.find((node) => node.id === added.nodeId)!;
    expect(inserted).toMatchObject({
      type: 'work',
      name: 'Work step',
      work: { capacity: 1, processingSeconds: 60 },
    });
    expect(added.graph.simulation!.edges.find((edge) => edge.id === previous.id)).toEqual({
      ...previous,
      targetNodeId: added.nodeId,
    });
    expect(added.graph.edges.find((edge) => edge.id === previous.id)).toMatchObject({
      targetNodeId: added.nodeId,
      label: 'Deliver',
      style: 'dashed',
    });
    expect(
      added.graph.simulation!.edges.find((edge) => edge.sourceNodeId === added.nodeId),
    ).toMatchObject({
      targetNodeId: previous.targetNodeId,
      travelSeconds: 3,
    });
    expect(graph).toEqual(before);
    validateGraph(added.graph);
  });

  it('runs inserted work through the real engine and retains original completion/revenue', () => {
    const graph = basic();
    const added = addConnectedNode(graph, id(graph, 'work'), 'work')!;
    const engine = new SimulationEngine(added.graph.simulation!, {
      untilComplete: true,
      durationSeconds: 1000,
    });
    engine.advance(1000);
    const result = engine.result();
    expect(result.metrics.completed).toBe(1);
    expect(result.metrics.realizedRevenue).toBe(100);
    expect(result.metrics.ttr.average).toBe(123);
    expect(result.nodes[added.nodeId].completed).toBe(1);
  });

  it('uses the same readable card geometry when extending a guided process', () => {
    const graph = createStarterGraph(createSimulationGraph('Build', createEmptySimulationModel()), {
      ...starterDefaults(),
      sharedResource: true,
    });
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const resource = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
    const outcome = graph.simulation!.nodes.find((node) => node.type === 'outcome')!;
    const original = (id: string) => graph.nodes.find((node) => node.id === id)!;
    for (const [type, originalId] of [
      ['work', work.id],
      ['resource', resource.id],
      ['router', outcome.id],
    ] as const) {
      const added = addConnectedNode(graph, work.id, type)!;
      const card = added.graph.nodes.find((node) => node.id === added.nodeId)!;
      expect({ width: card.width, height: card.height }).toEqual({
        width: original(originalId).width,
        height: original(originalId).height,
      });
    }
  });

  it('reserves an insertion column so repeated steps keep forward edges and no overlapping cards', () => {
    const graph = createStarterGraph(createSimulationGraph('Build', createEmptySimulationModel()), {
      ...starterDefaults(),
      sharedResource: true,
    });
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const first = addConnectedNode(graph, work.id, 'work')!;
    const second = addConnectedNode(first.graph, work.id, 'work')!;
    for (const edge of second.graph.simulation!.edges) {
      const source = second.graph.nodes.find((node) => node.id === edge.sourceNodeId)!;
      const target = second.graph.nodes.find((node) => node.id === edge.targetNodeId)!;
      expect(source.x + source.width).toBeLessThan(target.x);
      expect(source.y).toBe(target.y);
    }
    for (const node of second.graph.nodes)
      for (const other of second.graph.nodes.filter((other) => other.id !== node.id))
        expect(
          node.x + node.width <= other.x ||
            node.x >= other.x + other.width ||
            node.y + node.height <= other.y ||
            node.y >= other.y + other.height,
        ).toBe(true);
    expect(graph.simulation!.nodes).toHaveLength(4);
    validateGraph(second.graph);
  });

  it('restores all shifted placement when an inserted step is undone', () => {
    const graph = basic();
    const outcome = graph.nodes.find((node) => node.id === id(graph, 'outcome'))!;
    useEditor.getState().setGraph(graph);
    const added = useEditor.getState().addConnectedNode(outcome.id, 'work')!;
    const inserted = useEditor.getState().graph!.nodes.find((node) => node.id === added)!;
    const shifted = useEditor.getState().graph!.nodes.find((node) => node.id === outcome.id)!;
    const preceding = graph.nodes.find((node) => node.id === id(graph, 'work'))!;
    expect(preceding.x + preceding.width).toBeLessThan(inserted.x);
    expect(inserted.x + inserted.width).toBeLessThan(shifted.x);
    expect(shifted.x).toBeGreaterThan(outcome.x);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
  });

  it('inserts a preceding step before an outcome rather than adding an unreachable stub', () => {
    const graph = basic();
    const outcomeId = id(graph, 'outcome');
    const added = addConnectedNode(graph, outcomeId, 'router')!;
    expect(
      added.graph.simulation!.edges.find((edge) => edge.sourceNodeId === id(graph, 'work'))
        ?.targetNodeId,
    ).toBe(added.nodeId);
    expect(
      added.graph.simulation!.edges.find((edge) => edge.sourceNodeId === added.nodeId)
        ?.targetNodeId,
    ).toBe(outcomeId);
    expect(connectedNodeChoices(graph, outcomeId).map((choice) => choice.label)).toEqual([
      'Insert work step',
      'Arrivals',
      'Insert decision',
    ]);
    validateGraph(added.graph);
  });

  it('creates a shared resource binding and allows other Work to consume the same capacity', () => {
    const graph = basic();
    const workId = id(graph, 'work');
    const addedResource = addConnectedNode(graph, workId, 'resource')!;
    const resourceNode = addedResource.graph.simulation!.nodes.find(
      (node) => node.id === addedResource.nodeId,
    )!;
    expect(resourceNode.type).toBe('resource');
    if (resourceNode.type !== 'resource') throw new Error('Expected resource');
    expect(addedResource.graph.simulation!.resources).toHaveLength(1);
    expect(addedResource.graph.simulation!.edges).toHaveLength(graph.simulation!.edges.length);
    const work = addedResource.graph.simulation!.nodes.find((node) => node.id === workId)!;
    expect(work.type === 'work' && work.work.resourceRequirements).toEqual([
      { resourceId: resourceNode.resourceId, units: 1 },
    ]);
    expect(
      addedResource.graph.edges.find((edge) => edge.sourceNodeId === resourceNode.id),
    ).toMatchObject({ edgeType: 'simulation-resource', targetNodeId: workId });
    const addedWork = addConnectedNode(addedResource.graph, resourceNode.id, 'work')!;
    expect(addedWork.graph.simulation!.resources).toHaveLength(1);
    const secondWork = addedWork.graph.simulation!.nodes.find(
      (node) => node.id === addedWork.nodeId,
    )!;
    expect(secondWork.type === 'work' && secondWork.work.resourceRequirements).toEqual([
      { resourceId: resourceNode.resourceId, units: 1 },
    ]);
    validateGraph(addedWork.graph);
  });

  it('rejects unsupported simulation types and projected capacity IDs without dirtying the document', () => {
    const graph = basic();
    const workId = id(graph, 'work');
    useEditor.getState().setGraph(graph);
    expect(useEditor.getState().addConnectedNode(workId, 'generic')).toBeUndefined();
    expect(useEditor.getState().addConnectedNode(workId, 'outcome')).toBeUndefined();
    expect(
      useEditor.getState().addConnectedNode(`simulation-capacity:${workId}:2`, 'work'),
    ).toBeUndefined();
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toHaveLength(0);
    expect(connectedNodeChoices(graph, workId).map((choice) => choice.label)).toEqual([
      'Insert work step',
      'Insert decision',
      'Parallel work',
      'Shared resource',
    ]);
    const unconnected = { ...graph, simulation: { ...graph.simulation!, edges: [] }, edges: [] };
    expect(
      connectedNodeChoices(unconnected, workId).some((choice) => choice.type === 'outcome'),
    ).toBe(true);
  });
});

describe('node-local controls', () => {
  it('places multi-unit bank controls above the primary card and leaves ordinary controls below', () => {
    const graph = basic();
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([id(graph, 'work')]);
    const { rerender } = render(<NodeQuickAdd id={id(graph, 'work')} />);
    expect(screen.getByTestId('node-toolbar')).toHaveAttribute('data-position', 'bottom');
    rerender(<NodeQuickAdd id={id(graph, 'work')} above />);
    expect(screen.getByTestId('node-toolbar')).toHaveAttribute('data-position', 'top');
    expect(screen.getByRole('button', { name: 'Add next' })).toBeVisible();
  });
  it('opens a focused bounded menu and creates a node through the authoritative command', () => {
    const graph = blankGraph('Build', 'flowchart');
    const anchor = newNode(graph.diagram.id, { title: 'Review' });
    graph.nodes = [anchor];
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([anchor.id]);
    render(<NodeQuickAdd id={anchor.id} />);
    const trigger = screen.getByRole('button', { name: 'Add next' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('dialog', { name: 'Add next menu' });
    expect(menu).toBeVisible();
    const action = screen.getByRole('button', { name: 'Process' });
    expect(action).toHaveFocus();
    fireEvent.click(action);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useEditor.getState().graph!.nodes).toHaveLength(2);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it('discloses simulation defaults and restores trigger focus when Escape closes the menu', () => {
    const graph = basic();
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([id(graph, 'work')]);
    render(<NodeQuickAdd id={id(graph, 'work')} />);
    const trigger = screen.getByRole('button', { name: 'Add next' });
    fireEvent.click(trigger);
    expect(screen.getByText(/3 seconds transfer/)).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(useEditor.getState().history).toHaveLength(0);
  });
});
