import type { Graph } from '../../model/types';
import { createSimulationGraph, setSimulationModel } from '../document';
import type { SimulationModel, SimulationNode, Resource, SimulationEdge } from '../types';

export const infrastructureTemplateKeys = [
  'api-compute-capacity',
  'network-multi-site-capacity',
  'energy-power-capacity',
] as const;
export type InfrastructureTemplateKey = (typeof infrastructureTemplateKeys)[number];
export const infrastructureTemplateNames: Record<InfrastructureTemplateKey, string> = {
  'api-compute-capacity': 'API & Compute Capacity',
  'network-multi-site-capacity': 'Network & Multi-Site Capacity',
  'energy-power-capacity': 'Energy & Power Capacity',
};
const particle = (id: string, name: string, color: string, revenue = 0) => ({
  id,
  name,
  color,
  shape: 'circle' as const,
  revenue,
  complexity: { min: 1, max: 1 },
  priority: 0,
});
const source = (
  id: string,
  name: string,
  particleTypeId: string,
  ratePerHour: number,
  processId?: string,
): SimulationNode => ({
  id,
  name,
  type: 'source',
  processId,
  source: { particleTypeId, ratePerHour, distribution: 'regular' },
});
const resourceNode = (resource: Resource): SimulationNode => ({
  id: `${resource.id}-pool`,
  name: resource.name,
  type: 'resource',
  resourceId: resource.id,
});
const outcome = (id: string, name: string, processId?: string): SimulationNode => ({
  id,
  name,
  processId,
  type: 'outcome',
  outcome: { status: 'completed', revenue: true },
});
const edge = (sourceNodeId: string, targetNodeId: string, travelSeconds = 0): SimulationEdge => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  travelSeconds,
});
const base = (description: string): SimulationModel => ({
  type: 'process-simulator',
  schemaVersion: 2,
  infrastructure: { schemaVersion: 1 },
  currency: 'SEK',
  description,
  particleTypes: [],
  nodes: [],
  edges: [],
  resources: [],
  improvements: [],
  scenarios: [],
  defaults: { durationSeconds: 120, seed: 42 },
});

/** All assumptions are synthetic. Coordinates describe presentation, never capacity or routing. */
export function capacityExampleGraph(
  name: string,
  model: SimulationModel,
  existing?: Graph,
): Graph {
  const graph = existing ? setSimulationModel(existing, model) : createSimulationGraph(name, model);
  const networkLayout =
    graph.nodes.some((node) => node.externalId === 'source-a') &&
    graph.nodes.some((node) => node.externalId === 'source-b');
  const positions: Record<string, [number, number]> = {
    'source-a': [40, 80],
    'send-a': [400, 80],
    'source-b': [40, 440],
    'send-b': [400, 440],
    receive: [780, 260],
    acknowledged: [1140, 260],
    'backbone-pool': [780, -240],
    'return-link-pool': [1140, -240],
  };
  let step = 0,
    pool = 0;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const config = graph.simulation!.nodes.find((value) => value.id === node.id);
      const position = networkLayout && node.externalId ? positions[node.externalId] : undefined;
      if (position)
        return {
          ...node,
          x: position[0],
          y: position[1],
          width: 280,
          height: config?.type === 'resource' ? 240 : config?.type === 'work' ? 270 : 180,
        };
      if (config?.type === 'resource')
        return { ...node, x: 390 + pool++ * 360, y: -220, width: 280, height: 240 };
      return {
        ...node,
        x: 40 + step++ * 360,
        y: 140,
        width: 280,
        height: config?.type === 'work' ? 270 : 180,
      };
    }),
  };
}

