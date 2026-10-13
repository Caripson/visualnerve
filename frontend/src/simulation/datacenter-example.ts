import type { SimulationModel } from './types';
import { capacityExampleGraph } from './infrastructure/examples';

/** Synthetic planning assumptions: this is neither a server benchmark nor a power-flow model. */
export class DatacenterCapacityExample {
  model(): SimulationModel {
    return {
      type: 'process-simulator',
      schemaVersion: 2,
      infrastructure: { schemaVersion: 1 },
      currency: 'SEK',
      description:
        'Illustrative datacenter capacity model. Two locations each have 100 users, explicitly assumed to send 0.075 requests/user/second (15 requests/second total). Each 128 KiB request shares a 10 Mbps WAN, retains 64 MiB of RAM until completion, performs 0.1 core-seconds of CPU work and requires 0.000001 kWh at up to 0.04 kW. CPU and the attributable energy budget run in parallel and both must complete before a 20 ms database operation. A 16 KiB response shares the WAN. Power is a fluid allocation budget, not instantaneous CPU power measurement; energy shortage delays its branch. Costs are per capacity unit/hour plus imported grid energy. No TCP, server scheduling or electrical load-flow is modeled.',
      particleTypes: [
        {
          id: 'north-request',
          name: 'North site request',
          color: '#2563eb',
          shape: 'circle',
          revenue: 0.02,
          complexity: { min: 1, max: 1 },
          priority: 0,
        },
        {
          id: 'south-request',
          name: 'South site request',
          color: '#8b5cf6',
          shape: 'circle',
          revenue: 0.02,
          complexity: { min: 1, max: 1 },
          priority: 0,
        },
      ],
      processes: [
        { id: 'north', name: 'North location' },
        { id: 'south', name: 'South location' },
        { id: 'service', name: 'Shared datacenter' },
      ],
      resources: [
        {
          id: 'wan',
          name: 'Shared WAN',
          capacity: 10,
          unit: 'Mbps',
          costPerHour: 0.01,
          infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
        },
        {
          id: 'cpu',
          name: 'Compute pool',
          capacity: 2,
          unit: 'cores',
          costPerHour: 0.4,
          infrastructure: { kind: 'cpu', unit: 'cores' },
        },
        {
          id: 'ram',
          name: 'In-flight request RAM',
          capacity: 1024,
          unit: 'MiB',
          costPerHour: 0.001,
          infrastructure: { kind: 'memory', unit: 'MiB' },
        },
        {
          id: 'db',
          name: 'Database connections',
          capacity: 4,
          unit: 'connection',
          costPerHour: 0.1,
        },
        {
          id: 'power',
          name: 'Datacenter power budget',
          capacity: 1,
          unit: 'kW',
          costPerHour: 0.2,
          infrastructure: {
            kind: 'energy',
            unit: 'kW',
            generation: [{ startSeconds: 0, endSeconds: 120, powerKW: 0.3 }],
            gridImportLimitKW: 0.2,
            pricePerKWh: 1.5,
            battery: {
              capacityKWh: 0.01,
              initialKWh: 0.005,
              maxChargeKW: 0.2,
              maxDischargeKW: 0.3,
              chargeEfficiency: 0.9,
              dischargeEfficiency: 0.9,
            },
          },
        },
      ],
      nodes: [
        {
          id: 'north-arrivals',
          name: 'North: 100 users',
          type: 'source',
          processId: 'north',
          description: '100 users × 0.075 requests/user/second = 7.5 requests/second.',
          source: { particleTypeId: 'north-request', ratePerHour: 27000, distribution: 'regular' },
        },
        {
          id: 'south-arrivals',
          name: 'South: 100 users',
          type: 'source',
          processId: 'south',
          description: '100 users × 0.075 requests/user/second = 7.5 requests/second.',
          source: { particleTypeId: 'south-request', ratePerHour: 27000, distribution: 'regular' },
        },
        {
          id: 'receive',
          name: 'Receive + reserve RAM',
          type: 'work',
          processId: 'service',
          work: {
            processingSeconds: 0.005,
            capacity: 32,
            infrastructure: { memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }] },
          },
        },
        {
          id: 'compute-fork',
          name: 'Compute + energy budget',
          type: 'fork',
          processId: 'service',
          fork: { joinNodeId: 'compute-join', branchEdgeIds: ['cpu-branch', 'power-branch'] },
        },
        {
          id: 'compute',
          name: 'Compute request',
          type: 'work',
          processId: 'service',
          work: {
            processingSeconds: 0,
            capacity: 32,
            infrastructure: { cpu: { resourceId: 'cpu', coreSeconds: 0.1, cores: 1 } },
          },
        },
        {
          id: 'energy',
          name: 'Deliver job energy budget',
          type: 'work',
          processId: 'service',
          work: {
            processingSeconds: 0,
            capacity: 32,
            infrastructure: { energy: { resourceId: 'power', energyKWh: 0.000001, powerKW: 0.04 } },
          },
        },
        {
          id: 'compute-join',
          name: 'Both requirements met',
          type: 'join',
          processId: 'service',
          join: { forkNodeId: 'compute-fork' },
        },
        {
          id: 'database',
          name: 'Read database',
          type: 'work',
          processId: 'service',
          work: {
            processingSeconds: 0.02,
            capacity: 16,
            resourceRequirements: [{ resourceId: 'db', units: 1 }],
          },
        },
        {
          id: 'replied',
          name: 'Response delivered',
          type: 'outcome',
          processId: 'service',
          outcome: { status: 'completed', revenue: true },
        },
        ...['wan', 'cpu', 'ram', 'db', 'power'].map((id) => ({
          id: `${id}-pool`,
          name: {
            wan: 'Shared WAN',
            cpu: 'Compute pool',
            ram: 'In-flight RAM',
            db: 'Database pool',
            power: 'Power budget',
          }[id]!,
          type: 'resource' as const,
          resourceId: id,
        })),
      ],
      edges: [
        {
          id: 'north-upload',
          sourceNodeId: 'north-arrivals',
          targetNodeId: 'receive',
          travelSeconds: 0.02,
          infrastructure: { transfer: { resourceId: 'wan', bytes: 128 * 1024 } },
        },
        {
          id: 'south-upload',
          sourceNodeId: 'south-arrivals',
          targetNodeId: 'receive',
          travelSeconds: 0.05,
          infrastructure: { transfer: { resourceId: 'wan', bytes: 128 * 1024 } },
        },
        { id: 'to-fork', sourceNodeId: 'receive', targetNodeId: 'compute-fork' },
        { id: 'cpu-branch', sourceNodeId: 'compute-fork', targetNodeId: 'compute' },
        { id: 'power-branch', sourceNodeId: 'compute-fork', targetNodeId: 'energy' },
        { id: 'cpu-join', sourceNodeId: 'compute', targetNodeId: 'compute-join' },
        { id: 'power-join', sourceNodeId: 'energy', targetNodeId: 'compute-join' },
        { id: 'to-database', sourceNodeId: 'compute-join', targetNodeId: 'database' },
        {
          id: 'response',
          sourceNodeId: 'database',
          targetNodeId: 'replied',
          travelSeconds: 0.02,
          infrastructure: { transfer: { resourceId: 'wan', bytes: 16 * 1024 } },
        },
      ],
      improvements: [],
      scenarios: [
        {
          id: 'demand-stress',
          name: 'Double user activity',
          overrides: {
            nodes: {
              'north-arrivals': { source: { ratePerHour: 54000 } },
              'south-arrivals': { source: { ratePerHour: 54000 } },
            },
          },
        },
        {
          id: 'wan-upgrade',
          name: '100 Mbps WAN',
          overrides: { resources: { wan: { capacity: 100 } } },
        },
        {
          id: 'balanced-upgrade',
          name: 'WAN + compute + RAM + power',
          overrides: {
            resources: {
              wan: { capacity: 100 },
              cpu: { capacity: 4 },
              ram: { capacity: 2048 },
              power: { capacity: 2, infrastructure: { gridImportLimitKW: 0.8 } },
            },
          },
        },
      ],
      defaults: { durationSeconds: 120, seed: 42 },
    };
  }
  graph(name = 'Datacenter Capacity') {
    const graph = capacityExampleGraph(name, this.model());
    const positions: Record<string, [number, number]> = {
      'north-arrivals': [40, 60],
      'south-arrivals': [40, 400],
      receive: [400, 210],
      'compute-fork': [760, 210],
      compute: [1100, 10],
      energy: [1100, 400],
      'compute-join': [1450, 210],
      database: [1800, 210],
      replied: [2160, 210],
      'wan-pool': [40, -280],
      'cpu-pool': [400, -280],
      'ram-pool': [760, -280],
      'db-pool': [1800, -280],
      'power-pool': [1100, -280],
    };
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        ...(node.externalId && positions[node.externalId]
          ? { x: positions[node.externalId][0], y: positions[node.externalId][1] }
          : {}),
      })),
    };
  }
}
