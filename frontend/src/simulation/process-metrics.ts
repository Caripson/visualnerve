import { finishEconomics, zeroEconomics } from './economics';
import { ProcessHierarchy } from './process-hierarchy';
import { Distribution } from './statistics';
import type { ResourceState, WorkState } from './engine-state';
import type {
  Bottleneck,
  NodeMetrics,
  ParticleSnapshot,
  ProcessMetrics,
  SimulationModel,
} from './types';

interface ScopeCounter {
  entered: number;
  completed: number;
  exited: number;
  terminalCompleted: number;
  abandoned: number;
  failed: number;
  inSystem: number;
  queue: number;
  maximumQueue: number;
  queueArea: number;
  lastQueueTime: number;
  expectedRevenue: number;
  realizedRevenue: number;
  lostRevenue: number;
  resourceCost: number;
  wait: Distribution;
  cycle: Distribution;
  ttr: Distribution;
  processing: Distribution;
}
interface Projection {
  clock: number;
  nodes: Record<string, NodeMetrics>;
  work: ReadonlyMap<string, WorkState>;
  resources: ReadonlyMap<string, ResourceState>;
  bottlenecks: Bottleneck[];
  unitCostRate: (resource: ResourceState) => number;
}
interface CaseVisit {
  tokens: Set<number>;
  entered: number;
  status?: 'completed' | 'abandoned' | 'failed';
  revenue: number;
  lost: number;
  expectedRevenue: number;
}

/** Incremental bounded statistics from engine transitions; rendering never supplies process metrics. */
export class ProcessMetricsAccumulator {
  readonly hierarchy: ProcessHierarchy;
  private readonly counters = new Map<string, ScopeCounter>();
  /** Only current visits are retained, so completed populations do not accumulate individual records. */
  private readonly visits = new Map<number, Map<string, number>>();
  /** Parallel tokens share one logical visit/population/revenue per business case in a scope. */
  private readonly cases = new Map<string, Map<number, CaseVisit>>();
  private readonly rootScopes = new Map<number, Set<string>>();
  private readonly resourceUsage = new Map<string, Map<string, number>>();
  private readonly featureCosts = new Map<string, { investment: number; perHour: number }>();

  constructor(model: SimulationModel) {
    this.hierarchy = new ProcessHierarchy(model);
    for (const id of this.hierarchy.processes.keys())
      this.counters.set(id, {
        entered: 0,
        completed: 0,
        exited: 0,
        terminalCompleted: 0,
        abandoned: 0,
        failed: 0,
        inSystem: 0,
        queue: 0,
        maximumQueue: 0,
        queueArea: 0,
        lastQueueTime: 0,
        expectedRevenue: 0,
        realizedRevenue: 0,
        lostRevenue: 0,
        resourceCost: 0,
        wait: new Distribution(),
        cycle: new Distribution(),
        ttr: new Distribution(),
        processing: new Distribution(),
      });
    // Features are fixed by the captured model/scenario. Allocate each node target
    // once to its scopes; resource-only overhead remains in whole-system economics.
    for (const feature of model.improvements)
      if (feature.enabled && feature.nodeId)
        for (const id of this.hierarchy.forNode(feature.nodeId)) {
          const costs = this.featureCosts.get(id) ?? { investment: 0, perHour: 0 };
          costs.investment += feature.investmentCost;
          costs.perHour += feature.operatingCostPerHour ?? 0;
          this.featureCosts.set(id, costs);
        }
  }

  /** Outbound transit remains in the departing scope until arrival in the next actual node. */
  enter(
    particle: ParticleSnapshot,
    nodeId: string,
    clock: number,
    expectedRevenue = particle.expectedRevenue,
  ) {
    if (!this.counters.size) return;
    const next = this.hierarchy.forNode(nodeId);
    const previous = this.visits.get(particle.id);
    if (!previous && !next.length) return;
    if (previous?.size === next.length && next.every((id) => previous.has(id))) return;
    const scopes = new Set(next),
      visits = previous ?? new Map<string, number>();
    for (const id of visits.keys())
      if (!scopes.has(id)) {
        this.leaveCase(particle, id, clock);
        visits.delete(id);
      }
    for (const id of next)
      if (!visits.has(id)) {
        const cases = this.cases.get(id) ?? new Map<number, CaseVisit>();
        const rootId = particle.rootParticleId ?? particle.id;
        let visit = cases.get(rootId);
        if (!visit) {
          visit = { tokens: new Set(), entered: clock, revenue: 0, lost: 0, expectedRevenue };
          const counter = this.counters.get(id)!;
          counter.entered++;
          counter.inSystem++;
          counter.expectedRevenue += expectedRevenue;
          cases.set(rootId, visit);
          this.cases.set(id, cases);
          const scopes = this.rootScopes.get(rootId) ?? new Set<string>();
          scopes.add(id);
          this.rootScopes.set(rootId, scopes);
        }
        visit.tokens.add(particle.id);
        visits.set(id, clock);
      }
    if (visits.size) this.visits.set(particle.id, visits);
    else this.visits.delete(particle.id);
  }

