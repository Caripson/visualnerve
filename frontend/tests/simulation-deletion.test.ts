import { describe, expect, it } from 'vitest';
import { createKioskModel } from '../src/simulation/examples';
import { removeSimulationEntity } from '../src/simulation/deletion';
import { validateSimulationModel, resolveScenario } from '../src/simulation/schema';

function fixture() {
  const model = createKioskModel();
  const work = model.nodes.find((node) => node.id === 'core-sales')!;
  if (work.type === 'work') {
    work.work.acceptedParticleTypeIds = ['core-customer', 'package-customer'];
    work.work.overflowNodeId = 'package-revenue';
  }
  model.nodes.push({
    id: 'router',
    name: 'Router',
    type: 'router',
    router: {
      mode: 'first-match',
      fallbackEdgeId: 'router-route',
      rules: [
        {
          edgeId: 'router-route',
          condition: {
            field: 'queue',
            operator: 'gt',
            nodeId: 'core-sales',
            value: 10,
          },
        },
      ],
    },
  });
  model.edges.push(
    { id: 'router-route', sourceNodeId: 'router', targetNodeId: 'core-sales' },
    { id: 'overflow-route', sourceNodeId: 'core-sales', targetNodeId: 'package-revenue' },
  );
  model.improvements.push(
    {
      id: 'training',
      name: 'Training',
      resourceId: 'store-staff',
      enabled: true,
      investmentCost: 100,
    },
    {
      id: 'inspection',
      name: 'Inspection',
      nodeId: 'core-sales',
      enabled: true,
      investmentCost: 100,
      failureProbability: 0.1,
      failureNodeId: 'package-revenue',
    },
  );
  model.scenarios.push({
    id: 'custom',
    name: 'Custom',
    overrides: {
      resources: { 'store-staff': { capacity: 3 } },
      nodes: {
        'core-source': { source: { particleTypeId: 'core-customer', ratePerHour: 40 } },
        'core-sales': {
          work: { ...(work.type === 'work' ? work.work : {}), capacity: 2, processingSeconds: 120 },
        },
        router: {
          router: {
            mode: 'weighted',
            fallbackEdgeId: 'router-route',
            rules: [{ edgeId: 'router-route', weight: 1 }],
          },
        },
      },
      edges: { 'router-route': { travelSeconds: 2 } },
      improvements: { inspection: { enabled: false }, training: { enabled: false } },
    },
  });
  validateSimulationModel(model);
  return model;
}

describe('semantic deletion with scenario cleanup', () => {
  it('disconnects a deleted resource and removes its displays/investments in every scenario', () => {
    const original = fixture(),
      preserved = structuredClone(original);
    const deleted = removeSimulationEntity(original, 'resources', 'store-staff');
    validateSimulationModel(deleted);
    expect(original).toEqual(preserved);
    for (const model of [
      deleted,
      ...deleted.scenarios.map((scenario) => resolveScenario(deleted, scenario.id)),
    ]) {
      expect(model.resources.some((resource) => resource.id === 'store-staff')).toBe(false);
      expect(
        model.nodes.some((node) => node.type === 'resource' && node.resourceId === 'store-staff'),
      ).toBe(false);
      expect(
        model.nodes.some(
          (node) =>
            node.type === 'work' &&
            node.work.resourceRequirements?.some((ref) => ref.resourceId === 'store-staff'),
        ),
      ).toBe(false);
      expect(model.improvements.some((feature) => feature.id === 'training')).toBe(false);
    }
    expect(
      resolveScenario(deleted, 'custom').nodes.find((node) => node.id === 'core-sales'),
    ).toMatchObject({ work: { capacity: 2 } });
  });
  it('removes deleted nodes from routing, investments and scenario overrides', () => {
    const deleted = removeSimulationEntity(fixture(), 'nodes', 'core-sales');
    validateSimulationModel(deleted);
    expect(deleted.nodes.find((node) => node.id === 'router')).toMatchObject({
      router: { rules: [], fallbackEdgeId: undefined },
    });
    expect(deleted.improvements.some((feature) => feature.id === 'inspection')).toBe(false);
    expect(
      deleted.scenarios.find((scenario) => scenario.id === 'custom')!.overrides.nodes,
    ).not.toHaveProperty('core-sales');
    expect(
      deleted.scenarios.find((scenario) => scenario.id === 'custom')!.overrides.improvements,
    ).not.toHaveProperty('inspection');
  });
  it('clears direct overflow and failure routes when their connection is deleted', () => {
    const deleted = removeSimulationEntity(fixture(), 'edges', 'overflow-route');
    validateSimulationModel(deleted);
    for (const model of [deleted, resolveScenario(deleted, 'custom')]) {
      const work = model.nodes.find((node) => node.id === 'core-sales')!;
      expect(work.type === 'work' ? work.work.overflowNodeId : null).toBeUndefined();
      expect(
        model.improvements.find((feature) => feature.id === 'inspection')?.failureNodeId,
      ).toBeUndefined();
    }
  });
  it('removes sources of a deleted particle type and cleans accepted types and scenario references', () => {
    const deleted = removeSimulationEntity(fixture(), 'particleTypes', 'core-customer');
    validateSimulationModel(deleted);
    expect(deleted.nodes.some((node) => node.id === 'core-source')).toBe(false);
    expect(deleted.nodes.find((node) => node.id === 'core-sales')).toMatchObject({
      work: { acceptedParticleTypeIds: ['package-customer'] },
    });
    expect(
      deleted.scenarios.find((scenario) => scenario.id === 'custom')!.overrides.nodes,
    ).not.toHaveProperty('core-source');
  });
});
