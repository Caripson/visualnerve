import { describe, it, expect } from 'vitest';
import { BandwidthPool, fairRates } from '../src/simulation/infrastructure/fluid';
import { EnergyPool } from '../src/simulation/infrastructure/energy';
import { MemoryLeases } from '../src/simulation/infrastructure/memory';
import { canonicalInfrastructureValue } from '../src/simulation/infrastructure/types';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { compareSimulationResults } from '../src/simulation/economics';
import { validateSimulationModel, resolveScenario } from '../src/simulation/schema';
import type {
  SimulationModel,
  SimulationNode,
  InfrastructureResource,
} from '../src/simulation/types';
import { parallelModel } from './helpers/parallel-model';
import { DatacenterCapacityExample } from '../src/simulation/datacenter-example';

const work = (m: SimulationModel, id = 'work') =>
  m.nodes.find((n) => n.id === id) as Extract<SimulationNode, { type: 'work' }>;
function infrastructure(particles = 2) {
  const m = createBasicModel({ particles, capacity: 2 });
  m.schemaVersion = 2;
  m.infrastructure = { schemaVersion: 1 };
  m.resources = [
    {
      id: 'cpu',
      name: 'CPU',
      capacity: 1,
      unit: 'cores',
      infrastructure: { kind: 'cpu', unit: 'cores' },
    },
    {
      id: 'ram',
      name: 'RAM',
      capacity: 128,
      unit: 'MiB',
      infrastructure: { kind: 'memory', unit: 'MiB' },
    },
    {
      id: 'link',
      name: 'Link',
      capacity: 8,
      unit: 'Mbps',
      infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
    },
  ];
  work(m).work.processingSeconds = 0;
  work(m).work.infrastructure = {
    cpu: { resourceId: 'cpu', coreSeconds: 2, cores: 1 },
    memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
  };
  return m;
}
describe('infrastructure quantities and conservation', () => {
  it('delivers tiny scaled energy demands rather than discarding them as epsilon, including late-clock completion', () => {
    const pool = new EnergyPool(
      { kind: 'energy', unit: 'kW', generation: [], gridImportLimitKW: 1000000000000 },
      1000000000000,
    );
    pool.add(1, 1e-13, 1000000000000, 10000);
    pool.advance(10000.001);
    expect(pool.completed()).toEqual([1]);
    expect(pool.metrics().deliveredKWh).toBeCloseTo(1e-13, 25);
    expect(pool.metrics().gridImportedKWh).toBeCloseTo(1e-13, 25);
  });
  it('explicitly converts dimensions without confusing binary memory and decimal network rates', () => {
    expect(canonicalInfrastructureValue(1, 'GiB')).toEqual({ unit: 'bytes', value: 1073741824 });
    expect(canonicalInfrastructureValue(1, 'MB')).toEqual({ unit: 'bytes', value: 1000000 });
    expect(canonicalInfrastructureValue(1, 'MiB')).toEqual({ unit: 'bytes', value: 1048576 });
    expect(canonicalInfrastructureValue(1, 'Gbps')).toEqual({ unit: 'Mbps', value: 1000 });
    expect(canonicalInfrastructureValue(500, 'Wh')).toEqual({ unit: 'kWh', value: 0.5 });
    expect(() => canonicalInfrastructureValue(Infinity, 'MiB')).toThrow();
  });
  it('redistributes bandwidth after a completion and conserves every byte', () => {
    const pool = new BandwidthPool(125000);
    pool.add(1, 125000, 0);
    pool.add(2, 250000, 0);
    expect(pool.next()).toBe(2);
    pool.advance(2);
    expect(pool.completed()).toEqual([1]);
    expect(pool.jobs.get(2)!.remaining).toBe(125000);
    pool.remove(1, 2);
    expect(pool.next()).toBe(3);
    pool.advance(3);
    expect(pool.metrics()).toMatchObject({
      transferredBytes: 375000,
      busySeconds: 3,
      activeTransfers: 0,
    });
  });
  it('new arrivals change completion times without losing already transmitted bytes', () => {
    const pool = new BandwidthPool(125000);
    pool.add(1, 250000, 0);
    pool.add(2, 125000, 1);
    expect(pool.next()).toBe(3);
    pool.advance(2);
    expect(pool.transferredBytes).toBe(250000);
    pool.advance(3);
    expect(pool.completed()).toEqual([1, 2]);
    expect(pool.transferredBytes).toBe(375000);
  });
  it('max-min rates honor small load limits while sharing remaining capacity', () => {
    expect([
      ...fairRates(
        [
          { id: 1, maximumRate: 2 },
          { id: 2, maximumRate: 10 },
          { id: 3, maximumRate: 10 },
        ],
        12,
      ),
    ]).toEqual([
      [1, 2],
      [2, 5],
      [3, 5],
    ]);
  });
  it('tracks root memory once, tops up its maximum and adds independent branch stage memory', () => {
    const changes: number[] = [];
    const leases = new MemoryLeases(['ram'], (_id, _node, delta) => changes.push(delta));
    leases.acquire([{ resourceId: 'ram', amountMiB: 64, scope: 'case' }], 1, 1, 'host', 0);
    leases.acquire(
      [
        { resourceId: 'ram', amountMiB: 64, scope: 'case' },
        { resourceId: 'ram', amountMiB: 16, scope: 'stage' },
      ],
      1,
      2,
      'branch',
      1,
    );
    leases.acquire([{ resourceId: 'ram', amountMiB: 96, scope: 'case' }], 1, 3, 'other', 2);
    leases.releaseStage(2, 3);
    leases.releaseCase(1, 4);
    leases.releaseCase(1, 4);
    expect(changes).toEqual([64, 16, 32, -16, -96]);
    expect(leases.metrics().ram).toMatchObject({
      usedMiB: 0,
      peakUsedMiB: 112,
      caseLeases: 0,
      stageLeases: 0,
      allocatedMiBSeconds: 352,
    });
  });
  it('conserves generation through battery conversion, storage and curtailment', () => {
    const pool = new EnergyPool(
      {
        kind: 'energy',
        unit: 'kW',
        generation: [{ startSeconds: 0, endSeconds: 3600, powerKW: 10 }],
        battery: {
          capacityKWh: 4,
          initialKWh: 0,
          maxChargeKW: 5,
          maxDischargeKW: 4,
          chargeEfficiency: 0.8,
          dischargeEfficiency: 0.8,
        },
      },
      20,
    );
    pool.advance(3600);
    expect(pool.metrics()).toMatchObject({
      generatedKWh: 10,
      chargeInputKWh: 5,
      storedKWh: 4,
      curtailedKWh: 5,
    });
    expect(pool.metrics().conversionLossKWh).toBeCloseTo(1, 12);
    pool.add(1, 2, 4, 3600);
    pool.advance(5400);
    const m = pool.metrics();
    expect(m.deliveredKWh).toBe(2);
    expect(m.storedKWh).toBeCloseTo(1.5);
    expect(m.conversionLossKWh).toBeCloseTo(1.5);
    expect(m.generatedKWh + m.gridImportedKWh).toBeCloseTo(
      m.deliveredKWh + m.storedKWh + m.conversionLossKWh + m.curtailedKWh,
    );
  });
  it('grid charges only imported energy and exposes unmet requested load', () => {
    const pool = new EnergyPool(
      { kind: 'energy', unit: 'kW', generation: [], gridImportLimitKW: 10, pricePerKWh: 3 },
      20,
    );
    pool.add(1, 1, 10, 0);
    pool.add(2, 1, 10, 0);
    pool.advance(720);
    expect(pool.metrics()).toMatchObject({
      deliveredKWh: 2,
      gridImportedKWh: 2,
      unservedKWh: 2,
      gridCost: 6,
      storedKWh: 0,
    });
  });
});

