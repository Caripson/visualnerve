/** Public simulation values use seconds, one document currency and semantic IDs. */
export interface ScheduleWindow {
  startSeconds: number;
  endSeconds: number;
  /** Repeat this window, for example 86,400 seconds for a daily opening schedule. */
  repeatSeconds?: number;
}
export interface ScalingRule {
  minCapacity?: number;
  maxCapacity: number;
  increment?: number;
  queueAbove?: number;
  utilizationAbove?: number;
  utilizationBelow?: number;
  scaleDownAfterSeconds?: number;
  cooldownSeconds?: number;
  startupSeconds?: number;
  shutdownSeconds?: number;
  scaleUpCost?: number;
  additionalCostPerHour?: number;
}
export interface ParticleType {
  id: string;
  name: string;
  color: string;
  shape?: 'circle' | 'square' | 'triangle';
  revenue: number;
  complexity: { min: number; max: number };
  priority: number;
  patienceSeconds?: number;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, string | number | boolean>;
}
export interface SourceConfiguration {
  particleTypeId: string;
  ratePerHour?: number;
  burst?: number;
  maxCount?: number;
  distribution?: 'regular' | 'poisson';
  schedule?: ScheduleWindow[];
  startSeconds?: number;
}
export interface ResourceRequirement {
  resourceId: string;
  units: number;
}
export interface WorkConfiguration {
  processingSeconds: number;
  capacity: number;
  costPerHour?: number;
  costPerParticle?: number;
  queueLimit?: number;
  queueDiscipline?: 'fifo' | 'priority';
  resourceRequirements?: ResourceRequirement[];
  complexityMultiplier?: number;
  acceptedParticleTypeIds?: string[];
  overflowNodeId?: string;
  scaling?: ScalingRule;
  schedule?: ScheduleWindow[];
}
export type RoutingCondition =
  | { field: 'particleTypeId'; operator: 'eq' | 'neq'; value: string }
  | {
      field: 'complexity' | 'priority' | 'revenue';
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      field: 'attribute';
      key: string;
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      value: string | number | boolean;
    }
  | {
      field: 'queue' | 'availableCapacity' | 'utilization';
      nodeId?: string;
      resourceId?: string;
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    };
export interface RoutingRule {
  edgeId: string;
  condition?: RoutingCondition;
  weight?: number;
}
export interface RouterConfiguration {
  mode: 'first-match' | 'weighted' | 'least-queue' | 'available-capacity';
  rules?: RoutingRule[];
  fallbackEdgeId?: string;
}
export interface OutcomeConfiguration {
  status: 'completed' | 'failed' | 'rejected';
  revenue: boolean;
  revenueOverride?: number;
}
/** Organizational scope; all execution assumptions live on its actual child nodes. */
export interface SimulationProcess {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
}
export type SimulationNode = {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  processId?: string;
} & (
  | { type: 'source'; source: SourceConfiguration }
  | { type: 'work'; work: WorkConfiguration }
  | { type: 'router'; router: RouterConfiguration }
  | { type: 'resource'; resourceId: string }
  | { type: 'outcome'; outcome: OutcomeConfiguration }
);
export interface SimulationEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  travelSeconds?: number;
  particleTypeIds?: string[];
  weight?: number;
}
export interface Resource {
  id: string;
  name: string;
  capacity: number;
  minCapacity?: number;
  maxCapacity?: number;
  unit: string;
  costPerHour?: number;
  schedule?: ScheduleWindow[];
  scaling?: ScalingRule;
  metadata?: Record<string, unknown>;
}
export interface Improvement {
  id: string;
  name: string;
  enabled: boolean;
  nodeId?: string;
  resourceId?: string;
  investmentCost: number;
  operatingCostPerHour?: number;
  /** 0.65 means processing takes 65% of its previous time. */
  processingTimeMultiplier?: number;
  resourceUnitsMultiplier?: number;
  capacityIncrease?: number;
  costMultiplier?: number;
  revenueMultiplier?: number;
  failureProbability?: number;
  failureNodeId?: string;
}
/** In override objects, null removes a property; arrays replace complete values. */
export type ScenarioPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: ScenarioPatch<T[K]> | null }
    : T;