  expectedRevenueChanged(particleId: number, amount: number) {
    for (const id of this.rootScopes.get(particleId) ?? []) {
      this.counters.get(id)!.expectedRevenue += amount;
      this.cases.get(id)!.get(particleId)!.expectedRevenue += amount;
    }
  }

  retire(particle: ParticleSnapshot, clock: number, branchFailure?: 'abandoned' | 'failed') {
    for (const id of this.visits.get(particle.id)?.keys() ?? [])
      this.leaveCase(
        particle,
        id,
        clock,
        branchFailure ??
          (particle.status === 'joined'
            ? undefined
            : particle.status === 'completed'
              ? 'completed'
              : particle.status === 'abandoned'
                ? 'abandoned'
                : 'failed'),
      );
    this.visits.delete(particle.id);
  }
  private leaveCase(
    particle: ParticleSnapshot,
    id: string,
    clock: number,
    status?: 'completed' | 'abandoned' | 'failed',
  ) {
    const cases = this.cases.get(id)!;
    const rootId = particle.rootParticleId ?? particle.id;
    const visit = cases.get(rootId)!;
    if (status) {
      if (status !== 'completed' || visit.status === undefined) visit.status = status;
      visit.revenue = Math.max(visit.revenue, particle.realizedRevenue);
      if (status !== 'completed') visit.lost = visit.expectedRevenue;
    }
    visit.tokens.delete(particle.id);
    if (visit.tokens.size) return;
    const counter = this.counters.get(id)!;
    counter.inSystem--;
    if (visit.status === 'abandoned' || visit.status === 'failed') {
      counter[visit.status]++;
      counter.lostRevenue += visit.lost;
    } else {
      counter.completed++;
      const elapsed = (clock - visit.entered) / 1000;
      counter.cycle.add(elapsed);
      if (visit.status === 'completed') {
        counter.terminalCompleted++;
        counter.realizedRevenue += visit.revenue;
        if (visit.revenue > 0) counter.ttr.add(elapsed);
      } else counter.exited++;
    }
    cases.delete(rootId);
    if (!cases.size) this.cases.delete(id);
    const scopes = this.rootScopes.get(rootId)!;
    scopes.delete(id);
    if (!scopes.size) this.rootScopes.delete(rootId);
  }

  queueEntered(nodeId: string, clock: number) {
    for (const id of this.hierarchy.forNode(nodeId)) {
      const counter = this.counters.get(id)!;
      this.touchQueue(counter, clock);
      counter.queue++;
      counter.maximumQueue = Math.max(counter.maximumQueue, counter.queue);
    }
  }
  queueLeft(nodeId: string, clock: number, waitSeconds: number, queued: boolean) {
    for (const id of this.hierarchy.forNode(nodeId)) {
      const counter = this.counters.get(id)!;
      this.touchQueue(counter, clock);
      if (queued) counter.queue--;
      counter.wait.add(waitSeconds);
    }
  }
  private touchQueue(counter: ScopeCounter, clock: number) {
    counter.queueArea += counter.queue * (clock - counter.lastQueueTime);
    counter.lastQueueTime = clock;
  }
  processed(nodeId: string, elapsedSeconds: number) {
    for (const id of this.hierarchy.forNode(nodeId))
      this.counters.get(id)!.processing.add(elapsedSeconds);
  }

  resourceAcquired(resourceId: string, nodeId: string, units: number) {
    if (!this.counters.size) return;
    const usage = this.resourceUsage.get(resourceId) ?? new Map<string, number>();
    const next = (usage.get(nodeId) ?? 0) + units;
    if (next > 1e-9) usage.set(nodeId, next);
    else usage.delete(nodeId);
    if (usage.size) this.resourceUsage.set(resourceId, usage);
    else this.resourceUsage.delete(resourceId);
  }
  /** Called before changing a resource meter, with the occupied units from the preceding interval. */
  accrueResource(resourceId: string, elapsedMs: number, unitCostPerHour: number) {
    for (const [nodeId, units] of this.resourceUsage.get(resourceId) ?? [])
      for (const id of this.hierarchy.forNode(nodeId))
        this.counters.get(id)!.resourceCost += (units * unitCostPerHour * elapsedMs) / 3600000;
  }

