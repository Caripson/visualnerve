import type { Graph } from '../model/types';
import { ProcessStarterBuilder } from './starter-builder';
import type { SimulationModel } from './types';

export interface ProcessStarterDraft {
  structure: 'single' | 'hierarchical';
  mainProcessName: string;
  steps: ProcessStarterStepDraft[];
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

export interface ProcessStarterStepDraft {
  id: string;
  name: string;
  workName: string;
  processingMinutes: string;
  capacity: string;
  workCostPerHour: string;
  usesSharedResource: boolean;
}

export const starterDefaults = (currency = 'SEK'): ProcessStarterDraft => ({
  structure: 'single',
  mainProcessName: 'Order fulfilment',
  steps: [
    {
      id: 'validate',
      name: 'Order validation',
      workName: 'Validate order',
      processingMinutes: '2',
      capacity: '1',
      workCostPerHour: '0',
      usesSharedResource: true,
    },
    {
      id: 'prepare',
      name: 'Warehouse preparation',
      workName: 'Pick and pack order',
      processingMinutes: '5',
      capacity: '2',
      workCostPerHour: '0',
      usesSharedResource: true,
    },
    {
      id: 'deliver',
      name: 'Delivery',
      workName: 'Dispatch order',
      processingMinutes: '3',
      capacity: '1',
      workCostPerHour: '0',
      usesSharedResource: true,
    },
  ],
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
  if (draft.structure === 'hierarchical' && !draft.mainProcessName.trim())
    throw new Error('Name the main process.');
  if (draft.structure !== 'hierarchical' && !draft.workName.trim())
    throw new Error('Name the work step, such as Pack order.');
  if (!/^[A-Z]{3}$/.test(draft.currency))
    throw new Error('Use a three-letter currency code, such as SEK, EUR or USD.');
  if (draft.sharedResource && !draft.resourceName.trim())
    throw new Error('Give the shared resource a name.');
  const steps =
    draft.structure === 'hierarchical'
      ? draft.steps
      : [
          {
            id: 'work',
            name: draft.workName,
            workName: draft.workName,
            processingMinutes: draft.processingMinutes,
            capacity: draft.capacity,
            workCostPerHour: draft.workCostPerHour,
            usesSharedResource: true,
          },
        ];
  if (!steps.length || steps.length > 12)
    throw new Error('Add between one and twelve subprocesses.');
  const values = steps.map((step, index) => {
    if (!step.name.trim() || !step.workName.trim())
      throw new Error(`Name subprocess ${index + 1} and its work step.`);
    return {
      name: step.name.trim(),
      workName: step.workName.trim(),
      processingSeconds:
        numeric(step.processingMinutes, `Step ${index + 1} processing minutes`, 0.001, 5256000) *
        60,
      capacity: numeric(step.capacity, `Step ${index + 1} capacity`, 1, 100000, true),
      costPerHour: numeric(step.workCostPerHour, `Step ${index + 1} hourly cost`),
      usesSharedResource: step.usesSharedResource,
    };
  });
  return {
    steps: values,
    mainProcessName: draft.mainProcessName.trim(),
    itemName: draft.itemName.trim(),
    workName:
      draft.structure === 'hierarchical' ? draft.mainProcessName.trim() : draft.workName.trim(),
    arrivalsPerHour:
      draft.arrivalMode === 'regular'
        ? numeric(draft.arrivalsPerHour, 'Arrivals per hour', 0.001, 1000000)
        : 0,
    batchCount:
      draft.arrivalMode === 'batch' ? numeric(draft.batchCount, 'Batch size', 1, 100000, true) : 0,
    durationSeconds: numeric(draft.durationHours, 'Simulation hours', 0.001, 87600) * 3600,
    processingSeconds: values[0].processingSeconds,
    capacity: values[0].capacity,
    transferSeconds: numeric(draft.transferSeconds, 'Transfer seconds', 0, 315360000),
    patienceSeconds: draft.patienceMinutes.trim()
      ? numeric(draft.patienceMinutes, 'Patience minutes', 0.001, 5256000) * 60
      : undefined,
    revenue: numeric(draft.revenue, 'Revenue per completed item'),
    workCostPerHour: values[0].costPerHour,
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

/** UI and API/MCP use the same validated semantic document. */
export function createStarterGraph(graph: Graph, draft: ProcessStarterDraft): Graph {
  return new ProcessStarterBuilder().build(graph, draft);
}
