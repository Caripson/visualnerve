import { describe, expect, it } from 'vitest';
import {
  SimulationEngine,
  runSimulation,
  simulationExecutionLimits,
} from '../src/simulation/engine';
import { assertArchivedResult, assertArchivedState } from '../src/simulation/archive-validation';
import { simulationNodeTraffic } from '../src/simulation/traffic';
import type { SimulationModel, SimulationNode, SimulationState } from '../src/simulation/types';
import {
  longSharedParallelModel,
  nestedParallelModel,
  parallelModel,
} from './helpers/parallel-model';

const work = (model: SimulationModel, id = 'work-0') =>
  model.nodes.find((node) => node.id === id) as Extract<SimulationNode, { type: 'work' }>;
function invariant(state: SimulationState) {
  expect(state.metrics.created).toBe(
    state.metrics.completed +
      state.metrics.abandoned +
      state.metrics.failed +
      state.metrics.inSystem,
  );
  expect(new Set(state.particles.map((particle) => particle.id)).size).toBe(state.particles.length);
  expect(state.metrics.queue.current).toBeGreaterThanOrEqual(0);
  for (const node of Object.values(state.nodes)) {
    expect(node.busy).toBeGreaterThanOrEqual(0);
    expect(node.queue.current).toBeGreaterThanOrEqual(0);
  }
  for (const resource of Object.values(state.resources))
    expect(resource.busy).toBeGreaterThanOrEqual(0);
}

