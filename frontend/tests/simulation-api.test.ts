import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '../src/model/types';
import type { WorkspaceStorage } from '../src/storage/contracts';
import { StorageError } from '../src/model/errors';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation, simulationExecutionLimits } from '../src/simulation/engine';
import { simulationRuntimeLimits } from '../src/simulation/service';
import { resolveScenario } from '../src/simulation/schema';
import {
  MAX_CAPACITY_CARDS_PER_BANK,
  MAX_ADDITIONAL_CAPACITY_CARDS,
} from '../src/simulation/capacity-projection';
import type { SimulationModel } from '../src/simulation/types';
import {
  simulationCapabilities,
  simulationCommand,
  type SimulationRuntime,
} from '../src/storage/simulation-commands';
import { bridgeError, bridgeResponseStatus } from '../src/integration/bridge';
import { assertMcpAccess } from '../src/integration/access';

function fixture() {
  // API dispatch uses a fake write scope here; encrypted integration separately
  // verifies that real runtime guards share its authoritative storage snapshot.
  const writeScope = {} as WorkspaceStorage;
  let graph = createSimulationGraph('API model', createBasicModel());
  const repo = {
    getGraph: vi.fn(async () => graph),
    saveGraph: vi.fn(
      async (
        value: Graph,
        version: number,
        beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
      ) => {
        if (version !== graph.diagram.version) throw new StorageError(409, 'Stale model.');
        await beforeWrite?.(writeScope);
        graph = { ...value, diagram: { ...value.diagram, version: version + 1 } };
        return graph;
      },
    ),
  };
  const state = runSimulation(graph.simulation!);
  const run = { id: 'run-a', diagramId: graph.diagram.id };
  const runtime: SimulationRuntime = {
    start: vi.fn(async (_diagramId, _model, options) => {
      await options.beforeWrite?.(writeScope);
      return run;
    }),
    list: vi.fn(async () => [run]),
    get: vi.fn(async () => run),
    state: vi.fn(async () => state),
    result: vi.fn(async () => state),
    events: vi.fn(async (_id, paging) => ({
      events: state.events.slice(paging.offset, paging.offset + paging.limit),
    })),
    control: vi.fn(async (_runId, _action, options) => {
      await options?.beforeWrite?.(writeScope);
      return run;
    }),
    setSpeed: vi.fn(async (_runId, _speed, beforeWrite) => {
      await beforeWrite?.(writeScope);
      return run;
    }),
    seek: vi.fn(async (_runId, _time, options) => {
      await options?.beforeWrite?.(writeScope);
      return state;
    }),
    compare: vi.fn(async () => ({ comparisons: [] })),
  };
  const beforeWrite = vi.fn(async () => {});
  const request = (suffix = '', method = 'GET', payload?: unknown) => {
    const url = new URL(`/diagrams/${graph.diagram.id}/simulation${suffix}`, 'http://local');
    return simulationCommand(
      repo,
      graph.diagram.id,
      url.pathname.split('/').filter(Boolean),
      url,
      method,
      payload,
      beforeWrite,
      runtime,
    );
  };
  return { repo, runtime, state, beforeWrite, request, graph: () => graph };
}

