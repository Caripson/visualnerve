import {
  projectSimulationState,
  type Meter,
  type WorkState,
  type ResourceState,
  type Particle,
  type TypeState,
} from './engine-state';
import { ProcessMetricsAccumulator } from './process-metrics';
import { ParallelExecution, type ForkGroup } from './parallel-execution';
import { zeroEconomics, finishEconomics } from './economics';
export { compareSimulationResults } from './economics';
import type {
  SimulationModel,
  SimulationNode,
  SimulationEdge,
  Resource,
  RunOptions,
  ParticleType,
  ParticleSnapshot,
  SimulationEvent,
  SimulationEventType,
  SimulationState,
  SimulationResult,
  NodeMetrics,
  ResourceMetrics,
  EconomicMetrics,
  QueueMetrics,
  ScalingRule,
  ScheduleWindow,
  Bottleneck,
  CashPoint,
  SimulationComparison,
  RoutingCondition,
} from './types';
import { validateSimulationModel, resolveScenario } from './schema';
import { EventQueue, type EngineEvent } from './event-queue';
import { SeededRandom, hashString } from './random';
import { ParticleRoute } from './particle-route';
import { Distribution } from './statistics';
import { BoundedRing } from './ring';
import { StorageError } from '../model/errors';
const ms = (s: number) => Math.round(s * 1000),
  sec = (t: number) => t / 1000;
