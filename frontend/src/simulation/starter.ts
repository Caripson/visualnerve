import type { Graph } from '../model/types';
import { setSimulationModel } from './document';
import { assertSimulationModel } from './schema';
import type { SimulationModel } from './types';

export interface ProcessStarterDraft {
  itemName: string;
  workName: string;
  arrivalMode: 'regular' | 'batch';
  arrivalsPerHour: string;
  batchCount: string;
  durationHours: string;
  processingMinutes: string;
  capacity: string;
  transferSeconds: string;
  patienceMinutes: string;
  currency: string;
  revenue: string;
  workCostPerHour: string;
  sharedResource: boolean;
  resourceName: string;
  resourceCapacity: string;
  resourceCostPerHour: string;
}

export const starterDefaults = (currency = 'SEK'): ProcessStarterDraft => ({
  itemName: 'Order',
  workName: 'Fulfil order',
  arrivalMode: 'regular',
  arrivalsPerHour: '20',
  batchCount: '10',
  durationHours: '8',
  processingMinutes: '2',
  capacity: '1',
  transferSeconds: '5',
  patienceMinutes: '',
  currency,
  revenue: '100',
  workCostPerHour: '0',
  sharedResource: false,
  resourceName: 'Shared staff',
  resourceCapacity: '1',
  resourceCostPerHour: '180',
});

function numeric(value: string, label: string, minimum = 0, maximum = Infinity, integer = false) {
  const number = Number(value);
  if (
    !value.trim() ||
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum ||
    (integer && !Number.isSafeInteger(number))
  )
    throw new Error(
      `${label} must be ${integer ? 'a whole number' : 'a number'} between ${minimum} and ${Number.isFinite(maximum) ? maximum : 'the supported limit'}.`,
    );
  return number;
}

export function starterValues(draft: ProcessStarterDraft) {
  if (!draft.itemName.trim())
    throw new Error('Give the work item a name, such as Order or Customer.');
  if (!draft.workName.trim()) throw new Error('Name the work step, such as Pack order.');
  if (!/^[A-Z]{3}$/.test(draft.currency))
    throw new Error('Use a three-letter currency code, such as SEK, EUR or USD.');
  if (draft.sharedResource && !draft.resourceName.trim())
    throw new Error('Give the shared resource a name.');
  return {
    itemName: draft.itemName.trim(),
    workName: draft.workName.trim(),
    arrivalsPerHour:
      draft.arrivalMode === 'regular'
        ? numeric(draft.arrivalsPerHour, 'Arrivals per hour', 0.001, 1000000)
        : 0,
    batchCount:
      draft.arrivalMode === 'batch' ? numeric(draft.batchCount, 'Batch size', 1, 100000, true) : 0,
    durationSeconds: numeric(draft.durationHours, 'Simulation hours', 0.001, 87600) * 3600,
    processingSeconds: numeric(draft.processingMinutes, 'Processing minutes', 0.001, 5256000) * 60,
    capacity: numeric(draft.capacity, 'Parallel capacity', 1, 100000, true),
    transferSeconds: numeric(draft.transferSeconds, 'Transfer seconds', 0, 315360000),
    patienceSeconds: draft.patienceMinutes.trim()
      ? numeric(draft.patienceMinutes, 'Patience minutes', 0.001, 5256000) * 60
      : undefined,
    revenue: numeric(draft.revenue, 'Revenue per completed item'),
    workCostPerHour: numeric(draft.workCostPerHour, 'Work cost per hour'),
    resourceName: draft.resourceName.trim(),
    resourceCapacity: draft.sharedResource
      ? numeric(draft.resourceCapacity, 'Shared resource capacity', 1, 100000, true)
      : 0,
    resourceCostPerHour: draft.sharedResource
      ? numeric(draft.resourceCostPerHour, 'Shared resource cost per hour')
      : 0,
  };
}

export function createEmptySimulationModel(currency = 'SEK'): SimulationModel {
  return {
    type: 'process-simulator',
    schemaVersion: 1,
    currency,
    nodes: [],
    edges: [],
    particleTypes: [],
    resources: [],
    improvements: [],
    scenarios: [],
    defaults: { durationSeconds: 28800, seed: 42 },
    retention: { particles: 300, events: 2000, checkpoints: 20 },
  };
}

