import { describe, expect, it } from 'vitest';
import { simulationCapabilities } from '../src/storage/simulation-capabilities';
import { simulationExecutionLimits } from '../src/simulation/engine';
import { parallelLimits } from '../src/simulation/parallel-topology';
import { ParticleRoute } from '../src/simulation/particle-route';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

describe('programmatic parallel execution discovery', () => {
  it('exposes the complete additive semantics and the actual engine limits', () => {
    expect(simulationCapabilities.schemaVersion).toBe(1);
    expect(simulationCapabilities.nodeTypes).toEqual(
      expect.arrayContaining(['source', 'work', 'router', 'fork', 'join', 'resource', 'outcome']),
    );
    expect(simulationCapabilities.features).toContain('parallel-fork-join');
    expect(simulationCapabilities.execution.routeAggregation).toEqual({
      exactLabelCharacters: ParticleRoute.labelLimit,
      summaryPrefixCharacters: ParticleRoute.prefixLimit,
      digest: 'ordered-composable-dual-32-bit-with-edge-count',
      completedRouteBuckets: 256,
      overflow: '[other routes]',
      workRevenueAttribution: 'deduplicated-visited-work-nodes',
    });
    expect(simulationCapabilities.parallel).toMatchObject({
      mode: 'all-mandatory',
      fork: {
        joinNodeId: 'fork.joinNodeId',
        branchEdgeIds: 'fork.branchEdgeIds',
        outgoing: 'all-declared',
        particleTypeFilters: false,
      },
      join: {
        forkNodeId: 'join.forkNodeId',
        correlation: 'business-case-and-fork-group',
        wait: 'all-declared-branches',
      },
      cancellation: 'any-branch-failure-or-abandonment-cancels-entire-case',
      incurredCosts: 'retained-on-cancellation',
      population: 'original-business-cases',
      workTokens: 'independent-queue-resource-consuming-children',
      processingAndWaiting: 'summed-branch-effort',
      timeToRevenue: 'original-creation-to-single-outcome',
      stateField: 'parallel',
      joinMetricsField: 'nodes[].join',
      groupSampling: 'bounded-by-particle-retention',
      limits: { ...parallelLimits, liveTokens: simulationExecutionLimits.activeParticles },
      mutations: 'atomic-full-model-put-for-pair-and-topology-changes',
    });
  });
  it('returns detached semantic discovery through the existing Repository/API command', async () => {
    const database = new WorkspaceDatabase(`parallel-discovery-${crypto.randomUUID()}`);
    await database.open();
    try {
      const repo = new Repository(database);
      const first = await repo.request<typeof simulationCapabilities>('/simulation/capabilities');
      expect(first.parallel).toEqual(simulationCapabilities.parallel);
      first.parallel.limits.branches = 2;
      const second = await repo.request<typeof simulationCapabilities>(
        '/api/v1/simulation/capabilities',
      );
      expect(second.parallel.limits.branches).toBe(64);
    } finally {
      await database.delete();
    }
  });
});
