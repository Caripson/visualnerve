import type { NodeMetrics, ParticleSnapshot, SimulationState } from './types';

export const MAX_PRESENTATION_UNITS = 8;
export const MAX_PRESENTATION_RUNS = 8;

export interface SimulationUnitOccupancy {
  /** Aggregate engine busy count, including work omitted from particle snapshots. */
  readonly busy: number;
  readonly displayedCapacity: number;
  /** Anonymous displayed card indexes, starting at one. */
  readonly displayedBusyUnits: readonly number[];
  /** Actual processing snapshots assigned to displayed cards. */
  readonly sampledProcessing: number;
  /** Actual busy work without an individually displayed processing assignment. */
  readonly omittedProcessing: number;
}

interface Lease {
  nodeId: string;
  startedAtSeconds: number;
  endsAtSeconds?: number;
  unit: number;
  phase: 'processing' | 'departure';
  edgeId?: string;
  departedAtSeconds?: number;
  arrivesAtSeconds?: number;
}
interface ProcessingGroup {
  metric: NodeMetrics;
  preserved: { particle: ParticleSnapshot; lease: Lease }[];
  candidates: ParticleSnapshot[];
}
const EMPTY_OCCUPANCY: SimulationUnitOccupancy = Object.freeze({
  busy: 0,
  displayedCapacity: 0,
  displayedBusyUnits: Object.freeze([]),
  sampledProcessing: 0,
  omittedProcessing: 0,
});
const earlier = (a: ParticleSnapshot, b: ParticleSnapshot) =>
  a.processingStartedAtSeconds! - b.processingStartedAtSeconds! || a.id - b.id;

/**
 * Anonymous visual placement only. Engine timestamps, processing and aggregate busy
 * counts remain authoritative. A filled aggregate slot never acquires a particle lease.
 */
export class SimulationPresentationSlots {
  private runId?: string;
  private state?: SimulationState;
  private leases = new Map<number, Lease>();
  private occupancies = new Map<string, SimulationUnitOccupancy>();
  private readonly limit: number;

  constructor(displayedUnits = MAX_PRESENTATION_UNITS) {
    this.limit = Number.isFinite(displayedUnits)
      ? Math.max(1, Math.min(MAX_PRESENTATION_UNITS, Math.floor(displayedUnits)))
      : MAX_PRESENTATION_UNITS;
  }

  get trackedParticleCount() {
    return this.leases.size;
  }

