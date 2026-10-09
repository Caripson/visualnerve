import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageError } from '../src/model/errors';
import type { Graph } from '../src/model/types';
import { bridgeError, bridgeResponseStatus } from '../src/integration/bridge';
import { assertMcpAccess } from '../src/integration/access';
import { mcpSetupNote } from '../src/integration/setup';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import type { SimulationModel, SimulationResult, SimulationState } from '../src/simulation/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import {
  simulationCapabilities,
  simulationCommand,
  type SimulationRuntime,
  type SimulationStartOptions,
} from '../src/storage/simulation-commands';

const databases: WorkspaceDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

async function fixture(input = createBasicModel()) {
  const db = new WorkspaceDatabase(`process-api-${crypto.randomUUID()}`);
  databases.push(db);
  await db.initialize();
  const repo = new Repository(db);
  const created = await repo.saveGraph(createSimulationGraph('Process API', input), 0);
  const diagramId = created.diagram.id;
  const results = new Map<string, SimulationResult>();
  const runs = new Map<string, { id: string; diagramId: string }>();
  const runtime: SimulationRuntime = {
    start: vi.fn(async (_diagramId, model, options) => {
      const id = crypto.randomUUID();
      const result = runSimulation(model, { ...options, runId: id });
      const run = { id, diagramId };
      results.set(id, result);
      runs.set(id, run);
      return run;
    }),
    list: vi.fn(async () => [...runs.values()]),
    get: vi.fn(async (id) => runs.get(id)),
    state: vi.fn(async (id) => results.get(id)!),
    result: vi.fn(async (id) => results.get(id)!),
    events: vi.fn(async (id, paging) => ({
      events: results.get(id)!.events.slice(paging.offset, paging.offset + paging.limit),
    })),
    control: vi.fn(async () => {
      throw new Error('Not used in this test.');
    }),
    setSpeed: vi.fn(async () => {
      throw new Error('Not used in this test.');
    }),
    seek: vi.fn(async () => {
      throw new Error('Not used in this test.');
    }),
    compare: vi.fn(async () => ({ comparisons: [] })),
  };
  const request = (suffix = '', method = 'GET', payload?: unknown) => {
    const url = new URL(`/diagrams/${diagramId}/simulation${suffix}`, 'http://local');
    return simulationCommand(
      repo,
      diagramId,
      url.pathname.split('/').filter(Boolean),
      url,
      method,
      payload,
      undefined,
      runtime,
    );
  };
  const graph = () => repo.getGraph(diagramId);
  const write = async (suffix: string, method: string, value: unknown) => {
    const current = await graph();
    return request(suffix, method, {
      baseVersion: current.diagram.version,
      value,
    }) as Promise<Graph>;
  };
  return { db, repo, graph, request, write, runtime, diagramId };
}

function blankModel(): SimulationModel {
  const model = createBasicModel();
  return {
    ...model,
    particleTypes: [],
    nodes: [],
    edges: [],
    resources: [],
    improvements: [],
    scenarios: [],
  };
}

