import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { useEditor } from '../src/state/editor';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { SimulationService, simulationService } from '../src/simulation/service';
import {
  simulationTopologyCompatible,
  simulationTopologySignature,
} from '../src/simulation/topology';
import { useSimulation } from '../src/simulation/useSimulation';
import { useSimulationCanvasLifecycle } from '../src/simulation/useSimulationCanvasLifecycle';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';
import type { Graph } from '../src/model/types';

class TopologyWorker {
  static instances: TopologyWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
  engine?: SimulationEngine;
  commands: WorkerCommand[] = [];
  terminated = false;
  constructor() {
    TopologyWorker.instances.push(this);
  }
  emit(update: WorkerUpdate) {
    if (!this.terminated)
      this.onmessage?.({ data: structuredClone(update) } as MessageEvent<WorkerUpdate>);
  }
  postMessage(command: WorkerCommand) {
    this.commands.push(structuredClone(command));
    if (command.kind === 'start') {
      this.engine = new SimulationEngine(command.model, command.options);
      queueMicrotask(() => {
        const state = this.engine!.state();
        state.status = command.options.startPaused ? 'paused' : 'running';
        this.emit({ kind: 'state', state });
      });
    } else if (command.kind === 'seek') {
      this.engine!.advance(command.timeSeconds, Infinity, true);
      queueMicrotask(() => {
        this.emit({ kind: 'state', state: { ...this.engine!.state(), status: 'paused' } });
      });
    } else if (command.kind === 'stop') {
      queueMicrotask(() => {
        this.emit({
          kind: 'state',
          state: { ...this.engine!.state(), status: 'stopped' },
          result: { ...this.engine!.result(), status: 'stopped' },
        });
      });
    }
  }
  finish() {
    this.engine!.advance(this.engine!.options.durationSeconds);
    this.emit({ kind: 'state', state: this.engine!.state(), result: this.engine!.result() });
  }
  terminate() {
    this.terminated = true;
  }
}

