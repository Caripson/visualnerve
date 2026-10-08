import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import type { Graph } from '../src/model/types';
import { canvasViewportGraph } from '../src/canvas/navigation';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { holdRefreshRead, settingWrites } from './workspace-test-hooks';

let db: WorkspaceDatabase, repo: Repository, workspace: Workspace;
let refresh: () => Promise<void>;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  db = new WorkspaceDatabase(`workspace-api-camera-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  await workspace.create(createSimulationGraph('Camera race', createBasicModel()));
  // Drive refresh reads explicitly; the editor subscription, real repository and
  // IndexedDB transactions remain active, without an observer consuming a read gate.
  refresh = workspace.refresh.bind(workspace);
  vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
});

afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});

function capacity(graph: Graph) {
  const node = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  return node.type === 'work' ? node.work.capacity : undefined;
}

function withCapacity(graph: Graph, value: number) {
  const model = structuredClone(graph.simulation!);
  for (const node of model.nodes) if (node.type === 'work') node.work.capacity = value;
  return setSimulationModel(graph, model);
}

function camera(x: number) {
  const state = useEditor.getState();
  const graph = canvasViewportGraph(
    state.graph,
    state.graph!.diagram.id,
    { x, y: 12, zoom: 0.8 },
    true,
  )!;
  useEditor.setState({ graph, editRevision: state.editRevision + 1 });
}

function holdCommittedRequest() {
  const original = Repository.prototype.request;
  const committed = deferred(),
    release = deferred();
  vi.spyOn(Repository.prototype, 'request').mockImplementation(async function (
    this: Repository,
    ...args
  ) {
    const result = await original.apply(this, args);
    committed.resolve();
    await release.promise;
    return result;
  });
  return { committed, release };
}

describe('one authoritative graph during API and camera writes', () => {
  it.each(['graph', 'node', 'empty'] as const)(
    'rebases two late viewport saves onto the exact successful %s API response',
    async (response) => {
      const before = useEditor.getState().graph!;
      const work = before.nodes.find((node) => node.nodeType === 'process')!;
      const gate = holdCommittedRequest();
      const writing =
        response === 'graph'
          ? workspace.external(`/diagrams/${before.diagram.id}/simulation`, 'PUT', {
              baseVersion: before.diagram.version,
              model: withCapacity(before, 2).simulation,
            })
          : response === 'node'
            ? workspace.external(`/nodes/${work.id}`, 'PATCH', {
                version: work.version,
                title: 'Assembly from API',
              })
            : workspace.external(
                `/diagrams/${before.diagram.id}/simulation/edges/${before.edges[0].id}?baseVersion=${before.diagram.version}`,
                'DELETE',
              );
      await gate.committed.promise;
      expect((await repo.getGraph(before.diagram.id)).diagram.version).toBe(
        before.diagram.version + 1,
      );
      camera(80);
      camera(160);
      const refreshing = refresh();
      gate.release.resolve();
      await writing;
      await workspace.settled();
      await refreshing;
      const stored = await repo.getGraph(before.diagram.id),
        current = useEditor.getState().graph!;
      expect(stored.diagram.version).toBe(before.diagram.version + 3);
      expect(current).toEqual(stored);
      expect(stored.diagram.settings).toMatchObject({
        viewport: { x: 160, y: 12, zoom: 0.8 },
        viewportDevice: 'touch',
      });
      if (response === 'graph') expect(capacity(stored)).toBe(2);
      else if (response === 'node') {
        expect(stored.nodes.find((node) => node.id === work.id)?.title).toBe('Assembly from API');
        expect(stored.simulation!.nodes.find((node) => node.id === work.id)?.name).toBe(
          'Assembly from API',
        );
      } else expect(stored.edges).toHaveLength(before.edges.length - 1);
      expect(useEditor.getState()).toMatchObject({ status: 'saved', message: '' });
    },
  );

  it('preserves concurrent semantic drafts as a real conflict instead of overwriting either writer', async () => {
    const before = useEditor.getState().graph!;
    const work = before.nodes.find((node) => node.nodeType === 'process')!;
    const gate = holdCommittedRequest();
    const writing = workspace.external<Graph>(`/diagrams/${before.diagram.id}/simulation`, 'PUT', {
      baseVersion: before.diagram.version,
      model: withCapacity(before, 2).simulation,
    });
    await gate.committed.promise;
    useEditor.getState().updateNode(work.id, { title: 'Unsaved local Assembly' });
    const history = useEditor.getState().history;
    gate.release.resolve();
    expect(capacity(await writing)).toBe(2);
    await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
    expect(useEditor.getState().status).toBe('conflict');
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === work.id)?.title).toBe(
      'Unsaved local Assembly',
    );
    expect(useEditor.getState().history).toEqual(history);
    const stored = await repo.getGraph(before.diagram.id);
    expect(capacity(stored)).toBe(2);
    expect(stored.nodes.find((node) => node.id === work.id)?.title).toBe(work.title);
    expect(stored.diagram.version).toBe(before.diagram.version + 1);
  });

  it.each(['graph', 'node'] as const)(
    'does not adopt an unknown newer other-tab commit after an own %s response',
    async (response) => {
      const before = useEditor.getState().graph!;
      const work = before.nodes.find((node) => node.nodeType === 'process')!;
      const gate = holdCommittedRequest();
      const writing =
        response === 'graph'
          ? workspace.external(`/diagrams/${before.diagram.id}/simulation`, 'PUT', {
              baseVersion: before.diagram.version,
              model: withCapacity(before, 2).simulation,
            })
          : workspace.external(`/nodes/${work.id}`, 'PATCH', {
              version: work.version,
              title: 'Own API title',
            });
      await gate.committed.promise;
      const ownCommit = await repo.getGraph(before.diagram.id);
      const otherTab = new Repository(db);
      await otherTab.saveGraph(withCapacity(ownCommit, 3), ownCommit.diagram.version);
      camera(80);
      gate.release.resolve();
      await writing;
      await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
      expect(useEditor.getState().status).toBe('conflict');
      expect(useEditor.getState().graph!.diagram.settings.viewport?.x).toBe(80);
      const stored = await repo.getGraph(before.diagram.id);
      expect(capacity(stored)).toBe(3);
      expect(stored.diagram.version).toBe(before.diagram.version + 2);
      expect(stored.diagram.settings.viewport).toBeUndefined();
    },
  );

  it('rejects a stale API baseVersion when a camera edit precedes the API operation', async () => {
    const before = useEditor.getState().graph!;
    camera(80);
    await expect(
      workspace.external(`/diagrams/${before.diagram.id}/simulation`, 'PUT', {
        baseVersion: before.diagram.version,
        model: withCapacity(before, 2).simulation,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await workspace.settled();
    const stored = await repo.getGraph(before.diagram.id);
    expect(capacity(stored)).toBe(1);
    expect(stored.diagram.version).toBe(before.diagram.version + 1);
    expect(stored.diagram.settings.viewport?.x).toBe(80);
    expect(useEditor.getState().status).toBe('saved');
  });

  it('cannot resurrect an API-deleted project through a late viewport save', async () => {
    const before = useEditor.getState().graph!;
    const gate = holdCommittedRequest();
    const writing = workspace.external(`/diagrams/${before.diagram.id}`, 'DELETE');
    await gate.committed.promise;
    camera(80);
    gate.release.resolve();
    await writing;
    await workspace.settled();
    expect(await db.graph(before.diagram.id)).toBeUndefined();
    expect(useEditor.getState().graph).toBeNull();
    expect(useEditor.getState().status).toBe('saved');
  });

  it('never treats a simulation run-control response as a document commit', async () => {
    const before = useEditor.getState().graph!;
    const arrived = deferred(),
      release = deferred();
    vi.spyOn(Repository.prototype, 'request').mockImplementation(async () => {
      arrived.resolve();
      await release.promise;
      return {
        id: 'running-without-changing-the-model',
        diagramId: before.diagram.id,
        status: 'running',
      };
    });
    const running = workspace.external(`/diagrams/${before.diagram.id}/simulation/runs`, 'POST', {
      durationSeconds: 60,
    });
    await arrived.promise;
    await new Repository(db).saveGraph(withCapacity(before, 3), before.diagram.version);
    camera(80);
    release.resolve();
    await running;
    await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
    const stored = await repo.getGraph(before.diagram.id);
    expect(capacity(stored)).toBe(3);
    expect(stored.diagram.settings.viewport).toBeUndefined();
    expect(useEditor.getState().status).toBe('conflict');
  });

  it('preserves undo history when exporting the current graph without a document commit', async () => {
    const graph = useEditor.getState().graph!;
    useEditor.getState().updateNode(graph.nodes[1].id, { title: 'Local step' });
    await workspace.settled();
    const history = useEditor.getState().history;
    await workspace.external('/export', 'POST', { diagramId: graph.diagram.id, format: 'json' });
    expect(useEditor.getState().history).toEqual(history);
    expect(useEditor.getState().graph!.nodes[1].title).toBe('Local step');
  });

  it('ignores a stale refresh read while a newer own save remains in flight', async () => {
    const before = useEditor.getState().graph!;
    const staleRead = holdRefreshRead(db);
    const refreshing = refresh();
    await staleRead.entered;
    useEditor.getState().updateNode(before.nodes[1].id, { title: 'First own save' });
    await workspace.settled();
    const original = Repository.prototype.saveGraph;
    const saveStarted = deferred(),
      pendingSave = deferred();
    vi.spyOn(Repository.prototype, 'saveGraph').mockImplementationOnce(async function (
      this: Repository,
      ...args
    ) {
      saveStarted.resolve();
      await pendingSave.promise;
      return original.apply(this, args);
    });
    useEditor.getState().updateNode(before.nodes[1].id, { title: 'Second own save' });
    await saveStarted.promise;
    const history = useEditor.getState().history;
    staleRead.release();
    await refreshing;
    expect(useEditor.getState().status).not.toBe('conflict');
    expect(useEditor.getState().graph!.nodes[1].title).toBe('Second own save');
    expect(useEditor.getState().history).toEqual(history);
    pendingSave.resolve();
    await workspace.settled();
    expect((await repo.getGraph(before.diagram.id)).nodes[1].title).toBe('Second own save');
    expect(useEditor.getState().status).toBe('saved');
  });

  it.each(['off', 'read'] as const)(
    'rechecks a %s grant after an autosave delays generic node PATCH dispatch',
    async (permission) => {
      const before = useEditor.getState().graph!;
      const work = before.nodes[1];
      const saveStarted = deferred(),
        releaseSave = deferred();
      const save = Repository.prototype.saveGraph;
      vi.spyOn(Repository.prototype, 'saveGraph').mockImplementationOnce(async function (
        this: Repository,
        ...args
      ) {
        saveStarted.resolve();
        await releaseSave.promise;
        return save.apply(this, args);
      });
      const settle = workspace.settled.bind(workspace);
      vi.spyOn(workspace, 'settled')
        .mockImplementationOnce(settle)
        .mockImplementationOnce(async () => {
          // A local event arrives after the initial external permission read and
          // before execute has drained the save queue it will dispatch behind.
          camera(80);
          await settle();
        });
      const request = vi.spyOn(Repository.prototype, 'request');
      const patch = workspace.external(`/nodes/${work.id}`, 'PATCH', {
        version: work.version,
        title: 'Must not be written',
      });
      const rejected = expect(patch).rejects.toMatchObject({ status: 403 });
      await saveStarted.promise;
      await workspace.setPreference('mcp-access', permission);
      expect(useEditor.getState().mcpAccess).toBe(permission);
      releaseSave.resolve();
      await rejected;
      expect(request).not.toHaveBeenCalled();
      const stored = await repo.getGraph(before.diagram.id);
      expect(stored.nodes[1].title).toBe(work.title);
      expect(stored.diagram.settings.viewport?.x).toBe(80);
      expect(stored.diagram.version).toBe(before.diagram.version + 1);
    },
  );

  it('honors immediate UI revocation during an awaited generic PATCH transaction read', async () => {
    const before = useEditor.getState().graph!,
      work = before.nodes[1];
    const getGraph = Repository.prototype.getGraph;
    const reading = deferred(),
      releaseRead = deferred();
    vi.spyOn(Repository.prototype, 'getGraph').mockImplementationOnce(async function (
      this: Repository,
      id,
    ) {
      const graph = await getGraph.call(this, id);
      reading.resolve();
      // Keep the real read/write transaction open while its settings table is
      // locked, reproducing a revoke that must take effect before persistence.
      await Dexie.waitFor(releaseRead.promise);
      return graph;
    });
    const write = vi.spyOn(db.nodes, 'bulkPut');
    const patch = workspace.external(`/nodes/${work.id}`, 'PATCH', {
      version: work.version,
      title: 'Must not be written',
    });
    const rejected = expect(patch).rejects.toMatchObject({ status: 403 });
    await reading.promise;
    const revoked = Dexie.ignoreTransaction(() => workspace.setPreference('mcp-access', 'off'));
    expect(useEditor.getState().mcpAccess).toBe('off');
    // Do not await the settings write while deliberately holding its owning
    // transaction. The immediate in-memory revoke is checked before any write.
    releaseRead.resolve();
    await rejected;
    await revoked;
    expect(write).not.toHaveBeenCalled();
    expect((await repo.getGraph(before.diagram.id)).nodes[1].title).toBe(work.title);
    expect((await db.diagrams.get(before.diagram.id))?.version).toBe(before.diagram.version);
    expect((await db.settings.get('mcp-access'))?.value).toBe('off');
  });

  it('preserves semantic edits arriving during asynchronous dispatch authorization', async () => {
    const before = useEditor.getState().graph!,
      work = before.nodes[1];
    const authorizing = deferred(),
      authorized = deferred();
    const patch = workspace.execute<Graph>(
      `/diagrams/${before.diagram.id}/simulation`,
      'PUT',
      {
        baseVersion: before.diagram.version,
        model: withCapacity(before, 2).simulation,
      },
      {
        beforeRequest: async () => {
          authorizing.resolve();
          await authorized.promise;
        },
      },
    );
    await authorizing.promise;
    useEditor.getState().updateNode(work.id, { title: 'Local during authorization' });
    authorized.resolve();
    expect(capacity(await patch)).toBe(2);
    await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
    expect(useEditor.getState().graph!.nodes[1].title).toBe('Local during authorization');
    expect(useEditor.getState().status).toBe('conflict');
    const stored = await repo.getGraph(before.diagram.id);
    expect(stored.nodes[1].title).toBe(work.title);
    expect(capacity(stored)).toBe(2);
  });

  it.each(['/code/preview', '/export', '/diagrams/current/simulation/runs'])(
    'keeps camera saves and cancellation responsive during a long %s request',
    async (endpoint) => {
      const before = useEditor.getState().graph!;
      const path = endpoint.replace('current', before.diagram.id);
      const started = deferred(),
        release = deferred();
      vi.spyOn(Repository.prototype, 'request').mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return before;
      });
      const pending = workspace.external(path, 'POST', {});
      await started.promise;
      camera(80);
      await workspace.settled();
      await workspace.setPreference('mcp-access', 'off');
      expect((await repo.getGraph(before.diagram.id)).diagram.settings.viewport?.x).toBe(80);
      expect(useEditor.getState().mcpAccess).toBe('off');
      release.resolve();
      await pending;
      expect(useEditor.getState().graph!.diagram.settings.viewport?.x).toBe(80);
      expect(useEditor.getState().status).toBe('saved');
    },
  );

  it.each(['off', 'read'] as const)(
    'retains a failed %s downgrade through unrelated refreshes until an explicit grant succeeds',
    async (permission) => {
      const graph = useEditor.getState().graph!;
      settingWrites(db).mockRejectedValueOnce(
        new DOMException('Storage unavailable', 'QuotaExceededError'),
      );
      await expect(workspace.setPreference('mcp-access', permission)).rejects.toMatchObject({
        name: 'QuotaExceededError',
      });
      expect((await db.settings.get('mcp-access'))?.value).toBe('write');
      expect(useEditor.getState().mcpAccess).toBe(permission);
      await workspace.setPreference('theme', 'light');
      await refresh();
      expect(useEditor.getState().mcpAccess).toBe(permission);
      if (permission === 'off')
        await expect(workspace.external('/diagrams', 'GET')).rejects.toMatchObject({ status: 403 });
      else expect(await workspace.external('/diagrams', 'GET')).toHaveLength(1);
      await expect(
        workspace.external(`/nodes/${graph.nodes[1].id}`, 'PATCH', {
          version: graph.nodes[1].version,
          title: 'Blocked after failed downgrade',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await workspace.setPreference('mcp-access', 'write');
      await refresh();
      expect(useEditor.getState().mcpAccess).toBe('write');
      await workspace.external(`/nodes/${graph.nodes[1].id}`, 'PATCH', {
        version: graph.nodes[1].version,
        title: 'Allowed after explicit successful grant',
      });
      expect((await repo.getGraph(graph.diagram.id)).nodes[1].title).toBe(
        'Allowed after explicit successful grant',
      );
    },
  );

  it.each(['off', 'read'] as const)(
    'does not lift a prior %s restriction when an explicit upgrade also fails to persist',
    async (permission) => {
      const failure = new DOMException('Storage unavailable', 'QuotaExceededError');
      const put = settingWrites(db).mockRejectedValueOnce(failure);
      await expect(workspace.setPreference('mcp-access', permission)).rejects.toMatchObject({
        name: 'QuotaExceededError',
      });
      const observed: string[] = [];
      const unsubscribe = useEditor.subscribe((state) => {
        observed.push(state.mcpAccess);
      });
      put.mockRejectedValueOnce(failure);
      try {
        await expect(workspace.setPreference('mcp-access', 'write')).rejects.toMatchObject({
          name: 'QuotaExceededError',
        });
        expect(observed).not.toContain('write');
      } finally {
        unsubscribe();
      }
      await workspace.setPreference('theme', 'dark');
      await refresh();
      expect(useEditor.getState().mcpAccess).toBe(permission);
      const graph = useEditor.getState().graph!;
      await expect(
        workspace.external(`/nodes/${graph.nodes[1].id}`, 'PATCH', {
          version: graph.nodes[1].version,
          title: 'Blocked after failed upgrade',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await workspace.setPreference('mcp-access', 'write');
      expect(useEditor.getState().mcpAccess).toBe('write');
    },
  );

  it('does not let an older successful upgrade undo a newer failed revocation', async () => {
    await workspace.setPreference('mcp-access', 'read');
    const started = deferred(),
      release = deferred();
    const writes = settingWrites(db);
    const put = writes.getMockImplementation()!;
    writes.mockImplementationOnce(async (...args) => {
      const result = await put(...args);
      started.resolve();
      await release.promise;
      return result;
    });
    writes.mockRejectedValueOnce(new DOMException('Storage unavailable', 'QuotaExceededError'));
    const olderUpgrade = workspace.setPreference('mcp-access', 'write');
    await started.promise;
    expect(useEditor.getState().mcpAccess).toBe('read');
    await expect(workspace.setPreference('mcp-access', 'off')).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(useEditor.getState().mcpAccess).toBe('off');
    release.resolve();
    await olderUpgrade;
    expect((await db.settings.get('mcp-access'))?.value).toBe('write');
    await refresh();
    expect(useEditor.getState().mcpAccess).toBe('off');
    await expect(workspace.external('/diagrams', 'GET')).rejects.toMatchObject({ status: 403 });
    await workspace.setPreference('mcp-access', 'read');
    await refresh();
    expect(useEditor.getState().mcpAccess).toBe('read');
    expect(await workspace.external('/diagrams', 'GET')).toHaveLength(1);
  });

  it('cannot persist an older upgrade after a newer successful Off choice', async () => {
    await workspace.setPreference('mcp-access', 'read');
    const consentRead = deferred(),
      releaseConsent = deferred();
    const writes = settingWrites(db);
    const put = writes.getMockImplementation()!;
    writes.mockImplementationOnce(async (...args) => {
      consentRead.resolve();
      await releaseConsent.promise;
      return put(...args);
    });
    const olderUpgrade = workspace.setPreference('mcp-access', 'write');
    await consentRead.promise;
    expect(useEditor.getState().mcpAccess).toBe('read');
    await workspace.setPreference('mcp-access', 'off');
    expect((await db.settings.get('mcp-access'))?.value).toBe('off');
    releaseConsent.resolve();
    await olderUpgrade;
    await refresh();
    expect((await db.settings.get('mcp-access'))?.value).toBe('off');
    expect(useEditor.getState().mcpAccess).toBe('off');
    const reopened = new Workspace(new Repository(db));
    try {
      await reopened.start();
      expect(useEditor.getState().mcpAccess).toBe('off');
      await expect(reopened.external('/diagrams', 'GET')).rejects.toMatchObject({ status: 403 });
    } finally {
      reopened.stop();
    }
  });
});
