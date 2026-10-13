import { StorageError } from '../model/errors';
import { historyJsonBytes } from '../history/codec';
import type { SimulationModel, SimulationResult, SimulationState } from './types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
const statuses = ['ready', 'running', 'paused', 'stopped', 'completed', 'failed'];
const bottleneckMethods = [
  'queue-history',
  'blocked-admission',
  'bandwidth-sharing',
  'bandwidth-unavailable',
  'energy-shortfall',
];
const eventTypes = new Set([
  'PARTICLE_CREATED',
  'QUEUE_ENTERED',
  'QUEUE_LEFT',
  'PROCESS_STARTED',
  'PROCESS_COMPLETED',
  'PROCESS_CANCELLED',
  'RESOURCE_ACQUIRED',
  'RESOURCE_RELEASED',
  'PARTICLE_ROUTED',
  'PARTICLE_ABANDONED',
  'PARTICLE_FAILED',
  'PARTICLE_FORKED',
  'BRANCH_JOINED',
  'JOIN_COMPLETED',
  'BRANCH_CANCELLED',
  'CAPACITY_SCALE_UP',
  'CAPACITY_SCALE_DOWN',
  'REVENUE_REALIZED',
  'COST_INCURRED',
  'SIMULATION_COMPLETED',
]);
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new StorageError(422, 'Invalid archived simulation state.');
}
function fields(value: unknown, names: string[]): asserts value is RecordValue {
  requireValue(object(value) && names.every((name) => finite(value[name])));
}
function distribution(value: unknown) {
  fields(value, ['count', 'average', 'median', 'p50', 'maximum', 'resolutionSeconds']);
  requireValue(
    (value.p95 === null || finite(value.p95)) &&
      (value.p99 === null || finite(value.p99)) &&
      typeof value.approximate === 'boolean',
  );
}
function queue(value: unknown) {
  fields(value, ['current', 'average', 'maximum']);
  distribution(value.wait);
}
function economic(value: unknown) {
  fields(value, [
    'expectedRevenue',
    'realizedRevenue',
    'operatingCost',
    'resourceCost',
    'scalingCost',
    'investmentCost',
    'cost',
    'contribution',
    'cumulativeCashImpact',
    'lostRevenue',
  ]);
}
function values(value: unknown, visit: (entry: RecordValue, key: string) => void) {
  requireValue(object(value));
  for (const [key, entry] of Object.entries(value)) {
    requireValue(object(entry));
    visit(entry, key);
  }
}
function list(value: unknown, visit: (entry: RecordValue) => void) {
  requireValue(Array.isArray(value));
  for (const entry of value) {
    requireValue(object(entry));
    visit(entry);
  }
}

function nonnegativeFields(value: unknown, names: string[]) {
  fields(value, names);
  requireValue(names.every((name) => (value[name] as number) >= 0));
}

function infrastructure(value: unknown) {
  requireValue(object(value) && value.schemaVersion === 1);
  values(value.cpu, (entry) =>
    nonnegativeFields(entry, [
      'reservedCores',
      'peakReservedCores',
      'coreSeconds',
      'completedWorkCoreSeconds',
    ]),
  );
  values(value.memory, (entry) => {
    nonnegativeFields(entry, [
      'usedMiB',
      'peakUsedMiB',
      'caseLeases',
      'stageLeases',
      'allocatedMiBSeconds',
    ]);
    requireValue(Number.isSafeInteger(entry.caseLeases) && Number.isSafeInteger(entry.stageLeases));
  });
  values(value.bandwidth, (entry) => {
    nonnegativeFields(entry, [
      'activeTransfers',
      'peakActiveTransfers',
      'transferredBytes',
      'usedMbps',
      'busySeconds',
    ]);
    requireValue(
      Number.isSafeInteger(entry.activeTransfers) &&
        Number.isSafeInteger(entry.peakActiveTransfers),
    );
  });
  values(value.energy, (entry) => {
    nonnegativeFields(entry, [
      'generatedKWh',
      'gridImportedKWh',
      'deliveredKWh',
      'storedKWh',
      'stateOfCharge',
      'chargeInputKWh',
      'dischargeOutputKWh',
      'conversionLossKWh',
      'curtailedKWh',
      'unservedKWh',
      'activeLoads',
      'suppliedKW',
      'unmetKW',
      'gridCost',
    ]);
    requireValue((entry.stateOfCharge as number) <= 1 && Number.isSafeInteger(entry.activeLoads));
  });
}

/** Retained metrics must belong to the immutable model captured with the run. */
export function assertArchivedInfrastructureModel(state: SimulationState, model: SimulationModel) {
  if (!model.infrastructure) {
    requireValue(state.infrastructure === undefined && state.failureCode === undefined);
    return;
  }
  requireValue(state.infrastructure);
  const resourceIds = new Set(model.resources.map((resource) => resource.id));
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  requireValue(
    Object.values(state.nodes).every(
      (node) => node.blockedResourceIds?.every((id) => resourceIds.has(id)) ?? true,
    ),
  );
  requireValue(
    Object.values(state.resources).every(
      (resource) => resource.blockedNodeIds?.every((id) => nodeIds.has(id)) ?? true,
    ),
  );
  for (const kind of ['cpu', 'memory', 'bandwidth', 'energy'] as const) {
    const expected = new Set(
      model.resources
        .filter((resource) => resource.infrastructure?.kind === kind)
        .map((resource) => resource.id),
    );
    const actual = Object.keys(state.infrastructure[kind]);
    requireValue(actual.length === expected.size && actual.every((id) => expected.has(id)));
  }
}