  /** Repeated reads of the same immutable snapshot do not change assignments. */
  reconcile(runId: string, state: SimulationState): this {
    if (this.runId === runId && this.state === state) return this;
    if (this.runId !== runId || (this.state && state.timeSeconds < this.state.timeSeconds))
      this.leases.clear();
    this.runId = runId;
    this.state = state;
    const particles = new Map(state.particles.map((particle) => [particle.id, particle]));
    const next = new Map<number, Lease>();
    const groups = new Map<string, ProcessingGroup>();

    for (const [id, lease] of this.leases) {
      const particle = particles.get(id);
      if (
        !particle ||
        particle.status !== 'transit' ||
        particle.nodeId !== lease.nodeId ||
        !particle.edgeId ||
        particle.departedAtSeconds === undefined ||
        particle.arrivesAtSeconds === undefined
      )
        continue;
      // A later visit to the same Work must not inherit an earlier observed departure.
      if (lease.phase === 'processing' && particle.departedAtSeconds !== lease.endsAtSeconds)
        continue;
      if (
        lease.phase === 'departure' &&
        (particle.edgeId !== lease.edgeId ||
          particle.departedAtSeconds !== lease.departedAtSeconds ||
          particle.arrivesAtSeconds !== lease.arrivesAtSeconds)
      )
        continue;
      next.set(id, {
        ...lease,
        phase: 'departure',
        edgeId: particle.edgeId,
        departedAtSeconds: particle.departedAtSeconds,
        arrivesAtSeconds: particle.arrivesAtSeconds,
      });
    }

    for (const particle of particles.values()) {
      const metric = state.nodes[particle.nodeId];
      if (
        particle.status !== 'processing' ||
        particle.pendingAdmission ||
        particle.processingStartedAtSeconds === undefined ||
        !Number.isFinite(particle.processingStartedAtSeconds) ||
        metric?.type !== 'work' ||
        metric.busy < 1 ||
        metric.capacity < 1
      )
        continue;
      let group = groups.get(particle.nodeId);
      if (!group) groups.set(particle.nodeId, (group = { metric, preserved: [], candidates: [] }));
      const lease = this.leases.get(particle.id);
      if (
        lease?.phase === 'processing' &&
        lease.nodeId === particle.nodeId &&
        lease.startedAtSeconds === particle.processingStartedAtSeconds &&
        lease.unit <= Math.min(this.limit, metric.capacity)
      )
        group.preserved.push({ particle, lease });
      else {
        // Keep at most eight candidates per node: bounded insertion rather than
        // sorting or retaining the complete processing population.
        let position = 0;
        while (
          position < group.candidates.length &&
          earlier(group.candidates[position], particle) <= 0
        )
          position++;
        if (position < this.limit) {
          group.candidates.splice(position, 0, particle);
          if (group.candidates.length > this.limit) group.candidates.pop();
        }
      }
    }

    const assigned = new Map<string, Set<number>>();
    for (const [nodeId, group] of groups) {
      const budget = Math.min(
        this.limit,
        Math.floor(group.metric.capacity),
        Math.floor(group.metric.busy),
      );
      const occupied = new Set<number>();
      group.preserved.sort((a, b) => a.lease.unit - b.lease.unit);
      for (const { particle, lease } of group.preserved) {
        if (occupied.size >= budget) break;
        occupied.add(lease.unit);
        next.set(particle.id, lease);
      }
      for (const particle of group.candidates) {
        if (occupied.size >= budget) break;
        let unit = 1;
        while (occupied.has(unit)) unit++;
        occupied.add(unit);
        next.set(particle.id, {
          nodeId,
          unit,
          phase: 'processing',
          startedAtSeconds: particle.processingStartedAtSeconds!,
          endsAtSeconds: particle.processingEndsAtSeconds,
        });
      }
      assigned.set(nodeId, occupied);
    }

    this.leases = next;
    this.occupancies.clear();
    for (const metric of Object.values(state.nodes)) {
      if (metric.type !== 'work' && metric.type !== 'resource') continue;
      const capacity = Math.max(0, Math.min(this.limit, Math.floor(metric.capacity)));
      const observed = assigned.get(metric.id) ?? new Set<number>();
      const occupied = new Set(observed);
      const target = Math.min(capacity, Math.ceil(Math.max(0, metric.busy)));
      for (let unit = 1; occupied.size < target && unit <= capacity; unit++) occupied.add(unit);
      this.occupancies.set(
        metric.id,
        Object.freeze({
          busy: metric.busy,
          displayedCapacity: capacity,
          displayedBusyUnits: Object.freeze([...occupied].sort((a, b) => a - b)),
          sampledProcessing: observed.size,
          omittedProcessing: Math.max(0, metric.busy - observed.size),
        }),
      );
    }
    return this;
  }

  selectProcessingUnit(logicalId: string, particle: ParticleSnapshot): number | undefined {
    const lease = this.leases.get(particle.id);
    return particle.status === 'processing' &&
      particle.nodeId === logicalId &&
      lease?.phase === 'processing' &&
      lease.nodeId === logicalId &&
      lease.startedAtSeconds === particle.processingStartedAtSeconds
      ? lease.unit
      : undefined;
  }

  departureUnit(particle: ParticleSnapshot, logicalId: string): number | undefined {
    const lease = this.leases.get(particle.id);
    return particle.status === 'transit' &&
      particle.nodeId === logicalId &&
      lease?.phase === 'departure' &&
      lease.nodeId === logicalId &&
      lease.edgeId === particle.edgeId &&
      lease.departedAtSeconds === particle.departedAtSeconds &&
      lease.arrivesAtSeconds === particle.arrivesAtSeconds
      ? lease.unit
      : undefined;
  }

  occupancy(logicalId: string): SimulationUnitOccupancy {
    return this.occupancies.get(logicalId) ?? EMPTY_OCCUPANCY;
  }
}

const runs = new Map<string, SimulationPresentationSlots>();
/** Shared by card summaries and particle rendering; no separate component assignments. */
export function getSimulationPresentationSlots(runId: string, state: SimulationState) {
  let tracker = runs.get(runId);
  if (!tracker) tracker = new SimulationPresentationSlots();
  runs.delete(runId);
  runs.set(runId, tracker);
  if (runs.size > MAX_PRESENTATION_RUNS) runs.delete(runs.keys().next().value!);
  return tracker.reconcile(runId, state);
}
