import { StorageError } from '../model/errors';
import type { SimulationModel, ScalingRule, ScheduleWindow, SimulationNode } from './types';
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new StorageError(422, `Simulation: ${message}`);
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function keys(value: unknown, allowed: string[], label: string) {
  requireValue(object(value), `${label} must be an object.`);
  requireValue(
    Object.keys(value).every((key) => allowed.includes(key)),
    `${label} contains an unsupported field.`,
  );
}
function number(v: unknown, name: string, minimum = 0, integer = false) {
  requireValue(
    typeof v === 'number' &&
      Number.isFinite(v) &&
      v >= minimum &&
      (!integer || Number.isSafeInteger(v)),
    `${name} must be ${integer ? 'an integer' : 'finite'} and at least ${minimum}.`,
  );
}
function optional(v: unknown, name: string, minimum = 0, integer = false) {
  if (v !== undefined) number(v, name, minimum, integer);
}
function schedule(v: ScheduleWindow[] | undefined) {
  if (v === undefined) return;
  requireValue(Array.isArray(v), 'schedule must be an array.');
  for (const w of v) {
    requireValue(object(w), 'invalid schedule window.');
    keys(w, ['startSeconds', 'endSeconds', 'repeatSeconds'], 'schedule window');
    number(w.startSeconds, 'schedule start');
    number(w.endSeconds, 'schedule end');
    requireValue(w.endSeconds > w.startSeconds, 'schedule end must follow start.');
    optional(w.repeatSeconds, 'schedule repeat', w.endSeconds);
  }
}
function scaling(v: ScalingRule | undefined, capacity: number) {
  if (v === undefined) return;
  requireValue(object(v), 'invalid scaling rule.');
  keys(
    v,
    [
      'minCapacity',
      'maxCapacity',
      'increment',
      'queueAbove',
      'utilizationAbove',
      'utilizationBelow',
      'scaleDownAfterSeconds',
      'cooldownSeconds',
      'startupSeconds',
      'shutdownSeconds',
      'scaleUpCost',
      'additionalCostPerHour',
    ],
    'scaling rule',
  );
  number(v.maxCapacity, 'maximum capacity', capacity, true);
  optional(v.minCapacity, 'minimum capacity', 0, true);
  requireValue(
    (v.minCapacity ?? capacity) <= v.maxCapacity && (v.minCapacity ?? capacity) <= capacity,
    'minimum capacity exceeds current or maximum capacity.',
  );
  optional(v.increment, 'scale increment', 1, true);
  optional(v.queueAbove, 'queue threshold');
  for (const key of ['utilizationAbove', 'utilizationBelow'] as const)
    if (v[key] !== undefined) {
      number(v[key], key);
      requireValue(v[key]! <= 1, `${key} must be between 0 and 1.`);
    }
  for (const key of [
    'scaleDownAfterSeconds',
    'cooldownSeconds',
    'startupSeconds',
    'shutdownSeconds',
    'scaleUpCost',
    'additionalCostPerHour',
  ] as const)
    optional(v[key], key);
}
function validate(value: unknown, includeScenarios: boolean): asserts value is SimulationModel {
  requireValue(
    object(value) && value.type === 'process-simulator' && value.schemaVersion === 1,
    'unsupported document type or schema version.',
  );
  const model = value as unknown as SimulationModel;
  keys(
    model,
    [
      'type',
      'schemaVersion',
      'currency',
      'particleTypes',
      'nodes',
      'edges',
      'resources',
      'improvements',
      'scenarios',
      'defaults',
      'economics',
      'retention',
      'description',
    ],
    'model',
  );
  requireValue(
    typeof model.currency === 'string' && /^[A-Z]{3}$/.test(model.currency),
    'currency must be a three-letter currency code.',
  );
  requireValue(object(model.defaults), 'defaults are required.');
  keys(model.defaults, ['durationSeconds', 'seed'], 'defaults');
  number(model.defaults.durationSeconds, 'duration', 0.001);
  number(model.defaults.seed, 'seed', 0, true);
  requireValue(model.defaults.durationSeconds <= 315360000, 'duration exceeds ten years.');
  for (const key of [
    'nodes',
    'edges',
    'resources',
    'particleTypes',
    'improvements',
    'scenarios',
  ] as const) {
    requireValue(Array.isArray(model[key]), `${key} must be an array.`);
    const ids = new Set<string>();
    for (const item of model[key]) {
      requireValue(
        object(item) &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          item.id.length <= 300 &&
          !ids.has(item.id),
        `${key} contains an invalid or duplicate ID.`,
      );
      ids.add(item.id);
    }
  }
  requireValue(
    model.nodes.length <= 50000 && model.edges.length <= 200000,
    'topology exceeds the supported limits.',
  );
  const nodes = new Map(model.nodes.map((n) => [n.id, n])),
    types = new Set(model.particleTypes.map((p) => p.id)),
    resources = new Map(model.resources.map((r) => [r.id, r])),
    edges = new Map(model.edges.map((e) => [e.id, e]));
  for (const type of model.particleTypes) {
    keys(
      type,
      [
        'id',
        'name',
        'color',
        'shape',
        'revenue',
        'complexity',
        'priority',
        'patienceSeconds',
        'metadata',
        'attributes',
      ],
      'particle type',
    );
    requireValue(typeof type.name === 'string' && !!type.name.trim(), 'particle name is required.');
    requireValue(
      typeof type.color === 'string' &&
        /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(type.color),
      'particle color must be hex.',
    );
    requireValue(
      type.shape === undefined || ['circle', 'square', 'triangle'].includes(type.shape),
      'unsupported particle shape.',
    );
    keys(type.complexity, ['min', 'max'], 'complexity');
    number(type.revenue, 'particle revenue');
    number(type.priority, 'particle priority');
    optional(type.patienceSeconds, 'patience');
    requireValue(object(type.complexity), 'particle complexity is required.');
    number(type.complexity.min, 'complexity minimum', 0.000001);
    number(type.complexity.max, 'complexity maximum', type.complexity.min);
    requireValue(
      type.metadata === undefined || object(type.metadata),
      'particle metadata must be an object.',
    );
    requireValue(
      type.attributes === undefined || object(type.attributes),
      'particle attributes must be an object.',
    );
    if (type.attributes)
      requireValue(
        Object.values(type.attributes).every(
          (v) =>
            typeof v === 'string' ||
            typeof v === 'boolean' ||
            (typeof v === 'number' && Number.isFinite(v)),
        ),
        'particle attributes must contain finite primitive values.',
      );
  }
  for (const resource of model.resources) {
    keys(
      resource,
      [
        'id',
        'name',
        'capacity',
        'minCapacity',
        'maxCapacity',
        'unit',
        'costPerHour',
        'schedule',
        'scaling',
        'metadata',
      ],
      'resource',
    );
    requireValue(
      typeof resource.name === 'string' &&
        !!resource.name.trim() &&
        typeof resource.unit === 'string',
      'resource name and unit are required.',
    );
    number(resource.capacity, 'resource capacity', 0, true);
    optional(resource.minCapacity, 'minimum capacity', 0, true);
    optional(resource.maxCapacity, 'maximum capacity', resource.capacity, true);
    requireValue(
      (resource.minCapacity ?? 0) <= resource.capacity,
      'resource minimum exceeds capacity.',
    );
    optional(resource.costPerHour, 'resource cost');
    schedule(resource.schedule);
    scaling(resource.scaling, resource.capacity);
    if (resource.scaling) {
      const minimum = resource.scaling.minCapacity ?? resource.minCapacity ?? resource.capacity;
      requireValue(
        minimum >= (resource.minCapacity ?? 0),
        'scaling minimum falls below resource minimum.',
      );
      requireValue(
        minimum <= resource.scaling.maxCapacity,
        'scaling minimum exceeds scaling maximum.',
      );
    }
    if (resource.scaling && resource.maxCapacity !== undefined)
      requireValue(
        resource.scaling.maxCapacity <= resource.maxCapacity,
        'scaling maximum exceeds resource maximum.',
      );
  }
  for (const node of model.nodes) {
    keys(
      node,
      [
        'id',
        'name',
        'description',
        'metadata',
        'type',
        ...(node.type === 'source'
          ? ['source']
          : node.type === 'work'
            ? ['work']
            : node.type === 'router'
              ? ['router']
              : node.type === 'resource'
                ? ['resourceId']
                : ['outcome']),
      ],
      'node',
    );
    requireValue(typeof node.name === 'string' && !!node.name.trim(), 'node name is required.');
    if (node.type === 'source') {
      requireValue(
        object(node.source) && types.has(node.source.particleTypeId),
        'unknown source particle type.',
      );
      keys(
        node.source,
        [
          'particleTypeId',
          'ratePerHour',
          'burst',
          'maxCount',
          'distribution',
          'schedule',
          'startSeconds',
        ],
        'source',
      );
      optional(node.source.ratePerHour, 'arrival rate');
      optional(node.source.burst, 'burst', 0, true);
      optional(node.source.maxCount, 'maximum count', 0, true);
      optional(node.source.startSeconds, 'arrival start');
      schedule(node.source.schedule);
      requireValue(
        node.source.distribution === undefined ||
          ['regular', 'poisson'].includes(node.source.distribution),
        'unknown arrival distribution.',
      );
    } else if (node.type === 'work') {
      const w = node.work;
      requireValue(object(w), 'work configuration is required.');
      number(w.processingSeconds, 'processing time', 0.001);
      number(w.capacity, 'work capacity', 0, true);
      keys(
        w,
        [
          'processingSeconds',
          'capacity',
          'costPerHour',
          'costPerParticle',
          'queueLimit',
          'queueDiscipline',
          'resourceRequirements',
          'complexityMultiplier',
          'acceptedParticleTypeIds',
          'overflowNodeId',
          'scaling',
          'schedule',
        ],
        'work',
      );
      optional(w.costPerHour, 'work hourly cost');
      optional(w.costPerParticle, 'work item cost');
      optional(w.complexityMultiplier, 'complexity multiplier', 0.000001);
      optional(w.queueLimit, 'queue limit', 0, true);
      schedule(w.schedule);
      scaling(w.scaling, w.capacity);
      requireValue(
        w.queueDiscipline === undefined || ['fifo', 'priority'].includes(w.queueDiscipline),
        'unknown queue discipline.',
      );
      requireValue(
        w.acceptedParticleTypeIds === undefined ||
          (Array.isArray(w.acceptedParticleTypeIds) &&
            w.acceptedParticleTypeIds.every((t) => types.has(t))),
        'unknown accepted particle type.',
      );
      requireValue(
        w.overflowNodeId === undefined || nodes.has(w.overflowNodeId),
        'unknown overflow node.',
      );
      if (w.overflowNodeId !== undefined)
        requireValue(
          model.edges.some(
            (edge) => edge.sourceNodeId === node.id && edge.targetNodeId === w.overflowNodeId,
          ),
          'overflow routing requires an outgoing model edge.',
        );
      const seen = new Set<string>();
      requireValue(
        w.resourceRequirements === undefined || Array.isArray(w.resourceRequirements),
        'resource requirements must be an array.',
      );
      for (const requirement of w.resourceRequirements ?? []) {
        keys(requirement, ['resourceId', 'units'], 'resource requirement');
        requireValue(
          object(requirement) &&
            resources.has(requirement.resourceId) &&
            !seen.has(requirement.resourceId),
          'unknown or duplicated resource requirement.',
        );
        number(requirement.units, 'resource units', 0.000001);
        seen.add(requirement.resourceId);
      }
    } else if (node.type === 'resource')
      requireValue(resources.has(node.resourceId), 'unknown resource node reference.');
    else if (node.type === 'outcome') {
      keys(node.outcome, ['status', 'revenue', 'revenueOverride'], 'outcome');
      requireValue(
        object(node.outcome) &&
          ['completed', 'failed', 'rejected'].includes(node.outcome.status) &&
          typeof node.outcome.revenue === 'boolean',
        'invalid outcome.',
      );
      optional(node.outcome.revenueOverride, 'outcome revenue');
    } else if (node.type === 'router') {
      requireValue(
        object(node.router) &&
          ['first-match', 'weighted', 'least-queue', 'available-capacity'].includes(
            node.router.mode,
          ),
        'invalid router.',
      );
      keys(node.router, ['mode', 'rules', 'fallbackEdgeId'], 'router');
      requireValue(
        node.router.rules === undefined || Array.isArray(node.router.rules),
        'router rules must be an array.',
      );
      for (const rule of node.router.rules ?? []) {
        requireValue(
          object(rule) && edges.get(rule.edgeId)?.sourceNodeId === node.id,
          'routing edge must leave the router.',
        );
        optional(rule.weight, 'route weight');
        keys(rule, ['edgeId', 'condition', 'weight'], 'routing rule');
        if (rule.condition !== undefined) {
          const c = rule.condition;
          requireValue(
            object(c) &&
              [
                'particleTypeId',
                'complexity',
                'priority',
                'revenue',
                'attribute',
                'queue',
                'availableCapacity',
                'utilization',
              ].includes(c.field) &&
              ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.operator),
            'invalid routing condition.',
          );
          keys(
            c,
            [
              'field',
              'operator',
              'value',
              ...(c.field === 'attribute'
                ? ['key']
                : ['queue', 'availableCapacity', 'utilization'].includes(c.field)
                  ? ['nodeId', 'resourceId']
                  : []),
            ],
            'routing condition',
          );
          if (['queue', 'availableCapacity', 'utilization'].includes(c.field))
            requireValue(
              ('nodeId' in c && !!c.nodeId) !== ('resourceId' in c && !!c.resourceId),
              'state condition needs exactly one node or resource.',
            );
          if (c.field === 'attribute')
            requireValue(
              typeof c.key === 'string' &&
                !!c.key &&
                (typeof c.value === 'string' ||
                  typeof c.value === 'boolean' ||
                  (typeof c.value === 'number' && Number.isFinite(c.value))),
              'invalid attribute condition.',
            );
          if ('nodeId' in c)
            requireValue(c.nodeId === undefined || nodes.has(c.nodeId), 'unknown routing node.');
          if ('resourceId' in c)
            requireValue(
              c.resourceId === undefined || resources.has(c.resourceId),
              'unknown routing resource.',
            );
          if (c.field === 'particleTypeId')
            requireValue(types.has(c.value), 'unknown routing particle type.');
          else if (c.field !== 'attribute')
            requireValue(
              typeof c.value === 'number' && Number.isFinite(c.value),
              'routing threshold must be finite.',
            );
        }
      }
      requireValue(
        node.router.fallbackEdgeId === undefined ||
          edges.get(node.router.fallbackEdgeId)?.sourceNodeId === node.id,
        'invalid fallback edge.',
      );
    } else requireValue(false, 'unsupported node type.');
  }
  for (const edge of model.edges) {
    keys(
      edge,
      ['id', 'sourceNodeId', 'targetNodeId', 'travelSeconds', 'particleTypeIds', 'weight'],
      'edge',
    );
    requireValue(
      nodes.has(edge.sourceNodeId) && nodes.has(edge.targetNodeId),
      'edge references a nonexistent node.',
    );
    optional(edge.travelSeconds, 'edge travel time');
    optional(edge.weight, 'edge weight');
    requireValue(
      edge.particleTypeIds === undefined ||
        (Array.isArray(edge.particleTypeIds) && edge.particleTypeIds.every((t) => types.has(t))),
      'unknown edge particle type.',
    );
  }
  for (const feature of model.improvements) {
    keys(
      feature,
      [
        'id',
        'name',
        'enabled',
        'nodeId',
        'resourceId',
        'investmentCost',
        'operatingCostPerHour',
        'processingTimeMultiplier',
        'resourceUnitsMultiplier',
        'capacityIncrease',
        'costMultiplier',
        'revenueMultiplier',
        'failureProbability',
        'failureNodeId',
      ],
      'improvement',
    );
    requireValue(
      typeof feature.name === 'string' && typeof feature.enabled === 'boolean',
      'invalid improvement.',
    );
    number(feature.investmentCost, 'investment');
    optional(feature.operatingCostPerHour, 'feature operating cost');
    requireValue(
      (feature.nodeId !== undefined || feature.resourceId !== undefined) &&
        (feature.nodeId === undefined || nodes.has(feature.nodeId)) &&
        (feature.resourceId === undefined || resources.has(feature.resourceId)),
      'improvement needs a valid node/resource target.',
    );
    requireValue(
      feature.failureNodeId === undefined || nodes.has(feature.failureNodeId),
      'unknown failure route.',
    );
    for (const key of [
      'processingTimeMultiplier',
      'resourceUnitsMultiplier',
      'costMultiplier',
      'revenueMultiplier',
    ] as const)
      optional(feature[key], key, 0.000001);
    optional(feature.capacityIncrease, 'capacity increase', 0, true);
    optional(feature.failureProbability, 'failure probability');
    requireValue((feature.failureProbability ?? 0) <= 1, 'failure probability exceeds 1.');
    const targetNode = feature.nodeId === undefined ? undefined : nodes.get(feature.nodeId);
    requireValue(
      targetNode === undefined || targetNode.type === 'work' || targetNode.type === 'outcome',
      'node improvements require a Work or Outcome target; use a resource ID for resource improvements.',
    );
    if (targetNode?.type === 'outcome') {
      for (const key of [
        'processingTimeMultiplier',
        'resourceUnitsMultiplier',
        'costMultiplier',
      ] as const)
        requireValue(
          feature[key] === undefined || feature[key] === 1,
          `Outcome improvements do not support ${key}.`,
        );
      requireValue(
        (feature.capacityIncrease ?? 0) === 0 &&
          (feature.failureProbability ?? 0) === 0 &&
          feature.failureNodeId === undefined,
        'Outcome improvements support revenue and economic effects only.',
      );
    }
    if (feature.failureNodeId !== undefined)
      for (const node of model.nodes) {
        if (
          node.type !== 'work' ||
          !(
            node.id === feature.nodeId ||
            node.work.resourceRequirements?.some(
              (requirement) => requirement.resourceId === feature.resourceId,
            )
          )
        )
          continue;
        requireValue(
          model.edges.some(
            (edge) => edge.sourceNodeId === node.id && edge.targetNodeId === feature.failureNodeId,
          ),
          'failure routing requires an outgoing model edge from every affected Work node.',
        );
      }
  }
  for (const node of model.nodes) {
    if (node.type !== 'work') continue;
    const capacity =
      node.work.capacity +
      model.improvements.reduce(
        (sum, feature) =>
          sum +
          (feature.enabled && feature.nodeId === node.id ? (feature.capacityIncrease ?? 0) : 0),
        0,
      );
    requireValue(
      Number.isSafeInteger(capacity) && capacity <= (node.work.scaling?.maxCapacity ?? Infinity),
      'enabled Work improvements exceed the maximum capacity.',
    );
  }
  for (const resource of model.resources) {
    const capacity =
      resource.capacity +
      model.improvements.reduce(
        (sum, feature) =>
          sum +
          (feature.enabled && feature.resourceId === resource.id
            ? (feature.capacityIncrease ?? 0)
            : 0),
        0,
      );
    requireValue(
      Number.isSafeInteger(capacity) &&
        capacity <=
          Math.min(resource.maxCapacity ?? Infinity, resource.scaling?.maxCapacity ?? Infinity),
      'enabled resource improvements exceed the maximum capacity.',
    );
  }
  if (model.economics !== undefined) keys(model.economics, ['maximumBudget'], 'economics');
  optional(model.economics?.maximumBudget, 'maximum budget');
  if (model.retention !== undefined)
    keys(model.retention, ['particles', 'events', 'checkpoints'], 'retention');
  for (const key of ['particles', 'events', 'checkpoints'] as const)
    optional(model.retention?.[key], `retention ${key}`, 0, true);
  if (includeScenarios)
    for (const scenario of model.scenarios) {
      requireValue(
        typeof scenario.name === 'string' && object(scenario.overrides),
        'invalid scenario.',
      );
      optional(scenario.demandMultiplier, 'demand multiplier');
      keys(scenario, ['id', 'name', 'description', 'demandMultiplier', 'overrides'], 'scenario');
      keys(
        scenario.overrides,
        ['nodes', 'edges', 'particleTypes', 'resources', 'improvements', 'economics'],
        'scenario overrides',
      );
      validate(resolveScenario(model, scenario.id), false);
    }
}
export function validateSimulationModel(value: unknown): asserts value is SimulationModel {
  validate(value, true);
}
export const assertSimulationModel: typeof validateSimulationModel = validateSimulationModel;
function merge<T>(base: T, patch: unknown): T {
  if (patch === null) return undefined as T;
  if (!object(patch)) return structuredClone(patch) as T;
  const out: Record<string, unknown> = object(base) ? { ...base } : {};
  for (const [key, v] of Object.entries(patch)) {
    if (v === null) {
      delete out[key];
      continue;
    }
    const previous = Object.hasOwn(out, key) ? out[key] : undefined;
    Object.defineProperty(out, key, {
      value: object(v) ? merge(previous, v) : structuredClone(v),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return out as T;
}
/** Resolves copies only; overrides cannot change identity or entity discriminants. */
export function resolveScenario(
  model: SimulationModel,
  scenarioId?: string,
  demandMultiplier?: number,
): SimulationModel {
  const result = structuredClone(model);
  const scenario = scenarioId ? model.scenarios.find((s) => s.id === scenarioId) : undefined;
  requireValue(!scenarioId || scenario, 'unknown scenario.');
  if (scenario)
    for (const key of ['nodes', 'edges', 'resources', 'particleTypes', 'improvements'] as const) {
      const patches = scenario.overrides[key];
      if (!patches) continue;
      requireValue(object(patches), 'scenario overrides must contain ID records.');
      for (const [id, patch] of Object.entries(patches)) {
        const index = result[key].findIndex((item) => item.id === id);
        requireValue(index >= 0 && object(patch), `unknown ${key} override.`);
        requireValue(patch.id === undefined || patch.id === id, 'scenario cannot change IDs.');
        if (key === 'nodes')
          requireValue(
            patch.type === undefined || patch.type === (result.nodes[index] as SimulationNode).type,
            'scenario cannot change node types.',
          );
        (result[key] as unknown[])[index] = merge(result[key][index], patch);
      }
    }
  if (scenario && scenario.overrides.economics !== undefined)
    result.economics = merge(result.economics ?? {}, scenario.overrides.economics);
  const multiplier = demandMultiplier ?? scenario?.demandMultiplier ?? 1;
  number(multiplier, 'demand multiplier');
  for (const node of result.nodes)
    if (node.type === 'source') {
      if (node.source.ratePerHour !== undefined) node.source.ratePerHour *= multiplier;
      if (node.source.burst !== undefined)
        node.source.burst = Math.round(node.source.burst * multiplier);
      if (node.source.maxCount !== undefined)
        node.source.maxCount = Math.round(node.source.maxCount * multiplier);
    }
  return result;
}
