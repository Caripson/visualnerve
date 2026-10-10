import { webcrypto } from 'node:crypto';
import { Blob as NativeBlob } from 'node:buffer';
import {
  CompressionStream as NativeCompressionStream,
  DecompressionStream as NativeDecompressionStream,
} from 'node:stream/web';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { CollaborationDocumentGateway } from '../src/collaboration/session/document-gateway';
import { CollaborationPrivateStore } from '../src/collaboration/persistence/private-store';
import { encodeBytes } from '../src/collaboration/transport/identity';
import type { EncryptedRoom } from '../src/collaboration/session/encrypted-room';
import type { SharedRole } from '../src/collaboration/access';
import { withCollaborationJournal } from '../src/security/collaboration-journal';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { useEditor } from '../src/state/editor';
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const password = 'test-only collaboration repository password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let session: VaultSession,
  physical: VaultRecordStorage,
  db: EncryptedWorkspaceDatabase,
  repo: Repository,
  workspace: Workspace,
  privateStore: CollaborationPrivateStore;
let gateway: CollaborationDocumentGateway,
  graph: Graph,
  role: SharedRole,
  lease: Awaited<ReturnType<VaultSession['captureOperation']>>,
  roomId: string;
let room: EncryptedRoom;
const sends = vi.fn(async () => {});
const errors = vi.fn();
beforeAll(async () => {
  vault = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('CompressionStream', NativeCompressionStream);
  vi.stubGlobal('DecompressionStream', NativeDecompressionStream);
  physical = new VaultRecordStorage(`collaboration-parity-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  repo = new Repository(db);
  workspace = new Workspace(repo);
  graph = blankGraph('Actual authoritative graph');
  graph.nodes.push(newNode(graph.diagram.id, { title: 'Original' }));
  graph = await repo.saveGraph(graph, 0);
  privateStore = new CollaborationPrivateStore(session, cipher);
  lease = await session.captureOperation();
  role = 'editor';
  roomId = crypto.randomUUID();
  sends.mockClear();
  errors.mockClear();
  room = {
    currentPolicy: { policy: { roomId, ownerDeviceId: 'owner-device-1234' } },
    epoch: 0,
    encrypt: vi.fn(async (_kind: unknown, bytes: Uint8Array) => [
      { payloadKind: 'application', ciphertext: encodeBytes(bytes) },
    ]),
    send: sends,
    message: vi.fn(async () => {}),
  } as unknown as EncryptedRoom;
  gateway = new CollaborationDocumentGateway({
    workspace,
    store: privateStore,
    room,
    graph,
    scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
    lease,
    check: () => lease.assertActive(),
    role: () => role,
    onFailure: errors,
    onOffline: () => {},
  });
  await gateway.initialize('https://relay.example.com');
});
afterEach(async () => {
  workspace.stop();
  useEditor.setState({ graph: null, history: [], future: [], selectedNodes: [] });
  vi.unstubAllGlobals();
  gateway.dispose();
  lease.dispose();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(vault.keys));
describe('one authoritative graph transaction for UI/API/peer edits', () => {
  it.each(['root-first', 'group-first'] as const)(
    'preserves opted-in CSV sources across actual UI autosave and honors explicit source removal (%s)',
    async (sortOrder) => {
      gateway.dispose();
      const dataset = parseCsv('Category,Private\nA,secret-row-value', 'shared.csv');
      const csv = csvGraph(dataset, defaultAnalysis(dataset));
      expect(csv.nodes).toHaveLength(2);
      // A shared projection normalizes entity ordering. Force both UUID orders
      // and follow the edited node's identity throughout real encrypted autosave.
      const lowId = '11111111-1111-4111-8111-111111111111';
      const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const editedNodeId = sortOrder === 'root-first' ? lowId : highId;
      const untouchedNodeId = sortOrder === 'root-first' ? highId : lowId;
      const identifiers = new Map([
        [csv.nodes[0].id, editedNodeId],
        [csv.nodes[1].id, untouchedNodeId],
      ]);
      csv.nodes = csv.nodes.map((node) => ({
        ...node,
        id: identifiers.get(node.id)!,
        ...(node.parentId ? { parentId: identifiers.get(node.parentId)! } : {}),
      }));
      csv.edges = csv.edges.map((edge) => ({
        ...edge,
        sourceNodeId: identifiers.get(edge.sourceNodeId)!,
        targetNodeId: identifiers.get(edge.targetNodeId)!,
      }));
      graph = await repo.saveGraph(csv, 0);
      roomId = crypto.randomUUID();
      room = {
        ...room,
        currentPolicy: { policy: { roomId, ownerDeviceId: 'owner-device-1234' } },
      } as unknown as EncryptedRoom;
      gateway = new CollaborationDocumentGateway({
        workspace,
        store: privateStore,
        room,
        graph,
        scope: { shareMetadata: false, shareOwners: false, shareDatasets: true },
        lease,
        check: () => lease.assertActive(),
        role: () => role,
        onFailure: errors,
        onOffline: () => {},
      });
      await gateway.initialize('https://relay.example.com');
      await db.settings.put({ key: 'storage-consent', value: true });
      await workspace.start();
      await workspace.open(graph.diagram.id);
      useEditor.getState().updateNode(editedNodeId, { title: 'Edited CSV group' });
      await workspace.settled();
      await gateway.flush();
      let saved = await repo.getGraph(graph.diagram.id);
      expect(useEditor.getState().status, useEditor.getState().message).toBe('saved');
      expect(saved.nodes).toHaveLength(2);
      expect(saved.nodes.find((node) => node.id === editedNodeId)).toMatchObject({
        id: editedNodeId,
        title: 'Edited CSV group',
      });
      expect(saved.nodes.find((node) => node.id === untouchedNodeId)).toMatchObject({
        id: untouchedNodeId,
        title: 'A',
      });
      expect(
        useEditor.getState().graph?.nodes.find((node) => node.id === editedNodeId)?.title,
      ).toBe('Edited CSV group');
      expect(
        gateway.document.graph(saved).nodes.find((node) => node.id === editedNodeId)?.title,
      ).toBe('Edited CSV group');
      expect(saved.dataset!.rows).toEqual(dataset.rows);
      expect(gateway.document.graph(saved).dataset!.rows).toEqual(dataset.rows);
      expect(errors).not.toHaveBeenCalled();
      const baseline = saved;
      const peer = new CollaborativeDocument(
        saved,
        { shareMetadata: false, shareOwners: false, shareDatasets: true },
        gateway.document.encodedState(),
      );
      try {
        const remote = structuredClone(saved);
        remote.dataset!.rows = [['A', 'peer-row-value']];
        const change = peer.applyLocal(saved, remote, { canWrite: true, assertActive: () => {} });
        await gateway.receive(change.update);
      } finally {
        peer.destroy();
      }
      // An already queued drawing edit must preserve the newer source from the
      // peer, even though its edit baseline predates that source update.
      const { dataset: _dataset, datasets: _datasets, ...drawing } = baseline;
      drawing.nodes = drawing.nodes.map((node) => ({ ...node, title: 'Local queued title' }));
      const current = await repo.getGraph(graph.diagram.id);
      saved = await repo.saveGraph(
        drawing,
        current.diagram.version,
        undefined,
        undefined,
        baseline,
      );
      await gateway.flush();
      expect(saved.nodes[0].title).toBe('Local queued title');
      expect(saved.dataset!.rows).toEqual([['A', 'peer-row-value']]);
      expect(gateway.document.graph(saved).dataset!.rows).toEqual(saved.dataset!.rows);
      const empty = blankGraph('Intentionally replace shared CSV');
      empty.diagram.id = saved.diagram.id;
      empty.datasets = [];
      const replaced = await repo.saveGraph(empty, saved.diagram.version);
      await gateway.flush();
      expect(replaced.dataset).toBeUndefined();
      expect(replaced.datasets).toEqual([]);
      expect(gateway.document.graph(replaced).dataset).toBeUndefined();
      expect(await db.datasets.where('diagramId').equals(saved.diagram.id).toArray()).toEqual([]);
    },
  );
  it('projects an individual ID-based API patch through the same CRDT and encrypts its outbox', async () => {
    const node = graph.nodes[0];
    await repo.request(`/nodes/${node.id}`, 'PATCH', {
      version: node.version,
      title: 'API title survives',
    });
    await gateway.flush();
    const saved = await repo.getGraph(graph.diagram.id);
    expect(saved.nodes[0].title).toBe('API title survives');
    expect(gateway.document.graph(saved).nodes[0].title).toBe('API title survives');
    expect(sends).toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    const state = await privateStore.load(roomId, lease);
    expect(state?.state.pending).toEqual([]);
    const physicalRecords = await session.withUnlocked(({ lease }) =>
      physical.select(lease, { store: 'collaboration' }),
    );
    expect(JSON.stringify(physicalRecords)).not.toContain('API title survives');
    expect(
      (await db.backup()).settings.some((setting) => setting.key.includes('collaboration')),
    ).toBe(false);
  });
  it('commits full UI graph saves and local camera changes without sharing the camera', async () => {
    const next = structuredClone(graph);
    next.nodes[0].title = 'UI title';
    next.diagram.settings.viewport = { x: 444, y: 222, zoom: 0.4 };
    const saved = await repo.saveGraph(next, graph.diagram.version);
    await gateway.flush();
    expect(gateway.document.graph(saved).nodes[0].title).toBe('UI title');
    const vector = gateway.document.stateVector();
    const local = structuredClone(saved);
    local.diagram.settings.viewport = { x: 900, y: 800, zoom: 0.7 };
    await repo.saveGraph(local, saved.diagram.version);
    await gateway.flush();
    expect(gateway.document.stateVector()).toEqual(vector);
    expect((await repo.getGraph(graph.diagram.id)).diagram.settings.viewport).toEqual(
      local.diagram.settings.viewport,
    );
  });
  it('rolls back both private state/outbox and graph when the final write guard rejects', async () => {
    const before = await privateStore.load(roomId, lease);
    const next = structuredClone(graph);
    next.nodes[0].title = 'Must never publish';
    await expect(
      repo.saveGraph(next, graph.diagram.version, async () => {
        throw new Error('Grant revoked before commit');
      }),
    ).rejects.toThrow('Grant revoked');
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
    expect(gateway.document.graph(graph).nodes[0].title).toBe('Original');
    expect((await privateStore.load(roomId, lease))?.revision).toBe(before?.revision);
    expect(sends).not.toHaveBeenCalled();
  });
  it('rejects viewer API writes and deletion while preserving local navigation', async () => {
    role = 'viewer';
    const node = graph.nodes[0];
    await expect(
      repo.request(`/nodes/${node.id}`, 'PATCH', { version: node.version, title: 'Forbidden' }),
    ).rejects.toThrow('viewing access only');
    await expect(repo.removeDiagram(graph.diagram.id)).rejects.toThrow(
      'Leave the active collaboration',
    );
    await expect(repo.clearAll()).rejects.toThrow('Leave the active collaboration');
    const local = structuredClone(graph);
    local.diagram.settings.viewport = { x: 3, y: 4, zoom: 0.5 };
    await expect(repo.saveGraph(local, graph.diagram.version)).resolves.toBeDefined();
    expect(sends).not.toHaveBeenCalled();
  });
  it('applies a peer field change on the same ordered workspace queue and retains unrelated local fields', async () => {
    const peer = new CollaborativeDocument(
      graph,
      { shareMetadata: false, shareOwners: false, shareDatasets: false },
      gateway.document.encodedState(),
    );
    try {
      const remote = structuredClone(graph);
      remote.nodes[0].color = '#ef6600';
      const change = peer.applyLocal(graph, remote, { canWrite: true, assertActive: () => {} });
      const local = structuredClone(graph);
      local.nodes[0].title = 'Local independent title';
      const saved = await repo.saveGraph(local, graph.diagram.version);
      await gateway.flush();
      await gateway.receive(change.update);
      const merged = await repo.getGraph(graph.diagram.id);
      expect(merged.nodes[0].title).toBe('Local independent title');
      expect(merged.nodes[0].color).toBe('#ef6600');
      expect(gateway.document.graph(merged).nodes[0].title).toBe(saved.nodes[0].title);
      const privateState = await privateStore.load(roomId, lease);
      const restored = new CollaborativeDocument(
        merged,
        { shareMetadata: false, shareOwners: false, shareDatasets: false },
        privateState!.state.crdtState,
      );
      try {
        expect(restored.stateVector()).toEqual(gateway.document.stateVector());
        expect(restored.graph(merged)).toEqual(gateway.document.graph(merged));
      } finally {
        restored.destroy();
      }
    } finally {
      peer.destroy();
    }
  });
  it('does not accept a serialized imitation of the private journal capability', async () => {
    expect(() =>
      withCollaborationJournal({ inTransaction: true } as never, async () => {}),
    ).toThrow('encrypted workspace transaction');
  });
});
