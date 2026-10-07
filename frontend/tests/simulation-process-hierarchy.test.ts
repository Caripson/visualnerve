import { describe, expect, it, vi } from 'vitest';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import { ProcessMetricsAccumulator } from '../src/simulation/process-metrics';
import { ProcessHierarchy } from '../src/simulation/process-hierarchy';
import { resolveScenario, validateSimulationModel } from '../src/simulation/schema';
import { removeSimulationEntity } from '../src/simulation/deletion';
import { remapSimulationModel } from '../src/simulation/copy';
import { assertArchivedState } from '../src/simulation/archive-validation';
import { copySimulationSelection, pasteSimulationSelection } from '../src/simulation/clipboard';
import { createSimulationGraph } from '../src/simulation/document';
import type { SimulationModel, SimulationNode } from '../src/simulation/types';

function work(model: SimulationModel, id = 'work') {
  return model.nodes.find((node) => node.id === id) as Extract<SimulationNode, { type: 'work' }>;
}
function sequential() {
  const model = createBasicModel({ particles: 2, processingSeconds: 5 });
  model.processes = [
    { id: 'delivery', name: 'Delivery' },
    { id: 'prepare', name: 'Preparation', parentId: 'delivery' },
    { id: 'inspect', name: 'Inspection', parentId: 'delivery' },
  ];
  work(model).processId = 'prepare';
  model.nodes.find((node) => node.type === 'outcome')!.processId = 'delivery';
  model.nodes.push({
    id: 'inspect-work',
    name: 'Inspect',
    processId: 'inspect',
    type: 'work',
    work: { processingSeconds: 10, capacity: 1 },
  });
  model.edges[1] = { ...model.edges[1], targetNodeId: 'inspect-work', travelSeconds: 2 };
  model.edges.push({
    id: 'deliver',
    sourceNodeId: 'inspect-work',
    targetNodeId: 'outcome',
    travelSeconds: 3,
  });
  return model;
}

