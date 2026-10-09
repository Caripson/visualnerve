import { beforeEach, describe, expect, it } from 'vitest';
import { newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { addConnectedNode, connectedNodeChoices } from '../src/nodes/connected-node';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { useEditor } from '../src/state/editor';
import { parallelModel } from './helpers/parallel-model';

const basic = () => createSimulationGraph('Parallel process', createBasicModel({ particles: 1 }));
const alias = (graph: Graph, name: string) =>
  graph.nodes.find((node) => node.externalId === name)!.id;
const overlaps = (a: Graph['nodes'][number], b: Graph['nodes'][number]) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});

describe('authoritative parallel process quick-add', () => {
  it('offers a complete parallel pair only after source, work or join with at most one continuation', () => {
    const graph = basic();
    for (const name of ['source', 'work'])
      expect(
        connectedNodeChoices(graph, alias(graph, name)).some((choice) => choice.type === 'fork'),
      ).toBe(true);
    expect(
      connectedNodeChoices(graph, alias(graph, 'outcome')).some((choice) => choice.type === 'fork'),
    ).toBe(false);
    const open = structuredClone(graph);
    open.simulation!.edges = open.simulation!.edges.filter(
      (edge) => edge.sourceNodeId !== alias(graph, 'work'),
    );
    open.edges = open.edges.filter((edge) => edge.sourceNodeId !== alias(graph, 'work'));
    expect(addConnectedNode(open, alias(open, 'work'), 'fork')).toBeDefined();
    const paired = addConnectedNode(graph, alias(graph, 'work'), 'fork')!;
    const join = paired.graph.simulation!.nodes.find((node) => node.type === 'join')!;
    expect(addConnectedNode(paired.graph, join.id, 'fork')).toBeDefined();
    const branching = structuredClone(graph);
    branching.simulation!.edges.push({
      ...branching.simulation!.edges[1],
      id: crypto.randomUUID(),
    });
    expect(
      connectedNodeChoices(branching, alias(graph, 'work')).some(
        (choice) => choice.type === 'fork',
      ),
    ).toBe(false);
  });

  it('moves the original downstream edge to the join and preserves its identity, semantics and authored style', () => {
    const graph = basic();
    const workId = alias(graph, 'work');
    const original = graph.simulation!.edges.find((edge) => edge.sourceNodeId === workId)!;
    Object.assign(original, { travelSeconds: 17, weight: 0.75, particleTypeIds: ['work-item'] });
    Object.assign(graph.edges.find((edge) => edge.id === original.id)!, {
      label: 'Deliver',
      style: 'dashed',
      metadata: { review: true },
    });
    const group = newNode(graph.diagram.id, {
      nodeType: 'group',
      title: 'Preparation',
      width: 3000,
      height: 1000,
    });
    graph.nodes.push(group);
    Object.assign(graph.nodes.find((node) => node.id === workId)!, {
      color: '#23664d',
      parentId: group.id,
      metadata: { visualNerve: { icon: 'technology' } },
    });
    graph.simulation!.processes = [{ id: 'preparation', name: 'Preparation' }];
    graph.simulation!.nodes.find((node) => node.id === workId)!.processId = 'preparation';
    const before = structuredClone(graph);
    const added = addConnectedNode(graph, workId, 'fork')!;
    const fork = added.graph.simulation!.nodes.find((node) => node.id === added.nodeId)!;
    if (fork.type !== 'fork') throw new Error('Expected fork');
    const join = added.graph.simulation!.nodes.find((node) => node.id === fork.fork.joinNodeId)!;
    expect(added.graph.simulation!.edges.find((edge) => edge.id === original.id)).toEqual({
      ...original,
      sourceNodeId: join.id,
    });
    expect(added.graph.edges.find((edge) => edge.id === original.id)).toMatchObject({
      sourceNodeId: join.id,
      targetNodeId: original.targetNodeId,
      label: 'Deliver',
      style: 'dashed',
      metadata: { review: true },
    });
    const additions = added.graph.nodes.filter(
      (node) => !graph.nodes.some((old) => old.id === node.id),
    );
    expect(additions).toHaveLength(4);
    for (const node of additions) {
      expect(node).toMatchObject({
        parentId: group.id,
        color: '#23664d',
        metadata: { visualNerve: { icon: 'technology' } },
      });
      expect(
        added.graph.simulation!.nodes.find((semantic) => semantic.id === node.id)?.processId,
      ).toBe('preparation');
      for (const other of added.graph.nodes.filter(
        (other) => other.id !== node.id && other.id !== group.id,
      ))
        expect(overlaps(node, other)).toBe(false);
    }
    for (const edge of added.graph.simulation!.edges) {
      const from = added.graph.nodes.find((node) => node.id === edge.sourceNodeId)!;
      const to = added.graph.nodes.find((node) => node.id === edge.targetNodeId)!;
      expect(from.x + from.width).toBeLessThan(to.x);
    }
    expect(graph).toEqual(before);
    validateGraph(added.graph);
  });

  it('adds a mandatory fork-to-Work-to-join branch and cannot add an escaping router or outcome', () => {
    const base = basic();
    const pair = addConnectedNode(base, alias(base, 'work'), 'fork')!;
    const before = structuredClone(pair.graph);
    expect(connectedNodeChoices(pair.graph, pair.nodeId).map((choice) => choice.type)).toEqual([
      'work',
    ]);
    expect(addConnectedNode(pair.graph, pair.nodeId, 'router')).toBeUndefined();
    expect(addConnectedNode(pair.graph, pair.nodeId, 'outcome')).toBeUndefined();
    const added = addConnectedNode(pair.graph, pair.nodeId, 'work')!;
    const fork = added.graph.simulation!.nodes.find((node) => node.id === pair.nodeId)!;
    if (fork.type !== 'fork') throw new Error('Expected fork');
    expect(fork.fork.branchEdgeIds).toHaveLength(3);
    const entry = added.graph.simulation!.edges.find(
      (edge) => edge.sourceNodeId === fork.id && edge.targetNodeId === added.nodeId,
    )!;
    expect(fork.fork.branchEdgeIds).toContain(entry.id);
    expect(
      added.graph.simulation!.edges.find((edge) => edge.sourceNodeId === added.nodeId),
    ).toMatchObject({ targetNodeId: fork.fork.joinNodeId });
    const work = added.graph.simulation!.nodes.find((node) => node.id === added.nodeId)!;
    if (work.type !== 'work') throw new Error('Expected Work');
    work.work.processingSeconds = 240;
    const engine = new SimulationEngine(added.graph.simulation!, {
      untilComplete: true,
      durationSeconds: 1000,
    });
    engine.advance(200);
    expect(engine.state().metrics).toMatchObject({
      created: 1,
      completed: 0,
      realizedRevenue: 0,
      inSystem: 1,
    });
    engine.advance(1000);
    expect(engine.result().metrics).toMatchObject({
      created: 1,
      completed: 1,
      realizedRevenue: 100,
      inSystem: 0,
    });
    expect(
      engine.result().events.filter((event) => event.type === 'REVENUE_REALIZED'),
    ).toHaveLength(1);
    expect(pair.graph).toEqual(before);
    validateGraph(added.graph);
  });

  it('supports nested insertion inside a branch without crossing its original join or duplicating revenue', () => {
    const base = basic();
    const pair = addConnectedNode(base, alias(base, 'source'), 'fork')!;
    const branch = pair.graph.simulation!.nodes.find((node) => node.name === 'Parallel task 1')!;
    const nested = addConnectedNode(pair.graph, branch.id, 'fork')!;
    validateGraph(nested.graph);
    const result = runSimulation(nested.graph.simulation!, { untilComplete: true });
    expect(result.metrics).toMatchObject({ created: 1, completed: 1, realizedRevenue: 100 });
    expect(result.events.filter((event) => event.type === 'JOIN_COMPLETED')).toHaveLength(2);
  });

  it('uses identical semantic execution and authored cards in 2D and 3D', () => {
    const graph = basic();
    const spatial = structuredClone(graph);
    spatial.diagram.settings.spatialView = { version: 1, mode: '3d' };
    const planar = addConnectedNode(graph, alias(graph, 'work'), 'fork')!;
    const relief = addConnectedNode(spatial, alias(spatial, 'work'), 'fork')!;
    const planarResult = runSimulation(planar.graph.simulation!, { untilComplete: true, seed: 42 });
    const reliefResult = runSimulation(relief.graph.simulation!, { untilComplete: true, seed: 42 });
    expect(reliefResult.metrics).toEqual(planarResult.metrics);
    expect(relief.graph.diagram.settings.spatialView).toEqual({ version: 1, mode: '3d' });
    expect(
      relief.graph.nodes.map((node) => [
        node.title,
        node.nodeType,
        node.x,
        node.y,
        node.width,
        node.height,
      ]),
    ).toEqual(
      planar.graph.nodes.map((node) => [
        node.title,
        node.nodeType,
        node.x,
        node.y,
        node.width,
        node.height,
      ]),
    );
    validateGraph(relief.graph);
  });

  it('records the whole pair and each additional branch as atomic undoable commands', () => {
    const graph = basic();
    useEditor.getState().setGraph(graph);
    const forkId = useEditor.getState().addConnectedNode(alias(graph, 'work'), 'fork')!;
    const pair = structuredClone(useEditor.getState().graph!);
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().selectedNodes).toEqual([forkId]);
    const branchId = useEditor.getState().addConnectedNode(forkId, 'work')!;
    const extended = structuredClone(useEditor.getState().graph!);
    expect(useEditor.getState().history).toHaveLength(2);
    expect(useEditor.getState().selectedNodes).toEqual([branchId]);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(pair);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(extended);
    validateGraph(extended);
  });

  it('respects the semantic branch limit without creating a partial pair or dirtying the graph', () => {
    const graph = createSimulationGraph(
      'Maximum branches',
      parallelModel({ durations: Array(64).fill(1) }),
    );
    const fork = graph.simulation!.nodes.find((node) => node.type === 'fork')!;
    const before = structuredClone(graph);
    expect(connectedNodeChoices(graph, fork.id)).toEqual([]);
    expect(addConnectedNode(graph, fork.id, 'work')).toBeUndefined();
    expect(graph).toEqual(before);
  });

  it('persists the complete quick-added model and exposes it through the existing semantic API after reopening', async () => {
    const db = new WorkspaceDatabase(`parallel-quick-add-${crypto.randomUUID()}`);
    const repo = new Repository(db);
    try {
      await db.initialize();
      await db.settings.bulkPut([
        { key: 'storage-consent', value: true },
        { key: 'mcp-access', value: 'write' },
      ]);
      const base = await repo.importGraph(basic());
      const pair = addConnectedNode(base, alias(base, 'work'), 'fork')!;
      const branch = addConnectedNode(pair.graph, pair.nodeId, 'work')!;
      const saved = await repo.saveGraph(branch.graph, base.diagram.version);
      db.close();
      await db.open();
      const reopened = await repo.getGraph(saved.diagram.id);
      expect(reopened.simulation).toEqual(saved.simulation);
      const response = await repo.request(`/diagrams/${saved.diagram.id}/simulation`, 'GET');
      expect(response).toEqual(saved.simulation);
      expect(runSimulation(reopened.simulation!, { untilComplete: true }).metrics).toMatchObject({
        created: 1,
        completed: 1,
        realizedRevenue: 100,
      });
      validateGraph(reopened);
    } finally {
      await db.delete();
    }
  });
});
