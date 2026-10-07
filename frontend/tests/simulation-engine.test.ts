import { describe, expect, it } from 'vitest';
import {
  SimulationEngine,
  runSimulation,
  compareSimulationResults,
} from '../src/simulation/engine';
import { createBasicModel, createKioskModel } from '../src/simulation/examples';
import { validateSimulationModel, resolveScenario } from '../src/simulation/schema';
import type { SimulationModel, SimulationNode } from '../src/simulation/types';
import { Distribution } from '../src/simulation/statistics';
function work(model: SimulationModel, id = 'work') {
  return model.nodes.find((n) => n.id === id) as Extract<SimulationNode, { type: 'work' }>;
}
function source(model: SimulationModel, id = 'source') {
  return model.nodes.find((n) => n.id === id) as Extract<SimulationNode, { type: 'source' }>;
}
describe('Process Simulator deterministic acceptance', () => {
  it('AT-02 basic finite flow is deterministic and takes ten minutes', () => {
    const model = createBasicModel();
    const a = runSimulation(model, { seed: 42, untilComplete: true }),
      b = runSimulation(model, { seed: 42, untilComplete: true });
    expect(a).toEqual(b);
    expect(a.metrics).toMatchObject({
      created: 10,
      completed: 10,
      abandoned: 0,
      realizedRevenue: 1000,
      queue: { current: 0 },
    });
    expect(a.completedAtSeconds).toBe(600);
    expect(a.timeSeconds).toBe(600);
  });
  it('AT-03 capacity conserves work/revenue and reduces congestion', () => {
    const model = createBasicModel({ particles: 100 });
    const a = runSimulation(model, { untilComplete: true });
    work(model).work.capacity = 2;
    const b = runSimulation(model, { untilComplete: true });
    expect(a.completedAtSeconds).toBe(6000);
    expect(b.completedAtSeconds).toBe(3000);
    expect(b.metrics.realizedRevenue).toBe(a.metrics.realizedRevenue);
    expect(b.metrics.completed).toBe(a.metrics.completed);
    expect(b.metrics.queue.wait.average).toBeLessThan(a.metrics.queue.wait.average);
  });
  it('AT-04 overload exposes real queue, utilized capacity and wait metrics', () => {
    const model = createBasicModel();
    source(model).source = { particleTypeId: 'work-item', ratePerHour: 120 };
    const e = new SimulationEngine(model, { durationSeconds: 1800 });
    e.advance(1800);
    const s = e.state();
    expect(s.metrics.queue.current).toBeGreaterThan(20);
    expect(s.nodes.work.utilization).toBeGreaterThan(0.95);
    expect(s.nodes.work.queue.average).toBeGreaterThan(5);
    expect(s.metrics.queue.wait.average).toBeGreaterThan(200);
    expect(s.particles.some((p) => p.status === 'queued')).toBe(true);
  });
  it('AT-05 simultaneous Work nodes acquire one shared resource atomically', () => {
    const model = createBasicModel({ particles: 1 });
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.nodes.push(
      {
        id: 'source-b',
        name: 'Source B',
        type: 'source',
        source: { particleTypeId: 'work-item', burst: 1 },
      },
      {
        id: 'work-b',
        name: 'Work B',
        type: 'work',
        work: {
          processingSeconds: 60,
          capacity: 1,
          resourceRequirements: [{ resourceId: 'staff', units: 1 }],
        },
      },
    );
    model.edges.push(
      { id: 'b1', sourceNodeId: 'source-b', targetNodeId: 'work-b' },
      { id: 'b2', sourceNodeId: 'work-b', targetNodeId: 'outcome' },
    );
    const e = new SimulationEngine(model, { untilComplete: true });
    e.advance(1);
    expect(e.state().resources.staff.busy).toBe(1);
    expect(e.state().nodes.work.busy + e.state().nodes['work-b'].busy).toBe(1);
    e.advance(86400);
    const a = e.result();
    expect(a.completedAtSeconds).toBe(120);
    expect(a.metrics.queue.wait.maximum).toBe(60);
    model.resources[0].capacity = 2;
    const b = runSimulation(model, { untilComplete: true });
    expect(b.completedAtSeconds).toBe(60);
    expect(b.metrics.queue.wait.maximum).toBe(0);
  });
  it('AT-06/07 queue-driven scaling increases throughput, charges cost and waits before shrinking', () => {
    const model = createBasicModel({ particles: 100 });
    work(model).work.scaling = {
      minCapacity: 1,
      maxCapacity: 3,
      queueAbove: 20,
      increment: 1,
      cooldownSeconds: 60,
      additionalCostPerHour: 320,
      scaleUpCost: 50,
      utilizationBelow: 0.3,
      scaleDownAfterSeconds: 3600,
    };
    model.defaults.durationSeconds = 12000;
    const e = new SimulationEngine(model);
    e.advance(1);
    expect(e.state().nodes.work.capacity).toBe(2);
    e.advance(61);
    expect(e.state().nodes.work.capacity).toBe(3);
    e.advance(3000);
    expect(e.state().nodes.work.capacity).toBe(3);
    e.advance(12000);
    const result = e.result();
    expect(result.nodes.work.capacity).toBe(1);
    expect(result.metrics.operatingCost).toBeGreaterThan(0);
    expect(result.metrics.scalingCost).toBe(100);
    const up = result.events.filter((v) => v.type === 'CAPACITY_SCALE_UP'),
      down = result.events.filter((v) => v.type === 'CAPACITY_SCALE_DOWN');
    expect(up.map((v) => v.capacity)).toEqual([2, 3]);
    expect(down[0].timeSeconds).toBeGreaterThanOrEqual(result.completedAtSeconds! + 3600);
    expect(down.map((v) => v.capacity)).toEqual([2, 1]);
  });
  it('AT-08 complexity scales processing duration', () => {
    const model = createBasicModel({ particles: 1, processingSeconds: 300 });
    model.particleTypes[0].complexity = { min: 2, max: 2 };
    const result = runSimulation(model, { untilComplete: true });
    expect(result.completedAtSeconds).toBe(600);
    expect(result.particles[0].processingSeconds).toBe(600);
  });
  it('AT-09 TTR and route statistics use simulation timestamps', () => {
    const model = createBasicModel({ particles: 1, processingSeconds: 300 });
    model.nodes.push({
      id: 'b',
      name: 'Second work',
      type: 'work',
      work: { processingSeconds: 600, capacity: 1 },
    });
    model.edges[1].targetNodeId = 'b';
    model.edges.push({ id: 'finish', sourceNodeId: 'b', targetNodeId: 'outcome' });
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.ttr.average).toBe(900);
    expect(result.particles[0].timeToRevenueSeconds).toBe(900);
    expect(Object.values(result.routeMetrics)[0].ttr.average).toBe(900);
  });
  it('AT-10 economic ledger produces 1000 revenue,400 cost,600 contribution', () => {
    const model = createBasicModel();
    work(model).work.costPerParticle = 40;
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics).toMatchObject({ realizedRevenue: 1000, cost: 400, contribution: 600 });
  });
  it('AT-11 queued work abandons after patience and records lost revenue once', () => {
    const model = createBasicModel({ particles: 2, processingSeconds: 600 });
    model.particleTypes[0].patienceSeconds = 300;
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics).toMatchObject({
      completed: 1,
      abandoned: 1,
      lostRevenue: 100,
      realizedRevenue: 100,
    });
    expect(result.events.filter((v) => v.type === 'PARTICLE_ABANDONED')).toHaveLength(1);
  });
  it('AT-12/13/14 kiosk stress damages core flow and intervention changes both cost and throughput', () => {
    const model = createKioskModel();
    const baseline = runSimulation(model, { scenarioId: 'baseline' }),
      stress = runSimulation(model, { scenarioId: 'package-stress' }),
      intervention = runSimulation(model, { scenarioId: 'dedicated-package-counter' });
    expect(baseline.particleTypes['core-customer'].completed).toBe(300);
    expect(baseline.particleTypes['package-customer'].completed).toBe(10);
    expect(stress.particleTypes['core-customer'].lostRevenue).toBeGreaterThan(
      baseline.particleTypes['core-customer'].lostRevenue,
    );
    expect(stress.metrics.queue.maximum).toBeGreaterThan(baseline.metrics.queue.maximum);
    expect(intervention.particleTypes['core-customer'].lostRevenue).toBeLessThan(
      stress.particleTypes['core-customer'].lostRevenue,
    );
    expect(intervention.particleTypes['package-customer'].completed).toBeGreaterThan(
      stress.particleTypes['package-customer'].completed,
    );
    expect(intervention.metrics.resourceCost).toBeGreaterThan(stress.metrics.resourceCost);
    expect(compareSimulationResults(stress, intervention).delta.realizedRevenue).not.toBe(0);
  });
  it('AT-15 investment compares incremental cash and never invents future payback', () => {
    const model = createBasicModel({ particles: 10 });
    work(model).work.costPerParticle = 20000;
    model.improvements = [
      {
        id: 'automation',
        name: 'Automation',
        enabled: false,
        nodeId: 'work',
        investmentCost: 100000,
        costMultiplier: 0.1,
        processingTimeMultiplier: 0.65,
      },
    ];
    model.scenarios = [
      {
        id: 'investment',
        name: 'Invest',
        overrides: { improvements: { automation: { enabled: true } } },
      },
    ];
    const a = runSimulation(model, { untilComplete: true }),
      b = runSimulation(model, { scenarioId: 'investment', untilComplete: true });
    const comparison = compareSimulationResults(a, b);
    expect(comparison.incrementalCashImpact).toBe(80000);
    expect(comparison.paybackReached).toBe(true);
    expect(comparison.paybackTimeSeconds).toBeLessThanOrEqual(a.timeSeconds);
    model.improvements[0].investmentCost = 1000000;
    const c = runSimulation(model, { scenarioId: 'investment', untilComplete: true });
    expect(compareSimulationResults(a, c).paybackTimeSeconds).toBeNull();
  });
  it('AT-16 scenario overrides never mutate baseline or another scenario', () => {
    const model = createBasicModel();
    model.scenarios = [
      {
        id: 'a',
        name: 'A',
        overrides: {
          nodes: { work: { type: 'work', work: { ...work(model).work, capacity: 2 } } },
        },
      },
      {
        id: 'b',
        name: 'B',
        overrides: {
          nodes: { work: { type: 'work', work: { ...work(model).work, capacity: 3 } } },
        },
      },
    ];
    const a = resolveScenario(model, 'a'),
      b = resolveScenario(model, 'b');
    expect(work(model).work.capacity).toBe(1);
    expect(work(a).work.capacity).toBe(2);
    expect(work(b).work.capacity).toBe(3);
    work(a).work.capacity = 9;
    expect(work(b).work.capacity).toBe(3);
  });
  it('AT-24 bottleneck migrates after upstream capacity intervention', () => {
    const model = createBasicModel({ particles: 100, processingSeconds: 120 });
    model.nodes.push({
      id: 'b',
      name: 'B',
      type: 'work',
      work: { processingSeconds: 60, capacity: 1 },
    });
    model.edges[1].targetNodeId = 'b';
    model.edges.push({ id: 'b-done', sourceNodeId: 'b', targetNodeId: 'outcome' });
    const a = runSimulation(model, { untilComplete: true });
    expect(a.metrics.currentBottleneck).toBe('work');
    work(model).work.capacity = 10;
    const b = runSimulation(model, { untilComplete: true });
    expect(b.metrics.currentBottleneck).toBe('b');
  });
  it('AT-25 edge transit and queued particles follow actual simulation timestamps', () => {
    const model = createBasicModel({ particles: 2 });
    model.edges[0].travelSeconds = 10;
    const e = new SimulationEngine(model, { untilComplete: true });
    e.advance(5);
    expect(e.state().particles.filter((p) => p.status === 'transit')).toHaveLength(2);
    expect(e.state().nodes.work.started).toBe(0);
    e.advance(15);
    expect(e.state().nodes.work.busy).toBe(1);
    expect(e.state().nodes.work.queue.current).toBe(1);
    e.advance(69);
    expect(e.state().metrics.completed).toBe(0);
    e.advance(70);
    expect(e.state().metrics.completed).toBe(1);
  });
  it('AT-26 incremental animated and MAX execution have identical results', () => {
    const model = createBasicModel({ particles: 100 });
    model.particleTypes[0].complexity = { min: 0.7, max: 2 };
    source(model).source = {
      particleTypeId: 'work-item',
      ratePerHour: 120,
      maxCount: 100,
      distribution: 'poisson',
    };
    work(model).work.costPerHour = 97.31;
    const a = runSimulation(model, { durationSeconds: 3600, seed: 12345 });
    const engine = new SimulationEngine(model, { durationSeconds: 3600, seed: 12345 });
    for (let t = 1; t <= 3600; t += 1) while (!engine.advance(t, 10)) {}
    const b = engine.result();
    expect(b).toEqual(a);
  });
  it('AT-27 one million simulated items keep only bounded visual/event samples', () => {
    const model = createBasicModel({ particles: 0, capacity: 2, processingSeconds: 0.001 });
    source(model).source = { particleTypeId: 'work-item', ratePerHour: 3600000, maxCount: 1000000 };
    model.defaults.durationSeconds = 1001;
    model.retention = { particles: 20, events: 40 };
    const result = runSimulation(model);
    expect(result.metrics).toMatchObject({
      created: 1000000,
      completed: 1000000,
      inSystem: 0,
      realizedRevenue: 100000000,
    });
    expect(result.particles.length).toBeLessThanOrEqual(20);
    expect(result.events.length).toBeLessThanOrEqual(40);
    expect(result.retained.activeParticles).toBe(0);
    expect(result.retained.completedParticles).toBe(20);
    expect(result.retained.droppedEvents).toBeGreaterThan(1000000);
  }, 60000);
  it.each(['capacity', 'processing', 'resource', 'edge', 'particle', 'scaling', 'threshold'])(
    'AT-30 rejects invalid %s configuration',
    (kind) => {
      const model = createBasicModel();
      if (kind === 'capacity') work(model).work.capacity = -1;
      if (kind === 'processing') work(model).work.processingSeconds = -1;
      if (kind === 'resource')
        work(model).work.resourceRequirements = [{ resourceId: 'missing', units: 1 }];
      if (kind === 'edge') model.edges[0].targetNodeId = 'missing';
      if (kind === 'particle') source(model).source.particleTypeId = 'missing';
      if (kind === 'scaling') work(model).work.scaling = { minCapacity: 4, maxCapacity: 2 };
      if (kind === 'threshold') work(model).work.scaling = { maxCapacity: 3, utilizationAbove: 4 };
      expect(() => validateSimulationModel(model)).toThrow();
    },
  );
  it('priority queues arbitrate shared resources across different Work nodes', () => {
    const model = createBasicModel({ particles: 1 });
    model.particleTypes.push({
      ...model.particleTypes[0],
      id: 'urgent',
      name: 'Urgent',
      priority: 9,
    });
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    work(model).work.queueDiscipline = 'priority';
    model.nodes.push(
      {
        id: 'source-b',
        name: 'Source B',
        type: 'source',
        source: { particleTypeId: 'urgent', burst: 1 },
      },
      {
        id: 'work-b',
        name: 'Urgent work',
        type: 'work',
        work: {
          processingSeconds: 60,
          capacity: 1,
          queueDiscipline: 'priority',
          resourceRequirements: [{ resourceId: 'staff', units: 1 }],
        },
      },
    );
    model.edges.push(
      { id: 'b1', sourceNodeId: 'source-b', targetNodeId: 'work-b' },
      { id: 'b2', sourceNodeId: 'work-b', targetNodeId: 'outcome' },
    );
    const result = runSimulation(model, { untilComplete: true });
    expect(result.events.find((e) => e.type === 'PROCESS_STARTED')?.nodeId).toBe('work-b');
    expect(result.metrics.completed).toBe(2);
  });
  it('schedule closure charges active overtime once and stops idle cost', () => {
    const model = createBasicModel({ particles: 1 });
    work(model).work.costPerHour = 3600;
    work(model).work.schedule = [{ startSeconds: 0, endSeconds: 30 }];
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.resources = [
      {
        id: 'staff',
        name: 'Staff',
        capacity: 1,
        unit: 'employee',
        costPerHour: 3600,
        schedule: [{ startSeconds: 0, endSeconds: 30 }],
      },
    ];
    const result = runSimulation(model, { durationSeconds: 120 });
    expect(result.metrics).toMatchObject({
      completed: 1,
      operatingCost: 60,
      resourceCost: 60,
      cost: 120,
    });
    expect(result.resources.staff.cost).toBe(60);
  });
  it('resource-targeted improvement accelerates every consuming Work without duplicating capacity', () => {
    const model = createBasicModel({ particles: 1 });
    work(model).work.resourceRequirements = [{ resourceId: 'machine', units: 1 }];
    model.resources = [
      { id: 'machine', name: 'Machine', capacity: 1, unit: 'machine', costPerHour: 120 },
    ];
    model.improvements = [
      {
        id: 'upgrade',
        name: 'Upgrade',
        resourceId: 'machine',
        enabled: true,
        investmentCost: 10,
        processingTimeMultiplier: 0.5,
      },
    ];
    const result = runSimulation(model, { untilComplete: true });
    expect(result.completedAtSeconds).toBe(30);
    expect(result.nodes.work.capacity).toBe(1);
    expect(result.metrics.resourceCost).toBe(1);
    expect(result.metrics.investmentCost).toBe(10);
  });
  it('overflow routing uses a real configured transit edge', () => {
    const model = createBasicModel({ particles: 1 });
    work(model).work.capacity = 0;
    work(model).work.queueLimit = 0;
    work(model).work.overflowNodeId = 'overflow';
    model.nodes.push({
      id: 'overflow',
      name: 'Overflow',
      type: 'outcome',
      outcome: { status: 'failed', revenue: false },
    });
    model.edges.push({
      id: 'overflow-route',
      sourceNodeId: 'work',
      targetNodeId: 'overflow',
      travelSeconds: 10,
    });
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(5);
    expect(engine.state().particles[0]).toMatchObject({
      status: 'transit',
      edgeId: 'overflow-route',
      arrivesAtSeconds: 10,
    });
    engine.advance(86400);
    expect(engine.result().metrics.failed).toBe(1);
  });
  it('statistical medians are conventional and large quantiles retain bounded buckets', () => {
    const stats = new Distribution();
    stats.add(1);
    stats.add(3);
    expect(stats.metrics().median).toBe(2);
    for (let i = 0; i < 100000; i++) stats.add(i * 123.456);
    const metrics = stats.metrics();
    expect(metrics.approximate).toBe(true);
    expect(metrics.p99).toBeGreaterThan(metrics.median);
    expect(
      (stats as unknown as { histogram: Map<number, number> }).histogram.size,
    ).toBeLessThanOrEqual(4096);
  });
  it('unknown properties and misspelled assumptions fail validation', () => {
    const model = createBasicModel();
    (work(model).work as unknown as Record<string, unknown>).processTime = 3;
    expect(() => validateSimulationModel(model)).toThrow('unsupported field');
    const another = createBasicModel();
    another.scenarios = [{ id: 'a', name: 'A', overrides: {} }];
    (another.scenarios[0].overrides as unknown as Record<string, unknown>).typo = {};
    expect(() => validateSimulationModel(another)).toThrow('unsupported field');
  });
  it('scenario budgets isolate baseline and stop idle operating expenses at the limit', () => {
    const model = createBasicModel({ particles: 0 });
    work(model).work.costPerHour = 3600;
    model.scenarios = [
      { id: 'budget', name: 'Budget', overrides: { economics: { maximumBudget: 30 } } },
    ];
    const result = runSimulation(model, { scenarioId: 'budget', durationSeconds: 120 });
    expect(result.status).toBe('failed');
    expect(result.timeSeconds).toBe(30);
    expect(result.metrics.cost).toBe(30);
    expect(model.economics).toBeUndefined();
    expect(runSimulation(model, { durationSeconds: 120 }).metrics.cost).toBe(120);
  });
  it('resource display nodes and outcome nodes expose the actual semantic state', () => {
    const model = createBasicModel({ particles: 2 });
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
    model.nodes.push({
      id: 'staff-view',
      name: 'Staff display',
      type: 'resource',
      resourceId: 'staff',
    });
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(1);
    expect(engine.state().nodes['staff-view']).toMatchObject({
      capacity: 1,
      busy: 1,
      queue: { current: 1 },
      resourceUsage: { staff: 1 },
    });
    expect(engine.state().nodes.source.started).toBe(2);
    engine.advance(86400);
    expect(engine.state().nodes.outcome).toMatchObject({ completed: 2, realizedRevenue: 200 });
  });
  it.each([
    [1, 0, 1],
    [2, 0, 2],
    [1, 1, 2],
    [2, 1, 3],
  ])('same-time burst honors capacity %i and queue limit %i', (capacity, limit, completed) => {
    const model = createBasicModel({ particles: 100, capacity });
    work(model).work.queueLimit = limit;
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.completed).toBe(completed);
    expect(result.metrics.abandoned).toBe(100 - completed);
    expect(result.nodes.work.queue.maximum).toBe(limit);
    expect(result.nodes.work.abandoned).toBe(100 - completed);
  });
  it('zero-queue admissions obey shared resource capacity across Work nodes', () => {
    const model = createBasicModel({ particles: 1 });
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
    work(model).work.queueLimit = 0;
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.nodes.push(
      {
        id: 'source-b',
        name: 'Source B',
        type: 'source',
        source: { particleTypeId: 'work-item', burst: 1 },
      },
      {
        id: 'b',
        name: 'B',
        type: 'work',
        work: {
          processingSeconds: 60,
          capacity: 1,
          queueLimit: 0,
          resourceRequirements: [{ resourceId: 'staff', units: 1 }],
        },
      },
    );
    model.edges.push(
      { id: 'b-arrival', sourceNodeId: 'source-b', targetNodeId: 'b' },
      { id: 'b-done', sourceNodeId: 'b', targetNodeId: 'outcome' },
    );
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics).toMatchObject({
      created: 2,
      completed: 1,
      abandoned: 1,
      queue: { maximum: 0 },
    });
  });
  it('queue-only scaling does not react to immediately available burst capacity', () => {
    const model = createBasicModel({ particles: 100, capacity: 100 });
    work(model).work.scaling = {
      minCapacity: 100,
      maxCapacity: 120,
      queueAbove: 20,
      scaleUpCost: 50,
    };
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.queue.maximum).toBe(0);
    expect(result.nodes.work.capacity).toBe(100);
    expect(result.events.some((e) => e.type === 'CAPACITY_SCALE_UP')).toBe(false);
    expect(result.metrics.scalingCost).toBe(0);
  });
  it('untilComplete animated pacing and MAX stop at the same finite completion clock', () => {
    const model = createBasicModel();
    work(model).work.costPerHour = 320;
    const direct = runSimulation(model, { durationSeconds: 3600, untilComplete: true });
    const animated = new SimulationEngine(model, { durationSeconds: 3600, untilComplete: true });
    for (let t = 1; t <= 3600 && animated.getStatus() !== 'completed'; t++) animated.advance(t);
    expect(animated.result()).toEqual(direct);
    expect(direct.timeSeconds).toBe(600);
    const empty = createBasicModel({ particles: 0 });
    expect(runSimulation(empty, { untilComplete: true }).timeSeconds).toBe(0);
  });
  it('fractional complexity and configured multipliers multiply duration positively', () => {
    const model = createBasicModel({ particles: 1, processingSeconds: 60 });
    model.particleTypes[0].complexity = { min: 0.5, max: 0.5 };
    work(model).work.complexityMultiplier = 2;
    expect(runSimulation(model, { untilComplete: true }).completedAtSeconds).toBe(60);
    work(model).work.complexityMultiplier = 0;
    expect(() => validateSimulationModel(model)).toThrow();
  });
  it('literal resource IDs are preserved as own serialized properties', () => {
    const model = createBasicModel({ particles: 1 });
    model.resources = [{ id: '__proto__', name: 'Literal staff', capacity: 1, unit: 'employee' }];
    work(model).work.resourceRequirements = [{ resourceId: '__proto__', units: 1 }];
    const result = runSimulation(model, { untilComplete: true });
    expect(Object.hasOwn(result.resources, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(result)).resources.__proto__.capacity).toBe(1);
  });
  it('kiosk demand and paid availability repeat for multi-day runs', () => {
    const result = runSimulation(createKioskModel(), { durationSeconds: 172800 });
    expect(result.particleTypes['core-customer'].created).toBe(600);
    expect(result.particleTypes['package-customer'].created).toBe(20);
    expect(result.metrics.resourceCost).toBeCloseTo(4320, 8);
  });
  it.each(['scaling', 'economics', 'retention', 'condition'])(
    'optional %s objects cannot silently be null',
    (field) => {
      const model = createBasicModel();
      if (field === 'scaling') work(model).work.scaling = null as never;
      else if (field === 'economics') model.economics = null as never;
      else if (field === 'retention') model.retention = null as never;
      else {
        model.nodes.push({
          id: 'router',
          name: 'Router',
          type: 'router',
          router: { mode: 'first-match', rules: [{ edgeId: 'route', condition: null as never }] },
        });
        model.edges.push({ id: 'route', sourceNodeId: 'router', targetNodeId: 'outcome' });
      }
      expect(() => validateSimulationModel(model)).toThrow();
    },
  );
  it('payback cannot precede the discrete revenue event that finances it', () => {
    const model = createBasicModel({ particles: 1 });
    model.improvements = [
      {
        id: 'premium',
        name: 'Premium',
        enabled: false,
        nodeId: 'outcome',
        investmentCost: 50,
        revenueMultiplier: 2,
      },
    ];
    model.scenarios = [
      { id: 'invest', name: 'Invest', overrides: { improvements: { premium: { enabled: true } } } },
    ];
    const baseline = runSimulation(model, { untilComplete: true }),
      scenario = runSimulation(model, { scenarioId: 'invest', untilComplete: true });
    expect(compareSimulationResults(baseline, scenario).paybackTimeSeconds).toBe(60);
  });
  it('initial payback at t=0 is reported when observed immediate savings cover the investment', () => {
    const model = createBasicModel({ particles: 2 });
    work(model).work.capacity = 2;
    work(model).work.costPerParticle = 100;
    model.improvements = [
      {
        id: 'automation',
        name: 'Automation',
        enabled: false,
        nodeId: 'work',
        investmentCost: 80,
        costMultiplier: 0.5,
      },
    ];
    model.scenarios = [
      {
        id: 'invest',
        name: 'Invest',
        overrides: { improvements: { automation: { enabled: true } } },
      },
    ];
    const baseline = runSimulation(model, { untilComplete: true });
    const scenario = runSimulation(model, { scenarioId: 'invest', untilComplete: true });
    expect(compareSimulationResults(baseline, scenario)).toMatchObject({
      incrementalCashImpact: 20,
      paybackReached: true,
      paybackTimeSeconds: 0,
    });
  });
  it('resource hard minimum is the scaling floor when omitted from scaling and rejects conflicting bounds', () => {
    const model = createBasicModel({ particles: 1 });
    model.resources = [
      {
        id: 'staff',
        name: 'Staff',
        unit: 'employee',
        capacity: 2,
        minCapacity: 1,
        maxCapacity: 2,
        costPerHour: 3600,
        scaling: { maxCapacity: 2, utilizationBelow: 0.3, scaleDownAfterSeconds: 60 },
      },
    ];
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    const result = runSimulation(model, { durationSeconds: 300 });
    expect(result.resources.staff.capacity).toBe(1);
    expect(result.resources.staff.cost).toBe(420);
    expect(result.events.filter((event) => event.type === 'CAPACITY_SCALE_DOWN')).toMatchObject([
      { resourceId: 'staff', previousCapacity: 2, capacity: 1, timeSeconds: 120 },
    ]);
    model.resources[0].scaling!.minCapacity = 0;
    expect(() => validateSimulationModel(model)).toThrow(/minimum/);
    model.resources[0].scaling!.minCapacity = 1;
    model.resources[0].scaling!.maxCapacity = 3;
    expect(() => validateSimulationModel(model)).toThrow(/maximum/);
  });
  it('processing allocation never invents a surcharge when no capacity has scaled', () => {
    const model = createBasicModel({ particles: 1 });
    work(model).work.scaling = { maxCapacity: 3, additionalCostPerHour: 320 };
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.cost).toBe(0);
    expect(result.particles[0].accumulatedCost).toBe(0);
    expect(result.particleTypes['work-item'].cost).toBe(0);
  });
  it.each(['work', 'resource'])(
    'processing allocation integrates actual extra %s costs through mid-process scaling',
    (target) => {
      const model = createBasicModel({ particles: 2 });
      const scaling = {
        maxCapacity: 2,
        queueAbove: 0,
        startupSeconds: 30,
        additionalCostPerHour: 3600,
      };
      if (target === 'work') work(model).work.scaling = scaling;
      else {
        work(model).work.capacity = 2;
        model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee', scaling }];
        work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
      }
      const result = runSimulation(model, { untilComplete: true });
      expect(result.timeSeconds).toBe(90);
      expect(result.metrics.cost).toBe(60);
      expect(
        result.particles.map((particle) => particle.accumulatedCost).sort((a, b) => a - b),
      ).toEqual([15, 30]);
      expect(result.particleTypes['work-item'].cost).toBe(45);
      expect(result.metrics.cost - result.particleTypes['work-item'].cost).toBe(15); // idle capacity overhead
    },
  );
  it.each(['work', 'resource', 'outcome'])(
    'applies %s revenue improvements to carried value and economic aggregates',
    (target) => {
      const model = createBasicModel({ particles: 1 });
      model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
      work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
      model.improvements = [
        {
          id: 'premium',
          name: 'Premium',
          enabled: true,
          investmentCost: 0,
          ...(target === 'resource' ? { resourceId: 'staff' } : { nodeId: target }),
          revenueMultiplier: 2,
        },
      ];
      const result = runSimulation(model, { untilComplete: true });
      expect(result.metrics).toMatchObject({
        expectedRevenue: 200,
        realizedRevenue: 200,
        contribution: 200,
      });
      expect(result.particleTypes['work-item']).toMatchObject({
        expectedRevenue: 200,
        realizedRevenue: 200,
      });
      expect(result.particles[0]).toMatchObject({ expectedRevenue: 200, realizedRevenue: 200 });
    },
  );
  it('retains improved carried revenue when downstream work is abandoned', () => {
    const model = createBasicModel({ particles: 1 });
    model.particleTypes[0].patienceSeconds = 5;
    model.improvements = [
      {
        id: 'premium',
        name: 'Premium',
        enabled: true,
        investmentCost: 0,
        nodeId: 'work',
        revenueMultiplier: 2,
      },
    ];
    model.nodes.push({
      id: 'blocked',
      name: 'Blocked',
      type: 'work',
      work: { capacity: 0, processingSeconds: 1 },
    });
    model.edges.find((edge) => edge.sourceNodeId === 'work')!.targetNodeId = 'blocked';
    model.edges.push({ id: 'blocked-outcome', sourceNodeId: 'blocked', targetNodeId: 'outcome' });
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics).toMatchObject({
      expectedRevenue: 200,
      abandoned: 1,
      lostRevenue: 200,
      realizedRevenue: 0,
    });
    expect(result.particleTypes['work-item']).toMatchObject({
      expectedRevenue: 200,
      lostRevenue: 200,
    });
  });
  it('resource efficiency changes only its own allocation rather than all resources', () => {
    const model = createBasicModel({ particles: 2 });
    work(model).work.capacity = 2;
    work(model).work.resourceRequirements = [
      { resourceId: 'staff', units: 1 },
      { resourceId: 'counter', units: 1 },
    ];
    model.resources = [
      { id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' },
      { id: 'counter', name: 'Counter', capacity: 1, unit: 'counter' },
    ];
    model.improvements = [
      {
        id: 'efficient-staff',
        name: 'Efficient staff',
        enabled: true,
        investmentCost: 0,
        resourceId: 'staff',
        resourceUnitsMultiplier: 0.5,
      },
    ];
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(1);
    expect(engine.state().resources.staff.busy).toBe(0.5);
    expect(engine.state().resources.counter.busy).toBe(1);
    expect(engine.state().nodes.work.busy).toBe(1);
    engine.advance(1000);
    expect(engine.result().completedAtSeconds).toBe(120);
  });
  it('AT-30 rejects enabled capacity improvements above hard configured maxima', () => {
    const model = createBasicModel();
    work(model).work.scaling = { minCapacity: 1, maxCapacity: 2 };
    model.improvements = [
      {
        id: 'extra',
        name: 'Extra',
        enabled: true,
        investmentCost: 0,
        nodeId: 'work',
        capacityIncrease: 2,
      },
    ];
    expect(() => validateSimulationModel(model)).toThrow(/maximum capacity/);
    delete work(model).work.scaling;
    model.resources = [
      { id: 'staff', name: 'Staff', capacity: 1, maxCapacity: 2, unit: 'employee' },
    ];
    delete model.improvements[0].nodeId;
    model.improvements[0].resourceId = 'staff';
    expect(() => validateSimulationModel(model)).toThrow(/maximum capacity/);
    model.improvements[0].enabled = false;
    expect(() => validateSimulationModel(model)).not.toThrow();
  });
  it('AT-30 rejects unsupported improvement targets and effects rather than silently ignoring them', () => {
    const model = createBasicModel();
    model.improvements = [
      {
        id: 'invalid',
        name: 'Invalid',
        enabled: true,
        investmentCost: 0,
        nodeId: 'source',
        processingTimeMultiplier: 0.5,
      },
    ];
    expect(() => validateSimulationModel(model)).toThrow(/Work or Outcome/);
    model.improvements[0].nodeId = 'outcome';
    expect(() => validateSimulationModel(model)).toThrow(/Outcome improvements/);
    model.improvements[0].processingTimeMultiplier = 1;
    model.improvements[0].revenueMultiplier = 2;
    expect(() => validateSimulationModel(model)).not.toThrow();
  });
  it('AT-30 requires real outgoing edges for configured overflow and failure routes', () => {
    const model = createBasicModel();
    work(model).work.overflowNodeId = 'source';
    expect(() => validateSimulationModel(model)).toThrow(/outgoing model edge/);
    delete work(model).work.overflowNodeId;
    model.improvements = [
      {
        id: 'failure',
        name: 'Failure',
        enabled: true,
        investmentCost: 0,
        nodeId: 'work',
        failureProbability: 0.1,
        failureNodeId: 'source',
      },
    ];
    expect(() => validateSimulationModel(model)).toThrow(/every affected Work/);
    model.edges.push({ id: 'failure-source', sourceNodeId: 'work', targetNodeId: 'source' });
    expect(() => validateSimulationModel(model)).not.toThrow();
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' }];
    work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.nodes.push({
      id: 'second',
      name: 'Second',
      type: 'work',
      work: {
        capacity: 1,
        processingSeconds: 1,
        resourceRequirements: [{ resourceId: 'staff', units: 1 }],
      },
    });
    delete model.improvements[0].nodeId;
    model.improvements[0].resourceId = 'staff';
    expect(() => validateSimulationModel(model)).toThrow(/every affected Work/);
    model.edges.push({
      id: 'second-failure-source',
      sourceNodeId: 'second',
      targetNodeId: 'source',
    });
    expect(() => validateSimulationModel(model)).not.toThrow();
  });
  it.each(['work', 'resource'])(
    'Finish workload drains across repeating %s availability after the arrival horizon and replays truthfully',
    (target) => {
      const model = createBasicModel({ particles: 2 });
      const availability = [{ startSeconds: 0, endSeconds: 30, repeatSeconds: 60 }];
      if (target === 'work') {
        work(model).work.schedule = availability;
        work(model).work.costPerHour = 3600;
      } else {
        model.resources = [
          {
            id: 'staff',
            name: 'Staff',
            capacity: 1,
            unit: 'employee',
            costPerHour: 3600,
            schedule: availability,
          },
        ];
        work(model).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
      }
      const options = { seed: 42, durationSeconds: 10, untilComplete: true };
      const result = runSimulation(model, options);
      expect(result.status).toBe('completed');
      expect(result.timeSeconds).toBe(120);
      expect(result.metrics).toMatchObject({
        completed: 2,
        abandoned: 0,
        queue: { current: 0 },
        cost: 120,
      });
      const replay = new SimulationEngine(model, options);
      replay.advance(45, Infinity, true);
      expect(replay.state()).toMatchObject({
        timeSeconds: 45,
        status: 'running',
        metrics: { completed: 0, inSystem: 2, queue: { current: 1 } },
      });
      replay.advance(75, Infinity, true);
      expect(replay.state()).toMatchObject({
        timeSeconds: 75,
        status: 'running',
        metrics: { completed: 1, inSystem: 1, queue: { current: 0 } },
      });
      expect(
        replay.state().particles.find((particle) => particle.status === 'processing'),
      ).toMatchObject({
        processingStartedAtSeconds: 60,
        processingEndsAtSeconds: 120,
      });
      replay.advance(120, Infinity, true);
      expect(replay.result()).toEqual(result);
    },
  );
  it('routing first-match honors configured rule order instead of topology edge order', () => {
    const model = createBasicModel({ particles: 1 });
    model.nodes.push(
      {
        id: 'router',
        name: 'Router',
        type: 'router',
        router: {
          mode: 'first-match',
          rules: [
            { edgeId: 'specific', condition: { field: 'complexity', operator: 'gte', value: 1 } },
            { edgeId: 'general' },
          ],
        },
      },
      {
        id: 'specific-outcome',
        name: 'Specific',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    );
    model.edges.find((edge) => edge.sourceNodeId === 'work')!.targetNodeId = 'router';
    model.edges.push(
      { id: 'general', sourceNodeId: 'router', targetNodeId: 'outcome' },
      { id: 'specific', sourceNodeId: 'router', targetNodeId: 'specific-outcome' },
    );
    const result = runSimulation(model, { untilComplete: true });
    expect(result.nodes['specific-outcome'].completed).toBe(1);
    expect(result.nodes.outcome.completed).toBe(0);
    expect(
      result.events
        .filter((event) => event.type === 'PARTICLE_ROUTED' && event.nodeId === 'router')
        .map((event) => event.edgeId),
    ).toEqual(['specific']);
  });
  it.each([1, 2])(
    'routing all-zero weighted %i branches fails semantically or uses an eligible explicit fallback',
    (branches) => {
      const model = createBasicModel({ particles: 1 });
      model.nodes.push(
        {
          id: 'router',
          name: 'Router',
          type: 'router',
          router: {
            mode: 'weighted',
            rules: [
              { edgeId: 'zero-a', weight: 0 },
              ...(branches === 2 ? [{ edgeId: 'zero-b', weight: 0 }] : []),
            ],
          },
        },
        {
          id: 'fallback-outcome',
          name: 'Fallback',
          type: 'outcome',
          outcome: { status: 'completed', revenue: true },
        },
      );
      model.edges.find((edge) => edge.sourceNodeId === 'work')!.targetNodeId = 'router';
      model.edges.push({ id: 'zero-a', sourceNodeId: 'router', targetNodeId: 'outcome' });
      if (branches === 2)
        model.edges.push({ id: 'zero-b', sourceNodeId: 'router', targetNodeId: 'outcome' });
      const failed = runSimulation(model, { untilComplete: true });
      expect(failed.metrics).toMatchObject({
        created: 1,
        completed: 0,
        failed: 1,
        lostRevenue: 100,
      });
      expect(failed.events.find((event) => event.type === 'PARTICLE_FAILED')?.reason).toMatch(
        /positive-weight/,
      );
      const router = model.nodes.find((node) => node.id === 'router') as Extract<
        SimulationNode,
        { type: 'router' }
      >;
      router.router.fallbackEdgeId = 'fallback';
      model.edges.push({
        id: 'fallback',
        sourceNodeId: 'router',
        targetNodeId: 'fallback-outcome',
      });
      const success = runSimulation(model, { untilComplete: true });
      expect(success.metrics).toMatchObject({ completed: 1, failed: 0, realizedRevenue: 100 });
      expect(success.nodes['fallback-outcome'].completed).toBe(1);
      expect(success.nodes.outcome.completed).toBe(0);
      model.particleTypes.push({ ...model.particleTypes[0], id: 'other-type' });
      model.edges.find((edge) => edge.id === 'fallback')!.particleTypeIds = ['other-type'];
      expect(runSimulation(model, { untilComplete: true }).metrics.failed).toBe(1);
    },
  );
});
