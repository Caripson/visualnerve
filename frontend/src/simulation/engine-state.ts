import type {
  SimulationModel,
  SimulationNode,
  Resource,
  ParticleType,
  ParticleSnapshot,
  SimulationState,
  SimulationEvent,
  NodeMetrics,
  QueueMetrics,
  ResourceMetrics,
  Bottleneck,
} from './types';
import { Distribution } from './statistics';
import type { EventQueue } from './event-queue';
import type { BoundedRing } from './ring';
import { zeroEconomics, finishEconomics } from './economics';
const sec = (t: number) => t / 1000;
export interface Meter {
  capacity: number;
  initial: number;
  busy: number;
  queue: number;
  maximumQueue: number;
  last: number;
  busyArea: number;
  capacityArea: number;
  queueArea: number;
  cost: number;
  scaleCost: number;
  lastScale: number;
  lowSince?: number;
  scaleToken: number;
  scaling: boolean;
  scheduled: boolean;
  hourly: number;
  additionalHourly: number;
  /** Cumulative incurred processing cost per occupied slot/resource unit. */
  unitCostIntegral: number;
  wait: Distribution;
}
export interface WorkState extends Meter {
  node: Extract<SimulationNode, { type: 'work' }>;
  queueIds: Map<number, number>;
  pending: Set<number>;
  heap: EventQueue;
  started: number;
  completed: number;
  abandoned: number;
  revenue: number;
  expected: number;
  lost: number;
  perParticleCost: number;
}
export interface ResourceState extends Meter {
  resource: Resource;
  waiters: Set<string>;
}
export interface Particle extends ParticleSnapshot {
  entered: number;
  started: number;
  workCostIntegralStart: number;
  route: string[];
  resources: { resourceId: string; units: number; unitCostIntegralStart: number }[];
  visits: number;
}
export interface TypeState {
  type: ParticleType;
  created: number;
  completed: number;
  abandoned: number;
  failed: number;
  revenue: number;
  expected: number;
  lost: number;
  cost: number;
  wait: Distribution;
  ttr: Distribution;
  cycle: Distribution;
}

interface ProjectionInput {
  activity: Map<
    string,
    {
      started: number;
      completed: number;
      abandoned: number;
      failed: number;
      revenue: number;
      lost: number;
    }
  >;
  model: SimulationModel;
  clock: number;
  accountedClock: number;
  work: Map<string, WorkState>;
  resources: Map<string, ResourceState>;
  types: Map<string, TypeState>;
  active: Map<number, Particle>;
  retained: BoundedRing<ParticleSnapshot>;
  events: BoundedRing<SimulationEvent>;
  totals: {
    created: number;
    completed: number;
    abandoned: number;
    failed: number;
    revenue: number;
    lost: number;
    expected: number;
    operating: number;
    resource: number;
    scaling: number;
    investment: number;
  };
  workRate: number;
  resourceRate: number;
  queueLength: number;
  queueArea: number;
  maximumQueue: number;
  particleLimit: number;
  droppedEvents: number;
  message: string;
  status: SimulationState['status'];
  wait: Distribution;
  ttr: Distribution;
  cycle: Distribution;
  processing: Distribution;
  nodeMetrics: (w: WorkState) => NodeMetrics;
  utilization: (s: Meter) => number;
  queueMetrics: (s: Meter) => QueueMetrics;
  rate: (s: Meter) => number;
  snapshot: (p: Particle) => ParticleSnapshot;
}

