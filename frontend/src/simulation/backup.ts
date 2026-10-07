import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import type { WorkspaceDatabase, WorkspaceBackup } from '../storage/database';
import { historyJsonBytes } from '../history/codec';
import { remapSimulationModel } from './copy';
import { validateSimulationModel, resolveScenario } from './schema';
import { simulationModelHash } from './engine';
import type { SimulationResult, SimulationState } from './types';
import { assertArchivedResult, assertArchivedState } from './archive-validation';

export interface SimulationImportMapping {
  sourceGraph: Graph;
  importedGraph: Graph;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function remapState<T extends SimulationState>(
  state: T,
  nodes: ReadonlyMap<string, string>,
  edges: ReadonlyMap<string, string>,
): T {
  const nodeId = (id: string) => nodes.get(id) ?? id;
  const edgeId = (id: string) => edges.get(id) ?? id;
  return {
    ...state,
    metrics: {
      ...state.metrics,
      currentBottleneck: state.metrics.currentBottleneck
        ? nodeId(state.metrics.currentBottleneck)
        : null,
    },
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, metric]) => [
        nodeId(id),
        { ...metric, id: nodeId(metric.id) },
      ]),
    ),
    resources: Object.fromEntries(
      Object.entries(state.resources).map(([id, metric]) => [
        id,
        { ...metric, waitingNodeIds: metric.waitingNodeIds.map(nodeId) },
      ]),
    ),
    particles: state.particles.map((particle) => ({
      ...particle,
      nodeId: nodeId(particle.nodeId),
      ...(particle.edgeId ? { edgeId: edgeId(particle.edgeId) } : {}),
      history: particle.history.map((visit) => ({ ...visit, nodeId: nodeId(visit.nodeId) })),
    })),
    events: state.events.map((event) => ({
      ...event,
      ...(event.nodeId ? { nodeId: nodeId(event.nodeId) } : {}),
      ...(event.edgeId ? { edgeId: edgeId(event.edgeId) } : {}),
    })),
    bottlenecks: state.bottlenecks.map((bottleneck) => ({
      ...bottleneck,
      id: bottleneck.kind === 'node' ? nodeId(bottleneck.id) : bottleneck.id,
    })),
  };
}

/** Restore immutable run snapshots under the same collision maps as their documents. */
export async function importSimulationRuns(
  db: WorkspaceDatabase,
  backup: WorkspaceBackup,
  mappings: SimulationImportMapping[],
) {
  const runs = backup.simulationRuns ?? [];
  const checkpoints = backup.simulationCheckpoints ?? [];
  const byDiagram = new Map(mappings.map((mapping) => [mapping.sourceGraph.diagram.id, mapping]));
  const runIds = new Map<string, string>();
  const identities = new Map<string, { nodes: Map<string, string>; edges: Map<string, string> }>();
  for (const mapping of mappings)
    identities.set(mapping.sourceGraph.diagram.id, {
      nodes: new Map(
        mapping.sourceGraph.nodes.map((node, index) => [
          node.id,
          mapping.importedGraph.nodes[index].id,
        ]),
      ),
      edges: new Map(
        mapping.sourceGraph.edges.map((edge, index) => [
          edge.id,
          mapping.importedGraph.edges[index].id,
        ]),
      ),
    });
  for (const run of runs) {
    if (!object(run)) throw new StorageError(422, 'Invalid workspace simulation run.');
    const mapping = byDiagram.get(run.diagramId);
    if (
      !object(run) ||
      !mapping ||
      mapping.importedGraph.diagram.type !== 'process-simulator' ||
      typeof run.id !== 'string' ||
      !run.id ||
      runIds.has(run.id) ||
      !Number.isFinite(Date.parse(run.createdAt)) ||
      !Number.isFinite(Date.parse(run.updatedAt)) ||
      !object(run.options)
    )
      throw new StorageError(422, 'Invalid workspace simulation run.');
    validateSimulationModel(run.model);
    const scenarioId =
      typeof run.options.scenarioId === 'string' ? run.options.scenarioId : undefined;
    const demandMultiplier =
      typeof run.options.demandMultiplier === 'number' ? run.options.demandMultiplier : undefined;
    if (
      (run.options.scenarioId !== undefined && scenarioId === undefined) ||
      (run.options.demandMultiplier !== undefined &&
        (!Number.isFinite(demandMultiplier) || demandMultiplier! < 0))
    )
      throw new StorageError(422, 'Invalid archived simulation options.');
    historyJsonBytes(run, 48 * 1024 * 1024);
    const identity = identities.get(run.diagramId)!;
    for (const node of run.model.nodes)
      if (!identity.nodes.has(node.id)) identity.nodes.set(node.id, crypto.randomUUID());
    for (const edge of run.model.edges)
      if (!identity.edges.has(edge.id)) identity.edges.set(edge.id, crypto.randomUUID());
    const model = remapSimulationModel(run.model, identity.nodes, identity.edges);
    const id = crypto.randomUUID();
    runIds.set(run.id, id);
    let result: SimulationResult | undefined;
    if (run.result) {
      assertArchivedResult(run.result);
      result = {
        ...remapState(run.result, identity.nodes, identity.edges),
        runId: id,
        modelHash: simulationModelHash(resolveScenario(model, scenarioId, demandMultiplier)),
        finalCapacities: Object.fromEntries(
          Object.entries(run.result.finalCapacities).map(([key, capacity]) => [
            identity.nodes.get(key) ?? key,
            capacity,
          ]),
        ),
        routeMetrics: Object.fromEntries(
          Object.entries(run.result.routeMetrics).map(([route, metric]) => [
            route
              .split(' → ')
              .map((key) => identity.nodes.get(key) ?? key)
              .join(' → '),
            metric,
          ]),
        ),
      };
    }
    await db.simulationRuns.add({
      ...run,
      id,
      diagramId: mapping.importedGraph.diagram.id,
      model,
      options: { ...run.options, runId: id },
      ...(result ? { result } : {}),
    });
  }
  const checkpointIds = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (!object(checkpoint))
      throw new StorageError(422, 'Invalid workspace simulation checkpoint.');
    const runId = runIds.get(checkpoint.runId);
    const mapping = byDiagram.get(checkpoint.diagramId);
    const identity = identities.get(checkpoint.diagramId);
    if (
      !object(checkpoint) ||
      !runId ||
      !mapping ||
      !identity ||
      checkpointIds.has(checkpoint.id) ||
      !Number.isFinite(checkpoint.timeSeconds) ||
      checkpoint.timeSeconds < 0 ||
      checkpoint.state?.timeSeconds !== checkpoint.timeSeconds
    )
      throw new StorageError(422, 'Invalid workspace simulation checkpoint.');
    const run = await db.simulationRuns.get(runId);
    if (run?.diagramId !== mapping.importedGraph.diagram.id)
      throw new StorageError(422, 'Simulation checkpoint belongs to another document.');
    checkpointIds.add(checkpoint.id);
    assertArchivedState(checkpoint.state);
    await db.simulationCheckpoints.add({
      ...checkpoint,
      id: `${runId}:${checkpoint.timeSeconds}`,
      runId,
      diagramId: mapping.importedGraph.diagram.id,
      state: remapState(checkpoint.state, identity.nodes, identity.edges),
    });
  }
}