describe('authoritative nested process simulation', () => {
  it('preserves schemaVersion 1 flat documents', () => {
    const model = createBasicModel();
    validateSimulationModel(model);
    expect(runSimulation(model, { untilComplete: true }).processes).toEqual({});
  });
  it('indexes recursive membership', () => {
    const hierarchy = new ProcessHierarchy(sequential());
    expect(hierarchy.ancestry('prepare')).toEqual(['prepare', 'delivery']);
    expect(hierarchy.forNode('work')).toEqual(['prepare', 'delivery']);
    expect(hierarchy.nodeIds('delivery')).toEqual(['work', 'outcome', 'inspect-work']);
    expect(hierarchy.children()).toEqual(['delivery']);
    expect(hierarchy.descendants('delivery')).toEqual(['prepare', 'inspect']);
  });
  it.each([
    [
      'duplicate IDs',
      (m: SimulationModel) => m.processes!.push({ id: 'delivery', name: 'Duplicate' }),
    ],
    [
      'invalid parent',
      (m: SimulationModel) => {
        m.processes![1].parentId = 'missing';
      },
    ],
    [
      'cycle',
      (m: SimulationModel) => {
        m.processes![0].parentId = 'prepare';
      },
    ],
    [
      'self cycle',
      (m: SimulationModel) => {
        m.processes![0].parentId = 'delivery';
      },
    ],
    [
      'invalid member',
      (m: SimulationModel) => {
        m.nodes[0].processId = 'missing';
      },
    ],
    [
      'blank name',
      (m: SimulationModel) => {
        m.processes![0].name = ' ';
      },
    ],
    [
      'unsupported property',
      (m: SimulationModel) => {
        Object.assign(m.processes![0], { capacity: 2 });
      },
    ],
  ])('rejects %s', (_label, change) => {
    const model = sequential();
    change(model);
    expect(() => validateSimulationModel(model)).toThrow('Simulation:');
  });
  it('measures actual scope cycles and concurrent queue maxima', () => {
    const result = runSimulation(sequential(), { untilComplete: true, seed: 42 }),
      p = result.processes!;
    expect(result.metrics).toMatchObject({ created: 2, completed: 2, realizedRevenue: 200 });
    expect(result.completedAtSeconds).toBe(30);
    expect(p.prepare).toMatchObject({
      entered: 2,
      completed: 2,
      exited: 2,
      terminalCompleted: 0,
      inSystem: 0,
      realizedRevenue: 0,
      cycleTime: { count: 2, average: 9.5 },
      queue: { maximum: 1 },
    });
    expect(p.inspect).toMatchObject({
      entered: 2,
      completed: 2,
      exited: 2,
      cycleTime: { count: 2, average: 15.5 },
    });
    expect(p.delivery).toMatchObject({
      entered: 2,
      completed: 2,
      exited: 0,
      terminalCompleted: 2,
      inSystem: 0,
      realizedRevenue: 200,
      cycleTime: { count: 2, average: 25 },
      ttr: { count: 2, average: 25 },
      queue: {
        current: 0,
        maximum: 1,
        average: 1 / 3,
        wait: { count: 4, average: 2.5, median: 2.5 },
      },
      processing: { count: 4, average: 7.5 },
    });
    expect(p.delivery.queue.maximum).toBeLessThan(
      p.prepare.queue.maximum + p.inspect.queue.maximum,
    );
    assertArchivedState(structuredClone(result));
  });
  it('keeps outbound transfers in the departing scope', () => {
    const engine = new SimulationEngine(sequential(), { untilComplete: true });
    engine.advance(6);
    expect(engine.state().processes!.prepare).toMatchObject({
      inSystem: 2,
      completed: 0,
      queue: { current: 0 },
    });
    expect(engine.state().particles.find((p) => p.id === 1)).toMatchObject({ status: 'transit' });
    engine.advance(8);
    expect(engine.state().processes!.prepare).toMatchObject({ inSystem: 1, completed: 1 });
    expect(engine.state().processes!.inspect.inSystem).toBe(1);
    expect(engine.state().processes!.delivery.inSystem).toBe(2);
  });
  it('is deterministic across advancement chunks', () => {
    const model = sequential(),
      direct = runSimulation(model, { untilComplete: true, seed: 12345 });
    const engine = new SimulationEngine(model, { untilComplete: true, seed: 12345 });
    for (let s = 0; s <= 35; s += 0.25) engine.advance(s);
    expect(engine.result()).toEqual(direct);
  });
  it('counts re-entry without changing global work conservation', () => {
    const m = createBasicModel({ particles: 1, processingSeconds: 1 });
    m.processes = [
      { id: 'root', name: 'Root' },
      { id: 'a', name: 'A', parentId: 'root' },
      { id: 'b', name: 'B', parentId: 'root' },
    ];
    work(m).processId = 'a';
    m.nodes.push(
      {
        id: 'b-work',
        name: 'B',
        type: 'work',
        processId: 'b',
        work: { processingSeconds: 1, capacity: 1 },
      },
      {
        id: 'a2',
        name: 'Return A',
        type: 'work',
        processId: 'a',
        work: { processingSeconds: 1, capacity: 1 },
      },
    );
    m.nodes.find((n) => n.type === 'outcome')!.processId = 'a';
    m.edges[1].targetNodeId = 'b-work';
    m.edges.push(
      { id: 'return', sourceNodeId: 'b-work', targetNodeId: 'a2' },
      { id: 'done', sourceNodeId: 'a2', targetNodeId: 'outcome' },
    );
    const r = runSimulation(m, { untilComplete: true });
    expect(r.metrics).toMatchObject({ created: 1, completed: 1, realizedRevenue: 100 });
    expect(r.processes!.a).toMatchObject({
      entered: 2,
      completed: 2,
      exited: 1,
      terminalCompleted: 1,
      realizedRevenue: 100,
      cycleTime: { count: 2, average: 1 },
    });
    expect(r.processes!.root).toMatchObject({
      entered: 1,
      completed: 1,
      terminalCompleted: 1,
      realizedRevenue: 100,
      cycleTime: { count: 1, average: 3 },
    });
  });
  it('allocates occupied shared units once and leaves idle costs global', () => {
    const m = createBasicModel({ particles: 1, processingSeconds: 5 });
    m.processes = [
      { id: 'root', name: 'Root' },
      { id: 'a', name: 'A', parentId: 'root' },
      { id: 'b', name: 'B', parentId: 'root' },
    ];
    m.resources = [{ id: 'staff', name: 'Staff', capacity: 1, unit: 'person', costPerHour: 360 }];
    work(m).processId = 'a';
    work(m).work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    m.nodes.find((n) => n.type === 'outcome')!.processId = 'root';
    m.nodes.push(
      {
        id: 'picture',
        name: 'Shared pool',
        type: 'resource',
        resourceId: 'staff',
        processId: 'root',
      },
      {
        id: 'source-b',
        name: 'B arrivals',
        type: 'source',
        source: { particleTypeId: 'work-item', burst: 1 },
      },
      {
        id: 'work-b',
        name: 'B',
        type: 'work',
        processId: 'b',
        work: {
          processingSeconds: 5,
          capacity: 1,
          resourceRequirements: [{ resourceId: 'staff', units: 1 }],
        },
      },
    );
    m.edges.push(
      { id: 'arrive-b', sourceNodeId: 'source-b', targetNodeId: 'work-b' },
      { id: 'done-b', sourceNodeId: 'work-b', targetNodeId: 'outcome' },
    );
    const engine = new SimulationEngine(m, { durationSeconds: 20 });
    engine.advance(2);
    expect(engine.state().processes!.a.resourceCost).toBeCloseTo(0.2);
    expect(engine.state().processes!.b.resourceCost).toBe(0);
    expect(engine.state().processes!.root.resourceUsage.staff).toBe(1);
    engine.advance(20);
    const r = engine.result();
    expect(r.resources.staff.cost).toBeCloseTo(2);
    expect(r.processes!.a.resourceCost).toBeCloseTo(0.5);
    expect(r.processes!.b.resourceCost).toBeCloseTo(0.5);
    expect(r.processes!.root.resourceCost).toBeCloseTo(1);
    expect(r.processes!.root.realizedRevenue).toBe(200);
    expect(r.processes!.a.realizedRevenue).toBe(0);
    expect(r.processes!.a.currentBottleneck).toBeNull();
    expect(r.processes!.b.bottlenecks.some((b) => b.id === 'staff')).toBe(true);
    expect(r.processes!.root.bottlenecks.some((b) => b.id === 'staff')).toBe(true);
  });
  it('records abandonment and lost revenue once per containing scope', () => {
    const m = createBasicModel({ particles: 2, processingSeconds: 10 });
    m.processes = [
      { id: 'main', name: 'Main' },
      { id: 'service', name: 'Service', parentId: 'main' },
    ];
    m.particleTypes[0].patienceSeconds = 2;
    work(m).processId = 'service';
    m.nodes.find((n) => n.type === 'outcome')!.processId = 'main';
    const r = runSimulation(m, { untilComplete: true });
    expect(r.processes!.service).toMatchObject({
      entered: 2,
      completed: 1,
      abandoned: 1,
      lostRevenue: 100,
      inSystem: 0,
    });
    expect(r.processes!.main).toMatchObject({
      completed: 1,
      abandoned: 1,
      lostRevenue: 100,
      realizedRevenue: 100,
      inSystem: 0,
    });
  });
  it('includes actual scaling and scoped feature costs', () => {
    const m = createBasicModel({ particles: 4, processingSeconds: 10 });
    m.processes = [
      { id: 'main', name: 'Main' },
      { id: 'child', name: 'Child', parentId: 'main' },
    ];
    work(m).processId = 'child';
    m.nodes.find((n) => n.type === 'outcome')!.processId = 'main';
    work(m).work.scaling = {
      minCapacity: 1,
      maxCapacity: 2,
      queueAbove: 1,
      scaleUpCost: 5,
      additionalCostPerHour: 3600,
    };
    work(m).work.costPerParticle = 2;
    m.improvements = [
      {
        id: 'feature',
        name: 'Investment',
        nodeId: 'work',
        enabled: true,
        investmentCost: 100,
        operatingCostPerHour: 360,
      },
    ];
    const r = runSimulation(m, { untilComplete: true });
    expect(r.processes!.main.scalingCost).toBe(5);
    expect(r.processes!.main.investmentCost).toBe(100);
    expect(r.processes!.main.operatingCost).toBeCloseTo(r.metrics.operatingCost);
    expect(r.processes!.main.realizedRevenue).toBe(400);
    expect(r.processes!.child.realizedRevenue).toBe(0);
  });
  it('indexes node investments and hourly overhead without allocating global pool costs', () => {
    const model = sequential();
    model.processes!.push({ id: 'nested', name: 'Nested', parentId: 'prepare' });
    work(model).processId = 'nested';
    model.resources = [{ id: 'pool', name: 'Shared pool', capacity: 1, unit: 'person' }];
    model.nodes.push({
      id: 'ungrouped',
      name: 'Ungrouped work',
      type: 'work',
      work: { capacity: 1, processingSeconds: 1 },
    });
    model.improvements = [
      {
        id: 'nested-feature',
        name: 'Nested feature',
        nodeId: 'work',
        enabled: true,
        investmentCost: 100,
        operatingCostPerHour: 360,
      },
      {
        id: 'investment-only',
        name: 'Investment without overhead',
        nodeId: 'work',
        enabled: true,
        investmentCost: 25,
      },
      {
        id: 'inspection-feature',
        name: 'Inspection feature',
        nodeId: 'inspect-work',
        enabled: true,
        investmentCost: 50,
        operatingCostPerHour: 180,
      },
      {
        id: 'outcome-feature',
        name: 'Outcome feature',
        nodeId: 'outcome',
        enabled: true,
        investmentCost: 10,
        operatingCostPerHour: 90,
      },
      {
        id: 'disabled',
        name: 'Disabled feature',
        nodeId: 'work',
        enabled: false,
        investmentCost: 10000,
        operatingCostPerHour: 3600,
      },
      {
        id: 'pool-feature',
        name: 'Global pool feature',
        resourceId: 'pool',
        enabled: true,
        investmentCost: 1000,
        operatingCostPerHour: 720,
      },
      {
        id: 'ungrouped-feature',
        name: 'Ungrouped feature',
        nodeId: 'ungrouped',
        enabled: true,
        investmentCost: 500,
        operatingCostPerHour: 3600,
      },
    ];
    model.scenarios = [
      {
        id: 'expanded',
        name: 'Expanded investment',
        overrides: {
          improvements: {
            'nested-feature': { investmentCost: 200, operatingCostPerHour: 720 },
          },
        },
      },
    ];
    const engine = new SimulationEngine(model, { durationSeconds: 3600 });
    engine.advance(1800);
    expect(engine.state().processes!.delivery.operatingCost).toBe(315);
    engine.advance(3600);
    const result = engine.result();
    expect(result.metrics).toMatchObject({ investmentCost: 1685, operatingCost: 4950 });
    expect(result.processes!.delivery).toMatchObject({
      investmentCost: 185,
      operatingCost: 630,
    });
    expect(result.processes!.prepare).toMatchObject({
      investmentCost: 125,
      operatingCost: 360,
    });
    expect(result.processes!.nested).toMatchObject({
      investmentCost: 125,
      operatingCost: 360,
    });
    expect(result.processes!.inspect).toMatchObject({ investmentCost: 50, operatingCost: 180 });
    const scenario = runSimulation(model, { scenarioId: 'expanded', durationSeconds: 3600 });
    expect(scenario.processes!.delivery).toMatchObject({
      investmentCost: 285,
      operatingCost: 990,
    });
    expect(result.processes!.delivery.investmentCost).toBe(185);

    // Semantic inspections establish that snapshots do not scan all features per scope.
    let enabledReads = 0;
    for (const feature of model.improvements) {
      const enabled = feature.enabled;
      Object.defineProperty(feature, 'enabled', {
        get: () => {
          enabledReads++;
          return enabled;
        },
      });
    }
    const accumulator = new ProcessMetricsAccumulator(model);
    expect(enabledReads).toBe(model.improvements.length);
    enabledReads = 0;
    for (const clock of [1800000, 3600000]) {
      const processes = accumulator.project({
        clock,
        nodes: result.nodes,
        work: new Map(),
        resources: new Map(),
        bottlenecks: [],
        unitCostRate: () => 0,
      });
      expect(processes.delivery.operatingCost).toBe((630 * clock) / 3600000);
      expect(processes.delivery.investmentCost).toBe(185);
    }
    expect(enabledReads).toBe(0);
  });
  it('isolates process and child overrides between scenarios', () => {
    const m = sequential();
    m.scenarios = [
      {
        id: 'fast',
        name: 'Fast',
        overrides: {
          processes: { prepare: { name: 'Fast preparation' } },
          nodes: { work: { work: { capacity: 2, processingSeconds: 2 } } },
        },
      },
    ];
    validateSimulationModel(m);
    expect(
      runSimulation(m, { scenarioId: 'fast', untilComplete: true }).processes!.prepare.name,
    ).toBe('Fast preparation');
    expect(work(m).work).toMatchObject({ capacity: 1, processingSeconds: 5 });
    expect(m.processes![1].name).toBe('Preparation');
    expect(resolveScenario(m, 'fast').processes![1].name).toBe('Fast preparation');
    m.scenarios[0].overrides.processes = { delivery: { parentId: 'prepare' } };
    expect(() => validateSimulationModel(m)).toThrow('cycle');
  });
  it('deletes only container and promotes work, cleaning scenario references', () => {
    const m = sequential();
    m.processes!.push({ id: 'nested', name: 'Nested', parentId: 'prepare' });
    m.scenarios = [
      {
        id: 'a',
        name: 'A',
        overrides: {
          processes: { nested: { parentId: 'prepare' }, prepare: { name: 'Changed' } },
          nodes: { work: { processId: 'prepare', work: { capacity: 2 } } },
        },
      },
    ];
    const deleted = removeSimulationEntity(m, 'processes', 'prepare');
    validateSimulationModel(deleted);
    expect(deleted.nodes).toHaveLength(m.nodes.length);
    expect(work(deleted).processId).toBe('delivery');
    expect(deleted.processes!.find((p) => p.id === 'nested')!.parentId).toBe('delivery');
    expect(deleted.scenarios[0].overrides.processes?.prepare).toBeUndefined();
    expect(work(resolveScenario(deleted, 'a')).work.capacity).toBe(2);
    expect(work(resolveScenario(deleted, 'a')).processId).toBe('delivery');
  });
  it('remaps process references and copies selected ancestry across documents', () => {
    const m = sequential();
    m.scenarios = [
      {
        id: 'a',
        name: 'A',
        overrides: {
          processes: { prepare: { parentId: 'delivery' } },
          nodes: { work: { processId: 'inspect' } },
        },
      },
    ];
    const copied = remapSimulationModel(
      m,
      new Map([['work', 'copied-work']]),
      new Map(),
      new Map([
        ['delivery', 'copied-root'],
        ['prepare', 'copied-child'],
        ['inspect', 'copied-inspect'],
      ]),
    );
    validateSimulationModel(copied);
    expect(work(copied, 'copied-work').processId).toBe('copied-child');
    expect(copied.processes![1].parentId).toBe('copied-root');
    expect(copied.scenarios[0].overrides.processes!['copied-child']!.parentId).toBe('copied-root');
    const source = createSimulationGraph('Source', sequential()),
      member = source.simulation!.nodes.find((n) => n.type === 'work')!;
    const clip = copySimulationSelection(source, new Set([member.id]))!;
    expect(clip.model.processes).toHaveLength(2);
    const target = createSimulationGraph('Target', createBasicModel());
    const pasted = pasteSimulationSelection(
      clip,
      target,
      new Map([[member.id, 'pasted-work']]),
      new Map(),
    )!;
    validateSimulationModel(pasted);
    const added = work(pasted, 'pasted-work');
    expect(added.processId).toBeTruthy();
    expect(added.processId).not.toBe(member.processId);
    expect(pasted.processes).toHaveLength(2);
    expect(pasted.processes!.some((p) => p.id === added.processId)).toBe(true);
  });
  it('finds a migrating bottleneck in its actual subprocess', () => {
    const model = sequential();
    const source = model.nodes.find((node) => node.type === 'source')!;
    if (source.type === 'source') {
      source.source.burst = 100;
      source.source.maxCount = 100;
    }
    work(model, 'inspect-work').work.processingSeconds = 1;
    const before = runSimulation(model, { untilComplete: true });
    expect(before.processes!.delivery.currentBottleneck).toBe('work');
    work(model).work.capacity = 10;
    const after = runSimulation(model, { untilComplete: true });
    expect(after.processes!.delivery.currentBottleneck).toBe('inspect-work');
    expect(after.processes!.inspect.currentBottleneck).toBe('inspect-work');
    expect(after.metrics.completed).toBe(100);
  });

  it('aggregates the complete population when no individual particles or events are retained', () => {
    const model = createBasicModel({ particles: 1000, processingSeconds: 0.001 });
    model.processes = [
      { id: 'root', name: 'Root' },
      { id: 'stage', name: 'Stage', parentId: 'root' },
    ];
    work(model).processId = 'stage';
    work(model).work.capacity = 4;
    model.nodes.find((node) => node.type === 'outcome')!.processId = 'root';
    model.retention = { particles: 0, events: 0, checkpoints: 0 };
    const result = runSimulation(model, { untilComplete: true });
    expect(result.particles).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.processes!.stage).toMatchObject({
      entered: 1000,
      completed: 1000,
      inSystem: 0,
      cycleTime: { count: 1000 },
      processing: { count: 1000 },
    });
    expect(result.processes!.root).toMatchObject({ completed: 1000, realizedRevenue: 100000 });
  });

  it('inspects global constraints once for a large scoped topology', () => {
    const count = 1000,
      model = createBasicModel({ particles: 2, processingSeconds: 60 });
    model.nodes = [
      {
        id: 'outcome',
        name: 'Complete',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    ];
    model.edges = [];
    model.processes = [];
    for (let index = 0; index < count; index++) {
      const id = `scope-${index}`,
        sourceId = `source-${index}`,
        nodeId = `work-${index}`;
      model.processes.push({ id, name: id });
      model.nodes.push(
        {
          id: sourceId,
          name: sourceId,
          type: 'source',
          source: { particleTypeId: 'work-item', burst: 2, maxCount: 2 },
        },
        {
          id: nodeId,
          name: nodeId,
          type: 'work',
          processId: id,
          work: { capacity: 1, processingSeconds: 60 },
        },
      );
      model.edges.push(
        { id: `arrival-${index}`, sourceNodeId: sourceId, targetNodeId: nodeId },
        { id: `complete-${index}`, sourceNodeId: nodeId, targetNodeId: 'outcome' },
      );
    }
    const engine = new SimulationEngine(model);
    engine.advance(1);
    let inspectedKinds = 0;
    const original = ProcessMetricsAccumulator.prototype.project;
    const spy = vi
      .spyOn(ProcessMetricsAccumulator.prototype, 'project')
      .mockImplementation(function (this: ProcessMetricsAccumulator, input) {
        const bottlenecks = input.bottlenecks.map(
          (bottleneck) =>
            new Proxy(bottleneck, {
              get(target, key, receiver) {
                if (key === 'kind') inspectedKinds++;
                return Reflect.get(target, key, receiver);
              },
            }),
        );
        return original.call(this, { ...input, bottlenecks });
      });
    try {
      const state = engine.state();
      expect(state.bottlenecks).toHaveLength(count);
      expect(Object.keys(state.processes!)).toHaveLength(count);
      for (let index = 0; index < count; index++) {
        expect(state.processes![`scope-${index}`].currentBottleneck).toBe(`work-${index}`);
        expect(state.processes![`scope-${index}`].queue.current).toBe(1);
      }
      // Count semantic inspections rather than elapsed time: avoid CPU-dependent performance tests.
      expect(inspectedKinds).toBeLessThanOrEqual(count * 4);
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts old archives but rejects corrupted semantic rollups', () => {
    const r = runSimulation(sequential(), { untilComplete: true }),
      old = structuredClone(r);
    delete old.processes;
    expect(() => assertArchivedState(old)).not.toThrow();
    r.processes!.delivery.queue.current = Number.NaN;
    expect(() => assertArchivedState(r)).toThrow('Invalid archived simulation state');
  });
});