describe('hierarchical simulation API and canonical persistence', () => {
  it('discovers additive hierarchy semantics without changing the API/schema versions', () => {
    expect(simulationCapabilities).toMatchObject({ apiVersion: '0.6.0', schemaVersion: 1 });
    expect(simulationCapabilities.features).toEqual(
      expect.arrayContaining(['hierarchical-processes', 'process-drilldown']),
    );
    expect(simulationCapabilities.hierarchy).toMatchObject({
      parentField: 'processes[].parentId',
      nodeMembershipField: 'nodes[].processId',
      metrics: {
        resourceCostAllocation: 'occupied-units',
        aggregation: 'parent-and-child-totals-overlap-do-not-sum',
      },
    });
    expect(bridgeResponseStatus('/diagrams/id/simulation/processes', 'POST')).toBe(201);
    expect(bridgeResponseStatus('/diagrams/id/simulation/processes/id', 'PATCH')).toBe(200);
    const note = mcpSetupNote('https://visualnerve.caripson.com', 'ws://127.0.0.1:4317/bridge');
    expect(note).toContain('nodes[].processId');
    expect(note).toContain('/diagrams/{id}/simulation/hierarchy');
    expect(note).toContain('/diagrams/{id}/simulation/runs/{runId}/processes/{processId}');
    expect(note).toContain('idle/scaling/investment');
    assertMcpAccess('read', '/diagrams/id/simulation/hierarchy', 'GET');
    assertMcpAccess('read', '/diagrams/id/simulation/runs/run/processes/process', 'GET');
    expect(() => assertMcpAccess('read', '/diagrams/id/simulation/processes', 'POST')).toThrow(
      /read-only/,
    );
  });

  it('interprets absent processes as an empty hierarchy and safely reads legacy run archives', async () => {
    const f = await fixture();
    expect(await f.request('/processes')).toEqual([]);
    expect(await f.request('/hierarchy')).toEqual({ rootProcessIds: [], processes: [] });
    const run = (await f.request('/runs', 'POST', { seed: 42, durationSeconds: 1200 })) as {
      id: string;
    };
    const archived = (await f.request(`/runs/${run.id}/state`)) as SimulationState;
    delete archived.processes;
    expect(await f.request(`/runs/${run.id}/processes`)).toEqual({});
    expect(await f.request(`/runs/${run.id}/queues`)).toHaveProperty('processes', {});
    await expect(f.request(`/runs/${run.id}/processes/missing`)).rejects.toMatchObject({
      status: 404,
    });
    expect((await f.graph()).simulation).not.toHaveProperty('processes');
  });

  it('creates a nested complete process programmatically and reproduces the same real engine result as UI inputs', async () => {
    const f = await fixture(blankModel());
    await f.write('/processes', 'POST', { id: 'delivery', name: 'Delivery' });
    await f.write('/processes', 'POST', {
      id: 'fulfilment',
      name: 'Fulfilment',
      parentId: 'delivery',
    });
    await f.write('/processes', 'POST', { id: 'packing', name: 'Packing', parentId: 'fulfilment' });
    await f.write('/particle-types', 'POST', {
      id: 'order',
      name: 'Order',
      color: '#2563eb',
      revenue: 100,
      complexity: { min: 1, max: 1 },
      priority: 1,
    });
    await f.write('/resources', 'POST', {
      id: 'staff',
      name: 'Global staff',
      capacity: 1,
      unit: 'worker',
      costPerHour: 360,
    });
    await f.write('/nodes', 'POST', {
      id: 'source',
      name: 'Orders',
      type: 'source',
      processId: 'delivery',
      source: { particleTypeId: 'order', burst: 10, maxCount: 10 },
    });
    await f.write('/nodes', 'POST', {
      id: 'work',
      name: 'Pack order',
      type: 'work',
      processId: 'packing',
      work: {
        capacity: 1,
        processingSeconds: 60,
        costPerParticle: 2,
        resourceRequirements: [{ resourceId: 'staff', units: 1 }],
        scaling: { maxCapacity: 3, queueAbove: 20 },
      },
    });
    await f.write('/nodes', 'POST', {
      id: 'outcome',
      name: 'Delivered',
      type: 'outcome',
      processId: 'delivery',
      outcome: { status: 'completed', revenue: true },
    });
    const nodes = (await f.graph()).simulation!.nodes;
    const source = nodes.find((node) => node.type === 'source')!,
      work = nodes.find((node) => node.type === 'work')!,
      outcome = nodes.find((node) => node.type === 'outcome')!;
    await f.write('/edges', 'POST', {
      id: 'arrive',
      sourceNodeId: source.id,
      targetNodeId: work.id,
      travelSeconds: 0,
    });
    await f.write('/edges', 'POST', {
      id: 'complete',
      sourceNodeId: work.id,
      targetNodeId: outcome.id,
      travelSeconds: 0,
    });
    await f.write('/scenarios', 'POST', {
      id: 'more-work',
      name: 'More work',
      overrides: {},
      demandMultiplier: 1.2,
    });
    expect(await f.request('/hierarchy')).toEqual({
      rootProcessIds: ['delivery'],
      processes: [
        {
          id: 'delivery',
          name: 'Delivery',
          childProcessIds: ['fulfilment'],
          nodeIds: nodes.map((node) => node.id),
          directNodeIds: [source.id, outcome.id],
        },
        {
          id: 'fulfilment',
          name: 'Fulfilment',
          parentId: 'delivery',
          childProcessIds: ['packing'],
          nodeIds: [work.id],
          directNodeIds: [],
        },
        {
          id: 'packing',
          name: 'Packing',
          parentId: 'fulfilment',
          childProcessIds: [],
          nodeIds: [work.id],
          directNodeIds: [work.id],
        },
      ],
    });
    const saved = await f.graph();
    expect(saved.nodes.every((node) => !node.id.startsWith('simulation-process:'))).toBe(true);
    const options: SimulationStartOptions = {
      seed: 12345,
      durationSeconds: 1200,
      speed: 'max',
      animated: false,
    };
    const uiResult = runSimulation(saved.simulation!, options);
    const run = (await f.request('/runs', 'POST', options)) as { id: string };
    const result = (await f.request(`/runs/${run.id}/result`)) as SimulationResult;
    expect(result.metrics).toEqual(uiResult.metrics);
    expect(result.processes).toEqual(uiResult.processes);
    expect(result.events).toEqual(uiResult.events);
    expect(result.finalCapacities).toEqual(uiResult.finalCapacities);
    expect(result.metrics).toMatchObject({ created: 10, completed: 10, realizedRevenue: 1000 });
    expect(result.processes!.delivery).toMatchObject({
      entered: 10,
      completed: 10,
      terminalCompleted: 10,
      realizedRevenue: 1000,
    });
    expect(result.processes!.packing).toMatchObject({
      entered: 10,
      completed: 10,
      exited: 10,
      terminalCompleted: 0,
      resourceCostAllocation: 'occupied-units',
      resourceCost: 60,
    });
    expect(result.metrics.resourceCost).toBeCloseTo(120);
    expect(await f.request(`/runs/${run.id}/processes/packing`)).toEqual(result.processes!.packing);
    expect(await f.request(`/runs/${run.id}/processes`)).toEqual(result.processes);
    expect(await f.request(`/runs/${run.id}/queues`)).toHaveProperty(
      'processes.packing',
      result.processes!.packing.queue,
    );
    const reopened = new Repository(f.db);
    expect((await reopened.getGraph(f.diagramId)).simulation).toEqual(saved.simulation);
    // The UI's canonical model setter writes back through the same repository.
    const edited = structuredClone(saved.simulation!);
    edited.processes!.find((process) => process.id === 'packing')!.name = 'Dispatch packing';
    await f.repo.saveGraph(setSimulationModel(saved, edited), saved.diagram.version);
    expect(await f.request('/processes/packing')).toMatchObject({
      name: 'Dispatch packing',
      parentId: 'fulfilment',
    });
  });

  it('supports merge-patch reparenting/null removal, encoded semantic IDs and scenario isolation', async () => {
    const f = await fixture();
    await f.write('/processes', 'POST', { id: 'delivery/NO', name: 'NO delivery' });
    await f.write('/processes', 'POST', {
      id: 'packing',
      name: 'Packing',
      parentId: 'delivery/NO',
      description: 'Before',
    });
    await f.write('/processes/packing', 'PATCH', {
      parentId: null,
      description: null,
      name: 'Independent packing',
    });
    expect(await f.request('/processes/delivery%2FNO')).toMatchObject({ id: 'delivery/NO' });
    expect(await f.request('/processes/packing')).toEqual({
      id: 'packing',
      name: 'Independent packing',
    });
    await f.write('/scenarios', 'POST', {
      id: 'nested',
      name: 'Nested',
      overrides: { processes: { packing: { parentId: 'delivery/NO' } } },
    });
    expect(await f.request('/processes/packing')).not.toHaveProperty('parentId');
    const run = (await f.request('/runs', 'POST', {
      scenarioId: 'nested',
      seed: 42,
      durationSeconds: 1200,
    })) as { id: string };
    expect(await f.request(`/runs/${run.id}/processes/packing`)).toHaveProperty(
      'parentId',
      'delivery/NO',
    );
    await expect(
      f.request('/processes/packing', 'PATCH', { baseVersion: 1, value: { name: 'Stale' } }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects referenced scope deletion with structured errors and allows atomic reparenting', async () => {
    const f = await fixture();
    await f.write('/processes', 'POST', { id: 'delivery', name: 'Delivery' });
    await f.write('/processes', 'POST', { id: 'packing', name: 'Packing', parentId: 'delivery' });
    const work = (await f.graph()).simulation!.nodes.find((node) => node.type === 'work')!;
    await f.write(`/nodes/${work.id}`, 'PATCH', { processId: 'delivery' });
    const before = await f.graph();
    const error = await f
      .request(`/processes/delivery?baseVersion=${before.diagram.version}`, 'DELETE')
      .catch((failure) => failure);
    expect(error).toBeInstanceOf(StorageError);
    expect(bridgeError(error)).toMatchObject({
      code: 'SIMULATION_PROCESS_REFERENCED',
      issues: [{ path: 'processes.delivery' }],
    });
    expect((await f.graph()).diagram.version).toBe(before.diagram.version);
    const next = structuredClone(before.simulation!);
    delete next.nodes.find((node) => node.id === work.id)!.processId;
    delete next.processes!.find((process) => process.id === 'packing')!.parentId;
    next.processes = next.processes!.filter((process) => process.id !== 'delivery');
    await f.request('', 'PUT', { baseVersion: before.diagram.version, model: next });
    expect(await f.request('/processes')).toEqual([{ id: 'packing', name: 'Packing' }]);
    const current = await f.graph();
    await f.request(`/processes/packing?baseVersion=${current.diagram.version}`, 'DELETE');
    expect(await f.request('/hierarchy')).toEqual({ rootProcessIds: [], processes: [] });
  });

  it('rejects missing scopes, cycles and immutable identity without partial writes', async () => {
    const f = await fixture();
    await f.write('/processes', 'POST', { id: 'delivery', name: 'Delivery' });
    await f.write('/processes', 'POST', { id: 'packing', name: 'Packing', parentId: 'delivery' });
    const before = await f.graph();
    for (const [suffix, value] of [
      ['/processes/delivery', { parentId: 'packing' }],
      ['/processes/packing', { parentId: 'missing' }],
      ['/processes/packing', { id: 'replacement' }],
      [`/nodes/${before.simulation!.nodes[0].id}`, { processId: 'missing' }],
    ] as const) {
      const error = await f
        .request(suffix, 'PATCH', { baseVersion: before.diagram.version, value })
        .catch((failure) => failure);
      expect(error).toMatchObject({ status: 422 });
      expect(bridgeError(error)).toHaveProperty('issues');
      expect((await f.graph()).simulation).toEqual(before.simulation);
    }
    await expect(f.request('/hierarchy', 'POST', {})).rejects.toMatchObject({ status: 405 });
    await expect(f.request('/hierarchy?extra=1')).rejects.toMatchObject({ status: 422 });
    await expect(f.request('/hierarchy/extra')).rejects.toMatchObject({ status: 404 });
    expect((await f.graph()).diagram.version).toBe(before.diagram.version);
  });
});
