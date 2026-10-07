import { StorageError } from '../model/errors';
import type { Graph } from '../model/types';
import type { RunOptions, SimulationModel, SimulationState } from '../simulation/types';
import { validateSimulationModel, resolveScenario } from '../simulation/schema';
import { setSimulationModel } from '../simulation/document';
import { ProcessHierarchy } from '../simulation/process-hierarchy';
import {
  MAX_CAPACITY_CARDS_PER_BANK,
  MAX_ADDITIONAL_CAPACITY_CARDS,
} from '../simulation/capacity-projection';

export interface SimulationRepository {
  getGraph(id: string): Promise<Graph>;
  saveGraph(graph: Graph, baseVersion: number): Promise<Graph>;
}
export type SimulationStartOptions = RunOptions & {
  speed?: 1 | 10 | 100 | 'max';
  animated?: boolean;
  origin?: 'api' | 'ui';
};
export interface SimulationRuntime {
  start(
    diagramId: string,
    model: SimulationModel,
    options: SimulationStartOptions,
  ): Promise<unknown>;
  list(diagramId: string): Promise<unknown>;
  get(runId: string): Promise<unknown>;
  state(runId: string): Promise<SimulationState>;
  result(runId: string): Promise<unknown>;
  events(runId: string, options: { offset: number; limit: number }): Promise<unknown>;
  control(
    runId: string,
    action: 'pause' | 'resume' | 'stop' | 'reset',
    options?: { origin?: 'api' | 'ui' },
  ): Promise<unknown>;
  setSpeed(runId: string, speed: 1 | 10 | 100 | 'max'): Promise<unknown>;
  seek(runId: string, timeSeconds: number, options?: { origin?: 'api' | 'ui' }): Promise<unknown>;
  compare(runIds: string[]): Promise<unknown>;
}
const collections = {
  nodes: 'nodes',
  edges: 'edges',
  'particle-types': 'particleTypes',
  resources: 'resources',
  improvements: 'improvements',
  scenarios: 'scenarios',
  processes: 'processes',
} as const;
type Collection = (typeof collections)[keyof typeof collections];
type Entity = { id: string; [key: string]: unknown };