describe('authoritative Process Simulator API', () => {
  it('discovers explicit semantics and headless browser requirements', () => {
    expect(simulationCapabilities).toMatchObject({
      type: 'process-simulator',
      schemaVersion: 1,
      apiVersion: '0.5.0',
      timeUnit: 'second',
    });
    expect(simulationCapabilities.execution).toMatchObject({
      browserRequired: true,
      activeCanvasRequired: false,
      animationRequired: false,
    });
    expect(simulationCapabilities.execution.limits).toEqual({
      ...simulationExecutionLimits,
      routeVisits: 10000,
      ...simulationRuntimeLimits,
    });
    expect(simulationCapabilities.execution.limitBehavior.activeParticlesAndEvents).toContain(
      'failed run',
    );
    expect(simulationCapabilities.features).toContain('shared-resources');
    expect(simulationCapabilities.visualCapacity).toEqual({
      view: '2d',
      representation: 'full-native-cards',
      readOnly: true,
      primaryEditable: true,
      additionalCardsReadOnly: true,
      compactHierarchyReadOnly: true,
      sharedLogicalModel: true,
      persistentUnitIdentity: false,
      occupancy: 'actual-aggregate-busy',
      queueDisplay: 'shared-at-first-card',
      limits: {
        cardsPerBank: MAX_CAPACITY_CARDS_PER_BANK,
        additionalCards: MAX_ADDITIONAL_CAPACITY_CARDS,
      },
      overflow: 'explicit-aggregate-label',
      spatialView: 'logical-model',
    });
    expect(simulationCapabilities.features).toContain('native-capacity-card-projection');
  });
  it('reads a detached full model and requires a current version for replacement', async () => {
    const f = fixture();
    const read = (await f.request()) as SimulationModel;
    read.particleTypes[0].revenue = 999;
    expect(f.graph().simulation!.particleTypes[0].revenue).toBe(100);
    await expect(f.request('', 'PUT', { model: read })).rejects.toMatchObject({
      status: 428,
      code: 'VERSION_REQUIRED',
    });
    const saved = (await f.request('', 'PUT', { baseVersion: 1, model: read })) as Graph;
    expect(saved.simulation!.particleTypes[0].revenue).toBe(999);
    await expect(f.request('', 'PUT', { baseVersion: 1, model: read })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('merges one Work assumption while preserving semantic and native layout values', async () => {
    const f = fixture();
    const work = f.graph().simulation!.nodes.find((node) => node.type === 'work')!;
    const original = f.graph().nodes.find((node) => node.id === work.id)!;
    original.x = 777;
    original.color = '#abcdef';
    const saved = (await f.request(`/nodes/${work.id}`, 'PATCH', {
      baseVersion: 1,
      value: { work: { capacity: 8 } },
    })) as Graph;
    expect(saved.simulation!.nodes.find((node) => node.id === work.id)).toMatchObject({
      work: { capacity: 8, processingSeconds: 60, queueDiscipline: 'fifo' },
    });
    expect(saved.nodes.find((node) => node.id === work.id)).toMatchObject({
      x: 777,
      color: '#abcdef',
    });
    expect(f.beforeWrite).toHaveBeenCalledOnce();
  });
  it('rejects invalid assumptions with semantic structured errors and no partial writes', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes.find((node) => node.type === 'work')!.id;
    for (const work of [
      { capacity: -1 },
      { processingSeconds: -5 },
      { resourceRequirements: [{ resourceId: 'missing', units: 1 }] },
      { scaling: { maxCapacity: 0, minCapacity: 1 } },
      { scaling: { maxCapacity: 3, utilizationAbove: 2 } },
    ]) {
      await expect(
        f.request(`/nodes/${id}`, 'PATCH', { baseVersion: 1, value: { work } }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'SIMULATION_INVALID_MODEL',
        issues: [{ path: 'model' }],
      });
    }
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    expect(f.beforeWrite).not.toHaveBeenCalled();
  });
  it('removes optional direct PATCH properties with JSON null and rejects removing required values', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes.find((node) => node.type === 'work')!.id;
    await f.request(`/nodes/${id}`, 'PATCH', {
      baseVersion: 1,
      value: { work: { scaling: { maxCapacity: 3 } } },
    });
    await f.request(`/nodes/${id}`, 'PATCH', {
      baseVersion: 2,
      value: { work: { scaling: null } },
    });
    const work = (await f.request(`/nodes/${id}`)) as { work: Record<string, unknown> };
    expect(work.work).not.toHaveProperty('scaling');
    expect(work.work).toMatchObject({ capacity: 1, processingSeconds: 60 });
    await expect(
      f.request(`/nodes/${id}`, 'PATCH', { baseVersion: 3, value: { work: { capacity: null } } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.graph().diagram.version).toBe(3);
    const complete = structuredClone(f.graph().simulation!);
    Object.assign(complete.nodes.find((node) => node.id === id)!, {
      work: { ...work.work, scaling: null },
    });
    await expect(f.request('', 'PUT', { baseVersion: 3, model: complete })).rejects.toMatchObject({
      status: 422,
    });
  });
  it('retains scenario null-removal markers through CRUD and JSON round trips without mutating Baseline', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes.find((node) => node.type === 'work')!.id;
    await f.request(`/nodes/${id}`, 'PATCH', {
      baseVersion: 1,
      value: { work: { scaling: { maxCapacity: 3 } } },
    });
    await f.request('/economics', 'PUT', { baseVersion: 2, value: { maximumBudget: 500000 } });
    await f.request('/scenarios', 'POST', {
      baseVersion: 3,
      value: { id: 'no-limits', name: 'No limits', overrides: {} },
    });
    await f.request('/scenarios/no-limits', 'PATCH', {
      baseVersion: 4,
      value: {
        overrides: {
          nodes: { [id]: { work: { scaling: null } } },
          economics: { maximumBudget: null },
        },
      },
    });
    await f.request('/scenarios/no-limits', 'PATCH', {
      baseVersion: 5,
      value: { name: 'Cleared optional limits' },
    });
    expect(await f.request('/scenarios/no-limits')).toMatchObject({
      overrides: {
        nodes: { [id]: { work: { scaling: null } } },
        economics: { maximumBudget: null },
      },
    });
    const persisted = JSON.parse(JSON.stringify(f.graph().simulation!)) as SimulationModel;
    const effective = resolveScenario(persisted, 'no-limits');
    expect(effective.nodes.find((node) => node.id === id)).toMatchObject({ work: { capacity: 1 } });
    expect(effective.nodes.find((node) => node.id === id)).not.toHaveProperty('work.scaling');
    expect(effective.economics).not.toHaveProperty('maximumBudget');
    expect(persisted.nodes.find((node) => node.id === id)).toHaveProperty(
      'work.scaling.maxCapacity',
      3,
    );
    expect(persisted.economics?.maximumBudget).toBe(500000);
  });
  it('creates, reads, patches and deletes typed resources with versioned configuration', async () => {
    const f = fixture();
    const resource = {
      id: 'staff',
      name: 'Shared staff',
      capacity: 1,
      unit: 'employee',
      costPerHour: 180,
    };
    await f.request('/resources', 'POST', { baseVersion: 1, value: resource });
    expect(await f.request('/resources/staff')).toEqual(resource);
    await f.request('/resources/staff', 'PATCH', { baseVersion: 2, value: { capacity: 3 } });
    expect(await f.request('/resources/staff')).toMatchObject({ capacity: 3, costPerHour: 180 });
    await f.request('/resources/staff?baseVersion=3', 'DELETE');
    expect(await f.request('/resources')).toEqual([]);
    await expect(f.request('/resources/staff')).rejects.toMatchObject({ status: 404 });
  });
  it('rejects deleting a shared resource still consumed by Work', async () => {
    const f = fixture();
    await f.request('/resources', 'POST', {
      baseVersion: 1,
      value: { id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' },
    });
    const work = f.graph().simulation!.nodes.find((node) => node.type === 'work')!;
    await f.request(`/nodes/${work.id}`, 'PATCH', {
      baseVersion: 2,
      value: { work: { resourceRequirements: [{ resourceId: 'staff', units: 1 }] } },
    });
    await expect(f.request('/resources/staff?baseVersion=3', 'DELETE')).rejects.toMatchObject({
      status: 422,
    });
    expect(f.graph().simulation!.resources).toHaveLength(1);
  });
  it('keeps scenario edits isolated and exposes economics/defaults/retention', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes.find((node) => node.type === 'work')!.id;
    await f.request('/scenarios', 'POST', {
      baseVersion: 1,
      value: { id: 'a', name: 'A', overrides: { nodes: { [id]: { work: { capacity: 2 } } } } },
    });
    await f.request('/scenarios', 'POST', {
      baseVersion: 2,
      value: { id: 'b', name: 'B', overrides: { nodes: { [id]: { work: { capacity: 3 } } } } },
    });
    expect(f.graph().simulation!.nodes.find((node) => node.id === id)).toMatchObject({
      work: { capacity: 1 },
    });
    await f.request('/economics', 'PUT', { baseVersion: 3, value: { maximumBudget: 500000 } });
    expect(await f.request('/economics')).toEqual({ maximumBudget: 500000 });
    expect(await f.request('/defaults')).toEqual({ durationSeconds: 86400, seed: 42 });
    expect(await f.request('/retention')).toMatchObject({ particles: 300, events: 2000 });
  });
  it('rejects unknown paths, repeated queries, identity changes and duplicate semantic IDs', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes[0].id;
    await expect(f.request('/nodes/deadbeef')).rejects.toMatchObject({ status: 404 });
    await expect(f.request('/unknown')).rejects.toMatchObject({ status: 404 });
    await expect(f.request('/nodes?write=true')).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request(`/nodes/${id}?baseVersion=1&baseVersion=2`, 'DELETE'),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request(`/nodes/${id}`, 'PATCH', { baseVersion: 1, value: { id: 'changed' } }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request('/nodes', 'POST', { baseVersion: 1, value: f.graph().simulation!.nodes[0] }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('captures the same model, seed, duration, scenario and demand multiplier for asynchronous API runs', async () => {
    const f = fixture();
    const options = {
      durationSeconds: 86400,
      seed: 12345,
      demandMultiplier: 1.5,
      speed: 'max',
      animated: false,
    };
    await f.request('/runs', 'POST', options);
    expect(f.runtime.start).toHaveBeenCalledWith(f.graph().diagram.id, f.graph().simulation, {
      ...options,
      origin: 'api',
      beforeWrite: f.beforeWrite,
    });
    expect(f.beforeWrite).toHaveBeenCalledOnce();
    expect(await f.request('/runs')).toMatchObject([{ id: 'run-a' }]);
  });
  it.each([
    { durationSeconds: 0 },
    { durationSeconds: -1 },
    { durationSeconds: Infinity },
    { durationSeconds: 315360001 },
    { seed: -1 },
    { seed: 1.5 },
    { demandMultiplier: -1 },
    { scenarioId: 'missing' },
    { speed: 1000 },
    { animated: 'false' },
    { runId: 'caller-controlled' },
  ])('rejects invalid run input before worker creation: %j', async (options) => {
    const f = fixture();
    await expect(f.request('/runs', 'POST', options)).rejects.toMatchObject({ status: 422 });
    expect(f.runtime.start).not.toHaveBeenCalled();
  });
  it('exposes actual semantic metrics, queues and bounded event pages from the shared service', async () => {
    const f = fixture();
    const id = f.graph().simulation!.nodes.find((node) => node.type === 'work')!.id;
    expect(await f.request('/runs/run-a/state')).toEqual(f.state);
    expect(await f.request('/runs/run-a/metrics')).toEqual(f.state.metrics);
    expect(await f.request(`/runs/run-a/nodes/${id}`)).toEqual(f.state.nodes[id]);
    expect(await f.request('/runs/run-a/bottlenecks')).toEqual(f.state.bottlenecks);
    expect(await f.request('/runs/run-a/queues')).toHaveProperty(`nodes.${id}.current`, 0);
    await f.request('/runs/run-a/events?offset=2&limit=10');
    expect(f.runtime.events).toHaveBeenCalledWith('run-a', { offset: 2, limit: 10 });
    await expect(f.request('/runs/run-a/events?limit=1001')).rejects.toMatchObject({ status: 422 });
    expect(f.beforeWrite).not.toHaveBeenCalled();
  });
  it('guards controls and comparison against cross-document run IDs', async () => {
    const f = fixture();
    vi.mocked(f.runtime.get).mockResolvedValue({ diagramId: 'another-document' });
    await expect(f.request('/runs/run-a/pause', 'POST', {})).rejects.toMatchObject({ status: 404 });
    await expect(
      f.request('/compare', 'POST', { runIds: ['run-a', 'run-b'] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.runtime.control).not.toHaveBeenCalled();
    expect(f.runtime.compare).not.toHaveBeenCalled();
  });
  it('controls/replays the authoritative run and compares without graph writes', async () => {
    const f = fixture();
    await f.request('/runs/run-a/pause', 'POST', {});
    await f.request('/runs/run-a/speed', 'POST', { speed: 10 });
    await f.request('/runs/run-a/seek', 'POST', { timeSeconds: 600 });
    expect(f.runtime.control).toHaveBeenCalledWith('run-a', 'pause', {
      origin: 'api',
      beforeWrite: f.beforeWrite,
    });
    expect(f.runtime.setSpeed).toHaveBeenCalledWith('run-a', 10, f.beforeWrite);
    expect(f.runtime.seek).toHaveBeenCalledWith('run-a', 600, {
      origin: 'api',
      beforeWrite: f.beforeWrite,
    });
    await f.request('/compare', 'POST', { runIds: ['run-a', 'run-b'] });
    expect(f.runtime.compare).toHaveBeenCalledWith(['run-a', 'run-b']);
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
  });
  it('marks an externally reset run as API-origin regardless of the archived source origin', async () => {
    const f = fixture();
    await f.request('/runs/run-a/reset', 'POST', {});
    expect(f.runtime.control).toHaveBeenCalledWith('run-a', 'reset', {
      origin: 'api',
      beforeWrite: f.beforeWrite,
    });
    expect(f.beforeWrite).toHaveBeenCalledOnce();
  });
  it('preserves structured errors and consistent HTTP create statuses through the bridge', () => {
    expect(
      bridgeError({
        message: 'Bad capacity',
        code: 'SIMULATION_INVALID_MODEL',
        issues: [{ path: 'model', code: 'capacity', message: 'Bad capacity' }],
      }),
    ).toMatchObject({
      error: 'Bad capacity',
      code: 'SIMULATION_INVALID_MODEL',
      issues: [{ path: 'model' }],
    });
    for (const collection of [
      'nodes',
      'edges',
      'particle-types',
      'resources',
      'improvements',
      'scenarios',
      'runs',
    ])
      expect(bridgeResponseStatus(`/diagrams/id/simulation/${collection}`, 'POST')).toBe(201);
    expect(bridgeResponseStatus('/diagrams/id/simulation/compare', 'POST')).toBe(200);
  });
  it('permits inspection/comparison with read only and rejects model or runtime changes', () => {
    const base = '/diagrams/00000000-0000-4000-8000-000000000001/simulation';
    assertMcpAccess('read', base, 'GET');
    assertMcpAccess('read', `${base}/compare`, 'POST');
    for (const path of [
      `${base}/runs`,
      `${base}/runs/id/pause`,
      `${base}/compare?save=true`,
      `${base}/compare/extra`,
    ])
      expect(() => assertMcpAccess('read', path, 'POST')).toThrow(/read-only/);
  });
});
