import type { Graph } from '../model/types';
import { createSimulationGraph } from './document';
import type { SimulationModel, SimulationNode } from './types';

/** One customer delivery, three real work streams and one synchronized business outcome. */
export class ParallelDeliveryExample {
  model(): SimulationModel {
    const task = (
      id: string,
      name: string,
      minutes: number,
      resourceId: string,
      cost: number,
    ): SimulationNode => ({
      id,
      name,
      type: 'work',
      processId: 'readiness',
      work: {
        processingSeconds: minutes * 60,
        capacity: 2,
        costPerParticle: cost,
        resourceRequirements: [{ resourceId, units: 1 }],
      },
    });
    return {
      type: 'process-simulator',
      schemaVersion: 1,
      currency: 'SEK',
      description:
        'Illustrative SD-WAN delivery: eight customer orders arrive at time zero, with complexity 1 and revenue 12,000 SEK each. Access provisioning (8 minutes, 150 SEK/item), equipment preparation (6 minutes, 125 SEK/item) and site readiness (4 minutes, 100 SEK/item) run in parallel for the same order. All three must finish before installation (3 minutes, 75 SEK/item), and revenue is realized once at delivery. Access, site readiness and installation compete for two engineers at 450 SEK per employee/hour. Equipment uses one warehouse worker at 250 SEK/hour. All resources are paid for the full two-hour simulation, including idle time. Transfers take five seconds. No abandonment or random arrivals. The extra-engineer scenario adds real paid capacity without changing demand. These are editable example assumptions, not actual telecom lead times.',
      processes: [
        { id: 'delivery', name: 'Customer delivery' },
        { id: 'readiness', name: 'Parallel readiness', parentId: 'delivery' },
      ],
      particleTypes: [
        {
          id: 'customer-order',
          name: 'Customer order',
          color: '#2563eb',
          shape: 'circle',
          revenue: 12000,
          complexity: { min: 1, max: 1 },
          priority: 1,
        },
      ],
      nodes: [
        {
          id: 'orders',
          name: 'Customer orders',
          type: 'source',
          processId: 'delivery',
          source: { particleTypeId: 'customer-order', burst: 8, maxCount: 8 },
        },
        {
          id: 'prepare',
          name: 'Start parallel readiness',
          type: 'fork',
          processId: 'readiness',
          fork: {
            joinNodeId: 'ready',
            branchEdgeIds: ['prepare-access', 'prepare-equipment', 'prepare-site'],
          },
        },
        task('access', 'Access provisioning', 8, 'engineers', 150),
        task('equipment', 'Equipment preparation', 6, 'warehouse', 125),
        task('site', 'Site readiness', 4, 'engineers', 100),
        {
          id: 'ready',
          name: 'All prerequisites ready',
          type: 'join',
          processId: 'readiness',
          join: { forkNodeId: 'prepare' },
        },
        {
          id: 'install',
          name: 'Install and validate',
          type: 'work',
          processId: 'delivery',
          work: {
            processingSeconds: 180,
            capacity: 2,
            costPerParticle: 75,
            resourceRequirements: [{ resourceId: 'engineers', units: 1 }],
          },
        },
        {
          id: 'delivered',
          name: 'Delivered and billed once',
          type: 'outcome',
          processId: 'delivery',
          outcome: { status: 'completed', revenue: true },
        },
        {
          id: 'engineers-display',
          name: 'Shared engineering team',
          type: 'resource',
          resourceId: 'engineers',
        },
        {
          id: 'warehouse-display',
          name: 'Warehouse team',
          type: 'resource',
          resourceId: 'warehouse',
        },
      ],
      edges: [
        ['orders', 'prepare'],
        ['prepare', 'access'],
        ['prepare', 'equipment'],
        ['prepare', 'site'],
        ['access', 'ready'],
        ['equipment', 'ready'],
        ['site', 'ready'],
        ['ready', 'install'],
        ['install', 'delivered'],
      ].map(([sourceNodeId, targetNodeId]) => ({
        id: `${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        travelSeconds: 5,
      })),
      resources: [
        {
          id: 'engineers',
          name: 'Engineering team',
          capacity: 2,
          unit: 'employees',
          costPerHour: 450,
        },
        {
          id: 'warehouse',
          name: 'Warehouse team',
          capacity: 1,
          unit: 'employees',
          costPerHour: 250,
        },
      ],
      improvements: [],
      scenarios: [
        {
          id: 'extra-engineers',
          name: 'Two additional engineers',
          overrides: { resources: { engineers: { capacity: 4 } } },
        },
      ],
      defaults: { durationSeconds: 7200, seed: 42 },
      retention: { particles: 300, events: 3000, checkpoints: 30 },
    };
  }
  graph(name = 'Parallel SD-WAN delivery'): Graph {
    const graph = createSimulationGraph(name, this.model());
    const positions: Record<string, { x: number; y: number }> = {
      orders: { x: -450, y: 300 },
      prepare: { x: -140, y: 300 },
      access: { x: 180, y: 20 },
      equipment: { x: 180, y: 300 },
      site: { x: 180, y: 580 },
      ready: { x: 520, y: 300 },
      install: { x: 850, y: 300 },
      delivered: { x: 1180, y: 300 },
      'engineers-display': { x: 180, y: -260 },
      'warehouse-display': { x: 520, y: -260 },
    };
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        ...(node.externalId ? positions[node.externalId] : undefined),
      })),
    };
  }
}