  project(input: Projection): Record<string, ProcessMetrics> {
    const result: Record<string, ProcessMetrics> = Object.create(null);
    const nodeBottlenecks = new Map<string, Bottleneck>(),
      resourceBottlenecks = new Map<string, Bottleneck>();
    // Index once: thousands of scopes must not rescan every global constraint per snapshot.
    for (const bottleneck of input.bottlenecks)
      (bottleneck.kind === 'node' ? nodeBottlenecks : resourceBottlenecks).set(
        bottleneck.id,
        bottleneck,
      );
    const pendingResourceCosts = new Map<string, number>();
    for (const [resourceId, usage] of this.resourceUsage) {
      const resource = input.resources.get(resourceId)!;
      const elapsed = input.clock - resource.last;
      for (const [nodeId, units] of usage)
        for (const id of this.hierarchy.forNode(nodeId))
          pendingResourceCosts.set(
            id,
            (pendingResourceCosts.get(id) ?? 0) +
              (units * input.unitCostRate(resource) * elapsed) / 3600000,
          );
    }
    for (const [id, process] of this.hierarchy.processes) {
      const counter = this.counters.get(id)!,
        nodeIds = [...this.hierarchy.nodeIds(id)];
      const workNodes = nodeIds.flatMap((nodeId) => {
        const work = input.work.get(nodeId);
        return work ? [work] : [];
      });
      const resourceConsumers = new Map<string, WorkState[]>();
      for (const work of workNodes)
        for (const requirement of work.node.work.resourceRequirements ?? []) {
          const consumers = resourceConsumers.get(requirement.resourceId) ?? [];
          consumers.push(work);
          resourceConsumers.set(requirement.resourceId, consumers);
        }
      const resourceIds = new Set(resourceConsumers.keys());
      const bottlenecks = nodeIds.flatMap((nodeId): Bottleneck[] => {
        const bottleneck = nodeBottlenecks.get(nodeId);
        return bottleneck ? [bottleneck] : [];
      });
      for (const [resourceId, consumers] of resourceConsumers) {
        const bottleneck = resourceBottlenecks.get(resourceId);
        if (!bottleneck) continue;
        const averageQueue = consumers.reduce(
          (sum, work) => sum + input.nodes[work.node.id].queue.average,
          0,
        );
        if (!averageQueue) continue;
        const waitCount = consumers.reduce((sum, work) => sum + work.wait.count, 0);
        const waitSum = consumers.reduce((sum, work) => sum + work.wait.sum, 0);
        bottlenecks.push({
          ...bottleneck,
          averageQueue,
          score: averageQueue * bottleneck.utilization,
          averageWaitSeconds: waitCount ? waitSum / waitCount : 0,
        });
      }
      bottlenecks.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      let busyArea = 0,
        capacityArea = 0,
        capacity = 0,
        busy = 0,
        operatingCost = 0,
        scalingCost = 0;
      const resourceUsage: Record<string, number> = Object.create(null);
      for (const work of workNodes) {
        const delta = input.clock - work.last;
        busyArea += work.busyArea + work.busy * delta;
        capacityArea +=
          work.capacityArea +
          (work.scheduled ? work.capacity : Math.min(work.capacity, work.busy)) * delta;
        capacity += work.capacity;
        busy += work.busy;
        const metric = input.nodes[work.node.id];
        operatingCost += metric.operatingCost;
        scalingCost += metric.scalingCost;
        for (const [resourceId, units] of Object.entries(metric.resourceUsage))
          resourceUsage[resourceId] = (resourceUsage[resourceId] ?? 0) + units;
      }
      const featureCosts = this.featureCosts.get(id);
      const investmentCost = featureCosts?.investment ?? 0;
      operatingCost += ((featureCosts?.perHour ?? 0) * input.clock) / 3600000;
      const statuses = nodeIds
        .filter((nodeId) => input.nodes[nodeId]?.type !== 'resource')
        .map((nodeId) => input.nodes[nodeId]?.status);
      const status =
        (['failed', 'scaling', 'blocked', 'saturated', 'busy', 'normal'] as const).find((status) =>
          statuses.includes(status),
        ) ?? (counter.inSystem ? 'normal' : 'idle');
      result[id] = {
        ...finishEconomics({
          ...zeroEconomics(),
          expectedRevenue: counter.expectedRevenue,
          realizedRevenue: counter.realizedRevenue,
          lostRevenue: counter.lostRevenue,
          operatingCost,
          resourceCost: counter.resourceCost + (pendingResourceCosts.get(id) ?? 0),
          scalingCost,
          investmentCost,
        }),
        id,
        name: process.name,
        ...(process.parentId !== undefined ? { parentId: process.parentId } : {}),
        nodeIds,
        childProcessIds: [...this.hierarchy.children(id)],
        resourceIds: [...resourceIds],
        resourceUsage,
        entered: counter.entered,
        completed: counter.completed,
        exited: counter.exited,
        terminalCompleted: counter.terminalCompleted,
        abandoned: counter.abandoned,
        failed: counter.failed,
        inSystem: counter.inSystem,
        throughputPerHour: input.clock ? (counter.completed * 3600000) / input.clock : 0,
        queue: {
          current: counter.queue,
          average: input.clock
            ? (counter.queueArea + counter.queue * (input.clock - counter.lastQueueTime)) /
              input.clock
            : 0,
          maximum: counter.maximumQueue,
          wait: counter.wait.metrics(),
        },
        cycleTime: counter.cycle.metrics(),
        ttr: counter.ttr.metrics(),
        processing: counter.processing.metrics(),
        utilization: capacityArea ? busyArea / capacityArea : 0,
        currentUtilization: capacity ? busy / capacity : 0,
        status,
        currentBottleneck: bottlenecks[0]?.id ?? null,
        bottlenecks,
        resourceCostAllocation: 'occupied-units',
      };
    }
    return result;
  }
}
