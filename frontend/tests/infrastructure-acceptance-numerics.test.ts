import { expect, it } from 'vitest';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import type { SimulationNode } from '../src/simulation/types';

function model(particles = 1) {
  const value = createBasicModel({ particles, capacity: particles });
  value.schemaVersion = 2;
  value.infrastructure = { schemaVersion: 1 };
  const work = value.nodes.find((node) => node.type === 'work') as Extract<
    SimulationNode,
    { type: 'work' }
  >;
  work.work.processingSeconds = 0;
  return { value, work };
}

it.each([1, 2])(
  'IC05: %s core-seconds on equally many reserved cores takes one second',
  (cores) => {
    const { value, work } = model();
    value.resources = [
      {
        id: 'cpu',
        name: 'Dedicated cores',
        capacity: cores,
        unit: 'cores',
        infrastructure: { kind: 'cpu', unit: 'cores' },
      },
    ];
    work.work.infrastructure = { cpu: { resourceId: 'cpu', coreSeconds: cores, cores } };
    const result = runSimulation(value, { untilComplete: true });
    expect(result.completedAtSeconds).toBe(1);
    expect(result.metrics.completed).toBe(1);
    expect(result.infrastructure!.cpu.cpu.completedWorkCoreSeconds).toBe(cores);
  },
);

it('IC11: two 10 MB payloads share 100 Mbps and each adds propagation once', () => {
  const { value } = model(2);
  value.resources = [
    {
      id: 'link',
      name: 'Shared link',
      capacity: 100,
      unit: 'Mbps',
      infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
    },
  ];
  const outcome = value.nodes.find((node) => node.type === 'outcome')!;
  value.nodes = value.nodes.filter((node) => node.type !== 'work');
  value.edges = [
    {
      ...value.edges[0],
      targetNodeId: outcome.id,
      infrastructure: { transfer: { resourceId: 'link', bytes: 10_000_000 } },
      travelSeconds: 0.02,
    },
  ];
  const result = runSimulation(value, { untilComplete: true });
  expect(result.completedAtSeconds).toBe(1.62);
  expect(result.metrics.completed).toBe(2);
  expect(result.infrastructure!.bandwidth.link.transferredBytes).toBe(20_000_000);
  expect(result.infrastructure!.bandwidth.link.busySeconds).toBeCloseTo(1.6, 12);
});

it('IC14: generation and lossless battery supply a 10 kWh job in one hour', () => {
  const { value, work } = model();
  value.resources = [
    {
      id: 'power',
      name: 'Generation and battery',
      capacity: 10,
      unit: 'kW',
      infrastructure: {
        kind: 'energy',
        unit: 'kW',
        generation: [{ startSeconds: 0, endSeconds: 7200, powerKW: 5 }],
        battery: {
          capacityKWh: 10,
          initialKWh: 10,
          maxChargeKW: 5,
          maxDischargeKW: 5,
          chargeEfficiency: 1,
          dischargeEfficiency: 1,
        },
      },
    },
  ];
  work.work.infrastructure = { energy: { resourceId: 'power', energyKWh: 10, powerKW: 10 } };
  const result = runSimulation(value, { untilComplete: true });
  expect(result.completedAtSeconds).toBe(3600);
  expect(result.infrastructure!.energy.power).toMatchObject({
    generatedKWh: 5,
    deliveredKWh: 10,
    gridImportedKWh: 0,
    storedKWh: 5,
    stateOfCharge: 0.5,
    conversionLossKWh: 0,
  });
});
