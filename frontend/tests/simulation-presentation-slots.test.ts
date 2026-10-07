import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import {
  getSimulationPresentationSlots,
  MAX_PRESENTATION_RUNS,
  SimulationPresentationSlots,
} from '../src/simulation/presentation-slots';
import type { ParticleSnapshot, SimulationNode, SimulationState } from '../src/simulation/types';

function fixture(particles = 4, capacity = 2, processingSeconds = 60) {
  const model = createBasicModel({ particles, capacity, processingSeconds });
  model.edges[1].travelSeconds = 10;
  return new SimulationEngine(model);
}
function particle(state: SimulationState, id: number) {
  return state.particles.find((value) => value.id === id)!;
}

describe('anonymous simulation capacity-card presentation', () => {
  it('assigns only actual processing snapshots and keeps units stable across pause and repeated reads', () => {
    const engine = fixture();
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    expect(tracker.selectProcessingUnit('work', particle(state, 1))).toBe(1);
    expect(tracker.selectProcessingUnit('work', particle(state, 2))).toBe(2);
    expect(tracker.selectProcessingUnit('work', particle(state, 3))).toBeUndefined();
    const occupancy = tracker.occupancy('work');
    expect(occupancy).toEqual({
      busy: 2,
      displayedCapacity: 2,
      displayedBusyUnits: [1, 2],
      sampledProcessing: 2,
      omittedProcessing: 0,
    });
    expect(tracker.reconcile('run', state).occupancy('work')).toBe(occupancy);
    tracker.reconcile('run', {
      ...state,
      status: 'paused',
      particles: [...state.particles].reverse(),
    });
    expect(tracker.selectProcessingUnit('work', particle(state, 2))).toBe(2);
    expect(tracker.occupancy('work')).toEqual(occupancy);
    expect(tracker.trackedParticleCount).toBe(2);
  });

  it('allocates new observations deterministically irrespective of snapshot order', () => {
    const engine = fixture();
    engine.advance(1);
    const state = engine.state();
    const a = new SimulationPresentationSlots().reconcile('run', state);
    const b = new SimulationPresentationSlots().reconcile('run', {
      ...state,
      particles: [...state.particles].reverse(),
    });
    for (const item of state.particles)
      expect(a.selectProcessingUnit('work', item)).toBe(b.selectProcessingUnit('work', item));
  });

  it('preserves an existing unit while newly observed work uses the lowest free displayed slot', () => {
    const engine = fixture(3, 3);
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    const continuing = particle(state, 2);
    const newlyStarted: ParticleSnapshot = {
      ...particle(state, 3),
      id: 4,
      processingStartedAtSeconds: 30,
      processingEndsAtSeconds: 90,
    };
    const next = {
      ...state,
      timeSeconds: 31,
      nodes: { ...state.nodes, work: { ...state.nodes.work, busy: 2 } },
      particles: [continuing, newlyStarted],
    };
    tracker.reconcile('run', next);
    expect(tracker.selectProcessingUnit('work', continuing)).toBe(2);
    expect(tracker.selectProcessingUnit('work', newlyStarted)).toBe(1);
    expect(tracker.occupancy('work').displayedBusyUnits).toEqual([1, 2]);
  });

  it('keeps observed departure anchors only through the actual outgoing transit', () => {
    const engine = fixture();
    engine.advance(1);
    const tracker = new SimulationPresentationSlots().reconcile('run', engine.state());
    engine.advance(61);
    const moving = engine.state();
    tracker.reconcile('run', moving);
    expect(tracker.departureUnit(particle(moving, 1), 'work')).toBe(1);
    expect(tracker.departureUnit(particle(moving, 2), 'work')).toBe(2);
    expect(tracker.selectProcessingUnit('work', particle(moving, 3))).toBe(1);
    expect(tracker.departureUnit(particle(moving, 1), 'source')).toBeUndefined();
    expect(tracker.trackedParticleCount).toBe(4);
    engine.advance(71);
    const arrived = engine.state();
    tracker.reconcile('run', arrived);
    expect(tracker.departureUnit(particle(arrived, 1), 'work')).toBeUndefined();
    expect(tracker.trackedParticleCount).toBe(2);
  });

  it('never invents incoming or missed processing assignments from aggregate busy slots', () => {
    const model = createBasicModel({ particles: 2, capacity: 2 });
    model.edges[0].travelSeconds = 10;
    model.edges[1].travelSeconds = 10;
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const incoming = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', incoming);
    expect(tracker.selectProcessingUnit('work', incoming.particles[0])).toBeUndefined();
    expect(tracker.departureUnit(incoming.particles[0], 'source')).toBeUndefined();
    engine.advance(11);
    const processing = engine.state();
    tracker.reconcile('run', { ...processing, particles: [particle(processing, 1)] });
    expect(tracker.occupancy('work')).toMatchObject({
      displayedBusyUnits: [1, 2],
      sampledProcessing: 1,
      omittedProcessing: 1,
    });
    expect(tracker.selectProcessingUnit('work', particle(processing, 2))).toBeUndefined();
    engine.advance(71);
    const outgoing = engine.state();
    tracker.reconcile('run', outgoing);
    expect(tracker.departureUnit(particle(outgoing, 1), 'work')).toBe(1);
    expect(tracker.departureUnit(particle(outgoing, 2), 'work')).toBeUndefined();
    const fresh = new SimulationPresentationSlots().reconcile('fresh-run', outgoing);
    expect(fresh.departureUnit(particle(outgoing, 1), 'work')).toBeUndefined();
  });

  it('does not reuse a previous processing visit for a later unobserved departure', () => {
    const engine = fixture(1, 1);
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    engine.advance(61);
    const nextVisit = engine.state();
    const laterDeparture: ParticleSnapshot = {
      ...particle(nextVisit, 1),
      departedAtSeconds: 120,
      arrivesAtSeconds: 130,
    };
    tracker.reconcile('run', { ...nextVisit, timeSeconds: 121, particles: [laterDeparture] });
    expect(tracker.departureUnit(laterDeparture, 'work')).toBeUndefined();
    expect(tracker.trackedParticleCount).toBe(0);
  });

  it('clears presentation history on rewind/reset and culls particles absent from current samples', () => {
    const engine = fixture();
    engine.advance(1);
    const early = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', early);
    engine.advance(61);
    const later = engine.state();
    tracker.reconcile('run', later);
    tracker.reconcile('run', { ...early, particles: [particle(early, 2)] });
    expect(tracker.selectProcessingUnit('work', particle(early, 2))).toBe(1);
    expect(tracker.trackedParticleCount).toBe(1);
    tracker.reconcile('new-run', later);
    expect(tracker.departureUnit(particle(later, 1), 'work')).toBeUndefined();
    expect(tracker.trackedParticleCount).toBe(2);
    tracker.reconcile('new-run', { ...later, particles: [] });
    expect(tracker.trackedParticleCount).toBe(0);
    expect(tracker.occupancy('work')).toMatchObject({
      displayedBusyUnits: [1, 2],
      sampledProcessing: 0,
      omittedProcessing: 2,
    });
  });

  it('bounds individually assigned work to eight slots and aggregates the complete busy population', () => {
    const engine = fixture(40, 20);
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    expect(tracker.trackedParticleCount).toBe(8);
    expect(tracker.occupancy('work')).toEqual({
      busy: 20,
      displayedCapacity: 8,
      displayedBusyUnits: [1, 2, 3, 4, 5, 6, 7, 8],
      sampledProcessing: 8,
      omittedProcessing: 12,
    });
    expect(tracker.selectProcessingUnit('work', particle(state, 9))).toBeUndefined();
  });

  it('reconciles scale-down without assigning processing to an unavailable displayed card', () => {
    const engine = fixture(3, 3);
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    const continuing = particle(state, 3);
    tracker.reconcile('run', {
      ...state,
      timeSeconds: 2,
      particles: [continuing],
      nodes: { ...state.nodes, work: { ...state.nodes.work, capacity: 1, busy: 1 } },
    });
    expect(tracker.selectProcessingUnit('work', continuing)).toBe(1);
    expect(tracker.occupancy('work')).toMatchObject({
      displayedCapacity: 1,
      displayedBusyUnits: [1],
      busy: 1,
    });
  });

  it('uses actual fractional shared-resource occupancy without assigning resource particle leases', () => {
    const model = createBasicModel({ particles: 3, capacity: 3 });
    model.resources = [{ id: 'staff', name: 'Staff', capacity: 2, unit: 'employee' }];
    (model.nodes[1] as Extract<SimulationNode, { type: 'work' }>).work.resourceRequirements = [
      { resourceId: 'staff', units: 0.5 },
    ];
    model.nodes.push({ id: 'staff-display', name: 'Staff', type: 'resource', resourceId: 'staff' });
    const engine = new SimulationEngine(model);
    engine.advance(1);
    const state = engine.state();
    const tracker = new SimulationPresentationSlots().reconcile('run', state);
    expect(tracker.occupancy('staff-display')).toEqual({
      busy: 1.5,
      displayedCapacity: 2,
      displayedBusyUnits: [1, 2],
      sampledProcessing: 0,
      omittedProcessing: 1.5,
    });
    expect(tracker.selectProcessingUnit('staff-display', state.particles[0])).toBeUndefined();
  });

  it('keeps bookkeeping bounded by the current snapshot population over many completions', () => {
    const model = createBasicModel({ particles: 1000, capacity: 4, processingSeconds: 1 });
    model.retention = { particles: 20, events: 20 };
    model.edges[1].travelSeconds = 1;
    const engine = new SimulationEngine(model);
    const tracker = new SimulationPresentationSlots();
    for (let time = 0; time <= 260; time++) {
      engine.advance(time);
      const state = engine.state();
      tracker.reconcile('long-run', state);
      expect(tracker.trackedParticleCount).toBeLessThanOrEqual(state.particles.length);
      expect(tracker.occupancy('work').sampledProcessing).toBeLessThanOrEqual(4);
    }
    expect(tracker.trackedParticleCount).toBe(0);
  });

  it('shares one tracker per immutable view and bounds run history with LRU eviction', () => {
    const engine = fixture();
    engine.advance(1);
    const state = engine.state();
    const tracker = getSimulationPresentationSlots('cache-run-0', state);
    const occupancy = tracker.occupancy('work');
    expect(getSimulationPresentationSlots('cache-run-0', state)).toBe(tracker);
    expect(tracker.occupancy('work')).toBe(occupancy);
    for (let index = 1; index <= MAX_PRESENTATION_RUNS; index++)
      getSimulationPresentationSlots(`cache-run-${index}`, state);
    expect(getSimulationPresentationSlots('cache-run-0', state)).not.toBe(tracker);
  });
});
