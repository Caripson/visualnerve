import type { SimulationModel, SimulationNode } from '../types';
import { ParallelTopology } from '../parallel-topology';
import { pruneSimulationReferences } from '../deletion';
import { StorageError } from '../../model/errors';

/** Create a complete editable pair so users never start with an unpaired synchronizer. */
export class ParallelFlowDraft {
  synchronize(model: SimulationModel): SimulationModel {
    return {
      ...model,
      nodes: model.nodes.map((node) =>
        node.type === 'fork'
          ? {
              ...node,
              fork: {
                ...node.fork,
                branchEdgeIds: model.edges
                  .filter((edge) => edge.sourceNodeId === node.id)
                  .map((edge) => edge.id),
              },
            }
          : node,
      ),
    };
  }
  remove(model: SimulationModel, nodeId: string): SimulationModel {
    const node = model.nodes.find((entry) => entry.id === nodeId);
    const forkId =
      node?.type === 'fork' ? node.id : node?.type === 'join' ? node.join.forkNodeId : undefined;
    const fork = model.nodes.find((entry) => entry.id === forkId);
    if (fork?.type !== 'fork')
      throw new StorageError(422, 'Choose a complete parallel block to remove.');
    const topology = new ParallelTopology(model);
    const removed = new Set([fork.id, fork.fork.joinNodeId, ...topology.regions.get(fork.id)!]);
    const outgoing = model.edges.filter((edge) => edge.sourceNodeId === fork.fork.joinNodeId);
    if (outgoing.length > 1)
      throw new StorageError(
        422,
        'Use one continuation after the join before removing this parallel block.',
      );
    const continuation = outgoing[0]?.targetNodeId;
    const edges = model.edges.flatMap((edge) => {
      if (removed.has(edge.sourceNodeId)) return [];
      if (edge.targetNodeId === fork.id && continuation)
        return [{ ...edge, targetNodeId: continuation }];
      return removed.has(edge.targetNodeId) ? [] : [edge];
    });
    return pruneSimulationReferences(
      this.synchronize({
        ...model,
        nodes: model.nodes.filter((entry) => !removed.has(entry.id)),
        edges,
      }),
    );
  }
  add(model: SimulationModel, processId?: string) {
    const forkId = crypto.randomUUID();
    const joinId = crypto.randomUUID();
    const common = processId ? { processId } : {};
    const branches = [1, 2].map((number) => ({
      id: crypto.randomUUID(),
      name: `Parallel task ${number}`,
      type: 'work' as const,
      ...common,
      work: { capacity: 1, processingSeconds: 60 },
    }));
    const outgoing = branches.map((branch) => ({
      id: crypto.randomUUID(),
      sourceNodeId: forkId,
      targetNodeId: branch.id,
      travelSeconds: 0,
    }));
    const incoming = branches.map((branch) => ({
      id: crypto.randomUUID(),
      sourceNodeId: branch.id,
      targetNodeId: joinId,
      travelSeconds: 0,
    }));
    const fork: SimulationNode = {
      id: forkId,
      name: 'Start parallel work',
      type: 'fork',
      ...common,
      fork: { joinNodeId: joinId, branchEdgeIds: outgoing.map((edge) => edge.id) },
    };
    const join: SimulationNode = {
      id: joinId,
      name: 'All tasks ready',
      type: 'join',
      ...common,
      join: { forkNodeId: forkId },
    };
    return {
      id: forkId,
      model: {
        ...model,
        nodes: [...model.nodes, fork, ...branches, join],
        edges: [...model.edges, ...outgoing, ...incoming],
      },
    };
  }
}
