/** Test-only real controller/relay/MLS/vault fixture; never imported by the app. */
import { createRoot } from 'react-dom/client';
import { CollaborationController } from '../../src/collaboration/controller';
import { CollaborationPrivateStore } from '../../src/collaboration/persistence/private-store';
import { CollaborationPanel } from '../../src/collaboration/ui';
import { VaultCrypto } from '../../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../../src/security/vault-logical-record';
import { VaultRecordStorage, type VaultMutation } from '../../src/security/vault-storage';
import { VaultSession } from '../../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../../src/storage/encrypted-database';
import { Repository } from '../../src/storage/repository';
import { Workspace } from '../../src/storage/workspace';
import { blankGraph, newNode, type Graph } from '../../src/model/types';
import { csvGraph, defaultAnalysis, parseCsv } from '../../src/data/csv';
import { useEditor } from '../../src/state/editor';
import { appLocaleController } from '../../src/i18n/runtime';
import { workspaceStoreNames } from '../../src/storage/contracts';
import '../../src/styles.css';

const relay = new URL(location.href).searchParams.get('relay')!;
const cipher = new VaultCrypto();
const physical = new VaultRecordStorage(`browser-collaboration-${crypto.randomUUID()}`);
const session = new VaultSession(physical, cipher);
await session.initialize();
await session.setup('Browser integration uses only this ephemeral test password', {
  idleTimeoutMs: 60_000,
  absoluteTimeoutMs: 60_000,
  sessionTimerEnabled: false,
});
const database = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
await database.initialize();
const repository = new Repository(database);
const workspace = new Workspace(repository);
await workspace.start();
await workspace.acceptStorage();
const store = new CollaborationPrivateStore(session, cipher);
const shareCsv = new URL(location.href).searchParams.get('shareCsv') === '1';
const dataset = shareCsv
  ? parseCsv('Category,Value\nA,100\nB,200', 'browser-shared.csv')
  : undefined;
const analysis = dataset ? { ...defaultAnalysis(dataset), levels: [] } : undefined;
const graph = dataset
  ? csvGraph(dataset, analysis!)
  : blankGraph('Encrypted browser collaboration');
if (!dataset) graph.nodes.push(newNode(graph.diagram.id));
graph.nodes[0].title = 'Shared initial node';
graph.nodes[0].metadata = { ...graph.nodes[0].metadata, privateMarker: 'NEVER-SHARE-METADATA' };
await workspace.create(graph);
const controller = new CollaborationController({
  workspace,
  session,
  store,
  relay,
  origin: location.origin,
});
let failAtomicOnce = false;
const commits: Array<{ stores: string[]; failed: boolean }> = [];
const commit = physical.commit.bind(physical);
physical.commit = async (...args: Parameters<VaultRecordStorage['commit']>) => {
  const stores = [
    ...new Set(
      args[1].flatMap((item: VaultMutation) => (item.kind === 'put' ? [item.record.store] : [])),
    ),
  ];
  const failed = failAtomicOnce && stores.includes('collaboration') && stores.includes('nodes');
  commits.push({ stores, failed });
  if (failed) {
    failAtomicOnce = false;
    throw new Error('Test injected atomic vault commit failure');
  }
  return commit(...args);
};
const view = () => controller.getSnapshot();
const current = async () =>
  repository.getGraph(view().diagramId ?? useEditor.getState().graph!.diagram.id);
const test = {
  snapshot: () => structuredClone(view()),
  graph: current,
  graphById: (id: string) => repository.getGraph(id),
  commits: () => structuredClone(commits),
  clearCommits: () => {
    commits.length = 0;
  },
  failNextAtomic: () => {
    failAtomicOnce = true;
  },
  privateState: async () => {
    const state = view().roomId && (await store.load(view().roomId!));
    return (
      state && {
        revision: state.revision,
        crdtState: Array.from(state.state.crdtState),
        pending: state.state.pending.map((item) => ({
          operationId: item.operationId,
          epoch: item.epoch,
          ciphertext: Array.from(item.ciphertext),
        })),
      }
    );
  },
  raw: async () =>
    session.withUnlocked(async ({ lease }) =>
      (
        await Promise.all(
          [...workspaceStoreNames, 'collaboration' as const].map((store) =>
            physical.select(lease, { store }),
          ),
        )
      ).flat(),
    ),
  edit: async (title: string, method: 'ui' | 'api' = 'api') => {
    const before = await current(),
      node = before.nodes[0];
    if (method === 'ui') {
      useEditor.getState().updateNode(node.id, { title });
      await workspace.settled();
      return current();
    }
    return workspace.execute(`/nodes/${node.id}`, 'PATCH', { version: node.version, title });
  },
  patchUi: async (patch: Partial<Graph['nodes'][number]>) => {
    const graph = useEditor.getState().graph!;
    useEditor.getState().updateNode(graph.nodes[0].id, patch);
    await workspace.settled();
    return current();
  },
  reconnect: () => controller.reconnect(),
  lock: () => session.lock(),
  unlock: () => session.unlock('Browser integration uses only this ephemeral test password'),
  leave: () => controller.leave(),
  epoch: () => (controller as unknown as { room?: { epoch: number } }).room?.epoch,
  disconnect: () => {
    const room = (controller as unknown as { room?: { transport?: { disconnect(): void } } }).room;
    if (!room?.transport) throw new Error('Test transport not available');
    room.transport.disconnect();
  },
  dispose: async () => {
    controller.dispose();
    workspace.stop();
    database.dispose();
    await session.dispose();
  },
};
Object.assign(window, { collaborationLiveTest: test });
await appLocaleController.start();
createRoot(document.getElementById('root')!).render(
  <CollaborationPanel controller={controller} close={() => {}} />,
);