export class ApiComputeCapacityExample {
  model(): SimulationModel {
    const model = base(
      'Synthetic API service: regular 15 requests/second. Parsing retains 96 MiB per root request through CPU wait and response, then terminal completion releases it. Each request uses 0.2 core-seconds on one core plus 15 ms fixed overhead. Two CPU cores and 512 MiB RAM are shared across concurrent requests. Eight database connection slots cost 0.05 SEK per available connection/hour; execution atomically holds one connection together with its CPU allocation and releases it after execution. This is a connection-pool/service-demand abstraction, not database I/O physics or a hardware benchmark. Edit capacities or create a scenario and rerun.',
    );
    model.particleTypes = [particle('request', 'API request', '#2563eb', 0.02)];
    model.resources = [
      {
        id: 'cpu',
        name: 'API CPU pool',
        capacity: 2,
        unit: 'cores',
        costPerHour: 0.4,
        infrastructure: { kind: 'cpu', unit: 'cores' },
      },
      {
        id: 'ram',
        name: 'Request RAM',
        capacity: 512,
        unit: 'MiB',
        costPerHour: 0.001,
        infrastructure: { kind: 'memory', unit: 'MiB' },
      },
      {
        id: 'db',
        name: 'Database connection pool',
        capacity: 8,
        unit: 'connections',
        costPerHour: 0.05,
      },
    ];
    model.nodes = [
      source('requests', 'Incoming API requests', 'request', 54000),
      {
        id: 'parse',
        name: 'Parse request',
        type: 'work',
        work: {
          processingSeconds: 0.005,
          capacity: 32,
          infrastructure: { memory: [{ resourceId: 'ram', amountMiB: 96, scope: 'case' }] },
        },
      },
      {
        id: 'execute',
        name: 'Execute API request',
        type: 'work',
        work: {
          processingSeconds: 0.015,
          capacity: 32,
          resourceRequirements: [{ resourceId: 'db', units: 1 }],
          infrastructure: {
            cpu: { resourceId: 'cpu', coreSeconds: 0.2, cores: 1 },
            memory: [{ resourceId: 'ram', amountMiB: 96, scope: 'case' }],
          },
        },
      },
      outcome('replied', 'Response delivered'),
      ...model.resources.map(resourceNode),
    ];
    model.edges = [
      edge('requests', 'parse'),
      edge('parse', 'execute'),
      edge('execute', 'replied', 0.02),
    ];
    model.scenarios = [
      {
        id: 'database-limit',
        name: 'One database connection',
        overrides: {
          resources: { cpu: { capacity: 4 }, ram: { capacity: 1024 }, db: { capacity: 1 } },
        },
      },
      { id: 'more-cpu', name: 'Double CPU', overrides: { resources: { cpu: { capacity: 4 } } } },
      {
        id: 'cpu-and-memory',
        name: 'CPU + RAM headroom',
        overrides: { resources: { cpu: { capacity: 4 }, ram: { capacity: 1024 } } },
      },
    ];
    return model;
  }
  graph(name: string) {
    return capacityExampleGraph(name, this.model());
  }
}

export class NetworkMultiSiteCapacityExample {
  model(): SimulationModel {
    const model = base(
      'Synthetic two-site uploads share one 50 Mbps backbone. Site A sends 12 requests/minute with 16 MiB payloads; Site B sends 10 requests/minute with 32 MiB payloads. Active transfers share bandwidth equally and reschedule as transfers join/leave. Propagation of 30/80 ms follows serialization. Received uploads need one second of processing; acknowledgements share a separate 10 Mbps return link. This models fluid payload movement, not TCP, congestion control or physical geographic distance.',
    );
    model.defaults.durationSeconds = 600;
    model.processes = [
      { id: 'site-a', name: 'Site A' },
      { id: 'site-b', name: 'Site B' },
      { id: 'central', name: 'Central service' },
    ];
    model.particleTypes = [
      particle('upload-a', 'Site A upload', '#2563eb', 1),
      particle('upload-b', 'Site B upload', '#8b5cf6', 1),
    ];
    model.resources = [
      {
        id: 'backbone',
        name: 'Shared backbone',
        capacity: 50,
        unit: 'Mbps',
        infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
      },
      {
        id: 'return-link',
        name: 'Acknowledgement link',
        capacity: 10,
        unit: 'Mbps',
        infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
      },
    ];
    model.nodes = [
      source('source-a', 'Site A upload requests', 'upload-a', 720, 'site-a'),
      source('source-b', 'Site B upload requests', 'upload-b', 600, 'site-b'),
      {
        id: 'send-a',
        name: 'Prepare Site A payload',
        processId: 'site-a',
        type: 'work',
        work: { capacity: 16, processingSeconds: 0.05 },
      },
      {
        id: 'send-b',
        name: 'Prepare Site B payload',
        processId: 'site-b',
        type: 'work',
        work: { capacity: 16, processingSeconds: 0.05 },
      },
      {
        id: 'receive',
        name: 'Process received upload',
        processId: 'central',
        type: 'work',
        work: { capacity: 4, processingSeconds: 1 },
      },
      outcome('acknowledged', 'Upload acknowledged', 'central'),
      ...model.resources.map(resourceNode),
    ];
    model.edges = [
      edge('source-a', 'send-a'),
      edge('source-b', 'send-b'),
      {
        ...edge('send-a', 'receive', 0.03),
        infrastructure: { transfer: { resourceId: 'backbone', bytes: 16 * 1048576 } },
      },
      {
        ...edge('send-b', 'receive', 0.08),
        infrastructure: { transfer: { resourceId: 'backbone', bytes: 32 * 1048576 } },
      },
      {
        ...edge('receive', 'acknowledged', 0.03),
        infrastructure: { transfer: { resourceId: 'return-link', bytes: 128 * 1024 } },
      },
    ];
    model.scenarios = [
      {
        id: 'more-bandwidth',
        name: '100 Mbps backbone',
        overrides: { resources: { backbone: { capacity: 100 } } },
      },
      {
        id: 'lower-propagation',
        name: 'Lower fixed latency',
        overrides: {
          resources: { backbone: { capacity: 100 } },
          edges: {
            'send-a-receive': { travelSeconds: 0.01 },
            'send-b-receive': { travelSeconds: 0.01 },
          },
        },
      },
    ];
    return model;
  }
  graph(name: string) {
    return capacityExampleGraph(name, this.model());
  }
}

