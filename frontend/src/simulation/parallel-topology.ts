import { StorageError } from '../model/errors';
import type { SimulationModel, SimulationNode } from './types';

export const parallelLimits = { branches: 64, nesting: 16 };
function invalid(message: string): never {
  throw new StorageError(422, `Simulation: ${message}`);
}
type Fork = Extract<SimulationNode, { type: 'fork' }>;

/** Closed, acyclic fork regions can nest, but may never cross or admit unrelated work. */
export class ParallelTopology {
  readonly regions = new Map<string, ReadonlySet<string>>();
  constructor(model: SimulationModel) {
    const forks = model.nodes.filter((node): node is Fork => node.type === 'fork');
    const joins = model.nodes.filter((node) => node.type === 'join');
    if (!forks.length && !joins.length) return;
    const nodes = new Map(model.nodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, typeof model.edges>();
    const incoming = new Map<string, typeof model.edges>();
    for (const edge of model.edges) {
      const out = outgoing.get(edge.sourceNodeId) ?? [];
      out.push(edge);
      outgoing.set(edge.sourceNodeId, out);
      const into = incoming.get(edge.targetNodeId) ?? [];
      into.push(edge);
      incoming.set(edge.targetNodeId, into);
    }
    const cyclic = cyclicNodes(model, outgoing, incoming);
    for (const join of joins) {
      const fork = nodes.get(join.join.forkNodeId);
      if (fork?.type !== 'fork' || fork.fork.joinNodeId !== join.id)
        invalid(`join ${join.id} needs its matching fork.`);
      if (cyclic.has(join.id)) invalid(`parallel pair ${join.id} is part of a cycle.`);
    }
    for (const fork of forks) {
      const join = nodes.get(fork.fork.joinNodeId);
      if (join?.type !== 'join' || join.join.forkNodeId !== fork.id)
        invalid(`fork ${fork.id} needs its matching join.`);
      if (cyclic.has(fork.id)) invalid(`parallel pair ${fork.id} is part of a cycle.`);
      const branches = fork.fork.branchEdgeIds;
      const edges = outgoing.get(fork.id) ?? [];
      if (
        branches.length < 2 ||
        branches.length > parallelLimits.branches ||
        new Set(branches).size !== branches.length ||
        edges.length !== branches.length ||
        edges.some((edge) => !branches.includes(edge.id))
      )
        invalid(
          `fork ${fork.id} must declare all of its 2–${parallelLimits.branches} distinct outgoing branches.`,
        );
      if (edges.some((edge) => edge.particleTypeIds?.length))
        invalid(
          `fork ${fork.id} branches cannot filter particle types; all branches are mandatory.`,
        );
      const region = new Set<string>();
      const todo = edges.map((edge) => edge.targetNodeId);
      while (todo.length) {
        const id = todo.pop()!;
        if (id === join.id || region.has(id)) continue;
        if (id === fork.id || cyclic.has(id)) invalid(`fork ${fork.id} contains a cyclic branch.`);
        const node = nodes.get(id)!;
        if (node.type === 'source')
          invalid(`fork ${fork.id} cannot contain an independent source.`);
        if (node.type === 'outcome' && node.outcome.status === 'completed')
          invalid(`fork ${fork.id} cannot complete or realize revenue before its join.`);
        region.add(id);
        const next = outgoing.get(id) ?? [];
        if (!next.length && node.type !== 'outcome')
          invalid(`branch node ${id} must reach join ${join.id} or a failed/rejected outcome.`);
        for (const edge of next) todo.push(edge.targetNodeId);
      }
      // Every declared branch must have a path to its join. Explicit failure routes may also exist.
      const reaches = new Set([join.id]);
      const reverse = [join.id];
      while (reverse.length) {
        const id = reverse.pop()!;
        for (const edge of incoming.get(id) ?? [])
          if (region.has(edge.sourceNodeId) && !reaches.has(edge.sourceNodeId)) {
            reaches.add(edge.sourceNodeId);
            reverse.push(edge.sourceNodeId);
          }
      }
      if (edges.some((edge) => !reaches.has(edge.targetNodeId)))
        invalid(`every branch of fork ${fork.id} must be able to reach join ${join.id}.`);
      for (const id of [...region, join.id])
        if (
          (incoming.get(id) ?? []).some(
            (edge) => edge.sourceNodeId !== fork.id && !region.has(edge.sourceNodeId),
          )
        )
          invalid(`parallel region ${fork.id} cannot admit unrelated incoming work at ${id}.`);
      this.regions.set(fork.id, region);
    }
    const parents = new Map<string, string[]>();
    for (const fork of forks)
      for (const id of this.regions.get(fork.id)!) {
        const nested = nodes.get(id)!;
        const region = this.regions.get(fork.id)!;
        if (nested.type === 'fork') {
          if (!region.has(nested.fork.joinNodeId))
            invalid(`parallel pairs ${fork.id} and ${nested.id} cross instead of nesting.`);
          const ancestors = parents.get(nested.id) ?? [];
          ancestors.push(fork.id);
          parents.set(nested.id, ancestors);
        } else if (nested.type === 'join' && !region.has(nested.join.forkNodeId))
          invalid(
            `parallel pairs ${fork.id} and ${nested.join.forkNodeId} cross instead of nesting.`,
          );
      }
    for (const [id, ancestors] of parents)
      if (ancestors.length >= parallelLimits.nesting)
        invalid(`fork ${id} exceeds ${parallelLimits.nesting} levels of parallel nesting.`);
  }
}

/** Iterative SCC discovery preserves legacy loops outside parallel regions and handles deep models. */
function cyclicNodes(
  model: SimulationModel,
  outgoing: ReadonlyMap<string, SimulationModel['edges']>,
  incoming: ReadonlyMap<string, SimulationModel['edges']>,
) {
  const seen = new Set<string>(),
    order: string[] = [];
  for (const node of model.nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const stack = [{ id: node.id, index: 0 }];
    while (stack.length) {
      const frame = stack.at(-1)!;
      const next = outgoing.get(frame.id) ?? [];
      if (frame.index >= next.length) {
        order.push(frame.id);
        stack.pop();
      } else {
        const target = next[frame.index++].targetNodeId;
        if (!seen.has(target)) {
          seen.add(target);
          stack.push({ id: target, index: 0 });
        }
      }
    }
  }
  seen.clear();
  const cyclic = new Set<string>();
  for (let index = order.length - 1; index >= 0; index--) {
    const first = order[index];
    if (seen.has(first)) continue;
    const component = [],
      todo = [first];
    seen.add(first);
    while (todo.length) {
      const id = todo.pop()!;
      component.push(id);
      for (const edge of incoming.get(id) ?? [])
        if (!seen.has(edge.sourceNodeId)) {
          seen.add(edge.sourceNodeId);
          todo.push(edge.sourceNodeId);
        }
    }
    if (
      component.length > 1 ||
      (outgoing.get(first) ?? []).some((edge) => edge.targetNodeId === first)
    )
      for (const id of component) cyclic.add(id);
  }
  return cyclic;
}
