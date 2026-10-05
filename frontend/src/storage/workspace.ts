import { liveQuery, type Subscription } from 'dexie';
import { useEditor } from '../state/editor';
import { ownersFor, type Graph } from '../model/types';
import { StorageError } from '../model/validation';
import { Repository, repository } from './repository';
import {
  mcpAccess,
  assertMcpAccess,
  defaultBridgeUrl,
  localBridgeUrl,
} from '../integration/access';
import type { WorkspaceBackup } from './database';

function acknowledged(local: Graph, saved: Graph): Graph {
  const nodes = new Map(saved.nodes.map((node) => [node.id, node]));
  const edges = new Map(saved.edges.map((edge) => [edge.id, edge]));
  const share = <T extends Graph['nodes'][number] | Graph['edges'][number]>(
    value: T,
    stored?: T,
  ): T =>
    stored && value.version === stored.version && value.updatedAt === stored.updatedAt
      ? value
      : (stored ?? value);
  return {
    ...saved,
    nodes: local.nodes.map((node) => share(node, nodes.get(node.id))),
    edges: local.edges.map((edge) => share(edge, edges.get(edge.id))),
  };
}

/** Optimistic editor state backed exclusively by committed IndexedDB transactions. */
export class Workspace {
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private observer?: Subscription;
  private versions = new Map<string, number>();
  private pending = new Map<string, Graph>();
  private navigation = 0;
  private settingsRevision = 0;
  private stopped = false;
  constructor(public repo: Repository = repository) {}
  async start() {
    this.stopped = false;
    await this.repo.db.open();
    if ((await this.repo.db.settings.get('storage-consent'))?.value !== true) {
      useEditor.setState({
        privacyAcknowledged: false,
        graph: null,
        diagrams: [],
        owners: [],
        mcpAccess: 'off',
        workspaceId: '',
      });
      return;
    }
    await this.repo.db.initialize();
    const theme = await this.repo.db.settings.get('theme');
    const legacyTheme = localStorage.getItem('vn-theme');
    if (!theme && legacyTheme)
      await this.repo.db.settings.put({ key: 'theme', value: legacyTheme });
    localStorage.removeItem('vn-theme');
    this.unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.editRevision === previous.editRevision || !state.graph) return;
      const graph = ownersFor(state.graph, state.owners);
      const revision = state.editRevision;
      this.pending.set(graph.diagram.id, graph);
      this.queue = this.queue.then(() => this.persist(graph, revision));
    });
    await this.refresh();
    const last = await this.repo.db.settings.get('last-diagram');
    if (
      typeof last?.value === 'string' &&
      useEditor.getState().diagrams.some((diagram) => diagram.id === last.value)
    )
      await this.open(last.value);
    this.observer = liveQuery(() =>
      this.repo.db.transaction(
        'r',
        this.repo.db.diagrams,
        this.repo.db.owners,
        this.repo.db.settings,
        async () => {
          await this.repo.db.diagrams.toArray();
          await this.repo.db.owners.toArray();
          await this.repo.db.settings.toArray();
          return true;
        },
      ),
    ).subscribe({
      next: () => {
        void this.refresh().catch((error) => this.error(error));
      },
      error: (error) => this.error(error),
    });
    if (this.repo === repository) {
      const { bridge } = await import('../integration/bridge');
      bridge.start();
    }
  }
  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    this.observer?.unsubscribe();
  }
  async acceptStorage() {
    await this.repo.db.settings.put({ key: 'storage-consent', value: true });
    this.stop();
    await this.start();
  }
  private async requireStorageConsent() {
    if ((await this.repo.db.settings.get('storage-consent'))?.value !== true)
      throw new StorageError(403, 'Accept local browser storage before using the workspace.');
  }
  private error(error: unknown) {
    const conflict = error instanceof StorageError && [404, 409].includes(error.status);
    useEditor.setState({
      status: conflict ? 'conflict' : 'error',
      message: (error as Error).message,
    });
  }
  private async persist(graph: Graph, revision: number) {
    const id = graph.diagram.id;
    if (useEditor.getState().status === 'conflict') return;
    try {
      await this.requireStorageConsent();
      const stored = await this.repo.saveGraph(
        graph,
        this.versions.get(id) ?? graph.diagram.version,
      );
      this.versions.set(id, stored.diagram.version);
      const state = useEditor.getState();
      if (state.graph?.diagram.id === id) {
        const changed = state.editRevision !== revision;
        useEditor.setState({
          graph: changed
            ? {
                ...state.graph,
                diagram: { ...state.graph.diagram, version: stored.diagram.version },
              }
            : acknowledged(state.graph, stored),
          status: changed ? 'saving' : 'saved',
          message: '',
        });
      }
      if (this.pending.get(id) === graph) this.pending.delete(id);
    } catch (error) {
      this.error(error);
    }
  }
  async settled() {
    await this.queue;
    if (this.pending.size) {
      const state = useEditor.getState();
      if (state.status === 'conflict') throw new StorageError(409, state.message);
      for (const graph of this.pending.values())
        await this.persist(graph, useEditor.getState().editRevision);
      if (this.pending.size) throw new StorageError(500, useEditor.getState().message);
    }
  }
  async refresh() {
    if (this.stopped) return;
    await this.queue;
    const settingsRevision = this.settingsRevision;
    const [diagrams, owners, settings] = await Promise.all([
      this.repo.db.diagrams.orderBy('updatedAt').reverse().toArray(),
      this.repo.db.owners.toArray(),
      this.repo.db.settings.toArray(),
    ]);
    const preferences = new Map(settings.map((setting) => [setting.key, setting.value]));
    if (settingsRevision !== this.settingsRevision) return;
    useEditor.setState({
      diagrams: preferences.get('storage-consent') === true ? diagrams : [],
      owners: preferences.get('storage-consent') === true ? owners : [],
      theme: String(preferences.get('theme') ?? 'system'),
      mcpAccess:
        preferences.get('storage-consent') === true
          ? mcpAccess(preferences.get('mcp-access'))
          : 'off',
      bridgeUrl: String(preferences.get('bridge-url') ?? defaultBridgeUrl()),
      workspaceId: String(preferences.get('workspace-id') ?? ''),
      privacyAcknowledged: preferences.get('storage-consent') === true,
      lastExport: String(preferences.get('last-export') ?? ''),
      backupNudgeDismissed: preferences.get('backup-nudge-dismissed') === true,
    });
    if (preferences.get('storage-consent') !== true) {
      useEditor.getState().setGraph(null);
      return;
    }
    const state = useEditor.getState(),
      current = state.graph;
    if (!current) return;
    const record = diagrams.find((diagram) => diagram.id === current.diagram.id);
    if (record?.version === current.diagram.version) return;
    if (this.pending.has(current.diagram.id)) {
      this.error(
        new StorageError(
          409,
          'Another tab changed this project. Your unsaved edits are still available here.',
        ),
      );
      return;
    }
    if (!record) {
      state.setGraph(null);
      return;
    }
    const graph = await this.repo.getGraph(record.id);
    if (useEditor.getState().graph !== current || this.pending.has(record.id)) return;
    this.versions.set(record.id, graph.diagram.version);
    useEditor.setState({ graph, history: [], future: [], status: 'saved', message: '' });
  }
  async open(id: string, nodeId?: string) {
    await this.requireStorageConsent();
    await this.settled();
    const navigation = ++this.navigation;
    const graph = await this.repo.getGraph(id);
    if (navigation !== this.navigation) return;
    this.versions.set(id, graph.diagram.version);
    useEditor.getState().setGraph(graph);
    useEditor.setState({ status: 'saved', message: '' });
    await this.repo.db.settings.put({ key: 'last-diagram', value: id });
    if (nodeId) {
      const nodes = new Map(graph.nodes.map((node) => [node.id, node])),
        ancestors = new Set<string>();
      let parent = nodes.get(nodeId)?.parentId;
      while (parent && !ancestors.has(parent)) {
        ancestors.add(parent);
        parent = nodes.get(parent)?.parentId;
      }
      useEditor.getState().command('Reveal search result', (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          ancestors.has(node.id) && node.collapsed ? { ...node, collapsed: false } : node,
        ),
      }));
      useEditor.setState({ selectedNodes: [nodeId], focusNode: nodeId });
    }
  }
  async create(graph: Graph) {
    await this.requireStorageConsent();
    await this.settled();
    const stored = await this.repo.importGraph(graph);
    await this.refresh();
    await this.open(stored.diagram.id);
  }
  async execute<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    await this.requireStorageConsent();
    await this.settled();
    const result = await this.repo.request<T>(path, method, data);
    await this.refresh();
    return result;
  }
  async setPreference(key: string, value: unknown) {
    await this.requireStorageConsent();
    if (key === 'bridge-url') localBridgeUrl(String(value));
    if (key === 'mcp-access' && !['off', 'read', 'write'].includes(String(value)))
      throw new StorageError(422, 'Invalid MCP access level.');
    this.settingsRevision++;
    if (key === 'theme') useEditor.setState({ theme: String(value) });
    if (key === 'mcp-access') useEditor.setState({ mcpAccess: mcpAccess(value) });
    if (key === 'bridge-url') useEditor.setState({ bridgeUrl: String(value) });
    if (key === 'backup-nudge-dismissed')
      useEditor.setState({ backupNudgeDismissed: value === true });
    try {
      await this.repo.db.settings.put({ key, value });
      await this.refresh();
    } catch (error) {
      this.error(error);
      throw error;
    }
  }
  async external<T>(path: string, method: string, data?: unknown): Promise<T> {
    assertMcpAccess(useEditor.getState().mcpAccess, path, method);
    await this.settled();
    const permission = await this.repo.db.settings.get('mcp-access');
    assertMcpAccess(mcpAccess(permission?.value), path, method);
    return this.execute<T>(path, method, data);
  }
  async backup() {
    await this.requireStorageConsent();
    await this.settled();
    return this.repo.db.backup();
  }
  async restoreBackup(backup: WorkspaceBackup, mode: 'merge' | 'replace') {
    await this.requireStorageConsent();
    await this.settled();
    const graphs = await this.repo.restore(backup, mode);
    this.versions.clear();
    useEditor.getState().setGraph(null);
    sessionStorage.removeItem('vn-token');
    await this.refresh();
    if (graphs[0]) await this.open(graphs[0].diagram.id);
  }
  async deleteAll() {
    await this.queue;
    this.pending.clear();
    this.versions.clear();
    await this.repo.clearAll();
    useEditor.getState().setGraph(null);
    useEditor.setState({ status: 'saved', message: '' });
    sessionStorage.removeItem('vn-token');
    await this.refresh();
  }
  async remove(id: string) {
    await this.requireStorageConsent();
    await this.settled();
    await this.repo.removeDiagram(id);
    this.versions.delete(id);
    await this.refresh();
  }
  async resolve(strategy: 'copy' | 'discard' | 'retry') {
    await this.requireStorageConsent();
    await this.queue;
    const local = useEditor.getState().graph;
    if (!local) return;
    if (strategy === 'copy') {
      const copy = structuredClone(local);
      copy.diagram.name += ' (local copy)';
      const stored = await this.repo.importGraph(copy);
      this.pending.delete(local.diagram.id);
      useEditor.setState({ status: 'saved', message: '' });
      await this.open(stored.diagram.id);
    } else if (strategy === 'discard') {
      this.pending.delete(local.diagram.id);
      const current = await this.repo.db.graph(local.diagram.id);
      if (current) {
        this.versions.set(current.diagram.id, current.diagram.version);
        useEditor.getState().setGraph(current);
      } else useEditor.getState().setGraph(null);
      useEditor.setState({ status: 'saved', message: '' });
    } else {
      const current = await this.repo.db.graph(local.diagram.id);
      const stored = await this.repo.saveGraph(local, current?.diagram.version ?? 0);
      this.pending.delete(local.diagram.id);
      this.versions.set(stored.diagram.id, stored.diagram.version);
      useEditor.setState({ graph: stored, status: 'saved', message: '' });
    }
    await this.refresh();
  }
}
export const workspace = new Workspace();