/** The setup UI produces the same validated semantic model used by API/MCP and the engine. */
export function createStarterGraph(graph: Graph, draft: ProcessStarterDraft): Graph {
  const base = graph.simulation;
  if (!base || base.nodes.length)
    throw new Error('Guided setup starts on an empty Process Simulator.');
  const values = starterValues(draft);
  const itemId = crypto.randomUUID(),
    sourceId = crypto.randomUUID(),
    workId = crypto.randomUUID(),
    outcomeId = crypto.randomUUID(),
    resourceId = crypto.randomUUID(),
    resourceNodeId = crypto.randomUUID();
  const model: SimulationModel = {
    ...structuredClone(base),
    currency: draft.currency,
    description: `${values.itemName} flows through ${values.workName} to completion. ${draft.arrivalMode === 'batch' ? `${values.batchCount} items arrive together at time zero.` : `Regular arrivals: ${values.arrivalsPerHour} per hour.`} Processing takes ${values.processingSeconds / 60} minutes per item, with ${values.capacity} parallel slots. Each connection adds ${values.transferSeconds} simulated seconds. Work costs ${values.workCostPerHour} ${draft.currency} per capacity slot per hour.${draft.sharedResource ? ` Each item also needs one ${values.resourceName} unit; ${values.resourceCapacity} are available, costing ${values.resourceCostPerHour} ${draft.currency} per unit per hour.` : ''}`,
    particleTypes: [
      ...base.particleTypes,
      {
        id: itemId,
        name: values.itemName,
        color: '#2563eb',
        shape: 'circle',
        revenue: values.revenue,
        complexity: { min: 1, max: 1 },
        priority: 0,
        ...(values.patienceSeconds === undefined
          ? {}
          : { patienceSeconds: values.patienceSeconds }),
      },
    ],
    nodes: [
      {
        id: sourceId,
        name: `${values.itemName} arrivals`,
        type: 'source',
        source: {
          particleTypeId: itemId,
          ...(draft.arrivalMode === 'batch'
            ? { burst: values.batchCount, maxCount: values.batchCount }
            : { ratePerHour: values.arrivalsPerHour, distribution: 'regular' as const }),
        },
      },
      {
        id: workId,
        name: values.workName,
        type: 'work',
        work: {
          capacity: values.capacity,
          processingSeconds: values.processingSeconds,
          queueDiscipline: 'fifo',
          costPerHour: values.workCostPerHour,
          ...(draft.sharedResource ? { resourceRequirements: [{ resourceId, units: 1 }] } : {}),
        },
      },
      {
        id: outcomeId,
        name: 'Completed',
        type: 'outcome',
        outcome: { status: 'completed', revenue: values.revenue > 0 },
      },
      ...(draft.sharedResource
        ? [{ id: resourceNodeId, name: values.resourceName, type: 'resource' as const, resourceId }]
        : []),
    ],
    edges: [
      {
        id: crypto.randomUUID(),
        sourceNodeId: sourceId,
        targetNodeId: workId,
        travelSeconds: values.transferSeconds,
      },
      {
        id: crypto.randomUUID(),
        sourceNodeId: workId,
        targetNodeId: outcomeId,
        travelSeconds: values.transferSeconds,
      },
    ],
    resources: [
      ...base.resources,
      ...(draft.sharedResource
        ? [
            {
              id: resourceId,
              name: values.resourceName,
              capacity: values.resourceCapacity,
              unit: 'units',
              costPerHour: values.resourceCostPerHour,
            },
          ]
        : []),
    ],
    defaults: { ...base.defaults, durationSeconds: values.durationSeconds },
  };
  assertSimulationModel(model);
  const next = setSimulationModel(graph, model);
  const positions = new Map<string, { x: number; y: number; height: number }>([
    [sourceId, { x: 60, y: 180, height: 170 }],
    [workId, { x: 410, y: 180, height: 240 }],
    [outcomeId, { x: 760, y: 180, height: 170 }],
    [resourceNodeId, { x: 410, y: -120, height: 210 }],
  ]);
  // A viewport saved while the canvas was empty must not hide the newly created process.
  const { viewport: _viewport, viewportDevice: _device, ...settings } = next.diagram.settings;
  return {
    ...next,
    diagram: { ...next.diagram, settings },
    nodes: next.nodes.map((node) =>
      positions.has(node.id) ? { ...node, width: 250, ...positions.get(node.id) } : node,
    ),
  };
}
