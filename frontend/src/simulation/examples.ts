import type { SimulationModel } from './types';
export function createBasicModel(
  options: {
    particles?: number;
    capacity?: number;
    processingSeconds?: number;
    revenue?: number;
  } = {},
): SimulationModel {
  return {
    type: 'process-simulator',
    schemaVersion: 1,
    currency: 'SEK',
    particleTypes: [
      {
        id: 'work-item',
        name: 'Work item',
        color: '#2563eb',
        revenue: options.revenue ?? 100,
        complexity: { min: 1, max: 1 },
        priority: 1,
      },
    ],
    nodes: [
      {
        id: 'source',
        name: 'Arrivals',
        type: 'source',
        source: {
          particleTypeId: 'work-item',
          burst: options.particles ?? 10,
          maxCount: options.particles ?? 10,
        },
      },
      {
        id: 'work',
        name: 'Work',
        type: 'work',
        work: {
          processingSeconds: options.processingSeconds ?? 60,
          capacity: options.capacity ?? 1,
          queueDiscipline: 'fifo',
        },
      },
      {
        id: 'outcome',
        name: 'Revenue',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    ],
    edges: [
      { id: 'source-work', sourceNodeId: 'source', targetNodeId: 'work', travelSeconds: 0 },
      { id: 'work-outcome', sourceNodeId: 'work', targetNodeId: 'outcome', travelSeconds: 0 },
    ],
    resources: [],
    improvements: [],
    scenarios: [],
    defaults: { durationSeconds: 86400, seed: 42 },
    retention: { particles: 300, events: 2000, checkpoints: 20 },
  };
}
/** All baseline assumptions are explicit; an eight-hour employee cannot supply 640 minutes. */
export function createKioskModel(): SimulationModel {
  const model: SimulationModel = {
    type: 'process-simulator',
    schemaVersion: 1,
    currency: 'SEK',
    description:
      'A repeating 12-hour kiosk day, followed by 12 closed hours. Regular evenly distributed arrivals; core purchases take 2 minutes and package pickup takes 4. Core revenue is 85 SEK, package fee 20 SEK. Shared staff costs 180 SEK/hour; counter has no extra operating cost. Core patience 4 minutes, package patience 8 minutes. Package workers cost 180 SEK/hour and dedicated package counters cost 30 SEK/hour each. Each edge includes 3 seconds of walking/transfer time. These illustrative assumptions are editable.',
    particleTypes: [
      {
        id: 'core-customer',
        name: 'Core customer',
        color: '#2563eb',
        shape: 'circle',
        revenue: 85,
        complexity: { min: 1, max: 1 },
        priority: 1,
        patienceSeconds: 240,
      },
      {
        id: 'package-customer',
        name: 'Package pickup',
        color: '#f97316',
        shape: 'square',
        revenue: 20,
        complexity: { min: 1, max: 1 },
        priority: 1,
        patienceSeconds: 480,
      },
    ],
    nodes: [
      {
        id: 'core-source',
        name: 'Store customers',
        type: 'source',
        source: {
          particleTypeId: 'core-customer',
          ratePerHour: 25,
          distribution: 'regular',
          schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
        },
      },
      {
        id: 'package-source',
        name: 'Package arrivals',
        type: 'source',
        source: {
          particleTypeId: 'package-customer',
          ratePerHour: 10 / 12,
          distribution: 'regular',
          schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
        },
      },
      {
        id: 'core-sales',
        name: 'Store sales',
        type: 'work',
        work: {
          processingSeconds: 120,
          capacity: 1,
          queueDiscipline: 'fifo',
          resourceRequirements: [
            { resourceId: 'store-staff', units: 1 },
            { resourceId: 'shared-counter', units: 1 },
          ],
        },
      },
      {
        id: 'package-counter',
        name: 'Package pickup',
        type: 'work',
        work: {
          processingSeconds: 240,
          capacity: 1,
          queueDiscipline: 'fifo',
          resourceRequirements: [
            { resourceId: 'store-staff', units: 1 },
            { resourceId: 'shared-counter', units: 1 },
          ],
        },
      },
      {
        id: 'staff-display',
        name: 'Shared store employee',
        type: 'resource',
        resourceId: 'store-staff',
      },
      {
        id: 'counter-display',
        name: 'Shared counter',
        type: 'resource',
        resourceId: 'shared-counter',
      },
      {
        id: 'core-revenue',
        name: 'Store revenue',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
      {
        id: 'package-revenue',
        name: 'Package fee',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    ],
    edges: [
      {
        id: 'core-arrival',
        sourceNodeId: 'core-source',
        targetNodeId: 'core-sales',
        travelSeconds: 3,
      },
      {
        id: 'core-complete',
        sourceNodeId: 'core-sales',
        targetNodeId: 'core-revenue',
        travelSeconds: 3,
      },
      {
        id: 'package-arrival',
        sourceNodeId: 'package-source',
        targetNodeId: 'package-counter',
        travelSeconds: 3,
      },
      {
        id: 'package-complete',
        sourceNodeId: 'package-counter',
        targetNodeId: 'package-revenue',
        travelSeconds: 3,
      },
    ],
    resources: [
      {
        id: 'store-staff',
        name: 'Shared store staff',
        capacity: 1,
        minCapacity: 1,
        maxCapacity: 5,
        unit: 'employee',
        costPerHour: 180,
        schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
      },
      {
        id: 'shared-counter',
        name: 'Shared service counter',
        capacity: 1,
        minCapacity: 1,
        maxCapacity: 5,
        unit: 'counter',
        costPerHour: 0,
        schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
      },
      {
        id: 'package-staff',
        name: 'Dedicated package employees',
        capacity: 0,
        minCapacity: 0,
        maxCapacity: 5,
        unit: 'employee',
        costPerHour: 180,
        schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
      },
      {
        id: 'package-service-counter',
        name: 'Dedicated package counter',
        capacity: 0,
        minCapacity: 0,
        maxCapacity: 5,
        unit: 'counter',
        costPerHour: 30,
        schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
      },
    ],
    improvements: [],
    scenarios: [
      { id: 'baseline', name: 'Baseline', overrides: {} },
      {
        id: 'package-stress',
        name: '1,000 packages/day',
        overrides: {
          nodes: {
            'package-source': {
              type: 'source',
              source: {
                particleTypeId: 'package-customer',
                ratePerHour: 1000 / 12,
                distribution: 'regular',
                schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
              },
            },
          },
        },
      },
      {
        id: 'package-worker',
        name: '+1 package employee',
        overrides: {
          nodes: {
            'package-source': {
              type: 'source',
              source: {
                particleTypeId: 'package-customer',
                ratePerHour: 1000 / 12,
                distribution: 'regular',
                schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
              },
            },
            'package-counter': {
              type: 'work',
              work: {
                processingSeconds: 240,
                capacity: 1,
                queueDiscipline: 'fifo',
                resourceRequirements: [
                  { resourceId: 'package-staff', units: 1 },
                  { resourceId: 'shared-counter', units: 1 },
                ],
              },
            },
          },
          resources: { 'package-staff': { capacity: 1 } },
        },
      },
      {
        id: 'dedicated-package-counter',
        name: '+2 package employees and dedicated counter',
        overrides: {
          nodes: {
            'package-source': {
              type: 'source',
              source: {
                particleTypeId: 'package-customer',
                ratePerHour: 1000 / 12,
                distribution: 'regular',
                schedule: [{ startSeconds: 0, endSeconds: 43200, repeatSeconds: 86400 }],
              },
            },
            'package-counter': {
              type: 'work',
              work: {
                processingSeconds: 240,
                capacity: 2,
                queueDiscipline: 'fifo',
                resourceRequirements: [
                  { resourceId: 'package-staff', units: 1 },
                  { resourceId: 'package-service-counter', units: 1 },
                ],
              },
            },
          },
          resources: {
            'package-staff': { capacity: 2 },
            'package-service-counter': { capacity: 2 },
          },
        },
      },
    ],
    defaults: { durationSeconds: 43200, seed: 42 },
    retention: { particles: 300, events: 2000, checkpoints: 20 },
  };
  return model;
}
