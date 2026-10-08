import type { WorkspaceBackup } from './database';
import {
  WORKSPACE_SCHEMA_VERSION,
  workspaceStoreDefinitions,
  workspaceStoreNames,
} from './contracts';
import { StorageError } from '../model/errors';
import { validateGraph, validateOwner } from '../model/validation';
import type { Graph } from '../model/types';
import { prepareHistoryBackup } from '../history/backup';
import { prepareSimulationBackup } from '../simulation/backup';
import { resolveScenario } from '../simulation/schema';
import { simulationModelHash } from '../simulation/engine';
import type { SimulationModel, SimulationState } from '../simulation/types';
import { logicalJsonChunks, logicalJsonLimits } from '../security/vault-logical-json';
import { encodeWorkspaceIndexKey, projectWorkspaceIndexes } from '../security/vault-indexes';
import type { MigrationRecords } from './migration-digest';
import { isMigrationTechnicalSetting } from './migration-settings';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const bad = (): never => {
  throw new StorageError(422, 'Invalid complete workspace migration content or references.');
};

/** A private snapshot prevents a caller changing a valid input during later crypto awaits. */
function snapshot(input: WorkspaceBackup) {
  for (const chunk of logicalJsonChunks(input, {
    chunkBytes: logicalJsonLimits.chunkBytes,
    budget: { bytes: 0, values: 0 },
  }))
    chunk.fill(0);
  return structuredClone(input);
}
export function assertMigrationRecordKeys(records: MigrationRecords) {
  for (const store of workspaceStoreNames) {
    const primary = workspaceStoreDefinitions[store].primaryKey;
    const ids = new Set<string>();
    const unique = new Map<string, Set<string>>();
    for (const value of records[store]) {
      if (!object(value)) bad();
      const id = Reflect.get(value, primary);
      if (typeof id !== 'string' || !id || ids.has(id)) bad();
      ids.add(id);
      const projection = projectWorkspaceIndexes(store, value);
      for (const [index, specification] of Object.entries(
        workspaceStoreDefinitions[store].indexes,
      )) {
        if (!specification.unique) continue;
        let used = unique.get(index);
        if (!used) unique.set(index, (used = new Set()));
        for (const key of projection.keys[index]) {
          const encoded = encodeWorkspaceIndexKey(key);
          if (used.has(encoded)) bad();
          used.add(encoded);
        }
      }
    }
  }
}

function stateReferences(state: SimulationState, model: SimulationModel) {
  const nodeKinds = new Map(model.nodes.map((node) => [node.id, node.type]));
  const nodes = new Set(nodeKinds.keys());
  const edges = new Set(model.edges.map((edge) => edge.id));
  const resources = new Set(model.resources.map((resource) => resource.id));
  const particles = new Set(model.particleTypes.map((particle) => particle.id));
  const processes = new Set(model.processes?.map((process) => process.id) ?? []);
  const bottleneck = (item: { id: string; kind: 'node' | 'resource' }) => {
    if (!(item.kind === 'node' ? nodes : resources).has(item.id)) bad();
  };
  if (
    Object.keys(state.nodes).length !== nodes.size ||
    Object.keys(state.resources).length !== resources.size ||
    Object.keys(state.particleTypes).length !== particles.size ||
    Object.keys(state.nodes).some((id) => !nodes.has(id)) ||
    Object.keys(state.resources).some((id) => !resources.has(id)) ||
    Object.keys(state.particleTypes).some((id) => !particles.has(id)) ||
    (state.metrics.currentBottleneck !== null && !nodes.has(state.metrics.currentBottleneck))
  )
    bad();
  for (const metric of Object.values(state.nodes))
    if (
      metric.type !== nodeKinds.get(metric.id) ||
      Object.keys(metric.resourceUsage).some((id) => !resources.has(id))
    )
      bad();
  for (const metric of Object.values(state.resources))
    if (metric.waitingNodeIds.some((id) => !nodes.has(id))) bad();
  for (const [id, process] of Object.entries(state.processes ?? {})) {
    if (
      !processes.has(id) ||
      process.nodeIds.some((id) => !nodes.has(id)) ||
      process.childProcessIds.some((id) => !processes.has(id)) ||
      (process.parentId !== undefined && !processes.has(process.parentId)) ||
      process.resourceIds.some((id) => !resources.has(id)) ||
      Object.keys(process.resourceUsage).some((id) => !resources.has(id))
    )
      bad();
    for (const item of process.bottlenecks) bottleneck(item);
    if (
      process.currentBottleneck &&
      !nodes.has(process.currentBottleneck) &&
      !resources.has(process.currentBottleneck)
    )
      bad();
  }
  for (const particle of state.particles)
    if (
      !nodes.has(particle.nodeId) ||
      !particles.has(particle.typeId) ||
      (particle.edgeId !== undefined && !edges.has(particle.edgeId)) ||
      particle.history.some((visit) => !nodes.has(visit.nodeId))
    )
      bad();
  for (const event of state.events)
    if (
      (event.nodeId !== undefined && !nodes.has(event.nodeId)) ||
      (event.edgeId !== undefined && !edges.has(event.edgeId)) ||
      (event.resourceId !== undefined && !resources.has(event.resourceId)) ||
      (event.particleTypeId !== undefined && !particles.has(event.particleTypeId))
    )
      bad();
  for (const item of state.bottlenecks) bottleneck(item);
}