describe('deterministic mandatory fork/join execution', () => {
  it('completes a valid 4,007-node nested shared path without materializing 256,000 route IDs', () => {
    const model = longSharedParallelModel();
    expect(model.nodes).toHaveLength(4007);
    expect(model.edges).toHaveLength(4070);
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      completed: 1,
      failed: 0,
      inSystem: 0,
      realizedRevenue: 100,
      cost: 7,
    });
    expect(result.nodes['outer-work'].realizedRevenue).toBe(100);
    expect(result.parallel).toMatchObject({
      createdBranches: 66,
      joinedBranches: 66,
      activeGroups: 0,
    });
    const labels = Object.keys(result.routeMetrics);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('edges=256070');
    expect(labels[0].length).toBeLessThan(300);
    expect(result.routeMetrics[labels[0]].count).toBe(1);
  });
  it('cancels safely after a large nested route has joined and preserves partial costs and single lost revenue', () => {
    const model = longSharedParallelModel(true);
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(0);
    expect(engine.state().nodes['inner-join'].join?.completedGroups).toBe(1);
    engine.advance(60);
    const result = engine.result();
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      completed: 0,
      failed: 1,
      inSystem: 0,
      realizedRevenue: 0,
      lostRevenue: 100,
      cost: 7,
    });
    expect(result.nodes['outer-work'].busy).toBe(0);
    expect(result.parallel).toMatchObject({
      activeGroups: 0,
      activeBranches: 0,
      joinedBranches: 64,
      cancelledBranches: 2,
    });
  });
  it('attributes revenue once to a Work node shared by all 64 long-path branches while retaining every processing cost', () => {
    const model = longSharedParallelModel();
    model.nodes = model.nodes.map((node) =>
      node.id === 'router-0'
        ? {
            id: node.id,
            name: 'Shared branch work',
            type: 'work',
            work: { processingSeconds: 0.001, capacity: 64, costPerParticle: 1 },
          }
        : node,
    );
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      completed: 1,
      realizedRevenue: 100,
      cost: 71,
    });
    expect(result.nodes['router-0']).toMatchObject({ completed: 64, realizedRevenue: 100 });
    expect(result.nodes['outer-work'].realizedRevenue).toBe(100);
  });
  it('runs branches in parallel and realizes the original business revenue exactly once after the slowest branch', () => {
    const model = parallelModel();
    const engine = new SimulationEngine(model, { untilComplete: true, seed: 42 });
    engine.advance(6);
    const waiting = engine.state();
    invariant(waiting);
    expect(waiting.metrics).toMatchObject({
      created: 1,
      completed: 0,
      inSystem: 1,
      realizedRevenue: 0,
      expectedRevenue: 100,
    });
    expect(waiting.parallel).toMatchObject({
      activeGroups: 1,
      activeBranches: 2,
      waitingParents: 1,
    });
    expect(waiting.nodes.join.join).toMatchObject({
      waitingGroups: 1,
      arrivedBranches: 1,
      expectedBranches: 2,
    });
    expect(waiting.nodes.join.queue.current).toBe(1);
    expect(waiting.particles.find((particle) => particle.id === 1)?.status).toBe('waiting');
    expect(
      waiting.particles.filter((particle) => particle.parentParticleId !== undefined),
    ).toHaveLength(2);
    expect(waiting.events.filter((event) => event.type === 'PARTICLE_CREATED')).toHaveLength(1);
    expect(
      simulationNodeTraffic(model.nodes.find((node) => node.id === 'join')!, waiting, model),
    ).toMatchObject({ level: 'busy', label: 'Waiting for branches' });
    assertArchivedState(JSON.parse(JSON.stringify(waiting)));
    engine.advance(60);
    const result = engine.result();
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      completed: 1,
      abandoned: 0,
      failed: 0,
      inSystem: 0,
      realizedRevenue: 100,
      expectedRevenue: 100,
      lostRevenue: 0,
    });
    expect(result.timeSeconds).toBe(10);
    expect(result.metrics.ttr.average).toBe(10);
    expect(result.nodes.join.join).toMatchObject({
      waitingGroups: 0,
      arrivedBranches: 0,
      expectedBranches: 0,
      completedGroups: 1,
      wait: { maximum: 5 },
    });
    expect(result.parallel).toMatchObject({
      activeGroups: 0,
      activeBranches: 0,
      createdBranches: 2,
      joinedBranches: 2,
      cancelledBranches: 0,
    });
    expect(result.events.filter((event) => event.type === 'REVENUE_REALIZED')).toHaveLength(1);
    expect(result.particles.find((particle) => particle.id === 1)).toMatchObject({
      status: 'completed',
      processingSeconds: 15,
      waitingSeconds: 5,
      realizedRevenue: 100,
      timeToRevenueSeconds: 10,
    });
    assertArchivedResult(JSON.parse(JSON.stringify(result)));
  });
  it('preserves each case group at a join, even when another case has a faster branch', () => {
    const model = parallelModel({ particles: 2 });
    work(model).work.capacity = 1;
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(6);
    expect(engine.state().parallel?.groups).toHaveLength(2);
    expect(engine.state().nodes.join.join?.completedGroups).toBe(0);
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({ created: 2, completed: 2, realizedRevenue: 200 });
    expect(result.events.filter((event) => event.type === 'JOIN_COMPLETED')).toHaveLength(2);
    for (const event of result.events.filter((event) => event.type === 'JOIN_COMPLETED'))
      expect(event.branchCount).toBe(2);
  });
  it('shares constrained resources across parallel branches and responds to capacity without creating extra cases', () => {
    const single = runSimulation(parallelModel({ resourceCapacity: 1 }), { untilComplete: true });
    const double = runSimulation(parallelModel({ resourceCapacity: 2 }), { untilComplete: true });
    expect(single.metrics.ttr.average).toBe(15);
    expect(double.metrics.ttr.average).toBe(10);
    expect(single.metrics.completed).toBe(double.metrics.completed);
    expect(single.metrics.realizedRevenue).toBe(double.metrics.realizedRevenue);
    expect(single.resources.staff.busy).toBe(0);
    expect(single.resources.staff.queue.maximum).toBeGreaterThan(0);
    expect(single.metrics.resourceCost).toBe(15);
    expect(double.metrics.resourceCost).toBe(20);
  });
  it('accounts for both branch effort and travel while TTR measures elapsed business time', () => {
    const model = parallelModel({ travelSeconds: 3 });
    work(model).work.costPerParticle = 40;
    work(model, 'work-1').work.costPerParticle = 60;
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.ttr.average).toBe(16);
    expect(result.metrics.operatingCost).toBe(100);
    expect(result.metrics.contribution).toBe(0);
    expect(result.particles.find((particle) => particle.id === 1)?.accumulatedCost).toBe(100);
  });
  it('does not double-count branch revenue improvements', () => {
    const model = parallelModel();
    model.improvements = [
      {
        id: 'improve-a',
        name: 'A',
        enabled: true,
        nodeId: 'work-0',
        investmentCost: 0,
        revenueMultiplier: 2,
      },
      {
        id: 'improve-b',
        name: 'B',
        enabled: true,
        nodeId: 'work-1',
        investmentCost: 0,
        revenueMultiplier: 1.5,
      },
    ];
    const result = runSimulation(model, { untilComplete: true });
    expect(result.metrics.expectedRevenue).toBe(300);
    expect(result.metrics.realizedRevenue).toBe(300);
    expect(result.particleTypes['work-item'].expectedRevenue).toBe(300);
  });
  it('carries completed branch revenue changes into later case loss without waiting for a successful join', () => {
    const model = parallelModel({ durations: [1, 10], patienceSeconds: 2 });
    work(model, 'work-1').work.capacity = 0;
    model.improvements = [
      {
        id: 'value',
        name: 'Added value',
        enabled: true,
        nodeId: 'work-0',
        investmentCost: 0,
        revenueMultiplier: 2,
      },
    ];
    model.processes = [{ id: 'delivery', name: 'Delivery' }];
    model.nodes = model.nodes.map((node) => ({ ...node, processId: 'delivery' }));
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(1.5);
    expect(engine.state().metrics).toMatchObject({ expectedRevenue: 200, lostRevenue: 0 });
    engine.advance(60);
    const result = engine.result();
    expect(result.metrics).toMatchObject({
      abandoned: 1,
      expectedRevenue: 200,
      lostRevenue: 200,
      realizedRevenue: 0,
    });
    expect(result.processes?.delivery).toMatchObject({
      entered: 1,
      expectedRevenue: 200,
      lostRevenue: 200,
      abandoned: 1,
    });
  });
  it('composes nested branch improvements once and preserves their updated value if the outer case fails', () => {
    const model = nestedParallelModel(2);
    model.processes = [{ id: 'delivery', name: 'Delivery' }];
    model.nodes = model.nodes.map((node) => ({ ...node, processId: 'delivery' }));
    model.improvements = [
      {
        id: 'outer-value',
        name: 'Outer value',
        enabled: true,
        nodeId: 'work-0',
        investmentCost: 0,
        revenueMultiplier: 2,
      },
      {
        id: 'inner-value',
        name: 'Inner value',
        enabled: true,
        nodeId: 'last-work',
        investmentCost: 0,
        revenueMultiplier: 3,
      },
    ];
    const completed = runSimulation(model, { untilComplete: true });
    invariant(completed);
    expect(completed.metrics).toMatchObject({
      expectedRevenue: 600,
      realizedRevenue: 600,
      lostRevenue: 0,
      completed: 1,
    });
    expect(completed.processes?.delivery).toMatchObject({
      entered: 1,
      expectedRevenue: 600,
      realizedRevenue: 600,
    });
    const failed = structuredClone(model);
    failed.improvements.push({
      id: 'inner-failure',
      name: 'Inner failure',
      enabled: true,
      nodeId: 'work-1',
      investmentCost: 0,
      failureProbability: 1,
    });
    work(failed, 'work-1').work.processingSeconds = 3;
    const result = runSimulation(failed, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      failed: 1,
      expectedRevenue: 600,
      realizedRevenue: 0,
      lostRevenue: 600,
    });
    expect(result.processes?.delivery).toMatchObject({
      entered: 1,
      failed: 1,
      expectedRevenue: 600,
      lostRevenue: 600,
    });
    expect(result.parallel).toMatchObject({ activeGroups: 0, activeBranches: 0 });
  });
  it('fails before creating a partial branch group when the live-token boundary is reached', () => {
    const originalLimit = simulationExecutionLimits.activeParticles;
    try {
      simulationExecutionLimits.activeParticles = 3;
      const result = runSimulation(parallelModel({ durations: [1, 1, 1] }), {
        untilComplete: true,
      });
      invariant(result);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('active-particle limit');
      expect(result.metrics).toMatchObject({ created: 1, completed: 0, failed: 0, inSystem: 1 });
      expect(result.parallel).toMatchObject({ activeGroups: 0, createdBranches: 0 });
      expect(result.retained.activeParticles).toBe(1);
      expect(result.events.some((event) => event.type === 'PARTICLE_FORKED')).toBe(false);
    } finally {
      simulationExecutionLimits.activeParticles = originalLimit;
    }
  });
  it('cancels siblings on abandonment, frees actual occupied resources and preserves incurred partial costs', () => {
    const model = parallelModel({ durations: [100, 10], resourceCapacity: 1, patienceSeconds: 1 });
    work(model).work.costPerParticle = 7;
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      completed: 0,
      abandoned: 1,
      failed: 0,
      inSystem: 0,
      lostRevenue: 100,
      realizedRevenue: 0,
    });
    expect(result.parallel).toMatchObject({
      activeGroups: 0,
      activeBranches: 0,
      cancelledBranches: 2,
    });
    expect(result.resources.staff.busy).toBe(0);
    expect(result.nodes['work-0'].busy).toBe(0);
    expect(result.nodes['work-1'].queue.current).toBe(0);
    expect(result.metrics.cost).toBeCloseTo(8.001, 9);
    expect(result.particles.find((particle) => particle.id === 1)?.accumulatedCost).toBeCloseTo(
      8.001,
      9,
    );
    expect(result.events.filter((event) => event.type === 'PARTICLE_ABANDONED')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'PROCESS_CANCELLED')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'BRANCH_CANCELLED')).toHaveLength(2);
    assertArchivedResult(JSON.parse(JSON.stringify(result)));
  });
  it('cancels waiting joined tokens and never releases completed processing twice after a feature failure', () => {
    const model = parallelModel({ durations: [1, 5], resourceCapacity: 2 });
    model.improvements = [
      {
        id: 'failure',
        name: 'Fails',
        enabled: true,
        nodeId: 'work-1',
        investmentCost: 0,
        failureProbability: 1,
      },
    ];
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      failed: 1,
      lostRevenue: 100,
      realizedRevenue: 0,
      queue: { current: 0 },
    });
    expect(result.nodes['work-1'].busy).toBe(0);
    expect(result.resources.staff.busy).toBe(0);
    expect(result.nodes.join.join?.cancelledGroups).toBe(1);
    expect(result.nodes.join.queue.current).toBe(0);
    expect(result.metrics.resourceCost).toBe(10);
  });
  it('waits for every same-timestamp branch and leaves no residual queue/group state', () => {
    const result = runSimulation(parallelModel({ durations: [1, 1, 1] }), { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      completed: 1,
      queue: { current: 0 },
      realizedRevenue: 100,
    });
    expect(result.nodes.join.join).toMatchObject({
      waitingGroups: 0,
      arrivedBranches: 0,
      expectedBranches: 0,
      completedGroups: 1,
      wait: { maximum: 0 },
    });
    expect(result.events.filter((event) => event.type === 'BRANCH_JOINED')).toHaveLength(3);
    expect(result.events.filter((event) => event.type === 'JOIN_COMPLETED')).toHaveLength(1);
  });
  it.each([1, 2, 8, 16])(
    'supports %i correctly nested levels without inflating economics or process population',
    (depth) => {
      const model = nestedParallelModel(depth);
      model.processes = [{ id: 'delivery', name: 'Delivery' }];
      model.nodes = model.nodes.map((node) => ({ ...node, processId: 'delivery' }));
      const result = runSimulation(model, { untilComplete: true });
      invariant(result);
      expect(result.metrics).toMatchObject({
        created: 1,
        completed: 1,
        realizedRevenue: 100,
        cost: depth + 1,
      });
      expect(result.timeSeconds).toBe(Math.max(2, depth));
      expect(result.parallel).toMatchObject({
        activeGroups: 0,
        createdBranches: depth * 2,
        joinedBranches: depth * 2,
      });
      expect(result.processes?.delivery).toMatchObject({
        entered: 1,
        completed: 1,
        terminalCompleted: 1,
        inSystem: 0,
        expectedRevenue: 100,
        realizedRevenue: 100,
      });
    },
  );
  it('cancels all sixteen nested groups exactly once and preserves costs of every started sibling', () => {
    const model = nestedParallelModel(16, true);
    model.processes = [{ id: 'delivery', name: 'Delivery' }];
    model.nodes = model.nodes.map((node) => ({ ...node, processId: 'delivery' }));
    const result = runSimulation(model, { untilComplete: true });
    invariant(result);
    expect(result.metrics).toMatchObject({
      created: 1,
      abandoned: 1,
      completed: 0,
      inSystem: 0,
      cost: 16,
      lostRevenue: 100,
      queue: { current: 0 },
    });
    expect(result.parallel).toMatchObject({
      activeGroups: 0,
      activeBranches: 0,
      cancelledBranches: 32,
      joinedBranches: 0,
    });
    expect(result.events.filter((event) => event.type === 'PARTICLE_ABANDONED')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'BRANCH_CANCELLED')).toHaveLength(32);
    expect(result.processes?.delivery).toMatchObject({
      entered: 1,
      abandoned: 1,
      failed: 0,
      inSystem: 0,
      expectedRevenue: 100,
      lostRevenue: 100,
    });
  });
  it('deduplicates a scope shared by sibling branches but counts independent child process visits', () => {
    const model = parallelModel();
    model.processes = [
      { id: 'all', name: 'Whole process' },
      { id: 'branch-a', name: 'Branch A', parentId: 'all' },
      { id: 'branch-b', name: 'Branch B', parentId: 'all' },
    ];
    model.nodes = model.nodes.map((node) => ({
      ...node,
      processId: node.id === 'work-0' ? 'branch-a' : node.id === 'work-1' ? 'branch-b' : 'all',
    }));
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(2);
    const live = engine.state();
    expect(live.processes?.all.inSystem).toBe(1);
    expect(live.processes?.['branch-a'].inSystem).toBe(1);
    expect(live.processes?.['branch-b'].inSystem).toBe(1);
    engine.advance(60);
    const result = engine.result();
    expect(result.processes?.all).toMatchObject({
      entered: 1,
      completed: 1,
      terminalCompleted: 1,
      realizedRevenue: 100,
    });
    expect(result.processes?.['branch-a']).toMatchObject({
      entered: 1,
      completed: 1,
      exited: 1,
      inSystem: 0,
    });
    expect(result.processes?.['branch-b']).toMatchObject({
      entered: 1,
      completed: 1,
      exited: 1,
      inSystem: 0,
    });
  });
  it('hands child tokens back to a parent in the same join scope without creating a second case visit', () => {
    const model = parallelModel();
    model.processes = [{ id: 'joined-scope', name: 'Joined scope' }];
    model.nodes = model.nodes.map((node) =>
      node.id === 'fork' || node.id === 'source' ? node : { ...node, processId: 'joined-scope' },
    );
    const result = runSimulation(model, { untilComplete: true });
    expect(result.processes?.['joined-scope']).toMatchObject({
      entered: 1,
      completed: 1,
      exited: 0,
      terminalCompleted: 1,
      inSystem: 0,
      expectedRevenue: 100,
      realizedRevenue: 100,
    });
  });
  it('produces identical seeded event ordering and metrics across animated slices, MAX and exact replay', () => {
    const model = parallelModel({ particles: 30, durations: [1, 2, 3], resourceCapacity: 2 });
    model.particleTypes[0].complexity = { min: 0.7, max: 2 };
    const options = { untilComplete: true, seed: 12345, durationSeconds: 1000, runId: 'parity' };
    const expected = runSimulation(model, options);
    const sliced = new SimulationEngine(model, options);
    for (let horizon = 0; horizon <= 1000 && sliced.getStatus() !== 'completed'; horizon += 0.25)
      while (!sliced.advance(horizon, 3)) invariant(sliced.state());
    expect(sliced.result()).toEqual(expected);
    const replay = new SimulationEngine(model, options);
    while (!replay.advance(20.123, 5, true)) {}
    const again = new SimulationEngine(model, options);
    again.advance(20.123, Infinity, true);
    expect(replay.state()).toEqual(again.state());
  });
  it('bounds sampled tokens/groups while computing the complete large population', () => {
    const model = parallelModel({ particles: 500, durations: [1, 2, 3] });
    model.retention = { particles: 5, events: 10 };
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(0.5);
    const state = engine.state();
    expect(state.metrics.inSystem).toBe(500);
    expect(state.retained.activeParticles).toBe(2000);
    expect(state.particles).toHaveLength(5);
    expect(state.particles.every((particle) => particle.parentParticleId !== undefined)).toBe(true);
    expect(state.particles.every((particle) => particle.status === 'processing')).toBe(true);
    expect(state.parallel?.groups).toHaveLength(5);
    expect(state.parallel?.droppedGroups).toBe(495);
    engine.advance(60);
    expect(engine.result().metrics).toMatchObject({
      created: 500,
      completed: 500,
      realizedRevenue: 50000,
    });
  });
  it('includes arrived join work and excludes nested suspended parents in a tiny deterministic sample', () => {
    const model = nestedParallelModel(8);
    model.retention = { particles: 3, events: 10 };
    const engine = new SimulationEngine(model, { untilComplete: true });
    engine.advance(1.5);
    const state = engine.state();
    invariant(state);
    expect(state.metrics.inSystem).toBe(1);
    expect(state.particles).toHaveLength(3);
    expect(
      state.particles.some(
        (particle) => particle.status === 'waiting' && particle.nodeId === particle.joinNodeId,
      ),
    ).toBe(true);
    expect(
      state.particles.every(
        (particle) => particle.status !== 'waiting' || particle.nodeId === particle.joinNodeId,
      ),
    ).toBe(true);
    const repeated = new SimulationEngine(model, { untilComplete: true });
    repeated.advance(1.5);
    expect(repeated.state().particles).toEqual(state.particles);
  });
});
