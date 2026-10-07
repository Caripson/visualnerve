import type { Graph } from '../model/types';
import { createSimulationGraph } from './document';
import type { SimulationModel, SimulationNode, ResourceRequirement } from './types';

/** A reproducible, editable example: deliveries and returns compete for the same real pools. */
export class DeliveryNetworkExample {
  model(): SimulationModel {
    const opening = [{ startSeconds: 0, endSeconds: 28800, repeatSeconds: 86400 }];
    const work = (
      id: string,
      name: string,
      processId: string,
      minutes: number,
      capacity: number,
      resources: string[],
    ): SimulationNode => ({
      id,
      name,
      processId,
      type: 'work',
      work: {
        processingSeconds: minutes * 60,
        capacity,
        queueDiscipline: 'priority',
        resourceRequirements: resources.map(
          (resourceId): ResourceRequirement => ({ resourceId, units: 1 }),
        ),
      },
    });
    const edge = (sourceNodeId: string, targetNodeId: string) => ({
      id: `${sourceNodeId}-${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      travelSeconds: 3,
    });
    return {
      type: 'process-simulator',
      schemaVersion: 1,
      currency: 'SEK',
      description:
        'Illustrative delivery business, open eight hours every day. Standard orders: 18/hour, 750 SEK, complexity 1, patience 60 minutes. Enterprise orders: 4/hour, 3,500 SEK, complexity 1.5–2, patience 120 minutes. Returns: 2/hour, 20 SEK, complexity 1, patience 60 minutes. Every connection takes three seconds. Processing minutes below are multiplied by item complexity. Work slots have no additional hourly charge; the five shared resource pools are paid per available unit/hour, including idle time. Orders and returns share operations staff, loading dock and field technicians. Containers are organizational scopes and introduce no processing or cost. The baseline picking slot is deliberately constrained. Scenarios add real, paid capacity and can move the constraint downstream. All assumptions can be edited.',
      processes: [
        {
          id: 'fulfilment',
          name: 'Order fulfilment',
          description: 'From validation through installation and invoicing.',
        },
        { id: 'commercial', name: 'Order acceptance', parentId: 'fulfilment' },
        { id: 'planning', name: 'Service planning', parentId: 'fulfilment' },
        { id: 'warehouse', name: 'Warehouse preparation', parentId: 'fulfilment' },
        { id: 'delivery', name: 'Delivery and installation', parentId: 'fulfilment' },
        { id: 'transport', name: 'Transport', parentId: 'delivery' },
        { id: 'field-service', name: 'Field service', parentId: 'delivery' },
        { id: 'billing', name: 'Billing', parentId: 'fulfilment' },
        { id: 'returns', name: 'Returns and recovery' },
        { id: 'returns-inspection', name: 'Returns inspection', parentId: 'returns' },
        { id: 'returns-refurbishment', name: 'Refurbishment', parentId: 'returns' },
      ],
      particleTypes: [
        {
          id: 'standard',
          name: 'Standard order',
          color: '#2563eb',
          shape: 'circle',
          revenue: 750,
          complexity: { min: 1, max: 1 },
          priority: 1,
          patienceSeconds: 3600,
        },
        {
          id: 'enterprise',
          name: 'Enterprise order',
          color: '#8b5cf6',
          shape: 'triangle',
          revenue: 3500,
          complexity: { min: 1.5, max: 2 },
          priority: 2,
          patienceSeconds: 7200,
        },
        {
          id: 'return',
          name: 'Returned equipment',
          color: '#f97316',
          shape: 'square',
          revenue: 20,
          complexity: { min: 1, max: 1 },
          priority: 1,
          patienceSeconds: 3600,
        },
      ],
      nodes: [
        ...[
          ['standard-source', 'Standard orders', 'standard', 18],
          ['enterprise-source', 'Enterprise orders', 'enterprise', 4],
          ['return-source', 'Equipment returns', 'return', 2],
        ].map(
          ([id, name, particleTypeId, ratePerHour]): SimulationNode => ({
            id: String(id),
            name: String(name),
            type: 'source',
            source: {
              particleTypeId: String(particleTypeId),
              ratePerHour: Number(ratePerHour),
              distribution: 'regular',
              schedule: opening,
            },
          }),
        ),
        work('validate', 'Validate order', 'commercial', 2, 2, ['operations']),
        {
          id: 'order-router',
          name: 'Needs enterprise design?',
          processId: 'planning',
          type: 'router',
          router: {
            mode: 'first-match',
            rules: [
              {
                edgeId: 'order-router-design',
                condition: { field: 'particleTypeId', operator: 'eq', value: 'enterprise' },
              },
            ],
            fallbackEdgeId: 'order-router-reserve',
          },
        },
        work('design', 'Design enterprise service', 'planning', 8, 1, ['engineers']),
        work('reserve', 'Reserve equipment', 'planning', 2, 2, ['operations']),
        work('pick', 'Pick equipment', 'warehouse', 6, 1, ['operations']),
        work('pack', 'Pack equipment', 'warehouse', 5, 2, ['operations']),
        work('load', 'Load vehicle', 'transport', 2, 1, ['dock']),
        work('drive', 'Transport equipment', 'transport', 20, 3, ['drivers']),
        work('install', 'Install equipment', 'field-service', 20, 3, ['technicians']),
        work('quality', 'Verify installation', 'field-service', 3, 2, ['engineers']),
        work('invoice', 'Issue invoice', 'billing', 2, 2, ['operations']),
        {
          id: 'delivered',
          name: 'Delivered and invoiced',
          processId: 'billing',
          type: 'outcome',
          outcome: { status: 'completed', revenue: true },
        },
        work('inspect-return', 'Inspect returned equipment', 'returns-inspection', 4, 1, [
          'operations',
          'dock',
        ]),
        work('refurbish', 'Refurbish equipment', 'returns-refurbishment', 15, 1, ['technicians']),
        {
          id: 'recovered',
          name: 'Recovery fee',
          processId: 'returns-refurbishment',
          type: 'outcome',
          outcome: { status: 'completed', revenue: true },
        },
        ...[
          ['operations', 'Shared operations staff'],
          ['drivers', 'Shared drivers'],
          ['technicians', 'Shared field technicians'],
          ['dock', 'Shared loading dock'],
          ['engineers', 'Shared service engineers'],
        ].map(
          ([resourceId, name]): SimulationNode => ({
            id: `${resourceId}-display`,
            name,
            type: 'resource',
            resourceId,
          }),
        ),
      ],
      edges: [
        edge('standard-source', 'validate'),
        edge('enterprise-source', 'validate'),
        edge('validate', 'order-router'),
        edge('order-router', 'design'),
        edge('design', 'reserve'),
        edge('order-router', 'reserve'),
        edge('reserve', 'pick'),
        edge('pick', 'pack'),
        edge('pack', 'load'),
        edge('load', 'drive'),
        edge('drive', 'install'),
        edge('install', 'quality'),
        edge('quality', 'invoice'),
        edge('invoice', 'delivered'),
        edge('return-source', 'inspect-return'),
        edge('inspect-return', 'refurbish'),
        edge('refurbish', 'recovered'),
      ],
      resources: [
        {
          id: 'operations',
          name: 'Operations staff',
          capacity: 3,
          unit: 'employee',
          costPerHour: 180,
          schedule: opening,
        },
        {
          id: 'drivers',
          name: 'Drivers',
          capacity: 3,
          unit: 'driver',
          costPerHour: 230,
          schedule: opening,
        },
        {
          id: 'technicians',
          name: 'Field technicians',
          capacity: 3,
          unit: 'technician',
          costPerHour: 420,
          schedule: opening,
        },
        {
          id: 'dock',
          name: 'Loading dock',
          capacity: 1,
          unit: 'dock',
          costPerHour: 35,
          schedule: opening,
        },
        {
          id: 'engineers',
          name: 'Service engineers',
          capacity: 2,
          unit: 'engineer',
          costPerHour: 600,
          schedule: opening,
        },
      ],
      improvements: [
        {
          id: 'automated-picking',
          name: 'Assisted picking',
          nodeId: 'pick',
          enabled: false,
          investmentCost: 250000,
          processingTimeMultiplier: 0.65,
          operatingCostPerHour: 20,
        },
      ],
      scenarios: [
        { id: 'baseline', name: 'Baseline', overrides: {} },
        {
          id: 'returns-rush',
          name: '10× returns, same staff',
          overrides: {
            nodes: { 'return-source': { type: 'source', source: { ratePerHour: 20 } } },
          },
        },
        {
          id: 'warehouse-capacity',
          name: 'Expand warehouse capacity',
          overrides: {
            resources: { operations: { capacity: 5 } },
            nodes: {
              pick: { type: 'work', work: { capacity: 3 } },
              pack: { type: 'work', work: { capacity: 3 } },
            },
          },
        },
        {
          id: 'whole-flow-capacity',
          name: 'Expand warehouse and field delivery',
          overrides: {
            resources: {
              operations: { capacity: 5 },
              drivers: { capacity: 5 },
              technicians: { capacity: 5 },
              dock: { capacity: 2 },
            },
            nodes: {
              pick: { type: 'work', work: { capacity: 3 } },
              pack: { type: 'work', work: { capacity: 3 } },
              load: { type: 'work', work: { capacity: 2 } },
              drive: { type: 'work', work: { capacity: 5 } },
              install: { type: 'work', work: { capacity: 5 } },
            },
          },
        },
        {
          id: 'picking-investment',
          name: 'Assisted picking investment',
          overrides: { improvements: { 'automated-picking': { enabled: true } } },
        },
      ],
      defaults: { durationSeconds: 28800, seed: 42 },
      retention: { particles: 300, events: 2000, checkpoints: 40 },
    };
  }

  graph(name = 'Delivery network and returns'): Graph {
    const graph = createSimulationGraph(name, this.model());
    const positions: Record<string, [number, number]> = {
      'standard-source': [0, 180],
      'enterprise-source': [0, 500],
      validate: [360, 320],
      'order-router': [720, 320],
      design: [1060, 20],
      reserve: [1420, 320],
      pick: [1780, 320],
      pack: [2140, 320],
      load: [2500, 320],
      drive: [2860, 320],
      install: [3220, 320],
      quality: [3580, 320],
      invoice: [3940, 320],
      delivered: [4300, 320],
      'return-source': [0, 1000],
      'inspect-return': [360, 1000],
      refurbish: [720, 1000],
      recovered: [1080, 1000],
      'operations-display': [1200, -400],
      'drivers-display': [2600, -400],
      'technicians-display': [3100, -400],
      'dock-display': [2100, -400],
      'engineers-display': [1650, -400],
    };
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const position = node.externalId ? positions[node.externalId] : undefined;
        return position ? { ...node, x: position[0], y: position[1] } : node;
      }),
    };
  }
}
