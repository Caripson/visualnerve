import { describe, expect, it } from 'vitest';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import { simulationNodeTraffic } from '../src/simulation/traffic';
import { ObservedSimulationClock } from '../src/simulation/render-clock';

describe('traffic pressure from the authoritative simulation state', () => {
  it('distinguishes a full but flowing workstation from an actual saturated queue', () => {
    const model = createBasicModel({ particles: 1 });
    const node = model.nodes.find((node) => node.type === 'work')!;
    expect(simulationNodeTraffic(node)).toMatchObject({ level: 'inactive', label: 'Ready' });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    expect(simulationNodeTraffic(node, engine.state())).toMatchObject({
      level: 'busy',
      label: 'At capacity',
      queue: 0,
      utilization: 1,
    });
    engine.advance(61);
    expect(simulationNodeTraffic(node, engine.state())).toMatchObject({
      level: 'clear',
      label: 'Clear',
      queue: 0,
      utilization: 0,
    });
    const overloaded = createBasicModel({ particles: 100 });
    const busy = new SimulationEngine(overloaded);
    busy.advance(1);
    expect(simulationNodeTraffic(overloaded.nodes[1], busy.state())).toMatchObject({
      level: 'congested',
      label: 'Congested',
      queue: 99,
      utilization: 1,
    });
  });

  it('uses real shared-resource waiters, including work with spare local capacity', () => {
    const model = createBasicModel({ particles: 2, capacity: 2 });
    const node = model.nodes.find((node) => node.type === 'work')!;
    if (node.type !== 'work') throw Error('Work fixture');
    node.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.resources.push({ id: 'staff', name: 'Store staff', capacity: 1, unit: 'employee' });
    model.nodes.push({ id: 'staff-node', name: 'Staff', type: 'resource', resourceId: 'staff' });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    expect(state.nodes.work).toMatchObject({ capacity: 2, busy: 1, status: 'blocked' });
    expect(simulationNodeTraffic(node, state)).toMatchObject({
      level: 'congested',
      label: 'Resource blocked',
      waitingResources: ['Store staff'],
      queue: 1,
    });
    expect(simulationNodeTraffic(node, state).reason).toContain('Waiting for Store staff');
    expect(simulationNodeTraffic(model.nodes.at(-1)!, state)).toMatchObject({
      level: 'congested',
      queue: 1,
    });
    model.resources[0].capacity = 2;
    const relieved = new SimulationEngine(model);
    relieved.advance(1);
    expect(simulationNodeTraffic(node, relieved.state())).toMatchObject({
      level: 'busy',
      queue: 0,
      waitingResources: [],
    });
  });

  it('does not mistake historical utilization or unrelated resource pressure for a live bottleneck', () => {
    const model = createBasicModel({ particles: 1 });
    const engine = new SimulationEngine(model);
    engine.advance(61);
    const state = engine.state();
    expect(state.nodes.work.utilization).toBeGreaterThan(0.9);
    expect(simulationNodeTraffic(model.nodes[1], state).level).toBe('clear');
    const work = model.nodes[1];
    if (work.type !== 'work') throw Error('Work fixture');
    work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    state.resources.staff = {
      id: 'staff',
      name: 'Staff',
      capacity: 1,
      maximumCapacity: 1,
      busy: 1,
      utilization: 1,
      currentUtilization: 1,
      cost: 0,
      scalingCost: 0,
      queue: { ...state.nodes.work.queue, current: 5 },
      waitingNodeIds: ['another-work'],
    };
    expect(simulationNodeTraffic(work, state)).toMatchObject({
      level: 'clear',
      queue: 0,
      waitingResources: [],
    });
  });

  it('retains explicit failure/scaling labels and reports zero-capacity queued work as congested', () => {
    const model = createBasicModel({ particles: 1, capacity: 0 });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    expect(simulationNodeTraffic(model.nodes[1], state).level).toBe('congested');
    state.nodes.work.status = 'scaling';
    expect(simulationNodeTraffic(model.nodes[1], state).label).toBe('Scaling · congested');
    state.nodes.work.status = 'failed';
    expect(simulationNodeTraffic(model.nodes[1], state).label).toBe('Failed');
  });

  it('does not blame an available pool merely because a locally saturated dependent Work has a queue', () => {
    const model = createBasicModel({ particles: 5, capacity: 1 });
    const work = model.nodes[1];
    if (work.type !== 'work') throw Error('Work fixture');
    work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.resources.push({ id: 'staff', name: 'Staff', capacity: 10, unit: 'employee' });
    model.nodes.push({ id: 'pool', name: 'Staff', type: 'resource', resourceId: 'staff' });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    expect(state.resources.staff.waitingNodeIds).toContain('work');
    expect(state.resources.staff.busy).toBe(1);
    expect(simulationNodeTraffic(work, state, model)).toMatchObject({
      level: 'congested',
      label: 'Congested',
      waitingResources: [],
    });
    expect(simulationNodeTraffic(model.nodes.at(-1)!, state, model)).toMatchObject({
      level: 'busy',
      label: 'Queued demand',
      utilization: 0.1,
    });
  });

  it('names only the truly constrained pool when multiple registered resources have queued demand', () => {
    const model = createBasicModel({ particles: 3, capacity: 3 });
    const work = model.nodes[1];
    if (work.type !== 'work') throw Error('Work fixture');
    work.work.resourceRequirements = [
      { resourceId: 'staff', units: 1 },
      { resourceId: 'counter', units: 1 },
    ];
    model.resources.push(
      { id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' },
      { id: 'counter', name: 'Counter', capacity: 10, unit: 'counter' },
    );
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    expect(state.resources.counter.waitingNodeIds).toContain('work');
    expect(simulationNodeTraffic(work, state, model).waitingResources).toEqual(['Staff']);
  });

  it('honors enabled efficiency features when partial pool capacity cannot serve another Work item', () => {
    const model = createBasicModel({ particles: 3, capacity: 3 });
    const work = model.nodes[1];
    if (work.type !== 'work') throw Error('Work fixture');
    work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
    model.resources.push({ id: 'staff', name: 'Staff', capacity: 1, unit: 'employee' });
    model.nodes.push({ id: 'pool', name: 'Staff', type: 'resource', resourceId: 'staff' });
    model.improvements.push({
      id: 'assist',
      name: 'Assist',
      enabled: true,
      nodeId: 'work',
      investmentCost: 0,
      resourceUnitsMultiplier: 0.4,
    });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    expect(state.resources.staff.busy).toBeCloseTo(0.8);
    expect(simulationNodeTraffic(work, state, model).waitingResources).toEqual(['Staff']);
    expect(simulationNodeTraffic(model.nodes.at(-1)!, state, model).level).toBe('congested');
  });
});

describe('bounded interpolation of observed simulation time', () => {
  it('smooths known intervals without predicting the next snapshot', () => {
    const clock = new ObservedSimulationClock();
    clock.observe('run', 3, 0, true);
    expect(clock.time(0)).toBe(3);
    clock.observe('run', 4, 50, true);
    expect(clock.time(50)).toBe(3);
    expect(clock.time(75)).toBe(3.5);
    expect(clock.time(100)).toBe(4);
    expect(clock.time(5000)).toBe(4);
    expect(clock.needsFrame(75)).toBe(true);
    expect(clock.needsFrame(100)).toBe(false);
  });

  it('never reverses within a run when snapshots arrive before a previous interval finishes', () => {
    const clock = new ObservedSimulationClock();
    clock.observe('run', 0, 0, true);
    clock.observe('run', 1, 50, true);
    const observed = clock.time(60);
    clock.observe('run', 2, 60, true);
    expect(clock.time(60)).toBe(observed);
    expect(clock.time(68)).toBeGreaterThan(observed);
    expect(clock.time(76)).toBe(2);
  });

  it('pauses, replays, resets, completes and MAX renders at an exact fixed engine timestamp', () => {
    const clock = new ObservedSimulationClock();
    clock.observe('run', 10, 0, true);
    clock.observe('run', 11, 50, true);
    clock.observe('run', 11, 60, false);
    expect(clock.time(1000)).toBe(11);
    expect(clock.needsFrame(60)).toBe(false);
    clock.observe('run', 5, 70, true); // backwards replay seek
    expect(clock.time(80)).toBe(5);
    expect(clock.needsFrame(80)).toBe(false);
    clock.observe('other-run', 0, 100, true);
    expect(clock.time(200)).toBe(0);
    clock.observe('other-run', 100000, 250, false); // MAX/completed
    expect(clock.time(251)).toBe(100000);
    expect(clock.needsFrame(251)).toBe(false);
  });

  it('bounds the visual delay after a suspended tab', () => {
    const clock = new ObservedSimulationClock();
    clock.observe('run', 0, 0, true);
    clock.observe('run', 100, 60000, true);
    expect(clock.time(60050)).toBe(50);
    expect(clock.time(60100)).toBe(100);
    expect(clock.needsFrame(60100)).toBe(false);
  });
});
