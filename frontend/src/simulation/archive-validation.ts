import { StorageError } from '../model/errors';
import { historyJsonBytes } from '../history/codec';
import type { SimulationResult, SimulationState } from './types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
const statuses = ['ready', 'running', 'paused', 'stopped', 'completed', 'failed'];
const eventTypes = new Set([
  'PARTICLE_CREATED',
  'QUEUE_ENTERED',
  'QUEUE_LEFT',
  'PROCESS_STARTED',
  'PROCESS_COMPLETED',
  'RESOURCE_ACQUIRED',
  'RESOURCE_RELEASED',
  'PARTICLE_ROUTED',
  'PARTICLE_ABANDONED',
  'PARTICLE_FAILED',
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

/** Check archived data before remapping or exposing it to replay and metrics UI. */
export function assertArchivedState(value: unknown): asserts value is SimulationState {
  requireValue(
    object(value) &&
      finite(value.timeSeconds) &&
      value.timeSeconds >= 0 &&
      statuses.includes(value.status as string),
  );
  const state = value;
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
        ['source', 'work', 'router', 'resource', 'outcome'].includes(node.type as string) &&
        ['idle', 'normal', 'busy', 'saturated', 'blocked', 'scaling', 'failed'].includes(
          node.status as string,
        ) &&
        object(node.resourceUsage) &&
        Object.values(node.resourceUsage).every(finite),
    );
    queue(node.queue);
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
        ['queued', 'processing', 'transit', 'completed', 'abandoned', 'failed'].includes(
          particle.status as string,
        ),
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
    requireValue(particle.edgeId === undefined || text(particle.edgeId));
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
    for (const key of ['nodeId', 'edgeId', 'resourceId', 'particleTypeId'])
      requireValue(event[key] === undefined || text(event[key]));
    for (const key of ['particleId', 'amount', 'capacity', 'previousCapacity'])
      requireValue(event[key] === undefined || finite(event[key]));
  });
  list(state.bottlenecks, (bottleneck) => {
    fields(bottleneck, ['score', 'utilization', 'averageQueue', 'averageWaitSeconds']);
    requireValue(
      text(bottleneck.id) &&
        text(bottleneck.name) &&
        ['node', 'resource'].includes(bottleneck.kind as string) &&
        typeof bottleneck.reason === 'string',
    );
  });
  fields(state.retained, ['activeParticles', 'completedParticles', 'events', 'droppedEvents']);
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