describe('single-engine infrastructure execution', () => {
  it('branch failure cancels an active serialization and retains only bytes actually sent', () => {
    const m = parallelModel({ durations: [0.1, 2] });
    m.schemaVersion = 2;
    m.infrastructure = { schemaVersion: 1 };
    m.resources = [
      {
        id: 'ram',
        name: 'RAM',
        capacity: 128,
        unit: 'MiB',
        infrastructure: { kind: 'memory', unit: 'MiB' },
      },
      {
        id: 'link',
        name: 'Link',
        capacity: 1,
        unit: 'Mbps',
        infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
      },
    ];
    work(m, 'work-0').work.infrastructure = {
      memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
    };
    m.edges.find((e) => e.id === 'branch-1')!.infrastructure = {
      transfer: { resourceId: 'link', bytes: 125000 },
    };
    m.improvements = [
      {
        id: 'fail',
        name: 'Fail first branch',
        nodeId: 'work-0',
        enabled: true,
        investmentCost: 0,
        failureProbability: 1,
      },
    ];
    const r = runSimulation(m, { untilComplete: true });
    expect(r.metrics.failed).toBe(1);
    expect(r.infrastructure!.bandwidth.link.transferredBytes).toBe(12500);
    expect(r.infrastructure!.bandwidth.link.activeTransfers).toBe(0);
    expect(r.infrastructure!.memory.ram.usedMiB).toBe(0);
  });
  it('grid-only tariff reaches a budget at its actual import timestamp and cancels the unfinished load', () => {
    const m = infrastructure(1);
    m.resources.push({
      id: 'power',
      name: 'Grid',
      capacity: 5,
      unit: 'kW',
      infrastructure: {
        kind: 'energy',
        unit: 'kW',
        generation: [],
        gridImportLimitKW: 5,
        pricePerKWh: 10,
      },
    });
    work(m).work.infrastructure = {
      energy: { resourceId: 'power', energyKWh: 1, powerKW: 5 },
      memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
    };
    m.economics = { maximumBudget: 5 };
    const r = runSimulation(m, { untilComplete: true });
    expect(r.status).toBe('failed');
    expect(r.timeSeconds).toBe(360);
    expect(r.metrics.resourceCost).toBe(5);
    expect(r.infrastructure!.energy.power.deliveredKWh).toBe(0.5);
    expect(r.infrastructure!.energy.power.activeLoads).toBe(0);
    expect(r.infrastructure!.memory.ram.usedMiB).toBe(0);
  });
  it('attributes blocked admission to the actual CPU or memory pool without blaming every referenced pool', () => {
    const cpu = infrastructure();
    cpu.nodes.push(
      { id: 'cpu-view', name: 'CPU pool', type: 'resource', resourceId: 'cpu' },
      { id: 'ram-view', name: 'RAM pool', type: 'resource', resourceId: 'ram' },
    );
    cpu.processes = [{ id: 'api', name: 'API' }];
    work(cpu).processId = 'api';
    const cpuEngine = new SimulationEngine(cpu);
    cpuEngine.advance(1);
    const cpuState = cpuEngine.state();
    expect(cpuState.nodes.work.blockedResourceIds).toEqual(['cpu']);
    expect(cpuState.resources.ram.blockedNodeIds).toEqual([]);
    expect(cpuState.nodes['cpu-view'].status).toBe('blocked');
    expect(cpuState.nodes['ram-view'].status).toBe('normal');
    expect(cpuState.bottlenecks.find((b) => b.id === 'cpu')).toMatchObject({
      methodology: 'blocked-admission',
      score: 2,
    });
    expect(cpuState.bottlenecks.some((b) => b.id === 'ram')).toBe(false);
    expect(cpuState.processes!.api.bottlenecks.some((b) => b.id === 'cpu')).toBe(true);
    expect(cpuState.processes!.api.bottlenecks.some((b) => b.id === 'ram')).toBe(false);
    const ram = infrastructure();
    ram.resources[0].capacity = 2;
    ram.resources[1].capacity = 96;
    const ramEngine = new SimulationEngine(ram);
    ramEngine.advance(1);
    expect(ramEngine.state().nodes.work.blockedResourceIds).toEqual(['ram']);
    expect(ramEngine.state().resources.ram.blockedNodeIds).toEqual(['work']);
    expect(ramEngine.state().resources.cpu.blockedNodeIds).toEqual([]);
  });
  it('ranks actual shared bandwidth pressure without inventing a Work queue or blaming an inactive scope', () => {
    const m = infrastructure();
    m.edges[0].infrastructure = { transfer: { resourceId: 'link', bytes: 1000000 } };
    m.nodes.push(
      { id: 'link-view', name: 'WAN', type: 'resource', resourceId: 'link' },
      {
        id: 'later',
        name: 'Later source',
        type: 'source',
        processId: 'quiet',
        source: {
          particleTypeId: 'work-item',
          burst: 1,
          startSeconds: 10,
        },
      },
    );
    m.edges.push({
      id: 'later-link',
      sourceNodeId: 'later',
      targetNodeId: 'work',
      infrastructure: { transfer: { resourceId: 'link', bytes: 1000000 } },
    });
    m.processes = [
      { id: 'network', name: 'Network' },
      { id: 'quiet', name: 'Quiet' },
    ];
    m.nodes[0].processId = 'network';
    const engine = new SimulationEngine(m);
    engine.advance(1);
    const state = engine.state();
    expect(state.infrastructure!.bandwidth.link).toMatchObject({ activeTransfers: 2, usedMbps: 8 });
    expect(state.resources.link.queue.current).toBe(0);
    expect(state.metrics.currentBottleneck).toBe('link');
    expect(state.bottlenecks.find((b) => b.id === 'link')).toMatchObject({
      methodology: 'bandwidth-sharing',
      score: 1,
      averageQueue: 0,
      reason: 'Concurrent transfers share the available bandwidth.',
    });
    expect(state.nodes['link-view'].status).toBe('blocked');
    expect(state.processes!.network.currentBottleneck).toBe('link');
    expect(state.processes!.quiet.bottlenecks).toEqual([]);
  });
  it('indexes blocked consumers once while preserving declared resource and Work-node ordering', () => {
    for (const reverse of [false, true]) {
      const m = infrastructure();
      const second = { ...structuredClone(work(m)), id: 'a-work', name: 'Second work' };
      m.nodes.push(
        {
          id: 'second-source',
          name: 'Second source',
          type: 'source',
          source: { particleTypeId: 'work-item', burst: 1, startSeconds: 0 },
        },
        second,
      );
      m.edges.push(
        { id: 'second-in', sourceNodeId: 'second-source', targetNodeId: 'a-work' },
        { id: 'second-out', sourceNodeId: 'a-work', targetNodeId: m.nodes[2].id },
      );
      if (reverse) {
        m.resources.reverse();
        m.nodes = [m.nodes[0], second, ...m.nodes.slice(1).filter((node) => node.id !== second.id)];
      }
      const engine = new SimulationEngine(m);
      engine.advance(1);
      const state = engine.state();
      expect(Object.keys(state.resources)).toEqual(m.resources.map((r) => r.id));
      expect(state.resources.cpu.blockedNodeIds).toEqual(
        reverse ? ['a-work', 'work'] : ['work', 'a-work'],
      );
      expect(state.resources.ram.blockedNodeIds).toEqual([]);
      expect(state.resources.link.blockedNodeIds).toEqual([]);
      expect(state.bottlenecks.find((b) => b.id === 'cpu')?.score).toBe(4);
    }
  });
  it('ranks actual energy shortfall only in the scope of a rate-limited load', () => {
    const m = infrastructure(1);
    m.resources.push({
      id: 'power',
      name: 'Grid',
      capacity: 20,
      unit: 'kW',
      infrastructure: { kind: 'energy', unit: 'kW', generation: [], gridImportLimitKW: 5 },
    });
    work(m).work.infrastructure = { energy: { resourceId: 'power', energyKWh: 1, powerKW: 1 } };
    work(m).processId = 'small';
    m.nodes.push(
      {
        id: 'large-source',
        name: 'Large load source',
        type: 'source',
        source: {
          particleTypeId: 'work-item',
          burst: 1,
          startSeconds: 0,
        },
      },
      {
        id: 'large-work',
        name: 'Large load',
        type: 'work',
        processId: 'large',
        work: {
          ...work(m).work,
          infrastructure: { energy: { resourceId: 'power', energyKWh: 1, powerKW: 10 } },
        },
      },
      { id: 'power-view', name: 'Power pool', type: 'resource', resourceId: 'power' },
    );
    m.edges.push(
      { id: 'large-in', sourceNodeId: 'large-source', targetNodeId: 'large-work' },
      { id: 'large-out', sourceNodeId: 'large-work', targetNodeId: m.nodes[2].id },
    );
    m.processes = [
      { id: 'small', name: 'Small load' },
      { id: 'large', name: 'Large load' },
    ];
    const engine = new SimulationEngine(m);
    engine.advance(1);
    const state = engine.state();
    expect(state.infrastructure!.energy.power).toMatchObject({ suppliedKW: 5, unmetKW: 6 });
    expect(state.metrics.currentBottleneck).toBe('power');
    expect(state.bottlenecks.find((b) => b.id === 'power')).toMatchObject({
      methodology: 'energy-shortfall',
      score: 6 / 11,
      averageQueue: 0,
    });
    expect(state.nodes['power-view'].status).toBe('blocked');
    expect(state.processes!.large.currentBottleneck).toBe('power');
    expect(state.processes!.small.bottlenecks).toEqual([]);
  });
  it('mixed-domain and upgraded workloads drain within a bounded event count with no zero-time tail loop', () => {
    for (const scenarioId of [undefined, 'balanced-upgrade']) {
      const engine = new SimulationEngine(new DatacenterCapacityExample().model(), {
        untilComplete: true,
        scenarioId,
      });
      let done = false;
      for (let batches = 0; batches < 50 && !done; batches++) done = engine.advance(120, 10000);
      expect(done).toBe(true);
      expect(engine.state().status).toBe('completed');
      expect(engine.state().metrics.inSystem).toBe(0);
      expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(0);
      expect(engine.state().infrastructure!.bandwidth.wan.activeTransfers).toBe(0);
    }
  });
  it('frame-paced advancement preserves exact discrete results and continuous quantities within declared floating-point tolerance', () => {
    const m = new DatacenterCapacityExample().model();
    const direct = runSimulation(m);
    const pacedEngine = new SimulationEngine(m);
    for (let milliseconds = 31; milliseconds < 120000; milliseconds += 31)
      pacedEngine.advance(milliseconds / 1000);
    pacedEngine.advance(120);
    const paced = pacedEngine.result();
    expect(paced.status).toBe(direct.status);
    expect(paced.timeSeconds).toBe(direct.timeSeconds);
    expect(paced.completedAtSeconds).toBe(direct.completedAtSeconds);
    expect(paced.metrics).toEqual(direct.metrics);
    expect(paced.events).toEqual(direct.events);
    expect(paced.finalCapacities).toEqual(direct.finalCapacities);
    expect(paced.nodes).toEqual(direct.nodes);
    expect(paced.resources).toEqual(direct.resources);
    expect(paced.processes).toEqual(direct.processes);
    const counts = new Set([
      'caseLeases',
      'stageLeases',
      'activeTransfers',
      'peakActiveTransfers',
      'activeLoads',
    ]);
    for (const family of ['cpu', 'memory', 'bandwidth', 'energy'] as const)
      for (const [id, metrics] of Object.entries(direct.infrastructure![family]))
        for (const [field, expected] of Object.entries(
          metrics as unknown as Record<string, number>,
        )) {
          const actual = (paced.infrastructure![family][id] as unknown as Record<string, number>)[
            field
          ];
          if (counts.has(field)) expect(actual, `${family}.${id}.${field}`).toBe(expected);
          else
            expect(Math.abs(actual - expected), `${family}.${id}.${field}`).toBeLessThanOrEqual(
              Math.max(1e-9, 1e-9 * Math.max(Math.abs(expected), Math.abs(actual))),
            );
        }
  }, 20000);
  it('reports only observed byte progress and starts fixed propagation at serialization completion', () => {
    const m = infrastructure(1);
    m.edges[0].infrastructure = { transfer: { resourceId: 'link', bytes: 1000000 } };
    m.edges[0].travelSeconds = 0.5;
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(0.5);
    expect(engine.state().particles.find((p) => p.status === 'transit')!.transferProgress).toBe(
      0.45,
    );
    expect(
      engine.state().particles.find((p) => p.status === 'transit')!.arrivesAtSeconds,
    ).toBeUndefined();
    engine.advance(1.2);
    const propagating = engine.state().particles.find((p) => p.status === 'transit')!;
    expect(propagating.transferProgress).toBeCloseTo(0.94, 12);
    expect(propagating.departedAtSeconds).toBe(1);
    expect(propagating.arrivesAtSeconds).toBe(1.5);
  });
  it('holds already acquired case memory while a later CPU stage waits for its opening window', () => {
    const m = infrastructure(1);
    m.resources[0].schedule = [
      { startSeconds: 0, endSeconds: 2 },
      { startSeconds: 5, endSeconds: 10 },
    ];
    m.nodes.push({
      id: 'later',
      name: 'Later CPU',
      type: 'work',
      work: {
        processingSeconds: 0,
        capacity: 1,
        infrastructure: {
          cpu: { resourceId: 'cpu', coreSeconds: 2, cores: 1 },
          memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
        },
      },
    });
    m.edges[1].targetNodeId = 'later';
    m.edges.push({ id: 'later-out', sourceNodeId: 'later', targetNodeId: 'outcome' });
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(4);
    expect(engine.state().nodes.later.queue.current).toBe(1);
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(64);
    engine.advance(100);
    expect(engine.result().completedAtSeconds).toBe(7);
    expect(engine.result().infrastructure!.memory.ram.allocatedMiBSeconds).toBe(448);
  });
  it('explicit release ends a case allocation before a subsequent transfer', () => {
    const m = infrastructure(1);
    m.nodes.push({
      id: 'release',
      name: 'Release retained memory',
      type: 'work',
      work: {
        processingSeconds: 0.001,
        capacity: 1,
        infrastructure: { releaseMemoryResourceIds: ['ram'] },
      },
    });
    m.edges[1].targetNodeId = 'release';
    m.edges.push({
      id: 'release-out',
      sourceNodeId: 'release',
      targetNodeId: 'outcome',
      infrastructure: { transfer: { resourceId: 'link', bytes: 1000000 } },
    });
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(2.5);
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(0);
    engine.advance(100);
    expect(engine.result().completedAtSeconds).toBe(3.001);
    expect(engine.result().infrastructure!.memory.ram.allocatedMiBSeconds).toBeCloseTo(128.064, 9);
  });
  it('pauses serialization for an unavailable link without consuming bytes', () => {
    const m = infrastructure(1);
    m.resources[2].capacity = 1;
    m.resources[2].schedule = [{ startSeconds: 1, endSeconds: 3 }];
    m.edges[0].infrastructure = { transfer: { resourceId: 'link', bytes: 125000 } };
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(0.5);
    expect(engine.state().infrastructure!.bandwidth.link).toMatchObject({
      activeTransfers: 1,
      transferredBytes: 0,
      usedMbps: 0,
    });
    engine.advance(100);
    expect(engine.result().completedAtSeconds).toBe(4);
    expect(engine.result().infrastructure!.bandwidth.link.transferredBytes).toBe(125000);
  });
  it('waits for future generation and keeps memory until the actual energy load completes', () => {
    const m = infrastructure(1);
    m.resources.push({
      id: 'power',
      name: 'Generation',
      capacity: 10,
      unit: 'kW',
      infrastructure: {
        kind: 'energy',
        unit: 'kW',
        generation: [{ startSeconds: 10, endSeconds: 20, powerKW: 10 }],
      },
    });
    work(m).work.infrastructure = {
      energy: { resourceId: 'power', energyKWh: 0.001, powerKW: 10 },
      memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
    };
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(5);
    expect(engine.state().infrastructure!.energy.power.deliveredKWh).toBe(0);
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(64);
    engine.advance(100);
    expect(engine.result().completedAtSeconds).toBe(10.36);
    expect(engine.result().infrastructure!.energy.power.deliveredKWh).toBeCloseTo(0.001, 12);
  });
  it('acquires CPU and initial RAM atomically, holds case RAM through serialization and propagation, releases at terminal', () => {
    const m = infrastructure();
    m.edges[1].infrastructure = { transfer: { resourceId: 'link', bytes: 1000000 } };
    m.edges[1].travelSeconds = 0.5;
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(1);
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(64);
    expect(engine.state().infrastructure!.cpu.cpu.reservedCores).toBe(1);
    expect(engine.state().nodes.work.queue.current).toBe(1);
    engine.advance(2.5);
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(128);
    engine.advance(86400);
    const r = engine.result();
    expect(r.completedAtSeconds).toBe(5.5);
    expect(r.infrastructure!.cpu.cpu).toMatchObject({
      coreSeconds: 4,
      completedWorkCoreSeconds: 4,
      reservedCores: 0,
    });
    expect(r.infrastructure!.memory.ram).toMatchObject({
      usedMiB: 0,
      peakUsedMiB: 128,
      allocatedMiBSeconds: 448,
    });
    expect(r.infrastructure!.bandwidth.link.transferredBytes).toBe(2000000);
    expect(r.metrics.completed).toBe(2);
  });
  it('checks combined case+stage memory demand atomically on the same pool', () => {
    const m = infrastructure(1);
    m.resources[1].capacity = 64;
    work(m).work.infrastructure!.memory!.push({ resourceId: 'ram', amountMiB: 32, scope: 'stage' });
    const r = runSimulation(m, { untilComplete: true });
    expect(r.status).toBe('failed');
    expect(r.failureCode).toBe('SIMULATION_INFRASTRUCTURE_STALLED');
    expect(r.infrastructure!.memory.ram.usedMiB).toBe(0);
    expect(r.infrastructure!.cpu.cpu.reservedCores).toBe(0);
  });
  it('recalculates active transfer deadlines and ignores stale completion epochs', () => {
    const m = infrastructure(1);
    work(m).work.infrastructure = undefined;
    work(m).work.processingSeconds = 0.001;
    m.resources[2].capacity = 1;
    m.nodes.push({
      id: 'second',
      name: 'Second source',
      type: 'source',
      source: { particleTypeId: 'work-item', burst: 1, startSeconds: 1 },
    });
    m.edges[0].infrastructure = { transfer: { resourceId: 'link', bytes: 250000 } };
    m.edges.push({
      id: 'second-work',
      sourceNodeId: 'second',
      targetNodeId: 'work',
      infrastructure: { transfer: { resourceId: 'link', bytes: 125000 } },
    });
    const r = runSimulation(m, { untilComplete: true });
    expect(r.completedAtSeconds).toBe(3.001);
    expect(r.metrics.completed).toBe(2);
    expect(r.infrastructure!.bandwidth.link.transferredBytes).toBe(375000);
  });
  it('zero-byte transfer applies propagation once and terminates at zero-time epoch safely', () => {
    const m = infrastructure(1);
    m.edges[0].infrastructure = { transfer: { resourceId: 'link', bytes: 0 } };
    m.edges[0].travelSeconds = 0.5;
    const r = runSimulation(m, { untilComplete: true });
    expect(r.completedAtSeconds).toBe(2.5);
    expect(r.infrastructure!.bandwidth.link.transferredBytes).toBe(0);
  });
  it('executes shared energy loads by delivered kWh and includes only actual grid tariff in cost', () => {
    const m = infrastructure();
    m.resources.push({
      id: 'power',
      name: 'Power',
      capacity: 20,
      unit: 'kW',
      infrastructure: {
        kind: 'energy',
        unit: 'kW',
        generation: [],
        gridImportLimitKW: 10,
        pricePerKWh: 3,
      },
    });
    work(m).work.infrastructure = { energy: { resourceId: 'power', energyKWh: 1, powerKW: 10 } };
    const r = runSimulation(m, { untilComplete: true });
    expect(r.completedAtSeconds).toBe(720);
    expect(r.metrics.completed).toBe(2);
    expect(r.metrics.resourceCost).toBe(6);
    expect(r.resources.power.cost).toBe(6);
    expect(r.infrastructure!.energy.power).toMatchObject({
      deliveredKWh: 2,
      gridImportedKWh: 2,
      gridCost: 6,
      unservedKWh: 2,
    });
  });
  it('fails a genuinely exhausted supply with partial energy retained and reservations released', () => {
    const m = infrastructure(1);
    m.resources.push({
      id: 'power',
      name: 'Power',
      capacity: 5,
      unit: 'kW',
      infrastructure: {
        kind: 'energy',
        unit: 'kW',
        generation: [],
        battery: {
          capacityKWh: 1,
          initialKWh: 1,
          maxChargeKW: 1,
          maxDischargeKW: 5,
          chargeEfficiency: 1,
          dischargeEfficiency: 1,
        },
      },
    });
    work(m).work.infrastructure = {
      energy: { resourceId: 'power', energyKWh: 2, powerKW: 5 },
      memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
    };
    const r = runSimulation(m, { untilComplete: true });
    expect(r.status).toBe('failed');
    expect(r.failureCode).toBe('SIMULATION_INFRASTRUCTURE_STALLED');
    expect(r.infrastructure!.energy.power.deliveredKWh).toBeCloseTo(1);
    expect(r.infrastructure!.energy.power.activeLoads).toBe(0);
    expect(r.infrastructure!.memory.ram.usedMiB).toBe(0);
  });
  it('parallel children share root lease, stage allocations cancel once and root terminal frees the remaining case lease', () => {
    const m = parallelModel();
    m.schemaVersion = 2;
    m.infrastructure = { schemaVersion: 1 };
    m.resources = [
      {
        id: 'ram',
        name: 'RAM',
        capacity: 128,
        unit: 'MiB',
        infrastructure: { kind: 'memory', unit: 'MiB' },
      },
    ];
    for (const n of m.nodes)
      if (n.type === 'work')
        n.work.infrastructure = {
          memory: [
            { resourceId: 'ram', amountMiB: 64, scope: 'case' },
            { resourceId: 'ram', amountMiB: 16, scope: 'stage' },
          ],
        };
    const engine = new SimulationEngine(m, { untilComplete: true });
    engine.advance(1);
    expect(engine.state().infrastructure!.memory.ram).toMatchObject({
      usedMiB: 96,
      caseLeases: 1,
      stageLeases: 2,
    });
    engine.advance(60);
    expect(engine.state().infrastructure!.memory.ram).toMatchObject({
      usedMiB: 0,
      peakUsedMiB: 96,
    });
    const failing = structuredClone(m);
    failing.improvements = [
      {
        id: 'fail',
        name: 'Fail branch',
        enabled: true,
        nodeId: 'work-0',
        investmentCost: 0,
        failureProbability: 1,
      },
    ];
    const r = runSimulation(failing, { untilComplete: true });
    expect(r.metrics.failed).toBe(1);
    expect(r.infrastructure!.memory.ram.usedMiB).toBe(0);
    expect(r.parallel!.activeBranches).toBe(0);
  });
  it('stop invalidates transfers and releases CPU/RAM without late completion', () => {
    const m = infrastructure(1),
      engine = new SimulationEngine(m);
    engine.advance(1);
    engine.stop();
    expect(engine.state().status).toBe('stopped');
    expect(engine.state().infrastructure!.memory.ram.usedMiB).toBe(0);
    expect(engine.state().infrastructure!.cpu.cpu.reservedCores).toBe(0);
    engine.advance(1000);
    expect(engine.state().metrics.completed).toBe(0);
  });
  it('plain legacy models retain exact population, timing and economic acceptance values', () => {
    const m = createBasicModel();
    const r = runSimulation(m, { untilComplete: true });
    expect(r.infrastructure).toBeUndefined();
    expect(r.metrics).toMatchObject({ created: 10, completed: 10, realizedRevenue: 1000, cost: 0 });
    expect(r.completedAtSeconds).toBe(600);
  });
  it('domain comparison keeps actual result sides, signed same-pool deltas and no fabricated absent pool values', () => {
    const m = infrastructure();
    const baseline = runSimulation(m, { untilComplete: true });
    m.resources[0].capacity = 2;
    const scenario = runSimulation(m, { untilComplete: true });
    const comparison = compareSimulationResults(baseline, scenario).infrastructure!;
    expect(comparison.delta.memory.ram.allocatedMiBSeconds).toBe(0);
    expect(comparison.delta.memory.ram.peakUsedMiB).toBe(64);
    expect(comparison.delta.cpu.cpu.coreSeconds).toBe(0);
    scenario.infrastructure!.memory.other = { ...scenario.infrastructure!.memory.ram };
    expect(
      compareSimulationResults(baseline, scenario).infrastructure!.delta.memory.other,
    ).toBeUndefined();
    comparison.baseline.memory.ram.usedMiB = 999;
    expect(baseline.infrastructure!.memory.ram.usedMiB).toBe(0);
  });
});

