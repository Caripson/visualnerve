import { assertVoiceId, VOICE_SETTING } from '../presentation/speech/voices';
import { liveQuery, type Subscription } from 'dexie';
import { useEditor, type SaveStatus } from '../state/editor';
import { diffGraph } from '../state/history';
import { ownersFor, type Graph } from '../model/types';
import { graphDatasets } from '../data/model';
import { StorageError } from '../model/validation';
import { Repository, repository, type CommandOptions } from './repository';
import {
  mcpAccess,
  assertMcpAccess,
  defaultBridgeUrl,
  localBridgeUrl,
  type McpAccess,
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

interface QueuedSave {
  graph: Graph;
  revision: number;
  sourcesChanged: boolean;
  cancelled?: boolean;
}
interface PreferenceFailure {
  generation: number;
  message: string;
  diagramId?: string;
  revision: number;
  navigation: number;
  previousState: { status: SaveStatus; message: string };
  previous?: PreferenceFailure;
  resolved?: boolean;
}
function mutatesDocument(path: string, method: string) {
  if (method === 'GET') return false;
  const [collection, id, action, entity, operation] = new URL(
    path.replace(/^\/api\/v1/, ''),
    'http://browser.local',
  ).pathname
    .split('/')
    .filter(Boolean);
  if (['nodes', 'edges', 'owners'].includes(collection)) return true;
  if (collection !== 'diagrams' || !id) return false;
  if (action === 'simulation' && ['runs', 'compare'].includes(entity)) return false;
  if (['questions', 'build-brief', 'evidence'].includes(action)) return false;
  if (action === 'history') return !!entity && operation === 'restore' && method === 'POST';
  return true;
}
function withoutCamera(graph: Graph) {
  const {
    viewport: _viewport,
    viewportDevice: _device,
    spatialView,
    ...settings
  } = graph.diagram.settings;
  const { camera: _camera, ...spatial } = spatialView ?? {};
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...settings, ...(spatialView ? { spatialView: spatial } : {}) },
    },
  } as Graph;
}
function cameraOnly(before: Graph, local: Graph) {
  const delta = diffGraph(withoutCamera(before), withoutCamera(local), 'Camera compatibility');
  return (
    !delta.nodes.length &&
    !delta.edges.length &&
    !delta.nodeOrder &&
    !delta.edgeOrder &&
    !delta.diagram &&
    !delta.simulation &&
    !delta.sources?.length &&
    JSON.stringify(before.owners) === JSON.stringify(local.owners)
  );
}
function cameraRebased(before: Graph, local: Graph, committed: Graph): Graph {
  const settings = { ...committed.diagram.settings };
  for (const key of ['viewport', 'viewportDevice'] as const)
    if (
      JSON.stringify(before.diagram.settings[key]) !== JSON.stringify(local.diagram.settings[key])
    )
      if (key === 'viewport') settings.viewport = local.diagram.settings.viewport;
      else settings.viewportDevice = local.diagram.settings.viewportDevice;
  if (
    settings.spatialView &&
    JSON.stringify(before.diagram.settings.spatialView?.camera) !==
      JSON.stringify(local.diagram.settings.spatialView?.camera)
  )
    settings.spatialView = {
      ...settings.spatialView,
      camera: local.diagram.settings.spatialView?.camera,
    };
  return { ...committed, diagram: { ...committed.diagram, settings } };
}

