import Dexie, { type EntityTable } from 'dexie';
import {
  base,
  type Diagram,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
import { instantiate, templates } from '../templates/templates';
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
}

export class WorkspaceDatabase extends Dexie {
  diagrams!: EntityTable<Diagram, 'id'>;
  nodes!: EntityTable<GraphNode, 'id'>;
  edges!: EntityTable<GraphEdge, 'id'>;
  owners!: EntityTable<Owner, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
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
    this.on('versionchange', () => this.close());
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
    return this.transaction('r', this.diagrams, this.nodes, this.edges, this.owners, async () => {
      const diagram = await this.diagrams.get(id);
      if (!diagram) return;
      const nodes = await this.nodes.where('diagramId').equals(id).toArray();
      const edges = await this.edges.where('diagramId').equals(id).toArray();
      // Entity order is part of the saved graph, including branch order and owner aliases.
      const order = (diagram.settings.entityOrder ?? {}) as { nodes?: string[]; edges?: string[] };
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
      return {
        format: 'visual-nerve',
        formatVersion: 1,
        diagram,
        nodes: sort(nodes, order.nodes),
        edges: sort(edges, order.edges),
        owners,
      };
    });
  }
  async backup(): Promise<WorkspaceBackup> {
    return this.transaction('r', this.tables, async () => ({
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
          ].includes(setting.key),
      ),
      templates: await this.templates.toArray(),
    }));
  }
}
export const database = new WorkspaceDatabase();
