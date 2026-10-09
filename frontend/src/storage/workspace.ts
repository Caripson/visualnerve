import { assertVoiceId, normalizeVoiceId, VOICE_SETTING } from '../presentation/speech/voices';
import { VOICE_CHANGED } from '../presentation/speech/voice-events';
import { workspaceStoreNames, type WorkspaceOperation, type WorkspaceStorage } from './contracts';
import { useEditor } from '../state/editor';
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
  assertProjectSourceFileLimit,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
  projectSourceFileLimit,
} from '../code/project/limits';
import {
  appearancePreference,
  appearanceSettingsChanged,
  type AppearancePreference,
} from '../ui/appearance';
import { bridge } from '../integration/bridge';
import { isWorkspaceLockCommand, workspaceSecurityStatus } from './security-status';
import type { VaultSession } from '../security/vault-session';
import { VaultStorageError } from '../security/vault-storage';
import { ExternalSvgAuthority } from './external-svg-authority';

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
    ['/spatial-diagrams', '/sql/diagrams', '/code/diagrams', '/code/project/diagrams'].includes(
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
  graph?: Graph;
  revision: number;
  sourcesChanged: boolean;
  cancelled?: boolean;
  operation?: Promise<WorkspaceOperation>;
}
interface WorkspaceJob {
  operation: WorkspaceOperation;
  repo: Repository;
  lifecycle: number;
  check(): Promise<void>;
}
interface PreferenceFailure {
  message: string;
  value: unknown;
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
  private voiceSelection?: string;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private observer?: () => void;
  private lifecycle = 0;
  private versions = new Map<string, number>();
  private pending = new Map<string, QueuedSave>();
  private queuedSaves = new Set<QueuedSave>();
  private navigation = 0;
  private settingsRevision = 0;
  private preferenceWrites = 0;
  private preferenceFailures = new Map<string, PreferenceFailure>();
  private accessCeiling?: McpAccess;
  private accessChoice = 0;
  private appearanceTheme?: AppearancePreference;
  private stopped = false;
  private analysisCommands = new Set<AbortController>();
  private externalSvgJobs = new Set<ExternalSvgAuthority>();
  constructor(public repo: Repository = repository) {}
  private assertLifecycle(lifecycle: number) {
    if (lifecycle !== this.lifecycle || this.stopped)
      throw new StorageError(409, 'This workspace operation was cancelled.');
  }
  private async withOperation<T>(
    work: (job: WorkspaceJob) => Promise<T>,
    existing?: WorkspaceJob,
    originatingOperation?: WorkspaceOperation,
  ): Promise<T> {
    if (existing) {
      await existing.check();
      const result = await work(existing);
      await existing.check();
      return result;
    }
    const lifecycle = this.lifecycle;
    const operation = originatingOperation ?? (await this.repo.db.captureOperation());
    const job: WorkspaceJob = {
      operation,
      repo: new Repository(operation.storage),
      lifecycle,
      check: async () => {
        await operation.check();
        this.assertLifecycle(lifecycle);
      },
    };
    try {
      await job.check();
      const result = await work(job);
      await job.check();
      return result;
    } catch (error) {
      await job.check();
      throw error;
    } finally {
      if (!originatingOperation) operation.dispose();
    }
  }
  async start() {
    this.lifecycle++;
    this.stopped = false;
    this.unsubscribe?.();
    this.observer?.();
    this.unsubscribe = undefined;
    this.observer = undefined;
    // Unlocking is not authorization to revive an earlier agent's content access.
    if ('session' in this.repo.db) this.accessCeiling = 'off';
    this.publishPreferenceError();
    await this.withOperation(async (job) => {
      const db = job.operation.storage;
      await db.open();
      await job.check();
      if ((await db.settings.get('storage-consent'))?.value !== true) {
        await job.check();
        useEditor.setState({
          privacyAcknowledged: false,
          graph: null,
          diagrams: [],
          owners: [],
          mcpAccess: 'off',
          importFileLimitMb: 50,
          projectSourceFileLimit: 500,
          workspaceId: '',
          theme: 'system',
        });
        this.syncAppearance('system');
        return;
      }
      await db.initialize();
      await job.check();
      const theme = await db.settings.get('theme');
      await job.check();
      const legacyTheme = localStorage.getItem('vn-theme');
      if (!theme && legacyTheme) await db.settings.put({ key: 'theme', value: legacyTheme });
      await job.check();
      localStorage.removeItem('vn-theme');
      const lifecycle = job.lifecycle;
      this.unsubscribe = useEditor.subscribe((state, previous) => {
        if (
          lifecycle !== this.lifecycle ||
          this.stopped ||
          state.editRevision === previous.editRevision ||
          !state.graph
        )
          return;
        const graph = ownersFor(state.graph, state.owners);
        const revision = state.editRevision;
        const oldSources = previous.graph ? graphDatasets(previous.graph) : [];
        const sources = graphDatasets(graph);
        const sourcesChanged =
          this.pending.get(graph.diagram.id)?.sourcesChanged === true ||
          oldSources.length !== sources.length ||
          sources.some((source, index) => source !== oldSources[index]);
        const save = {
          graph,
          revision,
          sourcesChanged,
          operation: this.repo.db.captureOperation(),
        };
        // Attach a rejection handler while the job waits behind older saves.
        void save.operation.catch(() => undefined);
        this.pending.set(graph.diagram.id, save);
        this.queuedSaves.add(save);
        this.queue = this.queue.then(() => this.persist(save));
      });
      await this.refresh(job);
      await job.check();
      const last = await db.settings.get('last-diagram');
      await job.check();
      if (
        typeof last?.value === 'string' &&
        useEditor.getState().diagrams.some((diagram) => diagram.id === last.value)
      )
        await this.openCaptured(job, last.value, ++this.navigation);
      await job.check();
      this.observer = db.subscribe((change) => {
        if (lifecycle !== this.lifecycle || this.stopped) return;
        if (change.stores.some((store) => ['diagrams', 'owners', 'settings'].includes(store))) {
          void this.refresh().catch((error) => {
            if (lifecycle === this.lifecycle && !this.stopped) this.error(error);
          });
        }
      });
      if (this.repo === repository) {
        await job.check();
        bridge.start();
      }
    });
  }
  stop() {
    this.lifecycle++;
    this.navigation++;
    this.stopped = true;
    this.preferenceWrites = 0;
    for (const controller of this.analysisCommands) controller.abort();
    this.analysisCommands.clear();
    this.cancelExternalSvgJobs();
    this.unsubscribe?.();
    this.observer?.();
    this.unsubscribe = undefined;
    this.observer = undefined;
    for (const save of this.queuedSaves) save.cancelled = true;
  }
  async acceptStorage() {
    await this.withOperation(async (job) => {
      await job.operation.storage.settings.put({ key: 'storage-consent', value: true });
      await job.check();
    });
    this.stop();
    await this.start();
  }
  private async requireStorageConsent(db: WorkspaceStorage = this.repo.db) {
    if ((await db.settings.get('storage-consent'))?.value !== true)
      throw new StorageError(403, 'Accept local browser storage before using the workspace.');
  }
  private mcpGrant(value: unknown): McpAccess {
    const grant = mcpAccess(value);
    if (grant === 'off' || this.accessCeiling === 'off') return 'off';
    if (grant === 'read' || this.accessCeiling === 'read') return 'read';
    return 'write';
  }
  private error(error: unknown) {
    const conflict = error instanceof StorageError && [404, 409].includes(error.status);
    useEditor.setState({
      status: conflict ? 'conflict' : 'error',
      message: (error as Error).message,
    });
  }
  private publishPreferenceError() {
    const latest = [...this.preferenceFailures.entries()].at(-1);
    // A camera/document save acknowledges only the graph. Failed preference
    // writes remain independently visible until that setting is actually saved.
    useEditor.setState({
      preferenceError: latest ? { key: latest[0], message: latest[1].message } : null,
    });
  }
  private preferenceError(key: string, value: unknown, error: unknown) {
    this.preferenceFailures.delete(key);
    this.preferenceFailures.set(key, { value, message: (error as Error).message });
    this.publishPreferenceError();
  }
  private acknowledgePreference(key: string, failure?: PreferenceFailure) {
    if (!failure || this.preferenceFailures.get(key) !== failure) return;
    this.preferenceFailures.delete(key);
    this.publishPreferenceError();
  }
  async retryPreference(key: string) {
    const failure = this.preferenceFailures.get(key);
    if (failure) await this.setPreference(key, failure.value);
  }
  private async persist(save: QueuedSave) {
    const { graph, revision, sourcesChanged } = save;
    let operation: WorkspaceOperation | undefined;
    if (!graph || save.cancelled || useEditor.getState().status === 'conflict') {
      void save.operation?.then((operation) => operation.dispose()).catch(() => undefined);
      this.queuedSaves.delete(save);
      return;
    }
    const id = graph.diagram.id;
    try {
      operation = await (save.operation ?? this.repo.db.captureOperation());
      const repo = new Repository(operation.storage);
      await this.requireStorageConsent(operation.storage);
      // Editor commands change the drawing/configuration, not the original CSV cells.
      const { dataset: _dataset, datasets: _datasets, ...drawing } = graph;
      const stored = await repo.saveGraph(
        sourcesChanged ? { ...graph, datasets: graph.datasets ?? [] } : drawing,
        this.versions.get(id) ?? graph.diagram.version,
      );
      await operation.check();
      if (save.cancelled || this.stopped) return;
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
      if (!save.cancelled && !this.stopped) this.error(error);
    } finally {
      operation?.dispose();
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
  /** Retry failed autosaves with their original versions; never overwrite a conflict. */
  async retryFailedSaves() {
    await this.withOperation(async (job) => {
      await this.requireStorageConsent(job.operation.storage);
      await this.queue;
      await job.check();
      const state = useEditor.getState();
      if (state.status === 'conflict') throw new StorageError(409, state.message);
      for (const [id, save] of this.pending) {
        if (this.queuedSaves.has(save)) continue;
        const operation = this.repo.db.captureOperation();
        void operation.catch(() => undefined);
        const retry = { ...save, cancelled: false, operation };
        this.pending.set(id, retry);
        this.queuedSaves.add(retry);
        this.queue = this.queue.then(() => this.persist(retry));
      }
      await this.settled();
    });
  }
  async refresh(existing?: WorkspaceJob) {
    if (this.stopped) return;
    return this.withOperation((job) => this.refreshCaptured(job), existing);
  }
  private async refreshCaptured(job: WorkspaceJob) {
    const lifecycle = job.lifecycle;
    const queue = this.queue;
    await queue;
    if (queue !== this.queue || this.stopped) return;
    const settingsRevision = this.settingsRevision;
    const [diagrams, owners, settings] = await job.operation.storage.atomic(
      'r',
      ['diagrams', 'owners', 'settings'],
      async (scope) =>
        Promise.all([
          scope.diagrams.orderBy('updatedAt').reverse().toArray(),
          scope.owners.toArray(),
          scope.settings.toArray(),
        ]),
    );
    await job.check();
    const preferences = new Map(settings.map((setting) => [setting.key, setting.value]));
    if (
      settingsRevision !== this.settingsRevision ||
      this.preferenceWrites ||
      queue !== this.queue ||
      this.stopped ||
      lifecycle !== this.lifecycle
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
      projectSourceFileLimit: projectSourceFileLimit(
        preferences.get(PROJECT_SOURCE_FILE_LIMIT_SETTING),
      ),
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
    this.publishVoiceSelection(preferences.get(VOICE_SETTING));
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
    const graph = await job.repo.getGraph(record.id);
    await job.check();
    if (
      queue !== this.queue ||
      useEditor.getState().graph !== current ||
      this.pending.has(record.id) ||
      lifecycle !== this.lifecycle ||
      this.stopped
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
  private publishVoiceSelection(value: unknown, explicit = false) {
    const selected = normalizeVoiceId(value);
    const changed = selected !== this.voiceSelection;
    const initialized = this.voiceSelection !== undefined;
    this.voiceSelection = selected;
    if (changed && (initialized || explicit)) window.dispatchEvent(new Event(VOICE_CHANGED));
  }
  async open(id: string, nodeId?: string, beforeOpen?: () => Promise<void>) {
    const navigation = ++this.navigation;
    return this.withOperation((job) => this.openCaptured(job, id, navigation, nodeId, beforeOpen));
  }
  private async openCaptured(
    job: WorkspaceJob,
    id: string,
    navigation: number,
    nodeId?: string,
    beforeOpen?: () => Promise<void>,
  ) {
    await this.requireStorageConsent(job.operation.storage);
    await job.check();
    if (navigation !== this.navigation) return;
    useEditor.getState().finishEditing();
    flushSpatialCamera();
    await this.settled();
    await job.check();
    if (navigation !== this.navigation) return;
    const graph = await job.repo.getGraph(id);
    await beforeOpen?.();
    await job.check();
    if (navigation !== this.navigation) return;
    await job.operation.storage.atomic('rw', ['settings'], async (scope) => {
      await this.requireStorageConsent(scope);
      await scope.settings.put({ key: 'last-diagram', value: id });
    });
    await job.check();
    if (navigation !== this.navigation) return;
    // Mounting the canvas can immediately enqueue a viewport save. Persist its
    // navigation preference first so that initialization has one write order.
    this.versions.set(id, graph.diagram.version);
    useEditor.getState().setGraph(graph);
    useEditor.setState({ status: 'saved', message: '' });
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
  async create(graph: Graph, originatingOperation?: WorkspaceOperation) {
    const navigation = ++this.navigation;
    await this.withOperation(
      async (job) => {
        await this.requireStorageConsent(job.operation.storage);
        await job.check();
        useEditor.getState().finishEditing();
        await this.settled();
        await job.check();
        const stored = await job.repo.importGraph(graph, (scope) =>
          this.requireStorageConsent(scope),
        );
        await job.check();
        await this.refresh(job);
        await this.openCaptured(job, stored.diagram.id, navigation);
      },
      undefined,
      originatingOperation,
    );
  }
  async execute<T>(
    path: string,
    method = 'GET',
    data?: unknown,
    options: CommandOptions = {},
    originatingOperation?: WorkspaceOperation,
  ): Promise<T> {
    return this.withOperation(
      async (job) => {
        const { operation } = job;
        const guarded: CommandOptions = {
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, operation.signal])
            : operation.signal,
          beforeRequest: async () => {
            await job.check();
            await options.beforeRequest?.();
          },
          beforeWrite: async (scope) => {
            await job.check();
            await options.beforeWrite?.(scope);
          },
          beforeHistoryWrite: async (scope) => {
            await job.check();
            await options.beforeHistoryWrite?.(scope);
          },
        };
        return this.executeCaptured<T>(job.repo, path, method, data, guarded, job);
      },
      undefined,
      originatingOperation,
    );
  }
  private async executeCaptured<T>(
    repo: Repository,
    path: string,
    method: string,
    data: unknown,
    options: CommandOptions,
    job: WorkspaceJob,
  ): Promise<T> {
    await this.requireStorageConsent(repo.db);
    await this.settled();
    if (!mutatesDocument(path, method)) {
      await options.beforeRequest?.();
      const result = await repo.request<T>(path, method, data, options);
      await this.refresh(job);
      return result;
    }
    // External writes and autosaves have one ordering. Camera completions can still
    // arrive while the repository transaction runs; acknowledge/rebase them before saving.
    const operation = this.queue.then(async () => {
      const state = useEditor.getState();
      const before = state.graph ? ownersFor(state.graph, state.owners) : undefined;
      await options.beforeRequest?.();
      const result = await repo.request<T>(path, method, data, options);
      if (before) {
        const committed = await this.apiCommittedGraph(before, path, method, result, repo);
        await job.check();
        if (committed !== undefined) this.acknowledgeApi(before, committed);
      }
      return result;
    });
    this.queue = operation.then(
      () => {},
      () => {},
    );
    const result = await operation;
    await this.refresh(job);
    return result;
  }
  private async apiCommittedGraph(
    before: Graph,
    path: string,
    method: string,
    result: unknown,
    repo: Repository = this.repo,
  ) {
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
    const committed = await repo.db.graph(before.diagram.id);
    if (!committed)
      return deletion && parts.length === 2 && parts[0] === 'diagrams' ? null : undefined;
    const expected = ownDiagram ? value.version! : before.diagram.version + 1;
    // Node/empty responses carry no graph version. Only this operation's expected
    // single commit is attributable; a newer unknown version belongs to another writer.
    return committed.diagram.version === expected ? committed : undefined;
  }
  private acknowledgeApi(before: Graph, committed: Graph | null) {
    const id = before.diagram.id;
    const saves = [...this.queuedSaves].filter((save) => save.graph?.diagram.id === id);
    const state = useEditor.getState();
    const current =
      state.graph?.diagram.id === id ? ownersFor(state.graph, state.owners) : undefined;
    if (committed) this.versions.set(id, committed.diagram.version);
    if (
      saves.some((save) => save.graph && !cameraOnly(before, save.graph)) ||
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
      if (committed && save.graph) save.graph = cameraRebased(before, save.graph, committed);
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
    if (key === PROJECT_SOURCE_FILE_LIMIT_SETTING) assertProjectSourceFileLimit(value);
    if (key === VOICE_SETTING) assertVoiceId(value);
    const lifecycle = this.lifecycle;
    this.settingsRevision++;
    this.preferenceWrites++;
    const retryingFailure = this.preferenceFailures.get(key);
    let accessChoice: number | undefined;
    // Revocation closes the live grant before a persisted write can wait on IDB.
    if (key === 'mcp-access') {
      accessChoice = ++this.accessChoice;
      this.cancelExternalSvgJobs();
      if (this.repo === repository) bridge.beginAccessChoice();
      const current = this.mcpGrant(useEditor.getState().mcpAccess);
      const requested = this.mcpGrant(value);
      this.accessCeiling =
        current === 'off' || requested === 'off'
          ? 'off'
          : current === 'read' || requested === 'read'
            ? 'read'
            : 'write';
      useEditor.setState({ mcpAccess: this.accessCeiling });
      if (value === 'off' && this.repo === repository) bridge.disconnect();
    }
    if (key === 'storage-consent' && value !== true) this.cancelExternalSvgJobs();
    try {
      await this.withOperation(async (job) => {
        const saved = await job.operation.storage.atomic('rw', ['settings'], async (scope) => {
          await this.requireStorageConsent(scope);
          await job.check();
          if (key === 'mcp-access' && accessChoice !== this.accessChoice) return false;
          if (key === 'theme') useEditor.setState({ theme: String(value) });
          if (key === 'mcp-access') useEditor.setState({ mcpAccess: this.mcpGrant(value) });
          if (key === 'bridge-url') useEditor.setState({ bridgeUrl: String(value) });
          await scope.settings.put({ key, value });
          return true;
        });
        await job.check();
        if (!saved) return;
        if (key === 'mcp-access' && accessChoice === this.accessChoice) {
          // Only a successfully persisted explicit choice can lift a local restriction.
          this.accessCeiling = mcpAccess(value);
          useEditor.setState({ mcpAccess: this.accessCeiling });
          if (value !== 'off' && this.repo === repository) bridge.authorizeContent();
        }
        // The reminder disappears only after persistence, including immediate reloads.
        if (key === 'backup-nudge-dismissed')
          useEditor.setState({ backupNudgeDismissed: value === true });
        if (key === IMPORT_LIMIT_SETTING)
          useEditor.setState({ importFileLimitMb: value as number });
        if (key === PROJECT_SOURCE_FILE_LIMIT_SETTING)
          useEditor.setState({ projectSourceFileLimit: value as number });
        if (key === 'theme') this.syncAppearance(appearancePreference(value));
        if (key === VOICE_SETTING) this.publishVoiceSelection(value, true);
        this.acknowledgePreference(key, retryingFailure);
      });
    } catch (error) {
      if (
        lifecycle === this.lifecycle &&
        !this.stopped &&
        !(error instanceof StorageError && error.status === 423)
      )
        this.preferenceError(key, value, error);
      throw error;
    } finally {
      if (lifecycle === this.lifecycle) this.preferenceWrites--;
    }
    // Do not delay access revocation on the graph queue it cancels.
    void this.refresh().catch((error) => {
      if (lifecycle === this.lifecycle && !this.stopped) this.error(error);
    });
  }
  async external<T>(
    path: string,
    method: string,
    data?: unknown,
    originatingOperation?: WorkspaceOperation,
  ): Promise<T> {
    const accessChoice = this.accessChoice;
    if (method === 'GET' && path.replace(/^\/api\/v1/, '') === '/workspace/security')
      return this.repo.request<T>(path, method, data);
    if (isWorkspaceLockCommand(path, method))
      return this.lockExternal(data, originatingOperation) as Promise<T>;
    return this.withOperation(
      (job) => this.externalCaptured<T>(path, method, data, job, accessChoice),
      undefined,
      originatingOperation,
    );
  }
  /** Cached transport results require the same current browser permissions as fresh commands. */
  async authorizeExternal(path: string, method: string, operation: WorkspaceOperation) {
    await operation.check();
    await this.requireStorageConsent(operation.storage);
    const permission = await operation.storage.settings.get('mcp-access');
    if (!useEditor.getState().privacyAcknowledged)
      throw new StorageError(403, 'Accept local storage before using the workspace.');
    assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
    assertMcpAccess(mcpAccess(permission?.value), path, method);
    await operation.check();
  }
  private assertAccessChoice(choice: number) {
    if (choice !== this.accessChoice)
      throw new StorageError(
        403,
        'The originating MCP grant was revoked. Submit a fresh request after reviewing saved state.',
      );
  }
  private cancelExternalSvgJobs() {
    for (const authority of this.externalSvgJobs) authority.cancel();
    this.externalSvgJobs.clear();
  }
  private async svgAuthority(accessChoice: number, lifecycle: number) {
    // A child of the transient POST operation would be revoked when that response ends.
    // Capture the root storage lease and retain its original vault session instead.
    const operation = await this.repo.db.captureOperation();
    const fence = () => {
      this.assertAccessChoice(accessChoice);
      this.assertLifecycle(lifecycle);
      if (!useEditor.getState().privacyAcknowledged)
        throw new StorageError(403, 'Accept local storage before using the workspace.');
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), '/exports/svg', 'POST');
    };
    const authority = new ExternalSvgAuthority(
      operation,
      fence,
      async (storage) => {
        await this.requireStorageConsent(storage);
        const permission = await storage.settings.get('mcp-access');
        assertMcpAccess(mcpAccess(permission?.value), '/exports/svg', 'POST');
      },
      () => this.externalSvgJobs.delete(authority),
    );
    this.externalSvgJobs.add(authority);
    try {
      await authority.guard.check();
      return authority;
    } catch (error) {
      authority.dispose();
      throw error;
    }
  }
  private async lockExternal(data: unknown, originatingOperation?: WorkspaceOperation) {
    const accessChoice = this.accessChoice;
    if (
      data !== undefined &&
      (!data ||
        typeof data !== 'object' ||
        (Object.getPrototypeOf(data) !== Object.prototype &&
          Object.getPrototypeOf(data) !== null) ||
        Reflect.ownKeys(data).length !== 0)
    )
      throw new StorageError(422, 'Lock expects an empty object or no arguments.');
    const session = (this.repo.db as WorkspaceStorage & { session?: VaultSession }).session;
    if (!session) throw new StorageError(422, 'This workspace does not support encrypted locking.');
    if (session.getSnapshot().status === 'locked') return workspaceSecurityStatus(this.repo.db);
    const lifecycle = this.lifecycle;
    const operation = originatingOperation ?? (await this.repo.db.captureOperation());
    const authorize = async () => {
      await operation.check();
      this.assertAccessChoice(accessChoice);
      this.assertLifecycle(lifecycle);
      await operation.storage.atomic('r', ['settings'], async (scope) => {
        await this.requireStorageConsent(scope);
        const permission = await scope.settings.get('mcp-access');
        assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), '/workspace/lock', 'POST');
        assertMcpAccess(mcpAccess(permission?.value), '/workspace/lock', 'POST');
        if (!useEditor.getState().privacyAcknowledged)
          throw new StorageError(403, 'Accept local storage before using the workspace.');
      });
      await operation.check();
      this.assertAccessChoice(accessChoice);
      this.assertLifecycle(lifecycle);
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), '/workspace/lock', 'POST');
    };
    try {
      await authorize();
      useEditor.getState().finishEditing();
      flushSpatialCamera();
      await this.settled();
      // Capture before the authorization snapshot. Never replace this revision
      // with a later verify result: concurrent grants or content writes must conflict.
      const control = await session.verify();
      await authorize();
      // No await between the final generation/grant fence and intentional key revocation.
      await session.lockAuthorized(control.revision, operation.signal, () => {
        if (operation.signal.aborted)
          throw new VaultStorageError(
            423,
            'WORKSPACE_LOCKED',
            'Unlock the workspace in the browser to continue.',
          );
        this.assertLifecycle(lifecycle);
        this.assertAccessChoice(accessChoice);
        assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), '/workspace/lock', 'POST');
      });
      return workspaceSecurityStatus(this.repo.db);
    } finally {
      if (!originatingOperation) operation.dispose();
    }
  }
  private async externalCaptured<T>(
    path: string,
    method: string,
    data: unknown,
    job: WorkspaceJob,
    accessChoice: number,
  ): Promise<T> {
    const { operation } = job;
    this.assertAccessChoice(accessChoice);
    assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
    await this.settled();
    const permission = await operation.storage.settings.get('mcp-access');
    assertMcpAccess(mcpAccess(permission?.value), path, method);
    this.assertAccessChoice(accessChoice);
    const authorize = async (scope: WorkspaceStorage = operation.storage) => {
      await operation.check();
      this.assertAccessChoice(accessChoice);
      await this.requireStorageConsent(scope);
      const permission = await scope.settings.get('mcp-access');
      if (!useEditor.getState().privacyAcknowledged)
        throw new StorageError(403, 'Accept local storage before using the workspace.');
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
      assertMcpAccess(mcpAccess(permission?.value), path, method);
      this.assertAccessChoice(accessChoice);
    };
    if (spatialNavigation(useEditor.getState().graph, path, method, data)) {
      await this.requireStorageConsent(operation.storage);
      window.dispatchEvent(new Event('visualnerve:spatial-camera-flush'));
      const state = useEditor.getState();
      state.finishEditing();
      state.setDrawingTool('none');
      await this.settled();
      // A camera/title commit can yield; honor grants revoked while it was being saved.
      const latest = await operation.storage.settings.get('mcp-access');
      assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
      assertMcpAccess(mcpAccess(latest?.value), path, method);
    }
    const endpoint = path.replace(/^\/api\/v1/, '');
    if (endpoint.startsWith('/exports/')) {
      await authorize();
      const { SvgExportCommands } = await import('./svg-export-commands');
      return (await new SvgExportCommands(
        job.repo,
        () => authorize(),
        () => this.svgAuthority(accessChoice, job.lifecycle),
      ).request(endpoint, method, data)) as T;
    }
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
        const { isVideoExporting } = await import('../presentation/commands');
        const authorizeOpen = async () => {
          await authorize();
          if (isVideoExporting())
            throw new StorageError(409, 'Cancel or finish video export before opening a diagram.');
        };
        await authorizeOpen();
        if ('diagramId' in payload)
          await this.openCaptured(
            job,
            payload.diagramId as string,
            ++this.navigation,
            undefined,
            authorizeOpen,
          );
        payload = 'source' in payload ? { source: payload.source } : {};
      }
      const { presentationRequest } = await import('../presentation/commands');
      await authorize();
      return (await presentationRequest(
        endpoint,
        method,
        payload,
        authorize,
        operation.signal,
      )) as T;
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
        '/code/project/preview',
        '/code/project/diagrams',
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
      const result = await this.execute<T>(
        path,
        method,
        data,
        {
          signal: controller?.signal,
          beforeRequest: authorize,
          beforeWrite: authorize,
          beforeHistoryWrite: authorize,
          beforeAnalysisSave: analysis
            ? async () => {
                await operation.check();
                this.assertAccessChoice(accessChoice);
                await this.requireStorageConsent(operation.storage);
                const current = await operation.storage.settings.get('mcp-access');
                assertMcpAccess(this.mcpGrant(useEditor.getState().mcpAccess), path, method);
                assertMcpAccess(mcpAccess(current?.value), path, method);
                this.assertAccessChoice(accessChoice);
              }
            : undefined,
        },
        operation,
      );
      if (
        method === 'POST' &&
        ([
          '/spatial-diagrams',
          '/sql/diagrams',
          '/code/diagrams',
          '/code/project/diagrams',
        ].includes(endpoint) ||
          diagramFile)
      )
        await this.openCaptured(job, (result as Graph).diagram.id, ++this.navigation);
      return result;
    } finally {
      unsubscribe?.();
      if (controller) this.analysisCommands.delete(controller);
    }
  }
  async backup() {
    return this.withOperation(async (job) => {
      await this.requireStorageConsent(job.operation.storage);
      await job.check();
      useEditor.getState().finishEditing();
      flushSpatialCamera();
      await this.settled();
      return job.operation.storage.backup();
    });
  }
  /** Called after key revocation; wait for cancelled jobs before allowing another unlock. */
  async clearUnlockedState() {
    this.stop();
    const lifecycle = this.lifecycle;
    for (const save of this.queuedSaves) save.graph = undefined;
    this.pending.clear();
    this.versions.clear();
    this.preferenceFailures.clear();
    this.accessCeiling = 'off';
    this.accessChoice++;
    this.settingsRevision++;
    this.repo.db.forgetDatasets();
    useEditor.getState().setGraph(null);
    useEditor.setState({
      diagrams: [],
      owners: [],
      clipboard: null,
      workspaceId: '',
      mcpAccess: 'off',
      privacyAcknowledged: false,
      lastExport: '',
      preferenceError: null,
      message: '',
      status: 'saved',
    });
    await this.queue;
    // Only clean this stopped lifecycle: an obsolete cleanup cannot reset a new app.
    if (lifecycle === this.lifecycle && this.stopped) {
      this.queue = Promise.resolve();
      this.queuedSaves.clear();
    }
  }
  async restoreBackup(backup: WorkspaceBackup, mode: 'merge' | 'replace') {
    const navigation = ++this.navigation;
    await this.withOperation(async (job) => {
      await this.requireStorageConsent(job.operation.storage);
      await job.check();
      flushSpatialCamera();
      await this.settled();
      await job.check();
      const graphs = await job.repo.restore(backup, mode, (scope) =>
        this.requireStorageConsent(scope),
      );
      await job.check();
      this.versions.clear();
      if (navigation === this.navigation) useEditor.getState().setGraph(null);
      sessionStorage.removeItem('vn-token');
      await this.refresh(job);
      if (graphs[0]) await this.openCaptured(job, graphs[0].diagram.id, navigation);
    });
  }
  async deleteAll() {
    const navigation = ++this.navigation;
    await this.withOperation(async (job) => {
      await this.queue;
      await job.check();
      await job.repo.clearAll();
      await job.check();
      this.pending.clear();
      this.versions.clear();
      this.preferenceFailures.clear();
      this.publishPreferenceError();
      if (navigation === this.navigation) useEditor.getState().setGraph(null);
      useEditor.setState({ status: 'saved', message: '' });
      sessionStorage.removeItem('vn-token');
      await this.refresh(job);
    });
  }
  async remove(id: string) {
    await this.withOperation(async (job) => {
      await this.requireStorageConsent(job.operation.storage);
      await this.settled();
      await job.check();
      await job.repo.removeDiagram(id, (scope) => this.requireStorageConsent(scope));
      await job.check();
      this.versions.delete(id);
      await this.refresh(job);
    });
  }
  async resolve(strategy: 'copy' | 'discard' | 'retry') {
    const navigation = ++this.navigation;
    await this.withOperation(async (job) => {
      await this.requireStorageConsent(job.operation.storage);
      await this.queue;
      await job.check();
      if (navigation !== this.navigation) return;
      const local = useEditor.getState().graph;
      if (!local) return;
      if (strategy === 'copy') {
        const copy = structuredClone(local);
        copy.diagram.name += ' (local copy)';
        const stored = await job.repo.importGraph(copy, (scope) =>
          this.requireStorageConsent(scope),
        );
        await job.check();
        this.pending.delete(local.diagram.id);
        if (navigation === this.navigation) useEditor.setState({ status: 'saved', message: '' });
        await this.openCaptured(job, stored.diagram.id, navigation);
      } else if (strategy === 'discard') {
        const current = await job.operation.storage.graph(local.diagram.id);
        await job.check();
        if (navigation !== this.navigation) return;
        this.pending.delete(local.diagram.id);
        if (current) {
          this.versions.set(current.diagram.id, current.diagram.version);
          useEditor.getState().setGraph(current);
        } else useEditor.getState().setGraph(null);
        useEditor.setState({ status: 'saved', message: '' });
      } else {
        const current = await job.operation.storage.graph(local.diagram.id);
        const stored = await job.repo.saveGraph(local, current?.diagram.version ?? 0, (scope) =>
          this.requireStorageConsent(scope),
        );
        await job.check();
        this.pending.delete(local.diagram.id);
        this.versions.set(stored.diagram.id, stored.diagram.version);
        if (navigation === this.navigation)
          useEditor.setState({ graph: stored, status: 'saved', message: '' });
      }
      await this.refresh(job);
    });
  }
}
export const workspace = new Workspace();