export function projectSimulationState(input: ProjectionInput): SimulationState {
  const nodes: Record<string, NodeMetrics> = Object.create(null),
    resources: Record<string, ResourceMetrics> = Object.create(null);
  for (const node of input.model.nodes) {
    const w = input.work.get(node.id);
    nodes[node.id] = w
      ? input.nodeMetrics(w)
      : {
          ...zeroEconomics(),
          id: node.id,
          name: node.name,
          type: node.type,
          capacity:
            node.type === 'resource' ? (input.resources.get(node.resourceId)?.capacity ?? 0) : 0,
          maximumCapacity: 0,
          busy: 0,
          utilization: 0,
          currentUtilization: 0,
          queue: { current: 0, average: 0, maximum: 0, wait: new Distribution().metrics() },
          started: input.activity.get(node.id)?.started ?? 0,
          completed: input.activity.get(node.id)?.completed ?? 0,
          abandoned: input.activity.get(node.id)?.abandoned ?? 0,
          throughputPerHour: input.clock
            ? ((input.activity.get(node.id)?.completed ?? 0) * 3600000) / input.clock
            : 0,
          status: input.activity.get(node.id)?.failed ? 'failed' : 'idle',
          resourceUsage: {},
        };
  }
  for (const [id, r] of input.resources)
    resources[id] = {
      id,
      name: r.resource.name,
      capacity: r.capacity,
      maximumCapacity: r.resource.scaling?.maxCapacity ?? r.resource.maxCapacity ?? r.capacity,
      busy: r.busy,
      utilization: input.utilization(r),
      currentUtilization: r.capacity ? r.busy / r.capacity : 0,
      queue: input.queueMetrics(r),
      cost: r.cost + (input.rate(r) * (input.clock - r.last)) / 3600000,
      scalingCost: r.scaleCost,
      waitingNodeIds: [...r.waiters].filter((n) => input.work.get(n)!.queue > 0),
    };
  for (const node of input.model.nodes) {
    if (node.type === 'resource') {
      const r = resources[node.resourceId],
        meter = input.resources.get(node.resourceId)!;
      nodes[node.id] = {
        ...nodes[node.id],
        ...finishEconomics({
          ...zeroEconomics(),
          resourceCost: r.cost,
          scalingCost: r.scalingCost,
        }),
        capacity: r.capacity,
        maximumCapacity: r.maximumCapacity,
        busy: r.busy,
        utilization: r.utilization,
        currentUtilization: r.currentUtilization,
        queue: r.queue,
        status: meter.scaling
          ? 'scaling'
          : r.queue.current > 0
            ? 'blocked'
            : r.currentUtilization > 0.85
              ? 'busy'
              : r.busy
                ? 'normal'
                : 'idle',
        resourceUsage: { [r.id]: r.busy },
      };
    } else if (node.type !== 'work') {
      const a = input.activity.get(node.id);
      if (a)
        Object.assign(
          nodes[node.id],
          finishEconomics({ ...zeroEconomics(), realizedRevenue: a.revenue, lostRevenue: a.lost }),
        );
    }
  }
  const bottlenecks: Bottleneck[] = [];
  for (const n of Object.values(nodes))
    if (n.type === 'work') {
      const score = n.queue.average * (1 + n.utilization);
      if (score > 0)
        bottlenecks.push({
          id: n.id,
          kind: 'node',
          name: n.name,
          score,
          utilization: n.utilization,
          averageQueue: n.queue.average,
          averageWaitSeconds: n.queue.wait.average,
          reason:
            n.status === 'blocked'
              ? 'Waiting for shared resource capacity.'
              : 'Queue pressure and utilized processing capacity.',
        });
    }
  for (const r of Object.values(resources)) {
    const score = r.queue.average * r.utilization;
    if (score > 0)
      bottlenecks.push({
        id: r.id,
        kind: 'resource',
        name: r.name,
        score,
        utilization: r.utilization,
        averageQueue: r.queue.average,
        averageWaitSeconds: r.queue.wait.average,
        reason: 'Shared resource contention.',
      });
  }
  bottlenecks.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const economic = finishEconomics({
    ...zeroEconomics(),
    expectedRevenue: input.totals.expected,
    realizedRevenue: input.totals.revenue,
    operatingCost:
      input.totals.operating + (input.workRate * (input.clock - input.accountedClock)) / 3600000,
    resourceCost:
      input.totals.resource + (input.resourceRate * (input.clock - input.accountedClock)) / 3600000,
    scalingCost: input.totals.scaling,
    investmentCost: input.totals.investment,
    lostRevenue: input.totals.lost,
  });
  const particleTypes = Object.fromEntries(
    [...input.types].map(([id, t]) => [
      id,
      {
        ...finishEconomics({
          ...zeroEconomics(),
          expectedRevenue: t.expected,
          realizedRevenue: t.revenue,
          operatingCost: t.cost,
          lostRevenue: t.lost,
        }),
        id,
        name: t.type.name,
        created: t.created,
        completed: t.completed,
        abandoned: t.abandoned,
        failed: t.failed,
        inSystem: t.created - t.completed - t.abandoned - t.failed,
        wait: t.wait.metrics(),
        ttr: t.ttr.metrics(),
        cycleTime: t.cycle.metrics(),
      },
    ]),
  );
  const samples: ParticleSnapshot[] = [];
  for (const p of input.active.values()) {
    if (samples.length >= input.particleLimit) break;
    samples.push(input.snapshot(p));
  }
  return {
    timeSeconds: sec(input.clock),
    status: input.status,
    metrics: {
      ...economic,
      created: input.totals.created,
      completed: input.totals.completed,
      abandoned: input.totals.abandoned,
      failed: input.totals.failed,
      inSystem: input.active.size,
      throughputPerHour: input.clock ? (input.totals.completed * 3600000) / input.clock : 0,
      queue: {
        current: input.queueLength,
        average: input.clock
          ? (input.queueArea + input.queueLength * (input.clock - input.accountedClock)) /
            input.clock
          : 0,
        maximum: input.maximumQueue,
        wait: input.wait.metrics(),
      },
      ttr: input.ttr.metrics(),
      cycleTime: input.cycle.metrics(),
      processing: input.processing.metrics(),
      currentBottleneck: bottlenecks[0]?.id ?? null,
    },
    nodes,
    resources,
    particleTypes,
    particles: [
      ...samples,
      ...input.retained
        .values()
        .slice(Math.max(0, input.retained.length - (input.particleLimit - samples.length))),
    ],
    events: input.events.values(),
    bottlenecks,
    retained: {
      activeParticles: input.active.size,
      completedParticles: input.retained.length,
      events: input.events.length,
      droppedEvents: input.droppedEvents,
    },
    ...(input.message ? { message: input.message } : {}),
  };
}