export const simulationExecutionLimits = { activeParticles: 200000, semanticEvents: 50000000 };
function isOpen(schedule: ScheduleWindow[] | undefined, t: number) {
  if (!schedule?.length) return true;
  return schedule.some((w) => {
    const x = w.repeatSeconds === undefined ? t : t % ms(w.repeatSeconds);
    return x >= ms(w.startSeconds) && x < ms(w.endSeconds);
  });
}
function nextOpening(schedule: ScheduleWindow[] | undefined, t: number): number | undefined {
  if (!schedule?.length || isOpen(schedule, t)) return t;
  let next = Infinity;
  for (const w of schedule) {
    const start = ms(w.startSeconds);
    if (w.repeatSeconds !== undefined) {
      const period = ms(w.repeatSeconds),
        base = Math.floor(t / period) * period;
      next = Math.min(next, base + start > t ? base + start : base + period + start);
    } else if (start > t) next = Math.min(next, start);
  }
  return Number.isFinite(next) ? next : undefined;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function simulationModelHash(model: SimulationModel) {
  return hashString(canonical(model)).toString(16);
}
/** The sole business engine. Scheduling/UI determine advancement targets, never outcomes. */
export class SimulationEngine {
  readonly model: SimulationModel;
  readonly options: Required<
    Pick<RunOptions, 'durationSeconds' | 'seed' | 'demandMultiplier' | 'untilComplete'>
  > &
    RunOptions;
  private readonly processes: ProcessMetricsAccumulator;
  private readonly parallel: ParallelExecution;
  private clock = 0;
  private accountedClock = 0;
  private processedEvents = 0;
  private budgetToken = 0;
  private fixedOperating = 0;
  private activity = new Map<
    string,
    {
      started: number;
      completed: number;
      abandoned: number;
      failed: number;
      revenue: number;
      lost: number;
    }
  >();
  private status: SimulationState['status'] = 'ready';
  private message = '';
  private queue = new EventQueue();
  private sequence = 0;
  private eventSequence = 0;
  private particleSequence = 0;
  private scheduledSources = 0;
  private active = new Map<number, Particle>();
  private retained: BoundedRing<ParticleSnapshot>;
  private events: BoundedRing<SimulationEvent>;
  private droppedEvents = 0;
  private nodes = new Map<string, SimulationNode>();
  private work = new Map<string, WorkState>();
  private resources = new Map<string, ResourceState>();
  private types = new Map<string, TypeState>();
  private outgoing = new Map<string, SimulationModel['edges']>();
  private edges = new Map<string, SimulationModel['edges'][number]>();
  private nodeFeatures = new Map<string, SimulationModel['improvements']>();
  private sources = new Map<string, { count: number; random: SeededRandom }>();
  private random = new Map<string, SeededRandom>();
  private dirty = new Set<string>();
  private dispatchScheduled = false;
  private totals = {
    created: 0,
    completed: 0,
    abandoned: 0,
    failed: 0,
    revenue: 0,
    lost: 0,
    expected: 0,
    operating: 0,
    resource: 0,
    scaling: 0,
    investment: 0,
  };
  private workRate = 0;
  private resourceRate = 0;
  private queueLength = 0;
  private queueArea = 0;
  private maximumQueue = 0;
  private wait = new Distribution();
  private ttr = new Distribution();
  private cycle = new Distribution();
  private processing = new Distribution();
  private routes = new Map<string, { count: number; ttr: Distribution; cycle: Distribution }>();
  private cash: CashPoint[] = [];
  private completedAt: number | null = null;
  private particleLimit: number;
  private eventLimit: number;
  private hash: string;
  private runId: string;
  constructor(model: SimulationModel, options: RunOptions = {}) {
    validateSimulationModel(model);
    this.model = resolveScenario(model, options.scenarioId, options.demandMultiplier);
    validateSimulationModel({ ...this.model, scenarios: [] });
    this.processes = new ProcessMetricsAccumulator(this.model);
    this.parallel = new ParallelExecution(this.model);
    this.options = {
      ...options,
      durationSeconds: options.durationSeconds ?? model.defaults.durationSeconds,
      seed: options.seed ?? model.defaults.seed,
      demandMultiplier:
        options.demandMultiplier ??
        model.scenarios.find((s) => s.id === options.scenarioId)?.demandMultiplier ??
        1,
      untilComplete: options.untilComplete ?? false,
    };
    if (
      !Number.isFinite(this.options.durationSeconds) ||
      this.options.durationSeconds <= 0 ||
      this.options.durationSeconds > 315360000 ||
      !Number.isSafeInteger(this.options.seed) ||
      this.options.seed < 0
    )
      throw new StorageError(
        422,
        'Simulation requires a positive duration up to ten years and a nonnegative integer seed.',
      );
    this.particleLimit = Math.min(this.model.retention?.particles ?? 300, 10000);
    this.eventLimit = Math.min(this.model.retention?.events ?? 2000, 100000);
    this.retained = new BoundedRing(this.particleLimit);
    this.events = new BoundedRing(this.eventLimit);
    for (const node of this.model.nodes)
      if (node.type === 'work' || node.type === 'outcome') {
        const resourceIds =
          node.type === 'work'
            ? new Set((node.work.resourceRequirements ?? []).map((r) => r.resourceId))
            : new Set<string>();
        this.nodeFeatures.set(
          node.id,
          this.model.improvements.filter(
            (f) =>
              f.enabled &&
              (f.nodeId === node.id || (!!f.resourceId && resourceIds.has(f.resourceId))),
          ),
        );
      }
    this.hash = simulationModelHash(this.model);
    this.runId = options.runId ?? `simulation-${this.hash}-${this.options.seed}`;
    for (const t of this.model.particleTypes)
      this.types.set(t.id, {
        type: t,
        created: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
        revenue: 0,
        expected: 0,
        lost: 0,
        cost: 0,
        wait: new Distribution(),
        ttr: new Distribution(),
        cycle: new Distribution(),
      });
    for (const node of this.model.nodes) {
      this.activity.set(node.id, {
        started: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
        revenue: 0,
        lost: 0,
      });
      this.nodes.set(node.id, node);
      if (node.type === 'work') {
        let capacity = node.work.capacity,
          hourly = node.work.costPerHour ?? 0;
        for (const f of this.features(node.id).filter((f) => f.nodeId === node.id)) {
          capacity += f.capacityIncrease ?? 0;
          hourly *= f.costMultiplier ?? 1;
        }
        const state: WorkState = {
          ...this.meter(capacity, hourly, node.work.scaling, node.work.schedule),
          node,
          queueIds: new Map(),
          pending: new Set(),
          heap: new EventQueue(),
          started: 0,
          completed: 0,
          abandoned: 0,
          revenue: 0,
          expected: 0,
          lost: 0,
          perParticleCost: 0,
        };
        this.work.set(node.id, state);
        this.workRate += this.rate(state);
      }
    }
    for (const r of this.model.resources) {
      let capacity = r.capacity,
        hourly = r.costPerHour ?? 0;
      for (const f of this.model.improvements.filter((f) => f.enabled && f.resourceId === r.id)) {
        capacity += f.capacityIncrease ?? 0;
        hourly *= f.costMultiplier ?? 1;
      }
      const state: ResourceState = {
        ...this.meter(capacity, hourly, r.scaling, r.schedule),
        resource: r,
        waiters: new Set(),
      };
      this.resources.set(r.id, state);
      this.resourceRate += this.rate(state);
    }
    for (const feature of this.model.improvements)
      if (feature.enabled) {
        this.totals.investment += feature.investmentCost;
        this.workRate += feature.operatingCostPerHour ?? 0;
      }
    for (const node of this.model.nodes)
      if (node.type === 'work')
        for (const requirement of node.work.resourceRequirements ?? [])
          this.resources.get(requirement.resourceId)!.waiters.add(node.id);
    for (const edge of this.model.edges) {
      this.edges.set(edge.id, edge);
      const list = this.outgoing.get(edge.sourceNodeId) ?? [];
      list.push(edge);
      this.outgoing.set(edge.sourceNodeId, list);
    }
    for (const node of this.model.nodes)
      if (node.type === 'source') {
        this.sources.set(node.id, {
          count: 0,
          random: new SeededRandom(this.options.seed, `source:${node.id}`),
        });
        const first = nextOpening(node.source.schedule, ms(node.source.startSeconds ?? 0));
        if (first !== undefined) this.schedule('source', node.id, first, 2);
      }
    for (const [id, w] of this.work) this.scheduleWindows(id, w.node.work.schedule, false);
    for (const [id, r] of this.resources) this.scheduleWindows(id, r.resource.schedule, true);
    this.captureCash();
  }
  private features(nodeId: string) {
    return this.nodeFeatures.get(nodeId) ?? [];
  }
  private meter(
    capacity: number,
    hourly: number,
    scaling: ScalingRule | undefined,
    schedule: ScheduleWindow[] | undefined,
  ): Meter {
    return {
      capacity,
      initial: capacity,
      busy: 0,
      queue: 0,
      maximumQueue: 0,
      last: 0,
      busyArea: 0,
      capacityArea: 0,
      queueArea: 0,
      cost: 0,
      scaleCost: 0,
      lastScale: -Infinity,
      scaleToken: 0,
      scaling: false,
      scheduled: isOpen(schedule, 0),
      hourly,
      additionalHourly: scaling?.additionalCostPerHour ?? 0,
      unitCostIntegral: 0,
      wait: new Distribution(),
    };
  }
  private rate(s: Meter) {
    return (
      (s.scheduled ? s.capacity : Math.min(s.capacity, s.busy)) * s.hourly +
      Math.max(0, s.capacity - s.initial) * s.additionalHourly
    );
  }
  private touch(s: Meter) {
    const dt = this.clock - s.last;
    if ('resource' in s)
      this.processes.accrueResource((s as ResourceState).resource.id, dt, this.unitCostRate(s));
    s.busyArea += s.busy * dt;
    s.capacityArea += (s.scheduled ? s.capacity : Math.min(s.capacity, s.busy)) * dt;
    s.queueArea += s.queue * dt;
    s.cost += (this.rate(s) * dt) / 3600000;
    s.unitCostIntegral += (this.unitCostRate(s) * dt) / 3600000;
    s.last = this.clock;
  }
  private unitCostRate(s: Meter) {
    return s.capacity > 0
      ? s.hourly + (Math.max(0, s.capacity - s.initial) * s.additionalHourly) / s.capacity
      : 0;
  }
  private schedule(
    kind: string,
    id: string,
    at: number,
    phase = 1,
    particle?: number,
    token?: number,
    value?: number,
  ) {
    if (kind === 'source') this.scheduledSources++;
    this.queue.push({
      kind,
      id,
      at: Math.max(this.clock, at),
      phase,
      sequence: ++this.sequence,
      particle,
      token,
      value,
    });
  }
  private scheduleWindows(id: string, schedule: ScheduleWindow[] | undefined, resource: boolean) {
    for (const [index, w] of (schedule ?? []).entries())
      for (const [kind, t] of [
        ['open', w.startSeconds],
        ['close', w.endSeconds],
      ] as const)
        this.schedule(
          `${resource ? 'resource' : 'work'}-${kind}`,
          `${id}|${index}`,
          ms(t),
          0,
          undefined,
          undefined,
          w.repeatSeconds,
        );
  }
  private emit(
    type: SimulationEventType,
    fields: Omit<Partial<SimulationEvent>, 'type' | 'timeSeconds' | 'sequence'> = {},
  ) {
    const particle =
      fields.particleId === undefined ? undefined : this.active.get(fields.particleId);
    const event = {
      sequence: ++this.eventSequence,
      timeSeconds: sec(this.clock),
      type,
      ...(particle ? this.parallelFields(particle) : {}),
      ...fields,
    };
    if (this.events.push(event)) this.droppedEvents++;
  }
  private moveTime(t: number, commit = true) {
    if (t < this.clock) return;
    if (commit) {
      const dt = t - this.accountedClock;
      this.totals.operating += (this.workRate * dt) / 3600000;
      this.totals.resource += (this.resourceRate * dt) / 3600000;
      this.queueArea += this.queueLength * dt;
      this.accountedClock = t;
    }
    this.clock = t;
  }
  private captureCash() {
    const point = {
      timeSeconds: sec(this.clock),
      revenue: this.totals.revenue,
      operatingCostFixed: this.fixedOperating,
      operatingCost:
        this.totals.operating + (this.workRate * (this.clock - this.accountedClock)) / 3600000,
      resourceCost:
        this.totals.resource + (this.resourceRate * (this.clock - this.accountedClock)) / 3600000,
      scalingCost: this.totals.scaling,
      investmentCost: this.totals.investment,
    };
    if (this.cash[this.cash.length - 1]?.timeSeconds === point.timeSeconds)
      this.cash[this.cash.length - 1] = point;
    else {
      this.cash.push(point);
      if (this.cash.length > 2000) {
        this.cash = this.cash.filter((_, i, all) => i === 0 || i === all.length - 1 || i % 2 === 1);
      }
    }
    this.scheduleBudget();
  }
  private scheduleBudget() {
    const budget = this.model.economics?.maximumBudget;
    if (budget === undefined || this.status === 'completed' || this.status === 'failed') return;
    const remaining =
      budget -
      this.totals.operating -
      this.totals.resource -
      this.totals.scaling -
      this.totals.investment -
      ((this.workRate + this.resourceRate) * (this.clock - this.accountedClock)) / 3600000;
    const rate = this.workRate + this.resourceRate;
    const token = ++this.budgetToken;
    if (remaining <= 0) this.schedule('budget', '', this.clock, 0, undefined, token);
    else if (rate > 0)
      this.schedule(
        'budget',
        '',
        this.clock + Math.ceil((remaining * 3600000) / rate),
        0,
        undefined,
        token,
      );
  }
  private mark(id: string) {
    if (this.work.has(id)) this.dirty.add(id);
    if (!this.dispatchScheduled) {
      this.dispatchScheduled = true;
      this.schedule('dispatch', '', this.clock, 4);
    }
  }
  private source(event: EngineEvent) {
    const node = this.nodes.get(event.id);
    if (node?.type !== 'source') return;
    const config = node.source,
      state = this.sources.get(node.id)!;
    if (event.at >= ms(this.options.durationSeconds) && event.at !== 0) return;
    const maximum =
      config.maxCount ??
      (config.burst !== undefined && !(config.ratePerHour ?? 0) ? config.burst : Infinity);
    if (state.count >= maximum) return;
    if (!isOpen(config.schedule, this.clock)) {
      const at = nextOpening(config.schedule, this.clock);
      if (at !== undefined && at < ms(this.options.durationSeconds))
        this.schedule('source', node.id, at, 2);
      return;
    }
    if (state.count >= (config.burst ?? 0) && !(config.ratePerHour ?? 0)) return;
    if (this.active.size >= simulationExecutionLimits.activeParticles) {
      this.status = 'failed';
      this.message = `Active particle limit (${simulationExecutionLimits.activeParticles.toLocaleString('en-US')}) reached. Reduce the burst/arrival rate or add capacity.`;
      return;
    }
    const type = this.types.get(config.particleTypeId)!;
    type.created++;
    state.count++;
    this.totals.created++;
    this.activity.get(node.id)!.started++;
    this.activity.get(node.id)!.completed++;
    this.totals.expected += type.type.revenue;
    type.expected += type.type.revenue;
    const random = this.stream(`particle:${type.type.id}`),
      complexity =
        type.type.complexity.min +
        (type.type.complexity.max - type.type.complexity.min) * random.next();
    const particle: Particle = {
      id: ++this.particleSequence,
      typeId: type.type.id,
      createdAtSeconds: sec(this.clock),
      nodeId: node.id,
      status: 'transit',
      complexity,
      priority: type.type.priority,
      expectedRevenue: type.type.revenue,
      realizedRevenue: 0,
      accumulatedCost: 0,
      waitingSeconds: 0,
      processingSeconds: 0,
      history: [{ nodeId: node.id, enteredAtSeconds: sec(this.clock) }],
      entered: this.clock,
      started: 0,
      workCostIntegralStart: 0,
      route: new ParticleRoute(),
      resources: [],
      visits: 0,
    };
    this.active.set(particle.id, particle);
    this.processes.enter(particle, node.id, this.clock);
    this.emit('PARTICLE_CREATED', {
      nodeId: node.id,
      particleId: particle.id,
      particleTypeId: particle.typeId,
    });
    this.route(particle, node);
    if (state.count < maximum) {
      let at: number;
      if (state.count < (config.burst ?? 0)) at = this.clock;
      else if ((config.ratePerHour ?? 0) > 0) {
        const interval = 3600000 / config.ratePerHour!;
        at =
          this.clock +
          Math.max(
            1,
            Math.round(
              config.distribution === 'poisson'
                ? -Math.log(1 - state.random.next()) * interval
                : interval,
            ),
          );
      } else return;
      const opening = nextOpening(config.schedule, at);
      if (opening !== undefined && opening < ms(this.options.durationSeconds))
        this.schedule('source', node.id, opening, 2);
    }
  }
  private stream(key: string) {
    let random = this.random.get(key);
    if (!random) {
      random = new SeededRandom(this.options.seed, key);
      this.random.set(key, random);
    }
    return random;
  }
  private condition(c: RoutingCondition, p: Particle) {
    let value: unknown;
    if (c.field === 'particleTypeId') value = p.typeId;
    else if (c.field === 'complexity') value = p.complexity;
    else if (c.field === 'priority') value = p.priority;
    else if (c.field === 'revenue') value = p.expectedRevenue;
    else if (c.field === 'attribute') value = this.types.get(p.typeId)!.type.attributes?.[c.key];
    else {
      const stateCondition = c as Extract<RoutingCondition, { nodeId?: string }>;
      const meter = stateCondition.nodeId
        ? this.work.get(stateCondition.nodeId)
        : stateCondition.resourceId
          ? this.resources.get(stateCondition.resourceId)
          : undefined;
      value =
        c.field === 'queue'
          ? meter?.queue
          : c.field === 'availableCapacity'
            ? meter && Math.max(0, meter.capacity - meter.busy)
            : meter && meter.capacity
              ? meter.busy / meter.capacity
              : 0;
    }
    if (c.operator === 'eq') return value === c.value;
    if (c.operator === 'neq') return value !== c.value;
    if (typeof value !== 'number' || typeof c.value !== 'number') return false;
    return c.operator === 'gt'
      ? value > c.value
      : c.operator === 'gte'
        ? value >= c.value
        : c.operator === 'lt'
          ? value < c.value
          : value <= c.value;
  }
  private route(p: Particle, node: SimulationNode, forcedNodeId?: string) {
    if (++p.visits > 10000) {
      this.fail(p, node.id, 'Maximum route visits exceeded.');
      return;
    }
    p.history[p.history.length - 1].leftAtSeconds = sec(this.clock);
    if (forcedNodeId) {
      const edge = (this.outgoing.get(node.id) ?? []).find(
        (e) =>
          e.targetNodeId === forcedNodeId &&
          (!e.particleTypeIds?.length || e.particleTypeIds.includes(p.typeId)),
      );
      if (!edge) {
        this.fail(p, node.id, 'Overflow/failure routing needs a valid model edge.');
        return;
      }
      this.travel(p, node, edge);
      return;
    }
    const eligible = (this.outgoing.get(node.id) ?? []).filter(
      (e) => !e.particleTypeIds?.length || e.particleTypeIds.includes(p.typeId),
    );
    let edges = eligible;
    const fallback =
      node.type === 'router'
        ? eligible.find((candidate) => candidate.id === node.router.fallbackEdgeId)
        : undefined;
    if (node.type === 'router' && node.router.rules?.length) {
      const rules = node.router.rules.filter((r) => !r.condition || this.condition(r.condition, p));
      const ids = new Set(rules.map((r) => r.edgeId));
      edges =
        node.router.mode === 'first-match'
          ? rules.flatMap((rule) => {
              const candidate = eligible.find((e) => e.id === rule.edgeId);
              return candidate ? [candidate] : [];
            })
          : eligible.filter((e) => ids.has(e.id));
      if (!edges.length && fallback) edges = [fallback];
    }
    let edge: SimulationEdge | undefined = edges[0];
    if (
      node.type === 'router' &&
      (node.router.mode === 'least-queue' || node.router.mode === 'available-capacity')
    )
      ((edges = [...edges].sort((a, b) => {
        const aw = this.work.get(a.targetNodeId),
          bw = this.work.get(b.targetNodeId);
        return node.router.mode === 'least-queue'
          ? (aw?.queue ?? 0) - (bw?.queue ?? 0)
          : (bw ? bw.capacity - bw.busy : 0) - (aw ? aw.capacity - aw.busy : 0);
      })),
        (edge = edges[0]));
    if (edges.length && (node.type !== 'router' || node.router.mode === 'weighted')) {
      const weights = edges.map((e) =>
        node.type === 'router'
          ? (node.router.rules?.find(
              (r) => r.edgeId === e.id && (!r.condition || this.condition(r.condition, p)),
            )?.weight ??
            e.weight ??
            1)
          : (e.weight ?? 1),
      );
      const maximum = weights.reduce((max, value) => Math.max(max, value), 0);
      if (maximum === 0) {
        if (!fallback) {
          this.fail(p, node.id, 'No positive-weight outgoing route or eligible fallback.');
          return;
        }
        edge = fallback;
      } else if (edges.length > 1) {
        const normalized = weights.map((weight) => weight / maximum);
        let choice = this.stream(`route:${node.id}`).next() * normalized.reduce((a, b) => a + b, 0);
        edge = edges[edges.length - 1];
        for (let i = 0; i < edges.length; i++) {
          choice -= normalized[i];
          if (choice < 0) {
            edge = edges[i];
            break;
          }
        }
      }
    }
    if (!edge) {
      this.fail(p, node.id, 'No matching outgoing route.');
      return;
    }
    this.travel(p, node, edge);
  }
  private travel(p: Particle, node: SimulationNode, edge: SimulationEdge) {
    p.route.appendEdge(edge.id, node.type === 'work' ? node.id : undefined);
    p.edgeId = edge.id;
    p.departedAtSeconds = sec(this.clock);
    p.arrivesAtSeconds = sec(this.clock + ms(edge.travelSeconds ?? 0));
    p.status = 'transit';
    p.nodeId = node.id;
    this.emit('PARTICLE_ROUTED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: node.id,
      edgeId: edge.id,
    });
    this.schedule('arrival', edge.targetNodeId, this.clock + ms(edge.travelSeconds ?? 0), 2, p.id);
  }
  private enter(p: Particle, nodeId: string) {
    const node = this.nodes.get(nodeId)!;
    this.processes.enter(
      p,
      nodeId,
      this.clock,
      p.rootParticleId === undefined
        ? p.expectedRevenue
        : this.active.get(p.rootParticleId)!.expectedRevenue,
    );
    this.activity.get(nodeId)!.started++;
    p.nodeId = nodeId;
    p.edgeId = undefined;
    p.arrivesAtSeconds = undefined;
    p.departedAtSeconds = undefined;
    p.entered = this.clock;
    p.history.push({ nodeId, enteredAtSeconds: sec(this.clock) });
    if (p.history.length > 64) p.history.shift();
    if (node.type === 'fork') {
      this.fork(p, node);
      return;
    }
    if (node.type === 'join') {
      this.join(p, node);
      return;
    }
    if (node.type === 'outcome') {
      this.finish(p, node);
      return;
    }
    if (node.type !== 'work') {
      this.activity.get(nodeId)!.completed++;
      this.route(p, node);
      return;
    }
    const w = this.work.get(node.id)!;
    if (
      node.work.acceptedParticleTypeIds?.length &&
      !node.work.acceptedParticleTypeIds.includes(p.typeId)
    ) {
      if (node.work.overflowNodeId) this.route(p, node, node.work.overflowNodeId);
      else this.fail(p, node.id, 'Particle type is not accepted.');
      return;
    }
    p.status = 'queued';
    p.pendingAdmission = true;
    w.queueIds.set(p.id, ++this.sequence);
    w.pending.add(p.id);
    w.heap.push({
      at: 0,
      phase: node.work.queueDiscipline === 'priority' ? -p.priority : 0,
      sequence: this.sequence,
      kind: 'particle',
      id: '',
      particle: p.id,
    });
    w.expected += p.expectedRevenue;
    this.mark(node.id);
  }
  private parallelFields(p: Particle) {
    return p.parentParticleId === undefined
      ? {}
      : {
          rootParticleId: p.rootParticleId,
          parentParticleId: p.parentParticleId,
          forkGroupId: p.forkGroupId,
          forkNodeId: p.forkNodeId,
          joinNodeId: p.joinNodeId,
          branchEdgeId: p.branchEdgeId,
        };
  }
  private fork(p: Particle, node: Extract<SimulationNode, { type: 'fork' }>) {
    if (
      this.active.size + node.fork.branchEdgeIds.length >
      simulationExecutionLimits.activeParticles
    ) {
      this.status = 'failed';
      this.message =
        'Simulation active-particle limit reached while creating parallel work. Reduce arrivals or branch fan-out.';
      return;
    }
    const group = this.parallel.create(p, node, this.clock);
    p.status = 'waiting';
    const branches = node.fork.branchEdgeIds.map((edgeId) => {
      const child: Particle = {
        ...p,
        id: ++this.particleSequence,
        rootParticleId: group.rootId,
        parentParticleId: p.id,
        forkGroupId: group.id,
        forkNodeId: node.id,
        joinNodeId: group.joinNodeId,
        branchEdgeId: edgeId,
        status: 'transit',
        accumulatedCost: 0,
        waitingSeconds: 0,
        processingSeconds: 0,
        realizedRevenue: 0,
        history: [{ nodeId: node.id, enteredAtSeconds: sec(this.clock) }],
        route: new ParticleRoute(),
        resources: [],
      };
      this.active.set(child.id, child);
      this.processes.enter(
        child,
        node.id,
        this.clock,
        this.active.get(group.rootId)!.expectedRevenue,
      );
      this.parallel.addBranch(group, edgeId, child);
      return child;
    });
    this.emit('PARTICLE_FORKED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: node.id,
      rootParticleId: group.rootId,
      parentParticleId: p.id,
      forkGroupId: group.id,
      forkNodeId: node.id,
      joinNodeId: group.joinNodeId,
      branchCount: branches.length,
    });
    for (const child of branches) {
      child.history[0].leftAtSeconds = sec(this.clock);
      this.travel(child, node, this.edges.get(child.branchEdgeId!)!);
    }
  }
  private join(p: Particle, node: Extract<SimulationNode, { type: 'join' }>) {
    const group = this.parallel.arrive(p, node.id, this.clock);
    if (!group || group.forkNodeId !== node.join.forkNodeId) {
      this.fail(p, node.id, 'Join received work without its matching fork group.');
      return;
    }
    p.status = 'waiting';
    p.queueEnteredAtSeconds = sec(this.clock);
    this.queueLength++;
    this.maximumQueue = Math.max(this.maximumQueue, this.queueLength);
    this.processes.queueEntered(node.id, this.clock);
    this.emit('QUEUE_ENTERED', { particleId: p.id, particleTypeId: p.typeId, nodeId: node.id });
    this.emit('BRANCH_JOINED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: node.id,
      arrivedBranches: group.arrived.size,
      branchCount: group.branches.size,
    });
    if (group.arrived.size !== group.branches.size) return;
    const parent = group.parent;
    // Transfer the logical case into the join's scopes before retiring its child
    // tokens, so the handoff cannot create a second visit to the same scope.
    this.processes.enter(
      parent,
      node.id,
      this.clock,
      this.active.get(group.rootId)!.expectedRevenue,
    );
    let revenueFactor = 1;
    for (const child of group.branches.values()) {
      this.leaveJoin(child, group);
      parent.accumulatedCost += child.accumulatedCost;
      parent.waitingSeconds += child.waitingSeconds;
      parent.processingSeconds += child.processingSeconds;
      parent.route.append(child.route);
      if (group.expectedRevenue > 0) revenueFactor *= child.expectedRevenue / group.expectedRevenue;
      child.status = 'joined';
      this.retire(child);
    }
    this.parallel.close(group, false, this.clock);
    const expected = group.expectedRevenue * revenueFactor;
    const changed = expected - parent.expectedRevenue;
    parent.expectedRevenue = expected;
    if (parent.parentParticleId === undefined) {
      this.totals.expected += changed;
      this.types.get(parent.typeId)!.expected += changed;
      this.processes.expectedRevenueChanged(parent.id, changed);
    }
    parent.history[parent.history.length - 1].leftAtSeconds = sec(this.clock);
    parent.nodeId = node.id;
    parent.entered = this.clock;
    parent.status = 'transit';
    parent.history.push({ nodeId: node.id, enteredAtSeconds: sec(this.clock) });
    if (parent.history.length > 64) parent.history.shift();
    this.activity.get(group.forkNodeId)!.completed++;
    this.activity.get(node.id)!.completed++;
    this.emit('JOIN_COMPLETED', {
      particleId: parent.id,
      particleTypeId: parent.typeId,
      nodeId: node.id,
      rootParticleId: group.rootId,
      parentParticleId: parent.id,
      forkGroupId: group.id,
      forkNodeId: group.forkNodeId,
      joinNodeId: node.id,
      branchCount: group.branches.size,
      arrivedBranches: group.branches.size,
    });
    this.route(parent, node);
  }
  private leaveJoin(p: Particle, group: ForkGroup) {
    const arrived = group.arrived.get(p.branchEdgeId!);
    if (arrived === undefined) return;
    const wait = sec(this.clock - arrived);
    p.waitingSeconds += wait;
    p.queueEnteredAtSeconds = undefined;
    this.queueLength--;
    this.wait.add(wait);
    this.types.get(p.typeId)!.wait.add(wait);
    this.processes.queueLeft(group.joinNodeId, this.clock, wait, true);
    this.emit('QUEUE_LEFT', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: group.joinNodeId,
    });
  }
  private resourceQueue(id: string) {
    const r = this.resources.get(id)!;
    this.touch(r);
    r.queue = [...r.waiters].reduce((sum, n) => sum + (this.work.get(n)?.queue ?? 0), 0);
    r.maximumQueue = Math.max(r.maximumQueue, r.queue);
    this.checkScale(r, id, true);
  }
  private requirements(w: WorkState) {
    return (w.node.work.resourceRequirements ?? []).map((r) => {
      let multiplier = 1;
      for (const f of this.features(w.node.id))
        if (f.nodeId === w.node.id || f.resourceId === r.resourceId)
          multiplier *= f.resourceUnitsMultiplier ?? 1;
      return { ...r, units: r.units * multiplier };
    });
  }
  private canStart(w: WorkState, p: Particle) {
    if (!w.scheduled || w.busy >= w.capacity) return false;
    return this.requirements(w).every((req) => {
      const r = this.resources.get(req.resourceId)!;
      return r.scheduled && r.busy + req.units <= r.capacity + 1e-9;
    });
  }
  private head(w: WorkState): Particle | undefined {
    while (w.heap.peek()) {
      const id = w.heap.peek()!.particle!;
      if (w.queueIds.has(id)) return this.active.get(id);
      w.heap.pop();
    }
    return undefined;
  }
  private dispatch() {
    this.dispatchScheduled = false;
    const candidates = [...this.dirty].map((id) => this.work.get(id)!).filter(Boolean);
    this.dirty.clear();
    while (true) {
      let selected: WorkState | undefined,
        particle: Particle | undefined,
        order = Infinity;
      for (const w of candidates) {
        const p = this.head(w);
        if (p && this.canStart(w, p)) {
          const seq = w.queueIds.get(p.id)!,
            priority = w.node.work.queueDiscipline === 'priority' ? p.priority : 0,
            previousPriority =
              selected?.node.work.queueDiscipline === 'priority' ? particle!.priority : 0;
          if (priority > previousPriority || (priority === previousPriority && seq < order)) {
            selected = w;
            particle = p;
            order = seq;
          }
        }
      }
      if (!selected || !particle) break;
      this.start(selected, particle);
    }
    for (const w of candidates) {
      const pending = [...w.pending]
        .map((id) => this.active.get(id)!)
        .filter(Boolean)
        .sort(
          (a, b) =>
            (w.node.work.queueDiscipline === 'priority' ? b.priority - a.priority : 0) ||
            w.queueIds.get(a.id)! - w.queueIds.get(b.id)!,
        );
      for (const p of pending) {
        if (w.node.work.queueLimit !== undefined && w.queue >= w.node.work.queueLimit) {
          if (w.node.work.overflowNodeId) {
            w.queueIds.delete(p.id);
            w.pending.delete(p.id);
            p.pendingAdmission = undefined;
            this.route(p, w.node, w.node.work.overflowNodeId);
          } else this.abandon(p, w.node.id, 'Queue limit exceeded.');
          continue;
        }
        this.touch(w);
        w.pending.delete(p.id);
        p.pendingAdmission = undefined;
        p.queueEnteredAtSeconds = sec(this.clock);
        w.queue++;
        this.processes.queueEntered(w.node.id, this.clock);
        w.maximumQueue = Math.max(w.maximumQueue, w.queue);
        this.queueLength++;
        this.maximumQueue = Math.max(this.maximumQueue, this.queueLength);
        this.emit('QUEUE_ENTERED', {
          particleId: p.id,
          particleTypeId: p.typeId,
          nodeId: w.node.id,
        });
        const patience = this.types.get(p.typeId)!.type.patienceSeconds;
        if (patience !== undefined)
          this.schedule('abandon', w.node.id, this.clock + ms(patience) + 1, 3, p.id, p.entered);
      }
      for (const req of w.node.work.resourceRequirements ?? []) this.resourceQueue(req.resourceId);
      this.checkScale(w, w.node.id, false);
    }
  }
  private leaveQueue(w: WorkState, p: Particle) {
    this.touch(w);
    w.queueIds.delete(p.id);
    w.pending.delete(p.id);
    const queued = !p.pendingAdmission;
    p.pendingAdmission = undefined;
    if (queued) {
      w.queue--;
      this.queueLength--;
    }
    const wait = sec(this.clock - p.entered);
    this.processes.queueLeft(w.node.id, this.clock, wait, queued);
    p.waitingSeconds += wait;
    w.wait.add(wait);
    this.wait.add(wait);
    this.types.get(p.typeId)!.wait.add(wait);
    p.queueEnteredAtSeconds = undefined;
    if (queued)
      this.emit('QUEUE_LEFT', { particleId: p.id, particleTypeId: p.typeId, nodeId: w.node.id });
    for (const req of w.node.work.resourceRequirements ?? []) {
      this.resourceQueue(req.resourceId);
      this.resources.get(req.resourceId)!.wait.add(wait);
    }
  }
  private start(w: WorkState, p: Particle) {
    this.leaveQueue(w, p);
    this.touch(w);
    const beforeWorkRate = this.rate(w);
    w.busy++;
    this.workRate += this.rate(w) - beforeWorkRate;
    w.started++;
    p.status = 'processing';
    p.started = this.clock;
    p.workCostIntegralStart = w.unitCostIntegral;
    p.processingStartedAtSeconds = sec(this.clock);
    let duration =
        w.node.work.processingSeconds * p.complexity * (w.node.work.complexityMultiplier ?? 1),
      cost = w.node.work.costPerParticle ?? 0;
    for (const f of this.features(w.node.id)) {
      duration *= f.processingTimeMultiplier ?? 1;
      if (f.nodeId === w.node.id) cost *= f.costMultiplier ?? 1;
    }
    p.processingEndsAtSeconds = sec(this.clock + Math.max(1, ms(duration)));
    p.accumulatedCost += cost;
    w.perParticleCost += cost;
    this.types.get(p.typeId)!.cost += cost;
    this.totals.operating += cost;
    this.fixedOperating += cost;
    if (cost) this.emit('COST_INCURRED', { particleId: p.id, nodeId: w.node.id, amount: cost });
    p.resources = this.requirements(w).map((requirement) => ({
      ...requirement,
      unitCostIntegralStart: 0,
    }));
    for (const req of p.resources) {
      const r = this.resources.get(req.resourceId)!;
      this.touch(r);
      req.unitCostIntegralStart = r.unitCostIntegral;
      const before = this.rate(r);
      r.busy += req.units;
      this.processes.resourceAcquired(req.resourceId, w.node.id, req.units);
      this.resourceRate += this.rate(r) - before;
      this.emit('RESOURCE_ACQUIRED', {
        particleId: p.id,
        nodeId: w.node.id,
        resourceId: req.resourceId,
        amount: req.units,
      });
      this.checkScale(r, req.resourceId, true);
    }
    this.emit('PROCESS_STARTED', { particleId: p.id, particleTypeId: p.typeId, nodeId: w.node.id });
    this.schedule('finish', w.node.id, ms(p.processingEndsAtSeconds), 0, p.id);
    this.checkScale(w, w.node.id, false);
    this.captureCash();
  }
  private processFinished(p: Particle, id: string) {
    this.releaseProcessing(p, id, false);
    const w = this.work.get(id)!;
    let expected = p.expectedRevenue;
    for (const feature of this.features(id)) expected *= feature.revenueMultiplier ?? 1;
    const revenueChange = expected - p.expectedRevenue;
    p.expectedRevenue = expected;
    if (p.parentParticleId === undefined) {
      this.totals.expected += revenueChange;
      this.processes.expectedRevenueChanged(p.id, revenueChange);
      this.types.get(p.typeId)!.expected += revenueChange;
    } else if (revenueChange !== 0) {
      const root = this.active.get(p.rootParticleId!)!;
      const multiplier = expected / (expected - revenueChange);
      const rootChange = root.expectedRevenue * (multiplier - 1);
      root.expectedRevenue += rootChange;
      this.totals.expected += rootChange;
      this.types.get(p.typeId)!.expected += rootChange;
      this.processes.expectedRevenueChanged(root.id, rootChange);
    }
    w.expected += revenueChange;
    const failed = this.features(id).find(
      (f) => (f.failureProbability ?? 0) > this.stream(`failure:${f.id}`).next(),
    );
    if (failed) {
      if (failed.failureNodeId) this.route(p, w.node, failed.failureNodeId);
      else this.fail(p, id, 'Processing feature failure.');
    } else this.route(p, w.node);
    this.captureCash();
  }
  private releaseProcessing(p: Particle, id: string, cancelled: boolean) {
    const w = this.work.get(id)!;
    this.touch(w);
    const previousRate = this.rate(w);
    w.busy--;
    this.workRate += this.rate(w) - previousRate;
    if (!cancelled) w.completed++;
    const elapsed = sec(this.clock - p.started);
    p.processingSeconds += elapsed;
    this.processing.add(elapsed);
    this.processes.processed(id, elapsed);
    const allocated = w.unitCostIntegral - p.workCostIntegralStart;
    p.accumulatedCost += allocated;
    this.types.get(p.typeId)!.cost += allocated;
    for (const req of p.resources) {
      const r = this.resources.get(req.resourceId)!;
      this.touch(r);
      const before = this.rate(r);
      r.busy = Math.max(0, r.busy - req.units);
      this.processes.resourceAcquired(req.resourceId, id, -req.units);
      this.resourceRate += this.rate(r) - before;
      const cost = req.units * (r.unitCostIntegral - req.unitCostIntegralStart);
      p.accumulatedCost += cost;
      this.types.get(p.typeId)!.cost += cost;
      this.emit('RESOURCE_RELEASED', {
        particleId: p.id,
        nodeId: id,
        resourceId: req.resourceId,
        amount: req.units,
      });
      this.checkScale(r, req.resourceId, true);
      for (const waiting of r.waiters) this.mark(waiting);
    }
    p.resources = [];
    p.processingStartedAtSeconds = undefined;
    p.processingEndsAtSeconds = undefined;
    this.emit(cancelled ? 'PROCESS_CANCELLED' : 'PROCESS_COMPLETED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: id,
    });
    this.checkScale(w, id, false);
    this.mark(id);
    p.status = 'transit';
  }
  private abandon(p: Particle, id: string, reason: string) {
    if (p.parentParticleId !== undefined || this.parallel.forRoot(p.id).length) {
      this.cancelParallel(p, id, reason, 'abandoned');
      return;
    }
    this.activity.get(id)!.abandoned++;
    this.activity.get(id)!.lost += p.expectedRevenue;
    const w = this.work.get(id);
    if (p.status === 'queued' && w?.queueIds.has(p.id)) {
      this.leaveQueue(w, p);
      w.abandoned++;
      w.lost += p.expectedRevenue;
      this.checkScale(w, id, false);
    }
    p.status = 'abandoned';
    this.totals.abandoned++;
    this.totals.lost += p.expectedRevenue;
    const type = this.types.get(p.typeId)!;
    type.abandoned++;
    type.lost += p.expectedRevenue;
    this.emit('PARTICLE_ABANDONED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: id,
      amount: p.expectedRevenue,
      reason,
    });
    this.retire(p);
  }
  private fail(p: Particle, id: string, reason: string) {
    if (p.parentParticleId !== undefined || this.parallel.forRoot(p.id).length) {
      this.cancelParallel(p, id, reason, 'failed');
      return;
    }
    this.activity.get(id)!.failed++;
    this.activity.get(id)!.lost += p.expectedRevenue;
    p.status = 'failed';
    this.totals.failed++;
    this.totals.lost += p.expectedRevenue;
    const type = this.types.get(p.typeId)!;
    type.failed++;
    type.lost += p.expectedRevenue;
    this.emit('PARTICLE_FAILED', {
      particleId: p.id,
      particleTypeId: p.typeId,
      nodeId: id,
      reason,
    });
    this.retire(p);
  }
  private cancelParallel(
    trigger: Particle,
    id: string,
    reason: string,
    status: 'abandoned' | 'failed',
  ) {
    const root = this.active.get(trigger.rootParticleId ?? trigger.id)!;
    const groups = this.parallel.forRoot(root.id);
    const tokens = new Map<number, Particle>();
    for (const group of groups) {
      tokens.set(group.parent.id, group.parent);
      for (const child of group.branches.values()) tokens.set(child.id, child);
    }
    tokens.delete(root.id);
    for (const child of tokens.values()) {
      const work = this.work.get(child.nodeId);
      if (child.status === 'queued' && work?.queueIds.has(child.id)) {
        this.leaveQueue(work, child);
        this.checkScale(work, work.node.id, false);
        this.mark(work.node.id);
      } else if (child.status === 'processing') this.releaseProcessing(child, child.nodeId, true);
      else if (child.status === 'waiting') {
        const group = this.parallel.group(child);
        if (group?.arrived.has(child.branchEdgeId!)) this.leaveJoin(child, group);
      }
      root.accumulatedCost += child.accumulatedCost;
      root.waitingSeconds += child.waitingSeconds;
      root.processingSeconds += child.processingSeconds;
      root.route.append(child.route);
      child.status = 'cancelled';
      this.emit('BRANCH_CANCELLED', {
        particleId: child.id,
        particleTypeId: child.typeId,
        nodeId: child.nodeId,
        reason,
      });
      this.retire(child, status);
    }
    for (const group of groups) this.parallel.close(group, true, this.clock);
    this.activity.get(id)![status === 'abandoned' ? 'abandoned' : 'failed']++;
    this.activity.get(id)!.lost += root.expectedRevenue;
    const work = this.work.get(id);
    if (work) {
      if (status === 'abandoned') work.abandoned++;
      work.lost += root.expectedRevenue;
    }
    root.status = status;
    root.nodeId = id;
    this.totals[status]++;
    this.totals.lost += root.expectedRevenue;
    const type = this.types.get(root.typeId)!;
    type[status]++;
    type.lost += root.expectedRevenue;
    this.emit(status === 'abandoned' ? 'PARTICLE_ABANDONED' : 'PARTICLE_FAILED', {
      particleId: root.id,
      particleTypeId: root.typeId,
      nodeId: id,
      rootParticleId: root.id,
      amount: root.expectedRevenue,
      reason,
    });
    this.retire(root);
    this.captureCash();
  }
  private finish(p: Particle, node: Extract<SimulationNode, { type: 'outcome' }>) {
    if (node.outcome.status !== 'completed') {
      this.fail(p, node.id, node.outcome.status);
      return;
    }
    let revenue = node.outcome.revenue ? (node.outcome.revenueOverride ?? p.expectedRevenue) : 0;
    for (const feature of this.features(node.id)) revenue *= feature.revenueMultiplier ?? 1;
    if (node.outcome.revenue) {
      const revenueChange = revenue - p.expectedRevenue;
      p.expectedRevenue = revenue;
      this.totals.expected += revenueChange;
      this.processes.expectedRevenueChanged(p.id, revenueChange);
      this.types.get(p.typeId)!.expected += revenueChange;
    }
    p.status = 'completed';
    this.activity.get(node.id)!.completed++;
    this.activity.get(node.id)!.revenue += revenue;
    p.realizedRevenue = revenue;
    p.completedAtSeconds = sec(this.clock);
    this.totals.completed++;
    this.totals.revenue += revenue;
    this.completedAt = this.clock;
    const elapsed = sec(this.clock - ms(p.createdAtSeconds));
    this.cycle.add(elapsed);
    const type = this.types.get(p.typeId)!;
    type.completed++;
    type.revenue += revenue;
    type.cycle.add(elapsed);
    let route = p.route.label();
    if (!this.routes.has(route) && this.routes.size >= 256) route = '[other routes]';
    const routeStats = this.routes.get(route) ?? {
      count: 0,
      ttr: new Distribution(),
      cycle: new Distribution(),
    };
    routeStats.count++;
    routeStats.cycle.add(elapsed);
    this.routes.set(route, routeStats);
    if (revenue > 0) {
      p.timeToRevenueSeconds = elapsed;
      this.ttr.add(elapsed);
      type.ttr.add(elapsed);
      routeStats.ttr.add(elapsed);
      this.emit('REVENUE_REALIZED', {
        particleId: p.id,
        particleTypeId: p.typeId,
        nodeId: node.id,
        amount: revenue,
      });
    }
    for (const id of p.route.workNodeIds) {
      const w = this.work.get(id);
      if (w) w.revenue += revenue;
    }
    this.retire(p);
    this.captureCash();
  }
  private retire(p: Particle, branchFailure?: 'abandoned' | 'failed') {
    p.completedAtSeconds = sec(this.clock);
    p.pendingAdmission = undefined;
    this.processes.retire(p, this.clock, branchFailure);
    this.active.delete(p.id);
    if (this.particleLimit) this.retained.push(this.snapshot(p));
  }
  private snapshot(p: Particle): ParticleSnapshot {
    const {
      entered: _entered,
      started: _started,
      workCostIntegralStart: _workCostIntegralStart,
      route: _route,
      resources: _resources,
      visits: _visits,
      ...result
    } = p;
    return { ...result, history: result.history.map((h) => ({ ...h })) };
  }
  private scalingRule(s: WorkState | ResourceState, resource: boolean) {
    return resource ? (s as ResourceState).resource.scaling : (s as WorkState).node.work.scaling;
  }
  private minimumCapacity(s: WorkState | ResourceState, resource: boolean) {
    const hardMinimum = resource ? (s as ResourceState).resource.minCapacity : undefined;
    return Math.max(
      hardMinimum ?? 0,
      this.scalingRule(s, resource)?.minCapacity ?? hardMinimum ?? s.initial,
    );
  }
  private checkScale(s: WorkState | ResourceState, id: string, resource: boolean) {
    const rule = this.scalingRule(s, resource);
    if (!rule) return;
    if (s.scaling) {
      if (s.lowSince !== undefined && s.queue > 0) {
        s.scaleToken++;
        s.scaling = false;
        s.lowSince = undefined;
      } else return;
    }
    const utilization = s.capacity ? s.busy / s.capacity : 0;
    const overloaded =
      (rule.queueAbove !== undefined && s.queue > rule.queueAbove) ||
      (rule.utilizationAbove !== undefined && utilization > rule.utilizationAbove);
    if (
      overloaded &&
      s.capacity < rule.maxCapacity &&
      this.clock - s.lastScale >= ms(rule.cooldownSeconds ?? 60)
    ) {
      s.scaling = true;
      s.lowSince = undefined;
      s.scaleToken++;
      this.schedule(
        resource ? 'resource-scale' : 'work-scale',
        id,
        this.clock + ms(rule.startupSeconds ?? 0),
        1,
        undefined,
        s.scaleToken,
        Math.min(rule.maxCapacity, s.capacity + (rule.increment ?? 1)),
      );
      return;
    }
    const minimum = this.minimumCapacity(s, resource);
    if (
      rule.utilizationBelow !== undefined &&
      utilization < rule.utilizationBelow &&
      s.queue === 0 &&
      s.capacity > minimum
    ) {
      if (s.lowSince === undefined) {
        s.lowSince = this.clock;
        s.scaleToken++;
        this.schedule(
          resource ? 'resource-down' : 'work-down',
          id,
          this.clock + ms(rule.scaleDownAfterSeconds ?? 3600),
          1,
          undefined,
          s.scaleToken,
        );
      }
    } else if (s.lowSince !== undefined) {
      s.lowSince = undefined;
      s.scaleToken++;
    }
    if (overloaded && s.capacity < rule.maxCapacity && !s.scaling)
      this.schedule(
        resource ? 'resource-check' : 'work-check',
        id,
        Math.max(this.clock + 1, s.lastScale + ms(rule.cooldownSeconds ?? 60)),
        1,
      );
  }
  private changeCapacity(
    s: WorkState | ResourceState,
    id: string,
    resource: boolean,
    value: number,
  ) {
    const rule = this.scalingRule(s, resource)!;
    this.touch(s);
    const previous = s.capacity,
      rate = this.rate(s);
    s.capacity = value;
    s.scaling = false;
    s.lastScale = this.clock;
    s.lowSince = undefined;
    const delta = this.rate(s) - rate;
    if (resource) this.resourceRate += delta;
    else this.workRate += delta;
    if (value > previous) {
      const cost = (rule.scaleUpCost ?? 0) * (value - previous);
      s.scaleCost += cost;
      this.totals.scaling += cost;
    }
    this.emit(value > previous ? 'CAPACITY_SCALE_UP' : 'CAPACITY_SCALE_DOWN', {
      [resource ? 'resourceId' : 'nodeId']: id,
      capacity: value,
      previousCapacity: previous,
      amount: value > previous ? (rule.scaleUpCost ?? 0) * (value - previous) : 0,
    });
    this.captureCash();
    if (resource) for (const node of (s as ResourceState).waiters) this.mark(node);
    else this.mark(id);
    this.checkScale(s, id, resource);
  }
  private handle(event: EngineEvent) {
    const p = event.particle === undefined ? undefined : this.active.get(event.particle);
    if (event.kind === 'budget' && event.token === this.budgetToken) {
      this.status = 'failed';
      this.message = 'Maximum simulation budget reached.';
    } else if (event.kind === 'source') this.source(event);
    else if (event.kind === 'arrival' && p) this.enter(p, event.id);
    else if (event.kind === 'finish' && p && p.status === 'processing')
      this.processFinished(p, event.id);
    else if (
      event.kind === 'abandon' &&
      p &&
      p.status === 'queued' &&
      p.nodeId === event.id &&
      p.entered === event.token
    )
      this.abandon(p, event.id, 'Patience exceeded.');
    else if (event.kind === 'dispatch') this.dispatch();
    else if (
      event.kind.includes('-scale') ||
      event.kind.includes('-down') ||
      event.kind.includes('-check')
    ) {
      const resource = event.kind.startsWith('resource'),
        s = resource ? this.resources.get(event.id) : this.work.get(event.id);
      if (!s) return;
      const rule = this.scalingRule(s, resource);
      if (!rule) return;
      if (event.kind.endsWith('-check')) this.checkScale(s, event.id, resource);
      else if (event.token === s.scaleToken) {
        if (event.kind.endsWith('-scale')) this.changeCapacity(s, event.id, resource, event.value!);
        else if (
          s.lowSince !== undefined &&
          s.queue === 0 &&
          s.busy / s.capacity < (rule.utilizationBelow ?? 0)
        ) {
          const value = Math.max(
            this.minimumCapacity(s, resource),
            s.capacity - (rule.increment ?? 1),
          );
          if (s.busy > value)
            this.schedule(event.kind, event.id, this.clock + 1000, 1, undefined, event.token);
          else if ((rule.shutdownSeconds ?? 0) > 0 && event.value === undefined) {
            s.scaling = true;
            this.schedule(
              event.kind,
              event.id,
              this.clock + ms(rule.shutdownSeconds!),
              1,
              undefined,
              event.token,
              value,
            );
          } else this.changeCapacity(s, event.id, resource, event.value ?? value);
        }
      }
    } else if (event.kind.endsWith('-open') || event.kind.endsWith('-close')) {
      const resource = event.kind.startsWith('resource'),
        id = event.id.slice(0, event.id.lastIndexOf('|')),
        s = resource ? this.resources.get(id) : this.work.get(id);
      if (!s) return;
      this.touch(s);
      const before = this.rate(s);
      s.scheduled = isOpen(
        resource ? (s as ResourceState).resource.schedule : (s as WorkState).node.work.schedule,
        this.clock,
      );
      const delta = this.rate(s) - before;
      if (resource) this.resourceRate += delta;
      else this.workRate += delta;
      if (s.scheduled) {
        if (resource) for (const waiting of (s as ResourceState).waiters) this.mark(waiting);
        else this.mark(id);
      }
      this.captureCash();
      if (
        event.value !== undefined &&
        (this.options.untilComplete ||
          event.at + ms(event.value) <= ms(this.options.durationSeconds))
      )
        this.schedule(
          event.kind,
          event.id,
          event.at + ms(event.value),
          0,
          undefined,
          undefined,
          event.value,
        );
    }
  }
  nextEventTime(): number | undefined {
    const next = this.queue.peek();
    return next ? sec(next.at) : undefined;
  }
  getStatus(): SimulationState['status'] {
    return this.status;
  }
  /** true means this requested horizon has been reached, or execution has ended. */
  advance(untilSeconds: number, eventBudget = Infinity, exactTime = false): boolean {
    if (this.status === 'completed' || this.status === 'failed' || this.status === 'stopped')
      return true;
    if (
      !Number.isFinite(untilSeconds) ||
      untilSeconds < 0 ||
      (!Number.isFinite(eventBudget) && eventBudget !== Infinity) ||
      eventBudget <= 0
    )
      throw new Error('Invalid simulation advancement target or event budget.');
    this.status = 'running';
    let budget = 0;
    const duration = ms(this.options.durationSeconds),
      requested = ms(untilSeconds),
      drain = !exactTime && this.options.untilComplete && requested >= duration,
      target = exactTime ? requested : drain ? Infinity : Math.min(requested, duration);
    while (this.queue.peek() && this.queue.peek()!.at <= target) {
      const event = this.queue.pop()!;
      if (event.kind === 'source') this.scheduledSources--;
      if (event.kind === 'source' && event.at >= duration && event.at !== 0) continue;
      this.moveTime(event.at);
      this.handle(event);
      this.processedEvents++;
      if (
        this.eventSequence >= simulationExecutionLimits.semanticEvents ||
        this.processedEvents >= simulationExecutionLimits.semanticEvents
      ) {
        this.status = 'failed';
        this.message =
          'Simulation event limit reached. Reduce duration/arrivals or remove looping routes.';
      }
      budget++;
      if (this.getStatus() === 'failed') {
        this.captureCash();
        return true;
      }
      if (
        this.model.economics?.maximumBudget !== undefined &&
        this.totals.operating +
          this.totals.resource +
          this.totals.scaling +
          this.totals.investment >
          this.model.economics.maximumBudget
      ) {
        this.status = 'failed';
        this.message = 'Maximum simulation budget exceeded.';
        this.captureCash();
        return true;
      }
      if (
        this.options.untilComplete &&
        !exactTime &&
        this.active.size === 0 &&
        this.scheduledSources === 0
      ) {
        this.complete();
        return true;
      }
      if (budget >= eventBudget) return false;
    }
    if (
      this.options.untilComplete &&
      !exactTime &&
      this.active.size === 0 &&
      this.scheduledSources === 0
    ) {
      this.complete();
      return true;
    }
    if (drain) {
      if (this.active.size) {
        this.status = 'failed';
        this.message =
          'Remaining work cannot progress: unavailable capacity or no future resource availability.';
        this.captureCash();
      } else this.complete();
      return true;
    }
    this.moveTime(Math.max(this.clock, target), false);
    if (
      this.options.untilComplete
        ? this.active.size === 0 && this.scheduledSources === 0
        : target >= duration
    )
      this.complete();
    return true;
  }
  private complete() {
    this.moveTime(this.clock);
    this.status = 'completed';
    this.emit('SIMULATION_COMPLETED');
    this.captureCash();
  }
  private queueMetrics(s: Meter): QueueMetrics {
    return {
      current: s.queue,
      average: this.clock ? (s.queueArea + s.queue * (this.clock - s.last)) / this.clock : 0,
      maximum: s.maximumQueue,
      wait: s.wait.metrics(),
    };
  }
  private utilization(s: Meter) {
    const area =
      s.capacityArea +
      (s.scheduled ? s.capacity : Math.min(s.capacity, s.busy)) * (this.clock - s.last);
    return area ? (s.busyArea + s.busy * (this.clock - s.last)) / area : 0;
  }
  private nodeMetrics(w: WorkState): NodeMetrics {
    const economic = finishEconomics({
      ...zeroEconomics(),
      expectedRevenue: w.expected,
      realizedRevenue: w.revenue,
      operatingCost: w.cost + (this.rate(w) * (this.clock - w.last)) / 3600000 + w.perParticleCost,
      scalingCost: w.scaleCost,
      lostRevenue: w.lost,
    });
    const blocked = w.queue > 0 && w.busy < w.capacity && !this.canStart(w, this.head(w)!);
    return {
      ...economic,
      id: w.node.id,
      name: w.node.name,
      type: 'work',
      capacity: w.capacity,
      maximumCapacity: w.node.work.scaling?.maxCapacity ?? w.capacity,
      busy: w.busy,
      utilization: this.utilization(w),
      currentUtilization: w.capacity ? w.busy / w.capacity : 0,
      queue: this.queueMetrics(w),
      started: w.started,
      completed: w.completed,
      abandoned: w.abandoned,
      throughputPerHour: this.clock ? (w.completed * 3600000) / this.clock : 0,
      status: w.scaling
        ? 'scaling'
        : blocked
          ? 'blocked'
          : w.busy >= w.capacity && w.queue > 0
            ? 'saturated'
            : w.capacity && w.busy / w.capacity > 0.85
              ? 'busy'
              : w.busy
                ? 'normal'
                : 'idle',
      resourceUsage: Object.fromEntries(
        this.requirements(w).map((r) => [r.resourceId, r.units * w.busy]),
      ),
    };
  }
  state(): SimulationState {
    return projectSimulationState({
      activity: this.activity,
      model: this.model,
      clock: this.clock,
      accountedClock: this.accountedClock,
      work: this.work,
      resources: this.resources,
      types: this.types,
      active: this.active,
      retained: this.retained,
      events: this.events,
      totals: this.totals,
      workRate: this.workRate,
      resourceRate: this.resourceRate,
      queueLength: this.queueLength,
      queueArea: this.queueArea,
      maximumQueue: this.maximumQueue,
      particleLimit: this.particleLimit,
      droppedEvents: this.droppedEvents,
      message: this.message,
      status: this.status,
      wait: this.wait,
      ttr: this.ttr,
      cycle: this.cycle,
      processing: this.processing,
      nodeMetrics: (w) => this.nodeMetrics(w),
      utilization: (s) => this.utilization(s),
      queueMetrics: (s) => this.queueMetrics(s),
      rate: (s) => this.rate(s),
      snapshot: (p) => this.snapshot(p),
      parallel: this.parallel.state(this.particleLimit),
      joinMetrics: (id) => this.parallel.joinMetrics(id),
      joinQueueMetrics: (id) => this.parallel.queueMetrics(id, this.clock),
      processMetrics: (nodes, bottlenecks) =>
        this.processes.project({
          clock: this.clock,
          nodes,
          bottlenecks,
          work: this.work,
          resources: this.resources,
          unitCostRate: (resource) => this.unitCostRate(resource),
        }),
    });
  }
  result(): SimulationResult {
    this.captureCash();
    return {
      ...this.state(),
      runId: this.runId,
      durationSeconds: this.options.durationSeconds,
      seed: this.options.seed,
      scenarioId: this.options.scenarioId ?? null,
      demandMultiplier: this.options.demandMultiplier,
      modelHash: this.hash,
      completedAtSeconds: this.completedAt === null ? null : sec(this.completedAt),
      finalCapacities: Object.fromEntries(
        [...this.work]
          .map(([id, w]) => [id, w.capacity])
          .concat([...this.resources].map(([id, r]) => [id, r.capacity])),
      ),
      routeMetrics: Object.fromEntries(
        [...this.routes].map(([id, r]) => [
          id,
          { count: r.count, ttr: r.ttr.metrics(), cycleTime: r.cycle.metrics() },
        ]),
      ),
      cashTimeline: this.cash.map((p) => ({ ...p })),
      retention: {
        particleLimit: this.particleLimit,
        eventLimit: this.eventLimit,
        cashPointResolutionSeconds: this.cash.reduce(
          (max, p, i) => Math.max(max, i ? p.timeSeconds - this.cash[i - 1].timeSeconds : 0),
          0,
        ),
      },
    };
  }
}
export function runSimulation(model: SimulationModel, options: RunOptions = {}): SimulationResult {
  const engine = new SimulationEngine(model, options);
  while (!engine.advance(options.durationSeconds ?? model.defaults.durationSeconds, 100000)) {}
  return engine.result();
}
