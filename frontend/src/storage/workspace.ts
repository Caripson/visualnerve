import { assertVoiceId, VOICE_SETTING } from '../presentation/speech/voices';
import { liveQuery, type Subscription } from 'dexie';
import { useEditor } from '../state/editor';
import { ownersFor, type Graph } from '../model/types';
import { graphDatasets } from '../data/model';
import { StorageError } from '../model/validation';
import { Repository, repository, type CommandOptions } from './repository';
import {
  mcpAccess,
  assertMcpAccess,
  defaultBridgeUrl,
  localBridgeUrl,
} from '../integration/access';
import type { WorkspaceBackup } from './database';
import { getSpatialView } from '../spatial/types';
import { assertImportLimitMb, IMPORT_LIMIT_SETTING, importLimitMb } from '../imports/limits';
import {
  appearancePreference,
  appearanceSettingsChanged,
  type AppearancePreference,
} from '../ui/appearance';

/** Commit a pending local camera before a user-requested snapshot or navigation. */
export function flushSpatialCamera() {
  const graph = useEditor.getState().graph;
  if (graph && getSpatialView(graph).mode === '3d')
    window.dispatchEvent(new Event('visualnerve:spatial-camera-flush'));
}

function spatialNavigation(graph: Graph | null, path: string, method: string, value: unknown) {
  if (!graph || method === 'GET') return false;
  if (
    method === 'POST' &&
    ['/spatial-diagrams', '/sql/diagrams', '/code/diagrams'].includes(
      path.replace(/^\/api\/v1/, ''),
    )
  )
    return true;
  const [collection, id, action] = new URL(
    path.replace(/^\/api\/v1/, ''),
    'http://browser.local',
  ).pathname
    .split('/')
    .filter(Boolean);
  if (
    collection !== 'diagrams' ||
    id !== graph.diagram.id ||
    !['PATCH', 'PUT', 'POST'].includes(method)
  )
    return false;
  const payload = value as
    | { settings?: { spatialView?: { mode?: unknown } }; graph?: Graph }
    | undefined;
  const mode =
    action === 'graph'
      ? payload?.graph?.diagram?.settings?.spatialView?.mode
      : payload?.settings?.spatialView?.mode;
  return (mode === '2d' || mode === '3d') && mode !== getSpatialView(graph).mode;
}

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
  const sources = new Map(graphDatasets(local).map((source) => [source.id, source]));
  const shareSource = (stored: Graph['dataset']) => {
    const value = stored ? sources.get(stored.id) : undefined;
    return value &&
      stored &&
      value.version === stored.version &&
      value.updatedAt === stored.updatedAt
      ? value
      : stored;
  };
  return {
    ...saved,
    dataset: shareSource(saved.dataset),
    datasets: saved.datasets?.map((source) => shareSource(source)!),
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
  private pending = new Map<string, { graph: Graph; sourcesChanged: boolean }>();
  private navigation = 0;
  private settingsRevision = 0;
  private appearanceTheme?: AppearancePreference;
  private stopped = false;
  private analysisCommands = new Set<AbortController>();
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
        importFileLimitMb: 50,
        workspaceId: '',
        theme: 'system',
      });
      this.syncAppearance('system');
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
      const oldSources = previous.graph ? graphDatasets(previous.graph) : [];
      const sources = graphDatasets(graph);
      const sourcesChanged =
        this.pending.get(graph.diagram.id)?.sourcesChanged === true ||
        oldSources.length !== sources.length ||
        sources.some((source, index) => source !== oldSources[index]);
      this.pending.set(graph.diagram.id, { graph, sourcesChanged });
      this.queue = this.queue.then(() => this.persist(graph, revision, sourcesChanged));
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
    for (const controller of this.analysisCommands) controller.abort();
    this.analysisCommands.clear();
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
  private async persist(graph: Graph, revision: number, sourcesChanged = false) {
    const id = graph.diagram.id;
    if (useEditor.getState().status === 'conflict') return;
    try {
      await this.requireStorageConsent();
      // Editor commands change the drawing/configuration, not the original CSV cells.
      const { dataset: _dataset, datasets: _datasets, ...drawing } = graph;
      const stored = await this.repo.saveGraph(
        sourcesChanged ? { ...graph, datasets: graph.datasets ?? [] } : drawing,
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
      if (this.pending.get(id)?.graph === graph) this.pending.delete(id);
    } catch (error) {
      this.error(error);
    }
  }
  async settled() {
    // A camera/edit event can append another save while an API read waits for
    // the previous tail. Keep every write on that same queue: persisting pending
    // graphs here would race their already-enqueued save with its own baseVersion.
    while (true) {
      const tail = this.queue;
      await tail;
      if (tail === this.queue) break;
    }
    if (this.pending.size) {
      const state = useEditor.getState();
      if (state.status === 'conflict') throw new StorageError(409, state.message);
      throw new StorageError(500, state.message || 'Pending local changes could not be saved.');
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
    const theme =
      preferences.get('storage-consent') === true
        ? appearancePreference(preferences.get('theme'))
        : 'system';
    useEditor.setState({
      diagrams: preferences.get('storage-consent') === true ? diagrams : [],
      owners: preferences.get('storage-consent') === true ? owners : [],
      theme,
      importFileLimitMb: importLimitMb(preferences.get(IMPORT_LIMIT_SETTING)),
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
    this.syncAppearance(theme);
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
  private syncAppearance(theme: AppearancePreference) {
    if (theme === this.appearanceTheme) return;
    this.appearanceTheme = theme;
    appearanceSettingsChanged();
  }
  async open(id: string, nodeId?: string, beforeOpen?: () => Promise<void>) {
    await this.requireStorageConsent();
    useEditor.getState().finishEditing();
    flushSpatialCamera();
    await this.settled();
    const navigation = ++this.navigation;
    const graph = await this.repo.getGraph(id);
    await beforeOpen?.();
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
    useEditor.getState().finishEditing();
    await this.settled();
    const stored = await this.repo.importGraph(graph);
    await this.refresh();
    await this.open(stored.diagram.id);
  }
  async execute<T>(
    path: string,
    method = 'GET',
    data?: unknown,
    options: CommandOptions = {},
  ): Promise<T> {
    await this.requireStorageConsent();
    await this.settled();
    const result = await this.repo.request<T>(path, method, data, options);
    await this.refresh();
    return result;
  }
  async setPreference(key: string, value: unknown) {
    await this.requireStorageConsent();
    if (key === 'bridge-url') localBridgeUrl(String(value));
    if (key === 'mcp-access' && !['off', 'read', 'write'].includes(String(value)))
      throw new StorageError(422, 'Invalid MCP access level.');
    if (key === IMPORT_LIMIT_SETTING) assertImportLimitMb(value);
    if (key === VOICE_SETTING) assertVoiceId(value);
    this.settingsRevision++;
    if (key === 'theme') useEditor.setState({ theme: String(value) });
    if (key === 'mcp-access') useEditor.setState({ mcpAccess: mcpAccess(value) });
    if (key === 'bridge-url') useEditor.setState({ bridgeUrl: String(value) });
    if (key === 'backup-nudge-dismissed')
      useEditor.setState({ backupNudgeDismissed: value === true });
    try {
      await this.repo.db.settings.put({ key, value });
      if (key === IMPORT_LIMIT_SETTING) useEditor.setState({ importFileLimitMb: value as number });
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
    const authorize = async () => {
      await this.requireStorageConsent();
      const permission = await this.repo.db.settings.get('mcp-access');
      if (!useEditor.getState().privacyAcknowledged)
        throw new StorageError(403, 'Accept local storage before using the workspace.');
      assertMcpAccess(useEditor.getState().mcpAccess, path, method);
      assertMcpAccess(mcpAccess(permission?.value), path, method);
    };
    if (spatialNavigation(useEditor.getState().graph, path, method, data)) {
      await this.requireStorageConsent();
      window.dispatchEvent(new Event('visualnerve:spatial-camera-flush'));
      const state = useEditor.getState();
      state.finishEditing();
      state.setDrawingTool('none');
      await this.settled();
      // A camera/title commit can yield; honor grants revoked while it was being saved.
      const latest = await this.repo.db.settings.get('mcp-access');
      assertMcpAccess(useEditor.getState().mcpAccess, path, method);
      assertMcpAccess(mcpAccess(latest?.value), path, method);
    }
    const endpoint = path.replace(/^\/api\/v1/, '');
    if (endpoint === '/presentation' || endpoint.startsWith('/presentation/')) {
      await authorize();
      let payload = data;
      if (endpoint === '/presentation/open' && method === 'POST') {
        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          Object.keys(payload).some((key) => !['diagramId', 'source'].includes(key)) ||
          ('diagramId' in payload && typeof payload.diagramId !== 'string') ||
          ('source' in payload && !['nodes', 'storyboard'].includes(String(payload.source)))
        )
          throw new StorageError(
            422,
            'Open expects an optional diagramId and nodes or storyboard source.',
          );
        const { isVideoExporting } = await import('../presentation/video-service');
        const authorizeOpen = async () => {
          await authorize();
          if (isVideoExporting())
            throw new StorageError(409, 'Cancel or finish video export before opening a diagram.');
        };
        await authorizeOpen();
        if ('diagramId' in payload)
          await this.open(payload.diagramId as string, undefined, authorizeOpen);
        payload = 'source' in payload ? { source: payload.source } : {};
      }
      const { presentationRequest } = await import('../presentation/service');
      await authorize();
      return (await presentationRequest(endpoint, method, payload, authorize)) as T;
    }
    const diagramFile =
      method === 'POST' &&
      endpoint === '/import' &&
      !!data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      ((data as { format?: unknown }).format === 'drawio' ||
        (data as { format?: unknown }).format === 'vsdx');
    const analysis =
      method === 'POST' &&
      ([
        '/sql/preview',
        '/sql/diagrams',
        '/code/preview',
        '/code/diagrams',
        '/diagram-files/preview',
      ].includes(endpoint) ||
        diagramFile);
    const controller = analysis ? new AbortController() : undefined;
    if (controller) this.analysisCommands.add(controller);
    const unsubscribe = controller
      ? useEditor.subscribe((state) => {
          if (
            !state.privacyAcknowledged ||
            state.mcpAccess === 'off' ||
            ((endpoint.endsWith('/diagrams') || diagramFile) && state.mcpAccess !== 'write')
          )
            controller.abort();
        })
      : undefined;
    try {
      const result = await this.execute<T>(path, method, data, {
        signal: controller?.signal,
        beforeHistoryWrite: authorize,
        beforeAnalysisSave: analysis
          ? async () => {
              await this.requireStorageConsent();
              const current = await this.repo.db.settings.get('mcp-access');
              assertMcpAccess(useEditor.getState().mcpAccess, path, method);
              assertMcpAccess(mcpAccess(current?.value), path, method);
            }
          : undefined,
      });
      if (
        method === 'POST' &&
        (['/spatial-diagrams', '/sql/diagrams', '/code/diagrams'].includes(endpoint) || diagramFile)
      )
        await this.open((result as Graph).diagram.id);
      return result;
    } finally {
      unsubscribe?.();
      if (controller) this.analysisCommands.delete(controller);
    }
  }
  async backup() {
    await this.requireStorageConsent();
    useEditor.getState().finishEditing();
    flushSpatialCamera();
    await this.settled();
    return this.repo.db.backup();
  }
  async restoreBackup(backup: WorkspaceBackup, mode: 'merge' | 'replace') {
    await this.requireStorageConsent();
    flushSpatialCamera();
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