function simulationReferences(backup: WorkspaceBackup, graphs: Graph[]) {
  const { runs, checkpoints } = prepareSimulationBackup(backup, graphs);
  const models = new Map<string, SimulationModel>();
  for (const run of runs) {
    if (!['ready', 'running', 'paused', 'stopped', 'completed', 'failed'].includes(run.status))
      bad();
    const effective = resolveScenario(
      run.model,
      run.options.scenarioId,
      run.options.demandMultiplier,
    );
    models.set(run.id, effective);
    const duration = run.options.durationSeconds ?? run.model.defaults.durationSeconds;
    const seed = run.options.seed ?? run.model.defaults.seed;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 315360000 ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      (run.options.untilComplete !== undefined && typeof run.options.untilComplete !== 'boolean') ||
      (run.options.runId !== undefined && run.options.runId !== run.id)
    )
      bad();
    if (run.result) {
      const result = run.result;
      const capacities = new Set([
        ...effective.nodes.map((node) => node.id),
        ...effective.resources.map((resource) => resource.id),
      ]);
      const edges = new Set(effective.edges.map((edge) => edge.id));
      if (
        result.runId !== run.id ||
        result.modelHash !== simulationModelHash(effective) ||
        result.durationSeconds !== duration ||
        result.seed !== seed ||
        result.scenarioId !== (run.options.scenarioId ?? null) ||
        result.demandMultiplier !==
          (run.options.demandMultiplier ??
            run.model.scenarios.find((scenario) => scenario.id === run.options.scenarioId)
              ?.demandMultiplier ??
            1) ||
        Object.keys(result.finalCapacities).some((id) => !capacities.has(id))
      )
        bad();
      for (const route of Object.keys(result.routeMetrics))
        if (
          route &&
          route !== '[other routes]' &&
          !route.includes(' … [') &&
          route.split(' → ').some((id) => !edges.has(id))
        )
          bad();
      stateReferences(result, effective);
    }
  }
  for (const checkpoint of checkpoints)
    stateReferences(checkpoint.state, models.get(checkpoint.runId)!);
}

