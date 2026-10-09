import { createBasicModel } from '../../src/simulation/examples';
import type { SimulationModel } from '../../src/simulation/types';

export function parallelModel(
  options: {
    particles?: number;
    durations?: number[];
    travelSeconds?: number;
    resourceCapacity?: number;
    patienceSeconds?: number;
  } = {},
): SimulationModel {
  const durations = options.durations ?? [5, 10];
  const model = createBasicModel({ particles: options.particles ?? 1 });
  if (options.patienceSeconds !== undefined)
    model.particleTypes[0].patienceSeconds = options.patienceSeconds;
  model.nodes = [
    model.nodes[0],
    {
      id: 'fork',
      name: 'Parallel work',
      type: 'fork',
      fork: { joinNodeId: 'join', branchEdgeIds: durations.map((_, index) => `branch-${index}`) },
    },
    ...durations.map((duration, index) => ({
      id: `work-${index}`,
      name: `Work ${index}`,
      type: 'work' as const,
      work: {
        processingSeconds: duration,
        capacity: options.particles ?? 1,
        ...(options.resourceCapacity !== undefined
          ? { resourceRequirements: [{ resourceId: 'staff', units: 1 }] }
          : {}),
      },
    })),
    { id: 'join', name: 'Wait for all branches', type: 'join', join: { forkNodeId: 'fork' } },
    model.nodes[2],
  ];
  model.edges = [
    { id: 'to-fork', sourceNodeId: 'source', targetNodeId: 'fork' },
    ...durations.flatMap((_, index) => [
      {
        id: `branch-${index}`,
        sourceNodeId: 'fork',
        targetNodeId: `work-${index}`,
        travelSeconds: options.travelSeconds ?? 0,
      },
      {
        id: `to-join-${index}`,
        sourceNodeId: `work-${index}`,
        targetNodeId: 'join',
        travelSeconds: options.travelSeconds ?? 0,
      },
    ]),
    { id: 'to-outcome', sourceNodeId: 'join', targetNodeId: 'outcome' },
  ];
  if (options.resourceCapacity !== undefined)
    model.resources = [
      {
        id: 'staff',
        name: 'Shared staff',
        capacity: options.resourceCapacity,
        unit: 'employee',
        costPerHour: 3600,
      },
    ];
  model.defaults.durationSeconds = 60;
  model.retention = { particles: 10000, events: 100000, checkpoints: 20 };
  return model;
}

export function nestedParallelModel(depth: number, fail = false): SimulationModel {
  const model = createBasicModel({ particles: 1 });
  model.defaults.durationSeconds = 120;
  model.nodes = [model.nodes[0], model.nodes[2]];
  model.edges = [
    { id: 'entry', sourceNodeId: 'source', targetNodeId: 'fork-0' },
    { id: 'exit', sourceNodeId: 'join-0', targetNodeId: 'outcome' },
  ];
  for (let level = 0; level < depth; level++) {
    model.nodes.push(
      {
        id: `fork-${level}`,
        name: `Fork ${level}`,
        type: 'fork',
        fork: { joinNodeId: `join-${level}`, branchEdgeIds: [`left-${level}`, `right-${level}`] },
      },
      {
        id: `join-${level}`,
        name: `Join ${level}`,
        type: 'join',
        join: { forkNodeId: `fork-${level}` },
      },
      {
        id: `work-${level}`,
        name: `Work ${level}`,
        type: 'work',
        work: { processingSeconds: fail ? 100 : level + 1, capacity: 1, costPerParticle: 1 },
      },
    );
    model.edges.push(
      { id: `left-${level}`, sourceNodeId: `fork-${level}`, targetNodeId: `work-${level}` },
      { id: `return-${level}`, sourceNodeId: `work-${level}`, targetNodeId: `join-${level}` },
      {
        id: `right-${level}`,
        sourceNodeId: `fork-${level}`,
        targetNodeId: level === depth - 1 ? 'last-work' : `fork-${level + 1}`,
      },
    );
    if (level < depth - 1)
      model.edges.push({
        id: `nested-return-${level}`,
        sourceNodeId: `join-${level + 1}`,
        targetNodeId: `join-${level}`,
      });
  }
  model.nodes.push({
    id: 'last-work',
    name: 'Last work',
    type: 'work',
    work: { processingSeconds: 2, capacity: fail ? 0 : 1, costPerParticle: 1 },
  });
  model.edges.push({
    id: 'last-return',
    sourceNodeId: 'last-work',
    targetNodeId: `join-${depth - 1}`,
  });
  if (fail) model.particleTypes[0].patienceSeconds = 1;
  model.retention = { particles: 10000, events: 100000, checkpoints: 20 };
  return model;
}

/** Small active population, large merged path: legal shared router chains. */
export function longSharedParallelModel(fail = false): SimulationModel {
  const model = parallelModel();
  const source = model.nodes[0];
  const outcome = model.nodes[model.nodes.length - 1];
  model.nodes = [
    source,
    outcome,
    {
      id: 'outer-fork',
      name: 'Outer fork',
      type: 'fork',
      fork: { joinNodeId: 'outer-join', branchEdgeIds: ['outer-a', 'outer-b'] },
    },
    { id: 'outer-join', name: 'Outer join', type: 'join', join: { forkNodeId: 'outer-fork' } },
    {
      id: 'inner-fork',
      name: 'Inner fork',
      type: 'fork',
      fork: {
        joinNodeId: 'inner-join',
        branchEdgeIds: Array.from({ length: 64 }, (_, index) => `inner-${index}`),
      },
    },
    { id: 'inner-join', name: 'Inner join', type: 'join', join: { forkNodeId: 'inner-fork' } },
    {
      id: 'outer-work',
      name: 'Outer work',
      type: 'work',
      work: { processingSeconds: 1, capacity: 1, costPerParticle: 7 },
    },
    ...Array.from({ length: 4000 }, (_, index) => ({
      id: `router-${index}`,
      name: `Router ${index}`,
      type: 'router' as const,
      router: { mode: 'first-match' as const },
    })),
  ];
  model.edges = [
    { id: 'entry', sourceNodeId: 'source', targetNodeId: 'outer-fork' },
    { id: 'outer-a', sourceNodeId: 'outer-fork', targetNodeId: 'outer-work' },
    { id: 'outer-b', sourceNodeId: 'outer-fork', targetNodeId: 'inner-fork' },
    { id: 'outer-return', sourceNodeId: 'outer-work', targetNodeId: 'outer-join' },
    { id: 'inner-return', sourceNodeId: 'inner-join', targetNodeId: 'outer-join' },
    { id: 'exit', sourceNodeId: 'outer-join', targetNodeId: 'outcome' },
    ...Array.from({ length: 64 }, (_, index) => ({
      id: `inner-${index}`,
      sourceNodeId: 'inner-fork',
      targetNodeId: 'router-0',
    })),
    ...Array.from({ length: 4000 }, (_, index) => ({
      id: `router-edge-${index}`,
      sourceNodeId: `router-${index}`,
      targetNodeId: index === 3999 ? 'inner-join' : `router-${index + 1}`,
    })),
  ];
  if (fail)
    model.improvements = [
      {
        id: 'fail-after-inner-join',
        name: 'Fail outer work',
        nodeId: 'outer-work',
        enabled: true,
        investmentCost: 0,
        failureProbability: 1,
      },
    ];
  model.retention = { particles: 0, events: 0, checkpoints: 0 };
  return model;
}
