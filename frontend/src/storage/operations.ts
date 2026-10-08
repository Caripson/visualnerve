import type { CsvDataset } from '../data/types';
import { base, type Diagram, type Graph, type Owner } from '../model/types';
import { instantiate, templates } from '../templates/templates';
import { exportHistoryBackup } from '../history/backup';
import { IMPORT_LIMIT_SETTING } from '../imports/limits';
import { PROJECT_SOURCE_FILE_LIMIT_SETTING } from '../code/project/limits';
import type { WorkspaceStorage } from './contracts';
import type { WorkspaceBackup } from './database';
export const graphStoreNames = [
  'diagrams',
  'nodes',
  'edges',
  'owners',
  'datasets',
  'simulationModels',
] as const;
const privateBackupSettings = new Set([
  'workspace-id',
  'last-diagram',
  'integration-enabled',
  'mcp-access',
  'bridge-url',
  'privacy-acknowledged',
  'storage-consent',
  'last-export',
  'backup-nudge-dismissed',
  IMPORT_LIMIT_SETTING,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
]);
/** Helpers receive only an explicit scope; never open a separate ambient transaction. */
export async function initializeWorkspace(scope: WorkspaceStorage) {
  if (!(await scope.settings.get('workspace-id')))
    await scope.settings.put({ key: 'workspace-id', value: base().id });
  const existing = await scope.templates.bulkGet(templates.map((entry) => entry.key));
  await scope.templates.bulkPut(
    templates
      .filter((_, i) => !existing[i])
      .map((entry) => ({
        id: entry.key,
        name: entry.name,
        graph: instantiate(entry.key, entry.name),
        builtin: true,
      })),
  );
  for (const [i, entry] of templates.entries())
    if (existing[i]?.builtin && existing[i]!.name !== entry.name)
      await scope.templates.update(entry.key, { name: entry.name });
}
export async function readWorkspaceGraph(
  scope: WorkspaceStorage,
  id: string,
  cache: (diagram: Diagram) => CsvDataset[] | undefined,
): Promise<Graph | undefined> {
  const diagram = await scope.diagrams.get(id);
  if (!diagram) return;
  const nodes = await scope.nodes.where('diagramId').equals(id).toArray();
  const edges = await scope.edges.where('diagramId').equals(id).toArray();
  const order = (diagram.settings.entityOrder ?? {}) as { nodes?: string[]; edges?: string[] };
  const sort = <T extends { id: string }>(items: T[], ids?: string[]) => {
    const positions = new Map(ids?.map((id, i) => [id, i]) ?? []);
    return items.sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  };
  const owners = (
    await scope.owners.bulkGet([...new Set(nodes.flatMap((node) => node.ownerIds))])
  ).filter((owner): owner is Owner => !!owner);
  const cached = cache(diagram);
  const datasets = cached
    ? [...cached]
    : await scope.datasets.where('diagramId').equals(id).toArray();
  sort(datasets, diagram.settings.csvDatasetOrder);
  const [dataset, ...additional] = datasets;
  const simulation = (await scope.simulationModels.get(id))?.model;
  return {
    format: 'visual-nerve',
    formatVersion: 1,
    diagram,
    nodes: sort(nodes, order.nodes),
    edges: sort(edges, order.edges),
    owners,
    ...(dataset ? { dataset } : {}),
    ...(additional.length ? { datasets: additional } : {}),
    ...(simulation ? { simulation } : {}),
  };
}
export async function readWorkspaceBackup(scope: WorkspaceStorage): Promise<WorkspaceBackup> {
  const datasets = await scope.datasets.toArray();
  const history = await exportHistoryBackup(scope, datasets);
  return {
    format: 'visual-nerve-workspace',
    formatVersion: 1,
    schemaVersion: scope.schemaVersion,
    exportedAt: new Date().toISOString(),
    diagrams: await scope.diagrams.toArray(),
    nodes: await scope.nodes.toArray(),
    edges: await scope.edges.toArray(),
    owners: await scope.owners.toArray(),
    settings: (await scope.settings.toArray()).filter(
      (setting) => !privateBackupSettings.has(setting.key) && !setting.key.startsWith('vault-'),
    ),
    templates: await scope.templates.toArray(),
    datasets,
    simulationModels: await scope.simulationModels.toArray(),
    simulationRuns: await scope.simulationRuns.toArray(),
    simulationCheckpoints: await scope.simulationCheckpoints.toArray(),
    ...(history ? { history } : {}),
  };
}