export class EnergyPowerCapacityExample {
  model(): SimulationModel {
    const model = base(
      'Synthetic charging workload: 24 requests/hour, each requiring 1 kWh at a requested 3 kW. Six jobs may be active. Supply is limited by a 10 kW bus, time-varying generation, a 2 kW grid import and a 6 kWh battery initially at 50% SOC. Charge/discharge efficiency is 90%; losses, curtailment and unmet requested power are measured. Jobs slow until their actual delivered energy reaches 1 kWh. This is a DC energy-balance allocation model, not an AC load-flow, voltage, frequency or protection study.',
    );
    model.defaults.durationSeconds = 7200;
    model.particleTypes = [particle('charge', 'Charging request', '#f59e0b', 0.5)];
    model.resources = [
      {
        id: 'power',
        name: 'Generation + grid + battery',
        capacity: 10,
        unit: 'kW',
        infrastructure: {
          kind: 'energy',
          unit: 'kW',
          generation: [
            { startSeconds: 0, endSeconds: 1800, powerKW: 2 },
            { startSeconds: 1800, endSeconds: 3600, powerKW: 8 },
            { startSeconds: 3600, endSeconds: 7200, powerKW: 1 },
          ],
          gridImportLimitKW: 2,
          pricePerKWh: 1.5,
          battery: {
            capacityKWh: 6,
            initialKWh: 3,
            maxChargeKW: 3,
            maxDischargeKW: 4,
            chargeEfficiency: 0.9,
            dischargeEfficiency: 0.9,
          },
        },
      },
    ];
    model.nodes = [
      source('charging-requests', 'Charging requests', 'charge', 24),
      {
        id: 'charging',
        name: 'Deliver requested energy',
        type: 'work',
        work: {
          processingSeconds: 0,
          capacity: 6,
          infrastructure: { energy: { resourceId: 'power', energyKWh: 1, powerKW: 3 } },
        },
      },
      outcome('charged', 'Charging completed'),
      ...model.resources.map(resourceNode),
    ];
    model.edges = [edge('charging-requests', 'charging'), edge('charging', 'charged')];
    model.scenarios = [
      {
        id: 'more-energy',
        name: 'Larger battery + grid',
        overrides: {
          resources: {
            power: {
              capacity: 20,
              infrastructure: {
                gridImportLimitKW: 6,
                battery: { capacityKWh: 12, initialKWh: 12, maxChargeKW: 6, maxDischargeKW: 8 },
              },
            },
          },
        },
      },
      {
        id: 'lower-peak-power',
        name: 'Lower requested job power',
        overrides: {
          nodes: { charging: { work: { infrastructure: { energy: { powerKW: 1.5 } } } } },
        },
      },
    ];
    return model;
  }
  graph(name: string) {
    return capacityExampleGraph(name, this.model());
  }
}

export function infrastructureExample(key: string) {
  return key === 'api-compute-capacity'
    ? new ApiComputeCapacityExample()
    : key === 'network-multi-site-capacity'
      ? new NetworkMultiSiteCapacityExample()
      : key === 'energy-power-capacity'
        ? new EnergyPowerCapacityExample()
        : undefined;
}