/** Additive structured errors preserve the existing REST/MCP error string. */
export class SimulationCommandError extends StorageError {
  readonly code: string;
  readonly issues: { path: string; code: string; message: string }[];
  constructor(status: number, message: string, path = '', code = 'SIMULATION_INVALID_INPUT') {
    super(status, message);
    this.code = code;
    this.issues = [{ path, code, message }];
  }
}
export const simulationCapabilities = {
  type: 'process-simulator',
  schemaVersion: 1,
  apiVersion: '0.3.0',
  engine: 'deterministic-discrete-event',
  timeUnit: 'second',
  currency: 'one configurable currency per model',
  nodeTypes: ['source', 'work', 'router', 'resource', 'outcome'],
  queueDisciplines: ['fifo', 'priority'],
  arrivalDistributions: ['regular', 'poisson'],
  routingModes: ['first-match', 'weighted', 'least-queue', 'available-capacity'],
  speeds: [1, 10, 100, 'max'],
  features: [
    'semantic-crud',
    'hierarchical-processes',
    'process-drilldown',
    'shared-resources',
    'queues',
    'abandonment',
    'complexity',
    'scaling',
    'schedules',
    'improvements',
    'economics',
    'time-to-revenue',
    'scenarios',
    'comparison',
    'payback',
    'seeded-random',
    'replay',
    'headless',
    'bounded-particle-rendering',
    'native-capacity-card-projection',
    'local-persistence',
  ],
  hierarchy: {
    processCollection: 'processes',
    parentField: 'processes[].parentId',
    nodeMembershipField: 'nodes[].processId',
    missingProcesses: 'empty-hierarchy',
    maximumProcesses: 50000,
    maximumDepth: 128,
    execution: 'same-global-engine-and-shared-resource-pools',
    projection: 'read-only-process-cards-and-boundary-edges',
    metrics: {
      scope: 'direct-members-and-all-descendant-processes',
      completed: 'successful-scope-visits-including-exits-and-terminal-outcomes',
      terminalCompleted: 'successful-final-outcomes-inside-scope',
      cycleTime: 'scope-entry-to-exit-or-terminal-outcome',
      ttr: 'scope-entry-to-revenue-producing-terminal-outcome',
      aggregation: 'parent-and-child-totals-overlap-do-not-sum',
      distributions: 'computed-from-scope-observations-never-summed-node-quantiles',
      resourceCostAllocation: 'occupied-units',
      sharedResourceOverhead: 'idle-scaling-and-investment-pool-costs-remain-global',
    },
  },
  visualCapacity: {
    view: '2d',
    representation: 'full-native-cards',
    readOnly: true,
    sharedLogicalModel: true,
    persistentUnitIdentity: false,
    occupancy: 'actual-aggregate-busy',
    queueDisplay: 'shared-at-first-card',
    limits: {
      cardsPerBank: MAX_CAPACITY_CARDS_PER_BANK,
      additionalCards: MAX_ADDITIONAL_CAPACITY_CARDS,
    },
    overflow: 'explicit-aggregate-label',
    spatialView: 'logical-model',
  },
  execution: {
    browserRequired: true,
    activeCanvasRequired: false,
    animationRequired: false,
    limits: {
      activeParticles: 200000,
      semanticEvents: 50000000,
      routeVisits: 10000,
      activeRuns: 4,
      cachedRuns: 60,
    },
    limitBehavior: {
      activeParticlesAndEvents: 'failed run with an explicit message and partial metrics',
      routeVisits: 'failed particle with a semantic event',
      activeRuns:
        '409 rejection before starting another execution or replay worker; paused resident workers and startup reservations count',
    },
  },
  permissions: { inspection: 'read', comparison: 'read', mutationsAndRuns: 'write' },
  transport: { envelopeBytes: 32 * 1024 * 1024, asynchronousRuns: true, eventPageMaximum: 1000 },
  retention: {
    configurable: true,
    completedParticlesBounded: true,
    eventsBounded: true,
    metricsIncludeAllParticles: true,
  },
};

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SimulationCommandError(422, 'Provide a simulation command object.');
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new SimulationCommandError(422, `Only ${keys.join(', ')} are accepted.`);
  return value as Record<string, unknown>;
}
function version(value: unknown): number {
  if (value === undefined || value === null)
    throw new SimulationCommandError(
      428,
      'Provide the current baseVersion.',
      'baseVersion',
      'VERSION_REQUIRED',
    );
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new SimulationCommandError(422, 'baseVersion must be a positive integer.', 'baseVersion');
  return value as number;
}
function query(url: URL, allowed: string[]) {
  if (
    url.hash ||
    [...url.searchParams.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => url.searchParams.getAll(key).length > 1)
  )
    throw new SimulationCommandError(422, 'Unknown or repeated simulation query parameter.');
}
function nonnegative(value: unknown, path: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new SimulationCommandError(
      422,
      `${path} must be a nonnegative ${integer ? 'integer' : 'number'}.`,
      path,
    );
  return value;
}
function startOptions(value: unknown): SimulationStartOptions {
  const data = object(value, [
    'durationSeconds',
    'seed',
    'scenarioId',
    'demandMultiplier',
    'untilComplete',
    'speed',
    'animated',
  ]);
  if (data.durationSeconds !== undefined) {
    const duration = nonnegative(data.durationSeconds, 'durationSeconds');
    if (duration <= 0 || duration > 315360000)
      throw new SimulationCommandError(
        422,
        'durationSeconds must be positive and at most ten simulated years.',
        'durationSeconds',
      );
  }
  if (data.seed !== undefined && (!Number.isSafeInteger(data.seed) || (data.seed as number) < 0))
    throw new SimulationCommandError(422, 'seed must be a nonnegative safe integer.', 'seed');
  if (data.demandMultiplier !== undefined) nonnegative(data.demandMultiplier, 'demandMultiplier');
  if (data.scenarioId !== undefined && (typeof data.scenarioId !== 'string' || !data.scenarioId))
    throw new SimulationCommandError(422, 'scenarioId must be a nonempty string.', 'scenarioId');
  if (data.speed !== undefined && ![1, 10, 100, 'max'].includes(data.speed as 1 | 10 | 100 | 'max'))
    throw new SimulationCommandError(422, 'Choose speed 1, 10, 100 or max.', 'speed');
  for (const key of ['animated', 'untilComplete'])
    if (data[key] !== undefined && typeof data[key] !== 'boolean')
      throw new SimulationCommandError(422, `${key} must be boolean.`, key);
  return data as SimulationStartOptions;
}
function merged(
  previous: Record<string, unknown>,
  patch: Record<string, unknown>,
  preserveNull = false,
  scenarioRoot = false,
): Record<string, unknown> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && !preserveNull) {
      delete result[key];
      continue;
    }
    const before = Object.hasOwn(previous, key) ? previous[key] : undefined;
    const keepMarkers = preserveNull || (scenarioRoot && key === 'overrides');
    const next =
      value && typeof value === 'object' && !Array.isArray(value)
        ? merged(
            before && typeof before === 'object' && !Array.isArray(before)
              ? (before as Record<string, unknown>)
              : {},
            value as Record<string, unknown>,
            keepMarkers,
          )
        : value;
    Object.defineProperty(result, key, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
function entities(model: SimulationModel, collection: Collection): Entity[] {
  return (model[collection] ?? []) as unknown as Entity[];
}
function readModel(graph: Graph): SimulationModel {
  if (graph.diagram.type !== 'process-simulator' || !graph.simulation)
    throw new SimulationCommandError(
      422,
      'This document is not a Process Simulator.',
      'diagram.type',
      'SIMULATION_DOCUMENT_REQUIRED',
    );
  return graph.simulation;
}
function assertModel(value: unknown): asserts value is SimulationModel {
  try {
    validateSimulationModel(value);
  } catch (error) {
    const details = error as { message?: string; issues?: unknown };
    if (Array.isArray(details.issues) && details.issues.length) throw error;
    throw new SimulationCommandError(
      422,
      details.message ?? 'The simulation model is invalid.',
      'model',
      'SIMULATION_INVALID_MODEL',
    );
  }
}
async function defaultRuntime(): Promise<SimulationRuntime> {
  const { simulationService } = await import('../simulation/service');
  return simulationService;
}

/** Repository boundary shared by UI edits and external REST/MCP commands. */
export async function simulationCommand(
  repo: SimulationRepository,
  diagramId: string,
  parts: string[],
  url: URL,
  method: string,
  payload?: unknown,
  beforeWrite?: () => Promise<void>,
  runtime?: SimulationRuntime,
): Promise<unknown> {
  const graph = await repo.getGraph(diagramId);
  const model = readModel(graph);
  const action = parts[3];
  if (parts.length === 3) {
    query(url, []);
    if (method === 'GET') return structuredClone(model);
    if (method !== 'PUT')
      throw new SimulationCommandError(405, 'Use GET or PUT for the simulation model.');
    const data = object(payload, ['baseVersion', 'model']);
    const baseVersion = version(data.baseVersion);
    assertModel(data.model);
    await beforeWrite?.();
    return repo.saveGraph(setSimulationModel(graph, data.model), baseVersion);
  }
  if (action === 'compare' && parts.length === 4) {
    query(url, []);
    if (method !== 'POST') throw new SimulationCommandError(405, 'Comparison requires POST.');
    const data = object(payload, ['runIds']);
    if (
      !Array.isArray(data.runIds) ||
      data.runIds.length < 2 ||
      data.runIds.length > 20 ||
      data.runIds.some((id) => typeof id !== 'string' || !id) ||
      new Set(data.runIds).size !== data.runIds.length
    )
      throw new SimulationCommandError(422, 'Compare 2 through 20 distinct run IDs.', 'runIds');
    const service = runtime ?? (await defaultRuntime());
    for (const id of data.runIds) await ownedRun(service, diagramId, id);
    return service.compare(data.runIds as string[]);
  }
  if (action === 'hierarchy') {
    if (parts.length !== 4)
      throw new SimulationCommandError(404, 'Unknown simulation hierarchy endpoint.');
    query(url, []);
    if (method !== 'GET')
      throw new SimulationCommandError(405, 'Simulation hierarchy requires GET.');
    const hierarchy = new ProcessHierarchy(model);
    const directNodeIds = new Map<string, string[]>();
    for (const node of model.nodes) {
      if (node.processId === undefined) continue;
      const members = directNodeIds.get(node.processId) ?? [];
      members.push(node.id);
      directNodeIds.set(node.processId, members);
    }
    return {
      rootProcessIds: [...hierarchy.children()],
      processes: [...hierarchy.processes.values()].map((process) => ({
        ...structuredClone(process),
        childProcessIds: [...hierarchy.children(process.id)],
        nodeIds: [...hierarchy.nodeIds(process.id)],
        directNodeIds: directNodeIds.get(process.id) ?? [],
      })),
    };
  }
  if (action === 'runs')
    return runCommand(
      runtime ?? (await defaultRuntime()),
      graph,
      model,
      parts,
      url,
      method,
      payload,
      beforeWrite,
    );
  if (action === 'economics' || action === 'defaults' || action === 'retention') {
    if (parts.length !== 4)
      throw new SimulationCommandError(404, 'Unknown simulation configuration endpoint.');
    query(url, []);
    if (method === 'GET') return structuredClone(model[action] ?? {});
    if (method !== 'PUT')
      throw new SimulationCommandError(405, 'Use GET or PUT for simulation configuration.');
    const data = object(payload, ['baseVersion', 'value']);
    const baseVersion = version(data.baseVersion);
    const next = { ...model, [action]: object(data.value) };
    assertModel(next);
    await beforeWrite?.();
    return repo.saveGraph(setSimulationModel(graph, next), baseVersion);
  }
  if (!Object.hasOwn(collections, action) || parts.length > 5)
    throw new SimulationCommandError(404, 'Unknown simulation endpoint.');
  const collection = collections[action as keyof typeof collections];
  const entityId = parts[4] === undefined ? undefined : semanticId(parts[4]);
  const current = entities(model, collection);
  const index = entityId === undefined ? -1 : current.findIndex((value) => value.id === entityId);
  if (entityId !== undefined && index < 0)
    throw new SimulationCommandError(
      404,
      'Simulation entity not found.',
      action,
      'SIMULATION_ENTITY_NOT_FOUND',
    );
  if (method === 'GET') {
    query(url, []);
    return structuredClone(entityId === undefined ? current : current[index]);
  }
  let baseVersion: number;
  let nextEntities: Entity[];
  if (method === 'DELETE' && entityId !== undefined) {
    query(url, ['baseVersion']);
    baseVersion = version(
      url.searchParams.has('baseVersion') ? Number(url.searchParams.get('baseVersion')) : undefined,
    );
    if (
      collection === 'processes' &&
      (model.nodes.some((node) => node.processId === entityId) ||
        (model.processes ?? []).some((process) => process.parentId === entityId))
    )
      throw new SimulationCommandError(
        422,
        'Reassign member nodes and child processes in an atomic model PUT before deleting this process.',
        `processes.${entityId}`,
        'SIMULATION_PROCESS_REFERENCED',
      );
    nextEntities = current.filter((value) => value.id !== entityId);
  } else if (
    (method === 'POST' && entityId === undefined) ||
    (method === 'PATCH' && entityId !== undefined)
  ) {
    query(url, []);
    const data = object(payload, ['baseVersion', 'value']);
    baseVersion = version(data.baseVersion);
    const value = object(data.value);
    if (entityId !== undefined && value.id !== undefined && value.id !== entityId)
      throw new SimulationCommandError(422, 'An entity ID cannot be changed.', `${action}.id`);
    const id = entityId ?? value.id ?? crypto.randomUUID();
    if (typeof id !== 'string' || !id.trim())
      throw new SimulationCommandError(422, 'Provide a nonempty semantic ID.', `${action}.id`);
    if (entityId === undefined && current.some((entry) => entry.id === id))
      throw new SimulationCommandError(
        409,
        'This simulation entity ID already exists.',
        `${action}.id`,
        'SIMULATION_ID_CONFLICT',
      );
    const entity = {
      ...(entityId === undefined
        ? value
        : merged(current[index], value, false, collection === 'scenarios')),
      id,
    } as Entity;
    nextEntities =
      entityId === undefined
        ? [...current, entity]
        : current.map((entry, i) => (i === index ? entity : entry));
  } else
    throw new SimulationCommandError(
      405,
      'Use GET, collection POST, entity PATCH or entity DELETE.',
    );
  const next = { ...model, [collection]: nextEntities } as SimulationModel;
  if (method === 'DELETE' && collection === 'nodes')
    next.edges = next.edges.filter(
      (edge) => edge.sourceNodeId !== entityId && edge.targetNodeId !== entityId,
    );
  assertModel(next);
  await beforeWrite?.();
  const saved = await repo.saveGraph(setSimulationModel(graph, next), baseVersion);
  return method === 'DELETE' ? undefined : saved;
}
async function ownedRun(service: SimulationRuntime, diagramId: string, id: string) {
  const run = (await service.get(id)) as { diagramId?: string } | null;
  if (!run || run.diagramId !== diagramId)
    throw new SimulationCommandError(
      404,
      'Simulation run not found in this document.',
      'runId',
      'SIMULATION_RUN_NOT_FOUND',
    );
  return run;
}
function semanticId(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new SimulationCommandError(422, 'A semantic ID contains invalid URL encoding.');
  }
}
async function runCommand(
  service: SimulationRuntime,
  graph: Graph,
  model: SimulationModel,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  beforeWrite?: () => Promise<void>,
) {
  if (parts.length === 4) {
    query(url, []);
    if (method === 'GET') return service.list(graph.diagram.id);
    if (method !== 'POST')
      throw new SimulationCommandError(405, 'Use GET or POST for simulation runs.');
    const options = startOptions(payload);
    try {
      assertModel({
        ...resolveScenario(model, options.scenarioId, options.demandMultiplier),
        scenarios: [],
      });
    } catch (error) {
      if (error instanceof SimulationCommandError) throw error;
      throw new SimulationCommandError(
        422,
        (error as Error).message,
        'scenarioId',
        'SIMULATION_INVALID_MODEL',
      );
    }
    await beforeWrite?.();
    return service.start(graph.diagram.id, structuredClone(model), { ...options, origin: 'api' });
  }
  const runId = semanticId(parts[4]);
  await ownedRun(service, graph.diagram.id, runId);
  if (parts.length === 5 && method === 'GET') {
    query(url, []);
    return service.get(runId);
  }
  const action = parts[5];
  if (method === 'POST' && parts.length === 6) {
    query(url, []);
    if (action === 'speed') {
      const data = object(payload, ['speed']);
      if (![1, 10, 100, 'max'].includes(data.speed as 1 | 10 | 100 | 'max'))
        throw new SimulationCommandError(422, 'Choose speed 1, 10, 100 or max.', 'speed');
      await beforeWrite?.();
      return service.setSpeed(runId, data.speed as 1 | 10 | 100 | 'max');
    }
    if (action === 'seek') {
      const data = object(payload, ['timeSeconds']);
      const timeSeconds = nonnegative(data.timeSeconds, 'timeSeconds');
      await beforeWrite?.();
      return service.seek(runId, timeSeconds, { origin: 'api' });
    }
    if (!['pause', 'resume', 'stop', 'reset'].includes(action))
      throw new SimulationCommandError(404, 'Unknown simulation control.');
    object(payload, []);
    await beforeWrite?.();
    return action === 'reset'
      ? service.control(runId, 'reset', { origin: 'api' })
      : service.control(runId, action as 'pause' | 'resume' | 'stop');
  }
  if (method !== 'GET')
    throw new SimulationCommandError(405, 'Simulation inspection requires GET.');
  if (action === 'events' && parts.length === 6) {
    query(url, ['offset', 'limit']);
    const offset = nonnegative(Number(url.searchParams.get('offset') ?? 0), 'offset', true);
    const limit = nonnegative(Number(url.searchParams.get('limit') ?? 100), 'limit', true);
    if (limit < 1 || limit > 1000)
      throw new SimulationCommandError(422, 'Event page limit must be 1 through 1000.', 'limit');
    return service.events(runId, { offset, limit });
  }
  query(url, []);
  if (parts.length === 6 && action === 'result') return service.result(runId);
  const state = await service.state(runId);
  if (parts.length === 6) {
    if (action === 'state') return state;
    if (action === 'metrics') return state.metrics;
    if (action === 'bottlenecks') return state.bottlenecks;
    if (action === 'queues')
      return {
        nodes: Object.fromEntries(
          Object.entries(state.nodes).map(([id, value]) => [id, value.queue]),
        ),
        resources: Object.fromEntries(
          Object.entries(state.resources).map(([id, value]) => [id, value.queue]),
        ),
        processes: Object.fromEntries(
          Object.entries(state.processes ?? {}).map(([id, value]) => [id, value.queue]),
        ),
      };
    if (action === 'nodes') return state.nodes;
    if (action === 'resources') return state.resources;
    if (action === 'particle-types') return state.particleTypes;
    if (action === 'processes') return state.processes ?? {};
  }
  if (
    parts.length === 7 &&
    ['nodes', 'resources', 'particle-types', 'processes'].includes(action)
  ) {
    const values =
      action === 'processes'
        ? (state.processes ?? {})
        : action === 'particle-types'
          ? state.particleTypes
          : action === 'nodes'
            ? state.nodes
            : state.resources;
    const value = Object.hasOwn(values, semanticId(parts[6]))
      ? values[semanticId(parts[6])]
      : undefined;
    if (!value) throw new SimulationCommandError(404, 'Simulation metrics entity not found.');
    return value;
  }
  throw new SimulationCommandError(404, 'Unknown simulation run endpoint.');
}