/** No storage writes, normalization, identity remapping or version stamping. */
export async function prepareWorkspaceMigration(
  input: WorkspaceBackup,
  check: () => Promise<void>,
) {
  await check();
  const backup = snapshot(input);
  if (
    !object(backup) ||
    Object.keys(backup).some(
      (key) =>
        ![
          'format',
          'formatVersion',
          'schemaVersion',
          'exportedAt',
          'diagrams',
          'nodes',
          'edges',
          'owners',
          'settings',
          'templates',
          'datasets',
          'history',
          'simulationModels',
          'simulationRuns',
          'simulationCheckpoints',
        ].includes(key),
    ) ||
    (backup.exportedAt !== undefined &&
      (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt)))) ||
    backup?.format !== 'visual-nerve-workspace' ||
    backup.formatVersion !== 1 ||
    (backup.schemaVersion !== undefined &&
      (!Number.isSafeInteger(backup.schemaVersion) ||
        backup.schemaVersion < 1 ||
        backup.schemaVersion > WORKSPACE_SCHEMA_VERSION)) ||
    !['diagrams', 'nodes', 'edges', 'owners', 'settings', 'templates'].every((key) =>
      Array.isArray(Reflect.get(backup, key)),
    ) ||
    ['datasets', 'simulationModels', 'simulationRuns', 'simulationCheckpoints'].some(
      (key) => Reflect.get(backup, key) !== undefined && !Array.isArray(Reflect.get(backup, key)),
    )
  )
    bad();
  const records: MigrationRecords = {
    diagrams: backup.diagrams,
    nodes: backup.nodes,
    edges: backup.edges,
    owners: backup.owners,
    settings: backup.settings,
    templates: backup.templates,
    datasets: backup.datasets ?? [],
    historySnapshots: [],
    historyContents: [],
    historySources: [],
    historyRows: [],
    simulationModels: backup.simulationModels ?? [],
    simulationRuns: backup.simulationRuns ?? [],
    simulationCheckpoints: backup.simulationCheckpoints ?? [],
  };
  assertMigrationRecordKeys(records);
  const diagrams = new Map(records.diagrams.map((diagram) => [diagram.id, diagram]));
  if (
    [...records.nodes, ...records.edges, ...records.datasets, ...records.simulationModels].some(
      (value) => !diagrams.has(value.diagramId),
    )
  )
    bad();
  for (const owner of records.owners) validateOwner(owner);
  for (const setting of records.settings)
    if (
      setting.key.startsWith('vault-') ||
      !Object.hasOwn(setting, 'value') ||
      setting.value === undefined ||
      Object.keys(setting).some((key) => key !== 'key' && key !== 'value')
    )
      bad();
  records.settings = records.settings.filter(
    (setting) => !isMigrationTechnicalSetting(setting.key),
  );
  const graphs: Graph[] = [];
  for (const diagram of records.diagrams) {
    const sources = records.datasets.filter((dataset) => dataset.diagramId === diagram.id);
    const order = new Map(diagram.settings?.csvDatasetOrder?.map((id, index) => [id, index]) ?? []);
    sources.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    const nodes = records.nodes.filter((node) => node.diagramId === diagram.id);
    const ownerIds = new Set(nodes.flatMap((node) => node.ownerIds));
    const model = records.simulationModels.find((record) => record.diagramId === diagram.id);
    if (model && model.diagramVersion !== diagram.version) bad();
    const graph: Graph = {
      format: 'visual-nerve',
      formatVersion: 1,
      diagram,
      nodes,
      edges: records.edges.filter((edge) => edge.diagramId === diagram.id),
      owners: records.owners.filter((owner) => ownerIds.has(owner.id)),
      ...(sources.length ? { dataset: sources[0], datasets: sources.slice(1) } : {}),
      ...(model ? { simulation: model.model } : {}),
    };
    validateGraph(graph);
    graphs.push(graph);
    await check();
  }
  for (const template of records.templates) {
    if (
      typeof template.name !== 'string' ||
      !template.name.trim() ||
      (template.builtin !== undefined && typeof template.builtin !== 'boolean')
    )
      bad();
    validateGraph(template.graph);
  }
  const history = await prepareHistoryBackup(backup.history, records.datasets, graphs);
  if (history) {
    records.historySnapshots = backup.history!.snapshots;
    records.historyContents = [...history.contents.values()];
    records.historySources = [...history.sources.values()];
    records.historyRows = [...history.rawRows.values()];
  }
  simulationReferences(backup, graphs);
  assertMigrationRecordKeys(records);
  await check();
  return { records, schemaVersion: backup.schemaVersion ?? 1 };
}
