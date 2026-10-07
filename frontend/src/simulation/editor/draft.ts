import type { SimulationModel, SimulationNode } from '../types';
import { toScenarioPatch } from '../scenario-patch';

export function addDraftNode(
  model: SimulationModel,
  type: SimulationNode['type'],
  processId?: string,
) {
  const id = crypto.randomUUID();
  const common = { id, name: `New ${type}`, ...(processId ? { processId } : {}) };
  let added: SimulationNode;
  let particleTypes = model.particleTypes;
  let resources = model.resources;
  if (type === 'source') {
    const particleTypeId = particleTypes[0]?.id ?? crypto.randomUUID();
    if (!particleTypes.length)
      particleTypes = [
        {
          id: particleTypeId,
          name: 'Work item',
          color: '#647be7',
          revenue: 0,
          complexity: { min: 1, max: 1 },
          priority: 0,
        },
      ];
    added = { ...common, type, source: { particleTypeId, ratePerHour: 10 } };
  } else if (type === 'work')
    added = { ...common, type, work: { capacity: 1, processingSeconds: 60 } };
  else if (type === 'router') added = { ...common, type, router: { mode: 'first-match' } };
  else if (type === 'resource') {
    const resourceId = crypto.randomUUID();
    added = { ...common, type, resourceId };
    resources = [
      ...resources,
      { id: resourceId, name: added.name, capacity: 1, unit: 'units', costPerHour: 0 },
    ];
  } else added = { ...common, type, outcome: { status: 'completed', revenue: true } };
  return { model: { ...model, nodes: [...model.nodes, added], particleTypes, resources }, id };
}

/** Scenario settings contain typed differences, with the original topology intact. */
export function applyScenarioDraft(
  base: SimulationModel,
  draft: SimulationModel,
  scenarioId: string,
): SimulationModel {
  const model = structuredClone(base);
  const scenario = model.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error('The selected scenario no longer exists.');
  if (draft.currency !== base.currency || draft.description !== base.description)
    throw new Error('Edit currency and assumptions in the baseline.');
  const overrides: typeof scenario.overrides = {};
  for (const collection of [
    'nodes',
    'processes',
    'edges',
    'particleTypes',
    'resources',
    'improvements',
  ] as const) {
    const previous = new Map((base[collection] ?? []).map((entry) => [entry.id, entry]));
    if (
      (draft[collection] ?? []).length !== previous.size ||
      (draft[collection] ?? []).some((entry) => !previous.has(entry.id))
    )
      throw new Error(
        'Scenarios change assumptions. Add or remove process objects in the baseline.',
      );
    const changes = Object.fromEntries(
      (draft[collection] ?? [])
        .filter((entry) => JSON.stringify(entry) !== JSON.stringify(previous.get(entry.id)))
        .map((entry) => [entry.id, toScenarioPatch(entry, previous.get(entry.id))]),
    );
    if (Object.keys(changes).length) (overrides as Record<string, unknown>)[collection] = changes;
  }
  if (JSON.stringify(draft.economics) !== JSON.stringify(base.economics))
    overrides.economics = toScenarioPatch(draft.economics, base.economics);
  scenario.overrides = overrides;
  return model;
}