let db: WorkspaceDatabase, repo: Repository, service: SimulationService, graph: Graph;
beforeEach(async () => {
  TopologyWorker.instances = [];
  vi.stubGlobal('Worker', TopologyWorker);
  db = new WorkspaceDatabase(`simulation-topology-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  graph = await repo.importGraph(
    createSimulationGraph('Topology lifecycle', createBasicModel({ particles: 1 })),
  );
  service = new SimulationService(db);
  vi.spyOn(simulationService, 'subscribe').mockImplementation(service.subscribe);
  vi.spyOn(simulationService, 'version').mockImplementation(service.version);
  vi.spyOn(simulationService, 'current').mockImplementation((id) => service.current(id));
  vi.spyOn(simulationService, 'view').mockImplementation((id) => service.view(id));
  vi.spyOn(simulationService, 'detachCanvasRun').mockImplementation((diagramId, runId) =>
    service.detachCanvasRun(diagramId, runId),
  );
  useEditor.getState().setGraph(graph);
});
afterEach(async () => {
  cleanup();
  service.dispose();
  useEditor.getState().setGraph(null);
  await db.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function LifecycleProbe() {
  const current = useEditor((state) => state.graph)!;
  const lifecycle = useSimulationCanvasLifecycle(current.diagram.id, current.simulation);
  return (
    <>
      <output data-testid="canvas-run">{lifecycle.view?.run.id ?? 'none'}</output>
      <output data-testid="results-run">{lifecycle.resultsView?.run.id ?? 'none'}</output>
      <output data-testid="results-status">{lifecycle.resultsView?.run.status ?? 'none'}</output>
      {lifecycle.topologyChanged && <p>Previous run kept in Results</p>}
      {lifecycle.error && <p role="alert">{lifecycle.error}</p>}
    </>
  );
}

function reroutedGraph() {
  const model = structuredClone(graph.simulation!);
  model.edges[0].targetNodeId = model.nodes.find((node) => node.type === 'outcome')!.id;
  return setSimulationModel(graph, model);
}

describe('frozen simulation topology and canvas lifecycle', () => {
  it('does not rerender a canvas subscriber for geometry or viewport-only graph changes', async () => {
    await service.start(graph.diagram.id, graph.simulation!);
    let renders = 0;
    function SubscriptionProbe() {
      renders++;
      const view = useSimulation(graph.diagram.id);
      return <output>{view?.run.id ?? 'none'}</output>;
    }
    render(<SubscriptionProbe />);
    const before = renders;
    act(() =>
      useEditor.getState().setGraph({
        ...graph,
        diagram: {
          ...graph.diagram,
          settings: { ...graph.diagram.settings, viewport: { x: 100, y: 20, zoom: 1.2 } },
        },
        nodes: graph.nodes.map((node) => ({ ...node, x: node.x + 100, width: node.width + 50 })),
      }),
    );
    expect(renders).toBe(before);
    act(() => useEditor.getState().setGraph(reroutedGraph()));
    expect(renders).toBeGreaterThan(before);
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('keeps geometry and quantity edits compatible, independently of collection order', () => {
    const captured = createBasicModel();
    captured.resources = [{ id: 'staff', name: 'Staff', unit: 'employee', capacity: 2 }];
    const work = captured.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    const original = simulationTopologySignature(captured);
    const changed = structuredClone(captured);
    changed.nodes.reverse();
    changed.edges.reverse();
    changed.currency = 'EUR';
    changed.particleTypes[0].revenue = 700;
    changed.particleTypes[0].color = '#ef4444';
    changed.resources[0].capacity = 8;
    changed.resources[0].costPerHour = 500;
    changed.edges[0].travelSeconds = 40;
    const changedWork = changed.nodes.find((node) => node.type === 'work')!;
    if (changedWork.type === 'work') {
      changedWork.work.capacity = 5;
      changedWork.work.processingSeconds = 12;
      changedWork.work.resourceRequirements![0].units = 2;
    }
    expect(simulationTopologyCompatible(changed, captured)).toBe(true);
    expect(simulationTopologySignature(captured)).toBe(original);
    const repositioned = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, x: node.x + 350, width: node.width + 50 })),
    };
    expect(simulationTopologyCompatible(repositioned.simulation!, graph.simulation!)).toBe(true);
  });

  it.each([
    'edge',
    'node-type',
    'source-type',
    'binding',
    'scope',
    'parent',
    'resource-id',
    'particle-id',
  ])('detects a changed %s semantic topology', (change) => {
    const captured = createBasicModel();
    captured.processes = [
      { id: 'root', name: 'Root' },
      { id: 'child', name: 'Child', parentId: 'root' },
    ];
    captured.nodes[1].processId = 'child';
    captured.resources = [{ id: 'staff', name: 'Staff', unit: 'employee', capacity: 1 }];
    const changed = structuredClone(captured);
    if (change === 'edge') changed.edges[0].targetNodeId = 'outcome';
    if (change === 'node-type')
      changed.nodes[1] = {
        id: 'work',
        name: 'Decision',
        type: 'router',
        router: { mode: 'weighted' },
      };
    if (change === 'source-type' && changed.nodes[0].type === 'source')
      changed.nodes[0].source.particleTypeId = 'new-particle-type';
    if (change === 'binding' && changed.nodes[1].type === 'work')
      changed.nodes[1].work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    if (change === 'scope') changed.nodes[1].processId = 'root';
    if (change === 'parent') delete changed.processes![1].parentId;
    if (change === 'resource-id') changed.resources[0].id = 'different-staff';
    if (change === 'particle-id') changed.particleTypes[0].id = 'new-particle-type';
    expect(simulationTopologyCompatible(changed, captured)).toBe(false);
  });

  it('filters incompatible canvas state during render, before any lifecycle stop effect', async () => {
    const run = await service.start(graph.diagram.id, graph.simulation!);
    function CanvasProbe() {
      const view = useSimulation(graph.diagram.id);
      return <output>{view?.run.id ?? 'none'}</output>;
    }
    render(<CanvasProbe />);
    expect(screen.getByText(run.id)).toBeInTheDocument();
    act(() => useEditor.getState().setGraph(reroutedGraph()));
    expect(screen.getByText('none')).toBeInTheDocument();
    // Filtering is synchronous and does not itself mutate the authoritative service.
    expect(service.current(graph.diagram.id)?.run.id).toBe(run.id);
  });

  it('detaches an obsolete UI run, saves its actual stopped state and retains API replay', async () => {
    const run = await service.start(graph.diagram.id, graph.simulation!, { durationSeconds: 120 });
    const worker = TopologyWorker.instances[0];
    worker.engine!.advance(10);
    worker.emit({ kind: 'state', state: worker.engine!.state() });
    render(<LifecycleProbe />);
    expect(screen.getByTestId('canvas-run')).toHaveTextContent(run.id);
    act(() => useEditor.getState().setGraph(reroutedGraph()));
    expect(screen.getByTestId('canvas-run')).toHaveTextContent('none');
    expect(service.current(graph.diagram.id)).toBeUndefined();
    expect(screen.getByText('Previous run kept in Results')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('results-status')).toHaveTextContent('stopped'));
    const stopped = await service.result(run.id);
    expect(worker.terminated).toBe(true);
    expect(stopped).toMatchObject({
      status: 'stopped',
      timeSeconds: 10,
      metrics: { created: 1, completed: 0, inSystem: 1 },
    });
    expect((await db.simulationRuns.get(run.id))?.result).toEqual(stopped);
    expect((await service.get(run.id)).model).toEqual(run.model);
    expect(screen.getByTestId('results-run')).toHaveTextContent(run.id);
    const replayed = await act(async () => service.seek(run.id, 5, { origin: 'api' }));
    expect(replayed.timeSeconds).toBe(5);
    expect(replayed.nodes[run.model.nodes.find((node) => node.type === 'work')!.id].busy).toBe(1);
    expect(await service.result(run.id)).toEqual(stopped);
    expect(service.current(graph.diagram.id)).toBeUndefined();
  });

  it('does not stop API execution when its canvas view is detached', async () => {
    const run = await service.start(graph.diagram.id, graph.simulation!, {
      durationSeconds: 120,
      origin: 'api',
      animated: false,
    });
    const worker = TopologyWorker.instances[0];
    render(<LifecycleProbe />);
    act(() => useEditor.getState().setGraph(reroutedGraph()));
    expect(service.current(graph.diagram.id)).toBeUndefined();
    expect(worker.terminated).toBe(false);
    expect(worker.commands.some((command) => command.kind === 'stop')).toBe(false);
    act(() => worker.finish());
    const result = await service.result(run.id);
    expect(result).toEqual(runSimulation(run.model, run.options));
    expect((await db.simulationRuns.get(run.id))?.result).toEqual(result);
    expect(screen.getByTestId('canvas-run')).toHaveTextContent('none');
    expect(screen.getByTestId('results-run')).toHaveTextContent(run.id);
  });

  it('keeps a compatible completed run over geometry edits and detaches incompatible historical selection', async () => {
    const run = await service.start(graph.diagram.id, graph.simulation!, { durationSeconds: 120 });
    TopologyWorker.instances[0].finish();
    const result = await service.result(run.id);
    render(<LifecycleProbe />);
    act(() =>
      useEditor
        .getState()
        .setGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, x: node.x + 100 })) }),
    );
    expect(screen.getByTestId('canvas-run')).toHaveTextContent(run.id);
    act(() => useEditor.getState().setGraph(reroutedGraph()));
    expect(screen.getByTestId('canvas-run')).toHaveTextContent('none');
    await act(async () => service.selectRun(run.id));
    expect(service.current(graph.diagram.id)).toBeUndefined();
    expect(screen.getByTestId('results-run')).toHaveTextContent(run.id);
    expect(await service.result(run.id)).toEqual(result);
    await act(async () =>
      service.start(graph.diagram.id, reroutedGraph().simulation!, { durationSeconds: 120 }),
    );
    expect(screen.getByTestId('canvas-run')).not.toHaveTextContent('none');
    expect(screen.queryByText('Previous run kept in Results')).not.toBeInTheDocument();
  });
});