export interface ScenarioOverrides {
  processes?: Record<string, ScenarioPatch<SimulationProcess>>;
  economics?: ScenarioPatch<{ maximumBudget?: number }> | null;
  nodes?: Record<string, ScenarioPatch<SimulationNode>>;
  edges?: Record<string, ScenarioPatch<SimulationEdge>>;
  particleTypes?: Record<string, ScenarioPatch<ParticleType>>;
  resources?: Record<string, ScenarioPatch<Resource>>;
  improvements?: Record<string, ScenarioPatch<Improvement>>;
}
export interface Scenario {
  id: string;
  name: string;
  description?: string;
  demandMultiplier?: number;
  overrides: ScenarioOverrides;
}
export interface SimulationModel {
  type: 'process-simulator';
  schemaVersion: 1;
  currency: string;
  particleTypes: ParticleType[];
  /** Optional for compatibility with existing schemaVersion 1 documents. */
  processes?: SimulationProcess[];
  nodes: SimulationNode[];
  edges: SimulationEdge[];
  resources: Resource[];
  improvements: Improvement[];
  scenarios: Scenario[];
  defaults: { durationSeconds: number; seed: number };
  economics?: { maximumBudget?: number };
  retention?: { particles?: number; events?: number; checkpoints?: number };
  description?: string;
}
export interface RunOptions {
  durationSeconds?: number;
  seed?: number;
  scenarioId?: string;
  demandMultiplier?: number;
  untilComplete?: boolean;
  runId?: string;
}
export interface DistributionMetrics {
  count: number;
  average: number;
  median: number;
  p50: number;
  p95: number | null;
  p99: number | null;
  maximum: number;
  approximate: boolean;
  /** Maximum absolute percentile error is one histogram bucket at large counts. */
  resolutionSeconds: number;
}
export interface QueueMetrics {
  current: number;
  average: number;
  maximum: number;
  wait: DistributionMetrics;
}
export interface EconomicMetrics {
  expectedRevenue: number;
  realizedRevenue: number;
  operatingCost: number;
  resourceCost: number;
  scalingCost: number;
  investmentCost: number;
  cost: number;
  contribution: number;
  cumulativeCashImpact: number;
  lostRevenue: number;
}
export interface SimulationMetrics extends EconomicMetrics {
  created: number;
  completed: number;
  abandoned: number;
  failed: number;
  inSystem: number;
  throughputPerHour: number;
  queue: QueueMetrics;
  ttr: DistributionMetrics;
  cycleTime: DistributionMetrics;
  processing: DistributionMetrics;
  currentBottleneck: string | null;
}
export interface NodeMetrics extends EconomicMetrics {
  id: string;
  type: SimulationNode['type'];
  name: string;
  capacity: number;
  maximumCapacity: number;
  busy: number;
  utilization: number;
  currentUtilization: number;
  queue: QueueMetrics;
  started: number;
  completed: number;
  abandoned: number;
  throughputPerHour: number;
  status: 'idle' | 'normal' | 'busy' | 'saturated' | 'blocked' | 'scaling' | 'failed';
  resourceUsage: Record<string, number>;
}
/** Rollup of actual work in a scope and every nested subprocess. Parent and child totals overlap. */
export interface ProcessMetrics extends EconomicMetrics {
  id: string;
  name: string;
  parentId?: string;
  nodeIds: string[];
  childProcessIds: string[];
  resourceIds: string[];
  resourceUsage: Record<string, number>;
  entered: number;
  /** Successful scope visits, including boundary exits and final outcomes. */
  completed: number;
  /** Successful visits that left this scope and continued elsewhere. */
  exited: number;
  /** Final successful outcomes that occurred inside this scope. */
  terminalCompleted: number;
  abandoned: number;
  failed: number;
  inSystem: number;
  throughputPerHour: number;
  queue: QueueMetrics;
  cycleTime: DistributionMetrics;
  /** Scope-entry to revenue-producing terminal outcome. */
  ttr: DistributionMetrics;
  processing: DistributionMetrics;
  utilization: number;
  currentUtilization: number;
  status: NodeMetrics['status'];
  currentBottleneck: string | null;
  bottlenecks: Bottleneck[];
  /** Only occupied shared-resource units are allocated; idle/scale/investment pool costs stay global. */
  resourceCostAllocation: 'occupied-units';
}
export interface ResourceMetrics {
  id: string;
  name: string;
  capacity: number;
  maximumCapacity: number;
  busy: number;
  utilization: number;
  currentUtilization: number;
  queue: QueueMetrics;
  cost: number;
  scalingCost: number;
  waitingNodeIds: string[];
}
export interface ParticleTypeMetrics extends EconomicMetrics {
  id: string;
  name: string;
  created: number;
  completed: number;
  abandoned: number;
  failed: number;
  inSystem: number;
  wait: DistributionMetrics;
  ttr: DistributionMetrics;
  cycleTime: DistributionMetrics;
}
export interface ParticleSnapshot {
  /** Awaiting atomic admission at the current zero-time event phase; not in the queue yet. */
  pendingAdmission?: boolean;
  id: number;
  typeId: string;
  createdAtSeconds: number;
  nodeId: string;
  status: 'queued' | 'processing' | 'transit' | 'completed' | 'abandoned' | 'failed';
  complexity: number;
  priority: number;
  expectedRevenue: number;
  realizedRevenue: number;
  accumulatedCost: number;
  waitingSeconds: number;
  processingSeconds: number;
  queueEnteredAtSeconds?: number;
  processingStartedAtSeconds?: number;
  processingEndsAtSeconds?: number;
  completedAtSeconds?: number;
  timeToRevenueSeconds?: number;
  edgeId?: string;
  departedAtSeconds?: number;
  arrivesAtSeconds?: number;
  history: { nodeId: string; enteredAtSeconds: number; leftAtSeconds?: number }[];
}
export type SimulationEventType =
  | 'PARTICLE_CREATED'
  | 'QUEUE_ENTERED'
  | 'QUEUE_LEFT'
  | 'PROCESS_STARTED'
  | 'PROCESS_COMPLETED'
  | 'RESOURCE_ACQUIRED'
  | 'RESOURCE_RELEASED'
  | 'PARTICLE_ROUTED'
  | 'PARTICLE_ABANDONED'
  | 'PARTICLE_FAILED'
  | 'CAPACITY_SCALE_UP'
  | 'CAPACITY_SCALE_DOWN'
  | 'REVENUE_REALIZED'
  | 'COST_INCURRED'
  | 'SIMULATION_COMPLETED';
