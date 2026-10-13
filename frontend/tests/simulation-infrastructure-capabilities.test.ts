import { expect, it } from 'vitest';
import { simulationCapabilities } from '../src/storage/simulation-capabilities';
import {
  infrastructureLimits,
  infrastructureDisplayConversions,
} from '../src/simulation/infrastructure/types';
import { assertMcpAccess } from '../src/integration/access';

it('discovers the model execution boundary, canonical units and aggregate typed pool policy', () => {
  expect(simulationCapabilities).toMatchObject({
    schemaVersion: 1,
    apiVersion: '0.10.0',
    supportedModelSchemaVersions: [1, 2],
    infrastructure: {
      schemaVersion: 1,
      requiredModelSchemaVersion: 2,
      capability: 'infrastructure-resources-v1',
      units: { cpu: 'cores', memory: 'MiB', bandwidth: 'Mbps', energy: 'kW' },
      displayConversions: infrastructureDisplayConversions,
      metricsField: 'state/result.infrastructure',
      bottleneckMethodologies: [
        'queue-history',
        'blocked-admission',
        'bandwidth-sharing',
        'bandwidth-unavailable',
        'energy-shortfall',
      ],
      continuousTotals: {
        absoluteTolerance: 1e-9,
        relativeTolerance: 1e-9,
        rawUnrounded: true,
        discreteCountsOrderEventMillisecondsAndCapacities: 'exact',
      },
      compatibility: { legacyModelSchemaVersion: 1, liveCollaboration: false },
      limits: infrastructureLimits,
      bandwidth: { schedules: true, scaling: false, bytesPerSecondPerMbps: 125000 },
      energy: { schedules: false, scaling: false, charging: 'generation-surplus-only' },
    },
    visualCapacity: {
      typedPools: 'aggregate-domain-summaries',
      typedPoolsIndividualUnits: false,
      infrastructureWork: 'aggregate-in-flight-concurrency',
      infrastructureResources: 'aggregate-pools',
    },
  });
  expect(simulationCapabilities.features).toContain('infrastructure-resources-v1');
  expect(() => assertMcpAccess('read', '/simulation/capabilities', 'GET')).not.toThrow();
  expect(() =>
    assertMcpAccess('read', '/diagrams/id/simulation/runs/run/state', 'GET'),
  ).not.toThrow();
  expect(() =>
    assertMcpAccess(
      'read',
      '/diagrams/11111111-1111-4111-8111-111111111111/simulation/compare',
      'POST',
    ),
  ).not.toThrow();
  expect(() =>
    assertMcpAccess('read', '/diagrams/id/simulation/resources/resource', 'PATCH'),
  ).toThrow(/read-only/);
  expect(() => assertMcpAccess('read', '/diagrams/id/simulation/runs', 'POST')).toThrow(
    /read-only/,
  );
});