/** Check archived data before remapping or exposing it to replay and metrics UI. */
export function assertArchivedState(value: unknown): asserts value is SimulationState {
  requireValue(
    object(value) &&
      finite(value.timeSeconds) &&
      value.timeSeconds >= 0 &&
      statuses.includes(value.status as string),
  );
  const state = value;
  if (state.infrastructure !== undefined) infrastructure(state.infrastructure);
  requireValue(
    state.failureCode === undefined ||
      (state.failureCode === 'SIMULATION_INFRASTRUCTURE_STALLED' &&
        state.status === 'failed' &&
        state.infrastructure !== undefined),
  );
  economic(state.metrics);
  fields(state.metrics, [
    'created',
    'completed',
    'abandoned',
    'failed',
    'inSystem',
    'throughputPerHour',
  ]);
  requireValue(state.metrics.currentBottleneck === null || text(state.metrics.currentBottleneck));
  queue(state.metrics.queue);
  for (const key of ['ttr', 'cycleTime', 'processing']) distribution(state.metrics[key]);
  values(state.nodes, (node, key) => {
    economic(node);
    fields(node, [
      'capacity',
      'maximumCapacity',
      'busy',
      'utilization',
      'currentUtilization',
      'started',
      'completed',
      'abandoned',
      'throughputPerHour',
    ]);
    requireValue(
      node.id === key &&
        text(node.name) &&
        ['source', 'work', 'router', 'fork', 'join', 'resource', 'outcome'].includes(
          node.type as string,
        ) &&
        ['idle', 'normal', 'busy', 'saturated', 'blocked', 'scaling', 'failed'].includes(
          node.status as string,
        ) &&
        object(node.resourceUsage) &&
        Object.values(node.resourceUsage).every(finite),
    );
    queue(node.queue);
    if (node.blockedResourceIds !== undefined)
      requireValue(Array.isArray(node.blockedResourceIds) && node.blockedResourceIds.every(text));
    if (node.join !== undefined) {
      fields(node.join, [
        'waitingGroups',
        'arrivedBranches',
        'expectedBranches',
        'completedGroups',
        'cancelledGroups',
      ]);
      distribution(node.join.wait);
    }
  });
  values(state.resources, (resource, key) => {
    fields(resource, [
      'capacity',
      'maximumCapacity',
      'busy',
      'utilization',
      'currentUtilization',
      'cost',
      'scalingCost',
    ]);
    requireValue(
      resource.id === key &&
        text(resource.name) &&
        Array.isArray(resource.waitingNodeIds) &&
        resource.waitingNodeIds.every(text),
    );
    queue(resource.queue);
    if (resource.blockedNodeIds !== undefined)
      requireValue(Array.isArray(resource.blockedNodeIds) && resource.blockedNodeIds.every(text));
  });
  if (state.processes !== undefined)
    values(state.processes, (process, key) => {
      economic(process);
      fields(process, [
        'entered',
        'completed',
        'exited',
        'terminalCompleted',
        'abandoned',
        'failed',
        'inSystem',
        'throughputPerHour',
        'utilization',
        'currentUtilization',
      ]);
      requireValue(
        process.id === key &&
          text(process.name) &&
          (process.parentId === undefined || text(process.parentId)) &&
          (process.currentBottleneck === null || text(process.currentBottleneck)) &&
          process.resourceCostAllocation === 'occupied-units' &&
          ['idle', 'normal', 'busy', 'saturated', 'blocked', 'scaling', 'failed'].includes(
            process.status as string,
          ) &&
          object(process.resourceUsage) &&
          Object.values(process.resourceUsage).every(finite),
      );
      for (const field of ['nodeIds', 'childProcessIds', 'resourceIds'])
        requireValue(Array.isArray(process[field]) && process[field].every(text));
      queue(process.queue);
      for (const field of ['cycleTime', 'ttr', 'processing']) distribution(process[field]);
      list(process.bottlenecks, (bottleneck) => {
        requireValue(
          bottleneck.methodology === undefined ||
            bottleneckMethods.includes(bottleneck.methodology as string),
        );
        fields(bottleneck, ['score', 'utilization', 'averageQueue', 'averageWaitSeconds']);
        requireValue(
          text(bottleneck.id) &&
            text(bottleneck.name) &&
            ['node', 'resource'].includes(bottleneck.kind as string) &&
            typeof bottleneck.reason === 'string',
        );
      });
    });
  values(state.particleTypes, (type, key) => {
    economic(type);
    fields(type, ['created', 'completed', 'abandoned', 'failed', 'inSystem']);
    requireValue(type.id === key && text(type.name));
    for (const field of ['wait', 'ttr', 'cycleTime']) distribution(type[field]);
  });
  list(state.particles, (particle) => {
    fields(particle, [
      'id',
      'createdAtSeconds',
      'complexity',
      'priority',
      'expectedRevenue',
      'realizedRevenue',
      'accumulatedCost',
      'waitingSeconds',
      'processingSeconds',
    ]);
    requireValue(
      text(particle.typeId) &&
        text(particle.nodeId) &&
        [
          'queued',
          'processing',
          'transit',
          'waiting',
          'joined',
          'cancelled',
          'completed',
          'abandoned',
          'failed',
        ].includes(particle.status as string),
    );
    for (const field of [
      'queueEnteredAtSeconds',
      'processingStartedAtSeconds',
      'processingEndsAtSeconds',
      'completedAtSeconds',
      'timeToRevenueSeconds',
      'departedAtSeconds',
      'arrivesAtSeconds',
    ])
      requireValue(particle[field] === undefined || finite(particle[field]));
    requireValue(
      particle.transferProgress === undefined ||
        (finite(particle.transferProgress) &&
          particle.transferProgress >= 0 &&
          particle.transferProgress <= 1),
    );
    requireValue(particle.edgeId === undefined || text(particle.edgeId));
    for (const field of ['rootParticleId', 'parentParticleId', 'forkGroupId'])
      requireValue(
        particle[field] === undefined ||
          (finite(particle[field]) && Number.isSafeInteger(particle[field]) && particle[field] > 0),
      );
    for (const field of ['forkNodeId', 'joinNodeId', 'branchEdgeId'])
      requireValue(particle[field] === undefined || text(particle[field]));
    list(particle.history, (visit) => {
      fields(visit, ['enteredAtSeconds']);
      requireValue(
        text(visit.nodeId) && (visit.leftAtSeconds === undefined || finite(visit.leftAtSeconds)),
      );
    });
  });
  list(state.events, (event) => {
    fields(event, ['sequence', 'timeSeconds']);
    requireValue(eventTypes.has(event.type as string));
    for (const key of [
      'nodeId',
      'edgeId',
      'resourceId',
      'particleTypeId',
      'forkNodeId',
      'joinNodeId',
      'branchEdgeId',
    ])
      requireValue(event[key] === undefined || text(event[key]));
    for (const key of [
      'particleId',
      'amount',
      'capacity',
      'previousCapacity',
      'rootParticleId',
      'parentParticleId',
      'forkGroupId',
      'branchCount',
      'arrivedBranches',
    ])
      requireValue(event[key] === undefined || finite(event[key]));
  });
  list(state.bottlenecks, (bottleneck) => {
    requireValue(
      bottleneck.methodology === undefined ||
        bottleneckMethods.includes(bottleneck.methodology as string),
    );
    fields(bottleneck, ['score', 'utilization', 'averageQueue', 'averageWaitSeconds']);
    requireValue(
      text(bottleneck.id) &&
        text(bottleneck.name) &&
        ['node', 'resource'].includes(bottleneck.kind as string) &&
        typeof bottleneck.reason === 'string',
    );
  });
  fields(state.retained, ['activeParticles', 'completedParticles', 'events', 'droppedEvents']);
  if (state.parallel !== undefined) {
    fields(state.parallel, [
      'activeGroups',
      'activeBranches',
      'waitingParents',
      'createdBranches',
      'joinedBranches',
      'cancelledBranches',
      'droppedGroups',
    ]);
    list(state.parallel.groups, (group) => {
      fields(group, ['groupId', 'rootParticleId', 'parentParticleId', 'createdAtSeconds']);
      requireValue(text(group.forkNodeId) && text(group.joinNodeId));
      requireValue(Array.isArray(group.branchParticleIds) && group.branchParticleIds.every(finite));
      for (const field of ['arrivedBranchEdgeIds', 'pendingBranchEdgeIds'])
        requireValue(Array.isArray(group[field]) && group[field].every(text));
    });
  }
  historyJsonBytes(state, 32 * 1024 * 1024);
}

export function assertArchivedResult(value: unknown): asserts value is SimulationResult {
  assertArchivedState(value);
  const result = value as unknown as RecordValue;
  fields(result, ['durationSeconds', 'seed', 'demandMultiplier']);
  requireValue(
    text(result.runId) &&
      text(result.modelHash) &&
      (result.scenarioId === null || text(result.scenarioId)) &&
      (result.completedAtSeconds === null || finite(result.completedAtSeconds)) &&
      object(result.finalCapacities) &&
      Object.values(result.finalCapacities).every(finite),
  );
  values(result.routeMetrics, (route) => {
    fields(route, ['count']);
    distribution(route.ttr);
    distribution(route.cycleTime);
  });
  list(result.cashTimeline, (cash) =>
    fields(cash, [
      'timeSeconds',
      'revenue',
      'operatingCost',
      'resourceCost',
      'scalingCost',
      'investmentCost',
    ]),
  );
  fields(result.retention, ['particleLimit', 'eventLimit', 'cashPointResolutionSeconds']);
}
