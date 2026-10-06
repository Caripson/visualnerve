import Dexie, { type EntityTable, type ObservabilitySet } from 'dexie';
import type { CsvDataset } from '../data/types';
import {
  base,
  type Diagram,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
import { instantiate, templates } from '../templates/templates';
import { IMPORT_LIMIT_SETTING } from '../imports/limits';
import type {
  HistoryBackup,
  HistoryContent,
  HistoryRows,
  HistorySnapshot,
  HistorySource,
} from '../history/types';
import { exportHistoryBackup } from '../history/backup';
export interface Setting {
  key: string;
  value: unknown;
}
export interface TemplateRecord {
  id: string;
  name: string;
  graph: Graph;
  builtin: boolean;
}
export interface WorkspaceBackup {
  format: 'visual-nerve-workspace';
  formatVersion: 1;
  schemaVersion?: number;
  exportedAt?: string;
  diagrams: Diagram[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  owners: Owner[];
  settings: Setting[];
  templates: TemplateRecord[];
  datasets?: CsvDataset[];
  history?: HistoryBackup;
}

export class WorkspaceDatabase extends Dexie {
  private datasetCache = new Map<string, { diagramVersion: number; datasets: CsvDataset[] }>();
  private immutableDatasets = new WeakSet<CsvDataset>();
  private datasetMutation = (parts: ObservabilitySet) => {
    if (Object.keys(parts).some((part) => part.startsWith(`idb://${this.name}/datasets/`)))
      this.forgetDatasets();
  };
  diagrams!: EntityTable<Diagram, 'id'>;
  nodes!: EntityTable<GraphNode, 'id'>;
  edges!: EntityTable<GraphEdge, 'id'>;
  owners!: EntityTable<Owner, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
  datasets!: EntityTable<CsvDataset, 'id'>;
  historySnapshots!: EntityTable<HistorySnapshot, 'id'>;
  historyContents!: EntityTable<HistoryContent, 'id'>;
  historySources!: EntityTable<HistorySource, 'id'>;
  historyRows!: EntityTable<HistoryRows, 'id'>;
  constructor(name = 'visual-nerve-cache') {
    // Retain the historical database name to upgrade existing browser data in place.
    super(name);
    this.version(1).stores({
      diagrams: 'id,updatedAt,name,folder,*tags',
      graphs: 'id',
      owners: 'id,name,team',
      state: 'id',
    });
    this.version(2)
      .stores({
        diagrams: 'id,name,type,updatedAt,folder,*tags',
        nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
        edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
        owners: 'id,&externalId,name,kind,team,updatedAt',
        settings: 'key',
        templates: 'id,name',
      })
      .upgrade(async (tx) => {
        const legacy = (await tx.table('graphs').toArray()) as { graph: Graph }[];
        for (const { graph } of legacy) {
          await tx.table('diagrams').put({
            ...graph.diagram,
            settings: {
              ...graph.diagram.settings,
              entityOrder: {
                nodes: graph.nodes.map((node) => node.id),
                edges: graph.edges.map((edge) => edge.id),
              },
            },
          });
          await tx.table('nodes').bulkPut(graph.nodes);
          await tx.table('edges').bulkPut(graph.edges);
          for (const owner of graph.owners) {
            const current = (await tx.table('owners').get(owner.id)) as Owner | undefined;
            if (!current || current.version < owner.version) await tx.table('owners').put(owner);
          }
        }
        const old = (await tx.table('state').toArray()) as { id: string; value: unknown }[];
        await tx
          .table('settings')
          .bulkPut(old.map((record) => ({ key: record.id, value: record.value })));
      });
    this.version(3).stores({ graphs: null, state: null });
    this.version(4)
      .stores({ settings: 'key' })
      .upgrade(async (tx) => {
        await tx.table('settings').delete('integration-enabled');
      });
    this.version(5).stores({ datasets: 'id,&diagramId,updatedAt' });
    this.version(6).stores({ datasets: 'id,diagramId,updatedAt' });
    this.version(7).stores({
      historySnapshots: 'id,diagramId,createdAt,contentId,*sourceIds',
      historyContents: 'id,diagramId,bytes',
      historySources: 'id,diagramId,&[diagramId+datasetId+datasetVersion],rowId,bytes',
      historyRows: 'id,diagramId,bytes',
    });
    this.on(
      'ready',
      () => {
        Dexie.on.storagemutated.unsubscribe(this.datasetMutation);
        Dexie.on.storagemutated.subscribe(this.datasetMutation);
      },
      true,
    );
    this.on('close', () => {
      Dexie.on.storagemutated.unsubscribe(this.datasetMutation);
      this.forgetDatasets();
    });
    this.on('versionchange', () => this.close());
  }
  forgetDatasets() {
    this.datasetCache.clear();
  }
  rememberDataset(diagram: Diagram, dataset?: CsvDataset, additional: CsvDataset[] = []) {
    const datasets = [...(dataset ? [dataset] : []), ...additional];
    // Raw cells are immutable. Normal edits share this object without copying
    // or fetching a large dataset again. The committed diagram version changes
    // on every repository write, including source replacement in another tab.
    for (const dataset of datasets)
      if (!this.immutableDatasets.has(dataset)) {
        dataset.rows.forEach(Object.freeze);
        dataset.columns.forEach(Object.freeze);
        Object.freeze(dataset.rows);
        Object.freeze(dataset.columns);
        Object.freeze(dataset);
        this.immutableDatasets.add(dataset);
      }
    const remember = () => {
      this.datasetCache.delete(diagram.id);
      this.datasetCache.set(diagram.id, { diagramVersion: diagram.version, datasets });
      // Keep the active source and a few recent projects without retaining
      // every large dataset ever opened during this browser session.
      while (this.datasetCache.size > 3)
        this.datasetCache.delete(this.datasetCache.keys().next().value!);
    };
    let transaction = Dexie.currentTransaction;
    // import/restore/bulk call graph/saveGraph in nested transactions. A nested
    // scope can finish while the outer write later rolls back.
    while (transaction?.parent) transaction = transaction.parent;
    if (transaction) transaction.on('complete', remember);
    else remember();
  }
  async initialize() {
    await this.open();
    await this.transaction('rw', this.settings, this.templates, async () => {
      if (!(await this.settings.get('workspace-id')))
        await this.settings.put({ key: 'workspace-id', value: base().id });
      const existing = new Set(await this.templates.toCollection().primaryKeys());
      await this.templates.bulkPut(
        templates
          .filter((entry) => !existing.has(entry.key))
          .map((entry) => ({
            id: entry.key,
            name: entry.name,
            graph: instantiate(entry.key, entry.name),
            builtin: true,
          })),
      );
    });
  }
  async graph(id: string): Promise<Graph | undefined> {
    const graph = await this.transaction(
      'r',
      this.diagrams,
      this.nodes,
      this.edges,
      this.owners,
      this.datasets,
      async () => {
        const diagram = await this.diagrams.get(id);
        if (!diagram) return;
        const nodes = await this.nodes.where('diagramId').equals(id).toArray();
        const edges = await this.edges.where('diagramId').equals(id).toArray();
        // Entity order is part of the saved graph, including branch order and owner aliases.
        const order = (diagram.settings.entityOrder ?? {}) as {
          nodes?: string[];
          edges?: string[];
        };
        const sort = <T extends { id: string }>(items: T[], ids?: string[]) => {
          const index = new Map(ids?.map((id, position) => [id, position]) ?? []);
          return items.sort(
            (a, b) =>
              (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (index.get(b.id) ?? Number.MAX_SAFE_INTEGER),
          );
        };
        const ownerIds = [...new Set(nodes.flatMap((node) => node.ownerIds))];
        const owners = (await this.owners.bulkGet(ownerIds)).filter(
          (owner): owner is Owner => !!owner,
        );
        const cached = this.datasetCache.get(id);
        const datasets =
          cached?.diagramVersion === diagram.version
            ? cached.datasets
            : await this.datasets.where('diagramId').equals(id).toArray();
        sort(datasets, diagram.settings.csvDatasetOrder);
        const [dataset, ...additional] = datasets;
        const graph: Graph = {
          format: 'visual-nerve',
          formatVersion: 1,
          diagram,
          nodes: sort(nodes, order.nodes),
          edges: sort(edges, order.edges),
          owners,
          ...(dataset ? { dataset } : {}),
          ...(additional.length ? { datasets: additional } : {}),
        };
        return graph;
      },
    );
    // Outside a top-level transaction its mutation event has already fired.
    // Nested graph reads register against the outer commit instead.
    if (graph) this.rememberDataset(graph.diagram, graph.dataset, graph.datasets);
    return graph;
  }
  async backup(): Promise<WorkspaceBackup> {
    return this.transaction('r', this.tables, async () => {
      const datasets = await this.datasets.toArray();
      const history = await exportHistoryBackup(this, datasets);
      return {
        format: 'visual-nerve-workspace',
        formatVersion: 1,
        schemaVersion: this.verno,
        exportedAt: new Date().toISOString(),
        diagrams: await this.diagrams.toArray(),
        nodes: await this.nodes.toArray(),
        edges: await this.edges.toArray(),
        owners: await this.owners.toArray(),
        settings: (await this.settings.toArray()).filter(
          (setting) =>
            ![
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
            ].includes(setting.key),
        ),
        templates: await this.templates.toArray(),
        datasets,
        ...(history ? { history } : {}),
      };
    });
  }
}
export const database = new WorkspaceDatabase();
