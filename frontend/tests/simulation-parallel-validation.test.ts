import { describe, expect, it } from 'vitest';
import { validateSimulationModel } from '../src/simulation/schema';
import { parallelLimits } from '../src/simulation/parallel-topology';
import type { SimulationModel, SimulationNode } from '../src/simulation/types';
import { nestedParallelModel, parallelModel } from './helpers/parallel-model';

const fork = (model: SimulationModel) =>
  model.nodes.find((node) => node.type === 'fork') as Extract<SimulationNode, { type: 'fork' }>;
const join = (model: SimulationModel) =>
  model.nodes.find((node) => node.type === 'join') as Extract<SimulationNode, { type: 'join' }>;
describe('closed structured parallel topology validation', () => {
  it.each([
    [
      'missing join',
      (model: SimulationModel) => {
        fork(model).fork.joinNodeId = 'missing';
      },
    ],
    [
      'mismatched join',
      (model: SimulationModel) => {
        join(model).join.forkNodeId = 'work-0';
      },
    ],
    [
      'unknown branch',
      (model: SimulationModel) => {
        fork(model).fork.branchEdgeIds[0] = 'missing';
      },
    ],
    [
      'duplicate branch',
      (model: SimulationModel) => {
        fork(model).fork.branchEdgeIds[1] = fork(model).fork.branchEdgeIds[0];
      },
    ],
    [
      'only one branch',
      (model: SimulationModel) => {
        fork(model).fork.branchEdgeIds.pop();
      },
    ],
    [
      'undeclared outgoing',
      (model: SimulationModel) => {
        model.edges.push({ id: 'extra', sourceNodeId: 'fork', targetNodeId: 'work-0' });
      },
    ],
    [
      'filtered branch',
      (model: SimulationModel) => {
        model.edges.find((edge) => edge.id === 'branch-0')!.particleTypeIds = ['work-item'];
      },
    ],
    [
      'independent incoming',
      (model: SimulationModel) => {
        model.edges.push({ id: 'external', sourceNodeId: 'source', targetNodeId: 'work-0' });
      },
    ],
    [
      'direct unrelated join arrival',
      (model: SimulationModel) => {
        model.edges.push({ id: 'external', sourceNodeId: 'source', targetNodeId: 'join' });
      },
    ],
    [
      'early revenue outcome',
      (model: SimulationModel) => {
        model.edges.find((edge) => edge.id === 'to-join-0')!.targetNodeId = 'outcome';
      },
    ],
    [
      'dead branch',
      (model: SimulationModel) => {
        model.edges = model.edges.filter((edge) => edge.id !== 'to-join-0');
      },
    ],
    [
      'internal cycle',
      (model: SimulationModel) => {
        model.edges.push({ id: 'loop', sourceNodeId: 'work-0', targetNodeId: 'work-0' });
      },
    ],
    [
      'cross-pair cycle',
      (model: SimulationModel) => {
        model.edges.find((edge) => edge.id === 'to-outcome')!.targetNodeId = 'fork';
      },
    ],
    [
      'back edge into fork',
      (model: SimulationModel) => {
        model.edges.find((edge) => edge.id === 'to-join-0')!.targetNodeId = 'fork';
      },
    ],
    [
      'source inside branch',
      (model: SimulationModel) => {
        model.nodes.find((node) => node.id === 'work-0')!.type = 'source';
        Object.assign(model.nodes.find((node) => node.id === 'work-0')!, {
          source: { particleTypeId: 'work-item', burst: 1 },
        });
      },
    ],
  ] as const)('rejects %s before execution', (_name, mutate) => {
    const model = parallelModel();
    mutate(model);
    expect(() => validateSimulationModel(model)).toThrow();
  });
  it('rejects crossed pairs instead of letting unrelated branch tokens satisfy another join', () => {
    const model = nestedParallelModel(2);
    const other = model.nodes.find((node) => node.id === 'fork-1')!;
    if (other.type !== 'fork') throw new Error('Missing fixture fork');
    other.fork.joinNodeId = 'join-0';
    const otherJoin = model.nodes.find((node) => node.id === 'join-0')!;
    if (otherJoin.type !== 'join') throw new Error('Missing fixture join');
    otherJoin.join.forkNodeId = 'fork-1';
    expect(() => validateSimulationModel(model)).toThrow(/matching/);
  });
  it('rejects structurally crossing pairs even when their references match', () => {
    const model = nestedParallelModel(2);
    model.edges.find((edge) => edge.id === 'return-0')!.targetNodeId = 'join-1';
    expect(() => validateSimulationModel(model)).toThrow(/unrelated|cross/);
  });
  it('allows explicit branch failure paths but requires each mandatory branch to have a valid join path', () => {
    const model = parallelModel();
    model.nodes.push({
      id: 'reject',
      name: 'Failed branch',
      type: 'outcome',
      outcome: { status: 'failed', revenue: false },
    });
    model.edges.push({ id: 'possible-failure', sourceNodeId: 'work-0', targetNodeId: 'reject' });
    validateSimulationModel(model);
    model.edges = model.edges.filter((edge) => edge.id !== 'to-join-0');
    expect(() => validateSimulationModel(model)).toThrow(/every branch/);
  });
  it('allows branches directly to their join, where zero-time arrivals are still correlated separately', () => {
    const model = parallelModel();
    model.nodes = model.nodes.filter((node) => !node.id.startsWith('work-'));
    model.edges = model.edges.filter((edge) => !edge.id.startsWith('to-join-'));
    for (const edge of model.edges) if (edge.sourceNodeId === 'fork') edge.targetNodeId = 'join';
    validateSimulationModel(model);
  });
  it('bounds fan-out and nesting explicitly', () => {
    validateSimulationModel(
      parallelModel({ durations: Array.from({ length: parallelLimits.branches }, () => 1) }),
    );
    expect(() =>
      validateSimulationModel(
        parallelModel({ durations: Array.from({ length: parallelLimits.branches + 1 }, () => 1) }),
      ),
    ).toThrow(/2–64/);
    validateSimulationModel(nestedParallelModel(parallelLimits.nesting));
    expect(() => validateSimulationModel(nestedParallelModel(parallelLimits.nesting + 1))).toThrow(
      /16 levels/,
    );
  });
  it('does not reject existing nonparallel loops elsewhere in the same model', () => {
    const model = parallelModel();
    model.nodes.push(
      {
        id: 'legacy-a',
        name: 'Legacy A',
        type: 'work',
        work: { capacity: 1, processingSeconds: 1 },
      },
      {
        id: 'legacy-b',
        name: 'Legacy B',
        type: 'work',
        work: { capacity: 1, processingSeconds: 1 },
      },
    );
    model.edges.push(
      { id: 'legacy-loop-a', sourceNodeId: 'legacy-a', targetNodeId: 'legacy-b' },
      { id: 'legacy-loop-b', sourceNodeId: 'legacy-b', targetNodeId: 'legacy-a' },
    );
    validateSimulationModel(model);
  });
  it('validates the effective parallel topology of every scenario', () => {
    const model = parallelModel();
    model.scenarios = [
      {
        id: 'broken',
        name: 'Broken pair',
        overrides: { nodes: { fork: { fork: { branchEdgeIds: ['branch-0'] } } } },
      },
    ];
    expect(() => validateSimulationModel(model)).toThrow(/declare all/);
  });
});