export interface SimulationEvent {
  sequence: number;
  timeSeconds: number;
  type: SimulationEventType;
  particleId?: number;
  particleTypeId?: string;
  nodeId?: string;
  resourceId?: string;
  edgeId?: string;
  amount?: number;
  capacity?: number;
  previousCapacity?: number;
  reason?: string;
}
export interface Bottleneck {
  id: string;
  kind: 'node' | 'resource';
  name: string;
  score: number;
  utilization: number;
  averageQueue: number;
  averageWaitSeconds: number;
  reason: string;
}
export interface CashPoint {
  timeSeconds: number;
  revenue: number;
  operatingCost: number;
  /** Per-item charges jump at this timestamp; remaining operating costs accrue continuously. */
  operatingCostFixed?: number;
  resourceCost: number;
  scalingCost: number;
  investmentCost: number;
}
export interface SimulationState {
  timeSeconds: number;
  status: 'ready' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  metrics: SimulationMetrics;
  nodes: Record<string, NodeMetrics>;
  resources: Record<string, ResourceMetrics>;
  particleTypes: Record<string, ParticleTypeMetrics>;
  /** Older saved runs may omit this; current engine snapshots always provide it. */
  processes?: Record<string, ProcessMetrics>;
  particles: ParticleSnapshot[];
  events: SimulationEvent[];
  bottlenecks: Bottleneck[];
  retained: {
    activeParticles: number;
    completedParticles: number;
    events: number;
    droppedEvents: number;
  };
  message?: string;
}
export interface SimulationResult extends SimulationState {
  runId: string;
  durationSeconds: number;
  seed: number;
  scenarioId: string | null;
  demandMultiplier: number;
  modelHash: string;
  completedAtSeconds: number | null;
  finalCapacities: Record<string, number>;
  routeMetrics: Record<
    string,
    { count: number; ttr: DistributionMetrics; cycleTime: DistributionMetrics }
  >;
  cashTimeline: CashPoint[];
  retention: { particleLimit: number; eventLimit: number; cashPointResolutionSeconds: number };
}
export interface SimulationComparison {
  baselineRunId: string;
  scenarioRunId: string;
  baseline: SimulationMetrics;
  scenario: SimulationMetrics;
  delta: { [K in keyof EconomicMetrics]: number } & {
    completed: number;
    abandoned: number;
    averageWaitSeconds: number;
    averageTtrSeconds: number;
    maximumQueue: number;
  };
  incrementalCashImpact: number;
  paybackTimeSeconds: number | null;
  paybackReached: boolean;
  comparable: boolean;
  warnings: string[];
}