describe('strict additive infrastructure validation', () => {
  it.each([1, 2] as const)(
    'validates complete schema%s model descriptions as optional text',
    (version) => {
      const m = version === 2 ? infrastructure() : createBasicModel();
      for (const description of [undefined, '', 'CPU + RAM assumptions — 1 MiB ≠ 1 MB']) {
        m.description = description;
        expect(() => validateSimulationModel(m)).not.toThrow();
      }
      for (const description of [null, {}, [], 7, true]) {
        Object.assign(m, { description });
        expect(() => validateSimulationModel(m)).toThrow('model description must be a string');
      }
    },
  );
  it.each(['gridImportLimitKW', 'pricePerKWh'] as const)(
    'rejects explicit complete null energy %s but allows scenario removal',
    (field) => {
      const m = infrastructure();
      m.resources.push({
        id: 'power',
        name: 'Power',
        capacity: 1,
        unit: 'kW',
        infrastructure: {
          kind: 'energy',
          unit: 'kW',
          generation: [],
          [field]: null,
        } as unknown as InfrastructureResource,
      });
      expect(() => validateSimulationModel(m)).toThrow();
      const d = m.resources[3].infrastructure;
      if (d?.kind === 'energy') delete d[field];
      expect(() => validateSimulationModel(m)).not.toThrow();
    },
  );
  it('rejects silently ignored memory-target time improvement on an energy consumer, while memory-only unit optimization works', () => {
    const m = infrastructure(1);
    m.resources.push({
      id: 'power',
      name: 'Power',
      capacity: 1,
      unit: 'kW',
      infrastructure: { kind: 'energy', unit: 'kW', generation: [], gridImportLimitKW: 1 },
    });
    work(m).work.infrastructure = {
      energy: { resourceId: 'power', energyKWh: 0.001, powerKW: 1 },
      memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
    };
    m.improvements = [
      {
        id: 'bad',
        name: 'Ignored time multiplier',
        enabled: true,
        resourceId: 'ram',
        investmentCost: 0,
        processingTimeMultiplier: 0.5,
      },
    ];
    expect(() => validateSimulationModel(m)).toThrow('energy activity');
    delete m.improvements[0].processingTimeMultiplier;
    m.improvements[0].resourceUnitsMultiplier = 0.5;
    const r = runSimulation(m, { untilComplete: true });
    expect(r.infrastructure!.memory.ram.peakUsedMiB).toBe(32);
    expect(r.infrastructure!.energy.power.deliveredKWh).toBeCloseTo(0.001, 12);
  });
  it('rejects overflowing derived typed reservations before projection can contain NaN', () => {
    const m = infrastructure();
    m.improvements = [
      {
        id: 'too-large',
        name: 'Impossible multiplier',
        enabled: true,
        resourceId: 'cpu',
        investmentCost: 0,
        resourceUnitsMultiplier: 1e308,
      },
    ];
    expect(() => validateSimulationModel(m)).toThrow('quantity');
  });
  it('all malformed typed quantities return structured infrastructure errors while legacy errors remain compatible', () => {
    const m = infrastructure();
    m.resources[0].capacity = -1;
    try {
      validateSimulationModel(m);
      throw new Error('Expected invalid capacity');
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        code: 'SIMULATION_INFRASTRUCTURE_INVALID',
        issues: [{ path: 'simulation' }],
      });
    }
    const legacy = createBasicModel();
    work(legacy).work.capacity = -1;
    try {
      validateSimulationModel(legacy);
      throw new Error('Expected invalid capacity');
    } catch (error) {
      expect(error).not.toHaveProperty('code');
    }
  });
  it.each([
    (m: SimulationModel) => {
      m.schemaVersion = 1;
    },
    (m: SimulationModel) => {
      m.resources[0].unit = 'MHz';
    },
    (m: SimulationModel) => {
      work(m).work.infrastructure!.cpu!.cores = NaN;
    },
    (m: SimulationModel) => {
      work(m).work.infrastructure!.memory!.push({ ...work(m).work.infrastructure!.memory![0] });
    },
    (m: SimulationModel) => {
      work(m).work.resourceRequirements = [{ resourceId: 'cpu', units: 1 }];
    },
    (m: SimulationModel) => {
      work(m).work.infrastructure!.releaseMemoryResourceIds = ['ram'];
    },
    (m: SimulationModel) => {
      m.resources[2].scaling = { maxCapacity: 9 };
    },
    (m: SimulationModel) => {
      m.edges[0].infrastructure = { transfer: { resourceId: 'ram', bytes: 5 } };
    },
    (m: SimulationModel) => {
      m.resources[0].infrastructure = null as unknown as InfrastructureResource;
    },
  ])('rejects invalid dimensions, duplicates and unsupported operations atomically', (mutate) => {
    const m = infrastructure();
    mutate(m);
    expect(() => validateSimulationModel(m)).toThrow();
  });
  it('keeps optional scenario removals and finite fractional CPU capacities valid', () => {
    const m = infrastructure();
    m.resources[0].capacity = 0.5;
    work(m).work.infrastructure!.cpu!.cores = 0.5;
    m.resources[0].scaling = { maxCapacity: 2, minCapacity: 0.5, increment: 0.5 };
    m.scenarios = [
      {
        id: 'no-case-memory',
        name: 'No retained memory',
        overrides: { nodes: { work: { work: { infrastructure: { memory: null } } } } },
      },
    ];
    expect(() => validateSimulationModel(m)).not.toThrow();
    expect(work(resolveScenario(m, 'no-case-memory')).work.infrastructure!.memory).toBeUndefined();
  });
});