/** Optimistic editor state backed exclusively by committed IndexedDB transactions. */
export class Workspace {
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private observer?: Subscription;
  private versions = new Map<string, number>();
  private pending = new Map<string, QueuedSave>();
  private queuedSaves = new Set<QueuedSave>();
  private navigation = 0;
  private settingsRevision = 0;
  private preferenceWrites = 0;
  private errorGeneration = 0;
  private preferenceFailures = new Map<string, PreferenceFailure>();
  private accessCeiling?: McpAccess;
  private accessChoice = 0;
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
      const save = { graph, revision, sourcesChanged };
      this.pending.set(graph.diagram.id, save);
      this.queuedSaves.add(save);
      this.queue = this.queue.then(() => this.persist(save));
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
  private mcpGrant(value: unknown): McpAccess {
    const grant = mcpAccess(value);
    if (grant === 'off' || this.accessCeiling === 'off') return 'off';
    if (grant === 'read' || this.accessCeiling === 'read') return 'read';
    return 'write';
  }
  private error(error: unknown) {
    this.errorGeneration++;
    const conflict = error instanceof StorageError && [404, 409].includes(error.status);
    useEditor.setState({
      status: conflict ? 'conflict' : 'error',
      message: (error as Error).message,
    });
  }
  private ownsPreferenceError(failure: PreferenceFailure) {
    const state = useEditor.getState();
    return (
      state.status === 'error' &&
      state.message === failure.message &&
      this.errorGeneration === failure.generation
    );
  }
  private preferenceError(key: string, error: unknown) {
    const state = useEditor.getState();
    const previous = [...this.preferenceFailures.values()].find((failure) =>
      this.ownsPreferenceError(failure),
    );
    // Repeated failed attempts belong to the same error, retaining the state
    // that preceded it rather than restoring an earlier failed retry.
    const replaced = this.preferenceFailures.get(key);
    const sameKey = previous === replaced;
    if (replaced) replaced.resolved = true;
    this.error(error);
    this.preferenceFailures.set(key, {
      generation: this.errorGeneration,
      message: (error as Error).message,
      diagramId: state.graph?.diagram.id,
      revision: state.editRevision,
      navigation: this.navigation,
      previousState:
        sameKey && previous
          ? previous.previousState
          : { status: state.status, message: state.message },
      previous: sameKey && previous ? previous.previous : previous,
    });
  }
  private acknowledgePreference(key: string, failure?: PreferenceFailure) {
    if (!failure || this.preferenceFailures.get(key) !== failure) return;
    this.preferenceFailures.delete(key);
    failure.resolved = true;
    const state = useEditor.getState();
    if (
      this.stopped ||
      !this.ownsPreferenceError(failure) ||
      state.graph?.diagram.id !== failure.diagramId ||
      state.editRevision !== failure.revision ||
      this.navigation !== failure.navigation ||
      this.pending.size ||
      this.queuedSaves.size ||
      state.commandError
    )
      return;
    let restore = failure.previousState;
    let previous = failure.previous;
    // A different preference may have been successfully retried while hidden
    // behind this error. Do not resurrect an already acknowledged failure.
    while (previous?.resolved) {
      restore = previous.previousState;
      previous = previous.previous;
    }
    this.errorGeneration++;
    if (previous) previous.generation = this.errorGeneration;
    useEditor.setState(restore);
  }
  private async persist(save: QueuedSave) {
    const { graph, revision, sourcesChanged } = save;
    const id = graph.diagram.id;
    if (save.cancelled || useEditor.getState().status === 'conflict') {
      this.queuedSaves.delete(save);
      return;
    }
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
    } finally {
      this.queuedSaves.delete(save);
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
    const queue = this.queue;
    await queue;
    if (queue !== this.queue || this.stopped) return;
    const settingsRevision = this.settingsRevision;
    const [diagrams, owners, settings] = await Promise.all([
      this.repo.db.diagrams.orderBy('updatedAt').reverse().toArray(),
      this.repo.db.owners.toArray(),
      this.repo.db.settings.toArray(),
    ]);
    const preferences = new Map(settings.map((setting) => [setting.key, setting.value]));
    if (
      settingsRevision !== this.settingsRevision ||
      this.preferenceWrites ||
      queue !== this.queue ||
      this.stopped
    )
      return;
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
          ? this.mcpGrant(preferences.get('mcp-access'))
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
    // A delayed read can predate our own acknowledged save; it is not another writer.
    if (
      record &&
      record.version < (this.versions.get(current.diagram.id) ?? current.diagram.version)
    )
      return;
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
    if (
      queue !== this.queue ||
      useEditor.getState().graph !== current ||
      this.pending.has(record.id)
    )
      return;
    if (graph.diagram.version < (this.versions.get(record.id) ?? 0)) return;
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
    if (!mutatesDocument(path, method)) {
      await options.beforeRequest?.();
      const result = await this.repo.request<T>(path, method, data, options);
      await this.refresh();
      return result;
    }
    // External writes and autosaves have one ordering. Camera completions can still
    // arrive while the repository transaction runs; acknowledge/rebase them before saving.
    const operation = this.queue.then(async () => {
      const state = useEditor.getState();
      const before = state.graph ? ownersFor(state.graph, state.owners) : undefined;
      await options.beforeRequest?.();
      const result = await this.repo.request<T>(path, method, data, options);
      if (before) {
        const committed = await this.apiCommittedGraph(before, path, method, result);
        if (committed !== undefined) this.acknowledgeApi(before, committed);
      }
      return result;
    });
    this.queue = operation.then(
      () => {},
      () => {},
    );
    const result = await operation;
    await this.refresh();
    return result;
  }
  private async apiCommittedGraph(before: Graph, path: string, method: string, result: unknown) {
    const parts = new URL(path.replace(/^\/api\/v1/, ''), 'http://browser.local').pathname
      .split('/')
      .filter(Boolean);
    const value = result as Partial<Graph> & {
      diagramId?: string;
      id?: string;
      version?: number;
      nodeType?: unknown;
      sourceNodeId?: unknown;
      targetNodeId?: unknown;
    };
    if (
      parts[0] === 'diagrams' &&
      parts[1] === before.diagram.id &&
      value?.diagram?.id === before.diagram.id &&
      value.diagram.version > before.diagram.version &&
      Array.isArray(value.nodes) &&
      Array.isArray(value.edges)
    )
      return value as Graph;
    const ownEntity =
      value?.diagramId === before.diagram.id &&
      (typeof value.nodeType === 'string' ||
        (typeof value.sourceNodeId === 'string' && typeof value.targetNodeId === 'string'));
    const ownDiagram = value?.id === before.diagram.id && typeof value.version === 'number';
    const ownOwner = parts[0] === 'owners' && before.owners.some((owner) => owner.id === parts[1]);
    const deletion =
      method === 'DELETE' &&
      ((parts[0] === 'diagrams' &&
        parts[1] === before.diagram.id &&
        (parts.length === 2 ||
          (parts.length === 5 &&
            parts[2] === 'simulation' &&
            [
              'nodes',
              'edges',
              'particle-types',
              'resources',
              'improvements',
              'scenarios',
              'processes',
            ].includes(parts[3])))) ||
        (parts[0] === 'nodes' && before.nodes.some((node) => node.id === parts[1])) ||
        (parts[0] === 'edges' && before.edges.some((edge) => edge.id === parts[1])));
    if (!ownEntity && !ownDiagram && !ownOwner && !deletion) return undefined;
    const committed = await this.repo.db.graph(before.diagram.id);
    if (!committed)
      return deletion && parts.length === 2 && parts[0] === 'diagrams' ? null : undefined;
    const expected = ownDiagram ? value.version! : before.diagram.version + 1;
    // Node/empty responses carry no graph version. Only this operation's expected
    // single commit is attributable; a newer unknown version belongs to another writer.
    return committed.diagram.version === expected ? committed : undefined;
  }
  private acknowledgeApi(before: Graph, committed: Graph | null) {
    const id = before.diagram.id;
    const saves = [...this.queuedSaves].filter((save) => save.graph.diagram.id === id);
    const state = useEditor.getState();
    const current =
      state.graph?.diagram.id === id ? ownersFor(state.graph, state.owners) : undefined;
    if (committed) this.versions.set(id, committed.diagram.version);
    if (
      saves.some((save) => !cameraOnly(before, save.graph)) ||
      (current && !cameraOnly(before, current))
    ) {
      this.error(
        new StorageError(
          409,
          'The API changed this project while you were editing it. Your unsaved local edits are preserved.',
        ),
      );
      return;
    }
    for (const save of saves) {
      if (committed) save.graph = cameraRebased(before, save.graph, committed);
      else save.cancelled = true;
    }
    if (!committed) {
      this.pending.delete(id);
      this.versions.delete(id);
    }
    if (current)
      useEditor.setState({
        graph: committed ? cameraRebased(before, current, committed) : null,
        history: [],
        future: [],
        status: committed && saves.length ? 'saving' : 'saved',
        message: '',
      });
  }
  async setPreference(key: string, value: unknown) {
    if (key === 'bridge-url') localBridgeUrl(String(value));
    if (key === 'mcp-access' && !['off', 'read', 'write'].includes(String(value)))
      throw new StorageError(422, 'Invalid MCP access level.');
    if (key === IMPORT_LIMIT_SETTING) assertImportLimitMb(value);
    if (key === VOICE_SETTING) assertVoiceId(value);
    this.settingsRevision++;
    this.preferenceWrites++;
    const retryingFailure = this.preferenceFailures.get(key);
    let accessChoice: number | undefined;
    // Revocation closes the live grant before the settings read/write can wait
    // on an API transaction. Upgrades still require accepted persisted storage.
    if (key === 'mcp-access') {
      accessChoice = ++this.accessChoice;
      const current = this.mcpGrant(useEditor.getState().mcpAccess);
      const requested = this.mcpGrant(value);
      this.accessCeiling =
        current === 'off' || requested === 'off'
          ? 'off'
          : current === 'read' || requested === 'read'
            ? 'read'
            : 'write';
      useEditor.setState({ mcpAccess: this.accessCeiling });
    }
    try {
      await this.requireStorageConsent();
      // A newer choice can finish while this consent read is waiting. There is
      // no await between this fence and put; started IDB writes are ordered.
      if (key === 'mcp-access' && accessChoice !== this.accessChoice) return;
      if (key === 'theme') useEditor.setState({ theme: String(value) });
      if (key === 'mcp-access') useEditor.setState({ mcpAccess: this.mcpGrant(value) });
      if (key === 'bridge-url') useEditor.setState({ bridgeUrl: String(value) });
      await this.repo.db.settings.put({ key, value });
      if (key === 'mcp-access' && accessChoice === this.accessChoice) {
        // Only a successfully saved explicit choice can lift a local restriction.
        // Failed writes and unrelated refreshes must never resurrect an old grant.
        this.accessCeiling = mcpAccess(value);
        useEditor.setState({ mcpAccess: this.accessCeiling });
      }
      // Disappearance acknowledges persistence, so an immediate reload cannot
      // restore a reminder that looked successfully dismissed.
      if (key === 'backup-nudge-dismissed')
        useEditor.setState({ backupNudgeDismissed: value === true });
      if (key === IMPORT_LIMIT_SETTING) useEditor.setState({ importFileLimitMb: value as number });
      if (key === 'theme') this.syncAppearance(appearancePreference(value));
      this.acknowledgePreference(key, retryingFailure);
      // Preferences, especially access revocation, must not wait for the work
      // they cancel or an unrelated camera/document save to leave its queue.
    } catch (error) {
      this.preferenceError(key, error);
      throw error;
    } finally {
      this.preferenceWrites--;
    }
    void this.refresh().catch((error) => this.error(error));
  }
  async external<T>(path: string, method: string, data?: unknown): Promise<T> {
    assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
    await this.settled();
    const permission = await this.repo.db.settings.get('mcp-access');
    assertMcpAccess(mcpAccess(permission?.value), path, method);
    const authorize = async () => {
      await this.requireStorageConsent();
      const permission = await this.repo.db.settings.get('mcp-access');
      if (!useEditor.getState().privacyAcknowledged)
        throw new StorageError(403, 'Accept local storage before using the workspace.');
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
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
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
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
        beforeRequest: authorize,
        beforeWrite: authorize,
        beforeHistoryWrite: authorize,
        beforeAnalysisSave: analysis
          ? async () => {
              await this.requireStorageConsent();
              const current = await this.repo.db.settings.get('mcp-access');
              assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
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
