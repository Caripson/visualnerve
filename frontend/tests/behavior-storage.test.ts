import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getBehaviorLibrary,
  updateBehaviorBinding,
  validateBehaviorConfiguration,
  type BehaviorLibrary,
} from '../src/behaviors/document';
import { compileBehavior } from '../src/behaviors/language';
import { parseImport } from '../src/export/semantic';
import { HistoryStore } from '../src/history/store';
import type { Graph } from '../src/model/types';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { captureSimulationBehaviors } from '../src/simulation/behaviors';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import { useEditor } from '../src/state/editor';
import type { WorkspaceStorage } from '../src/storage/contracts';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';

const diagramId = '11111111-1111-4111-8111-111111111111';
const arrivalsId = '22222222-2222-4222-8222-222222222222';
const checkoutId = '33333333-3333-4333-8333-333333333333';
const finishedId = '44444444-4444-4444-8444-444444444444';
const firstEdgeId = '55555555-5555-4555-8555-555555555555';
const secondEdgeId = '66666666-6666-4666-8666-666666666666';
const staffId = 'staff';
const timestamp = '2026-11-25T12:00:00.000Z';
const record = { version: 1, createdAt: timestamp, updatedAt: timestamp };

// A fixed native-format v1 envelope based on the dcbc510 checkout demo.
// Source and shape are independent of today's library builders and model defaults.
const previewLibrary: BehaviorLibrary = {
  definitions: [
    {
      id: 'threshold-v1',
      name: 'Kötröskel',
      version: 1,
      source: `parameter threshold as number = 15
parameter receiver as node

on queueChanged
  if queue.previousLength <= threshold and queue.length > threshold then
    send "öppna" to node receiver
  end if
end`,
    },
    {
      id: 'reserve-v1',
      name: 'Öppna reservkassa',
      version: 1,
      source: `parameter staffing as resource

on "öppna"
  open reserve slot using resource staffing
end`,
    },
  ],
  bindings: [
    {
      id: 'watch-binding',
      definitionId: 'threshold-v1',
      nodeId: checkoutId,
      enabled: true,
      parameters: { receiver: checkoutId },
    },
    {
      id: 'reserve-binding',
      definitionId: 'reserve-v1',
      nodeId: checkoutId,
      enabled: true,
      parameters: { staffing: staffId },
    },
  ],
};

const fixture: Graph = {
  format: 'visual-nerve',
  formatVersion: 1,
  diagram: {
    ...record,
    id: diagramId,
    name: 'Frozen checkout preview',
    type: 'process-simulator',
    favorite: false,
    tags: [],
    metadata: {},
    settings: { grid: true, snap: false, behaviors: previewLibrary },
  },
  nodes: (
    [
      [arrivalsId, 'Ankomster', 'start', 'source'],
      [checkoutId, 'Kassor', 'process', 'work'],
      [finishedId, 'Klart', 'end', 'outcome'],
    ] as const
  ).map(([id, title, nodeType, externalId], index) => ({
    ...record,
    id,
    diagramId,
    title,
    nodeType,
    externalId,
    x: index * 280,
    y: 0,
    width: 220,
    height: 170,
    tags: [],
    ownerIds: [],
    collapsed: false,
    metadata: {},
  })),
  edges: [
    { id: firstEdgeId, sourceNodeId: arrivalsId, targetNodeId: checkoutId },
    { id: secondEdgeId, sourceNodeId: checkoutId, targetNodeId: finishedId },
  ].map((edge) => ({
    ...record,
    ...edge,
    diagramId,
    edgeType: 'simulation-flow',
    direction: 'forward',
    style: 'solid',
    metadata: {},
  })),
  owners: [],
  simulation: {
    type: 'process-simulator',
    schemaVersion: 1,
    currency: 'SEK',
    particleTypes: [
      {
        id: 'work-item',
        name: 'Kund',
        color: '#2563eb',
        revenue: 100,
        complexity: { min: 1, max: 1 },
        priority: 1,
      },
    ],
    nodes: [
      {
        id: arrivalsId,
        name: 'Ankomster',
        type: 'source',
        source: { particleTypeId: 'work-item', burst: 17, maxCount: 17 },
      },
      {
        id: checkoutId,
        name: 'Kassor',
        type: 'work',
        work: {
          processingSeconds: 60,
          capacity: 1,
          queueDiscipline: 'fifo',
          resourceRequirements: [{ resourceId: staffId, units: 1 }],
        },
      },
      {
        id: finishedId,
        name: 'Klart',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    ],
    edges: [
      { id: firstEdgeId, sourceNodeId: arrivalsId, targetNodeId: checkoutId, travelSeconds: 0 },
      { id: secondEdgeId, sourceNodeId: checkoutId, targetNodeId: finishedId, travelSeconds: 0 },
    ],
    resources: [{ id: staffId, name: 'Personal', capacity: 2, unit: 'person' }],
    improvements: [],
    scenarios: [],
    defaults: { durationSeconds: 75, seed: 42 },
  },
};

const stagedJson = JSON.stringify(fixture);

function mixedVersionFixture(): Graph {
  const graph = parseImport('json', stagedJson);
  const { definitions, bindings } = getBehaviorLibrary(graph);
  definitions[0].draftSource = 'parameter receiver as node\r\non';
  definitions.push(
    {
      id: 'reserve-v2',
      name: 'Delayed backup checkout',
      version: 2,
      source: `parameter receiver as node
parameter staffing as resource
parameter label as text
property requests as number = 0
on queueChanged
  set requests to requests + 1
  send "reserve" to node receiver after 1
  open reserve slot using resource staffing
end`,
    },
    {
      id: 'future',
      name: 'Stored future source',
      version: Number.MAX_SAFE_INTEGER,
      source: '⟪test-host future rule⟫\r\n  preserved source\r\n',
      draftSource: '⟪future draft⟫\n',
    },
  );
  bindings.splice(
    1,
    0,
    {
      id: 'future-binding',
      definitionId: 'future',
      nodeId: checkoutId,
      enabled: false,
      parameters: { receiver: checkoutId, staffing: staffId, quantity: 17, active: true },
    },
    {
      id: 'v2-binding',
      definitionId: 'reserve-v2',
      nodeId: checkoutId,
      enabled: false,
      parameters: { receiver: checkoutId, staffing: staffId, label: checkoutId },
    },
  );
  return graph;
}

type Mode = 'legacy' | 'encrypted';
const password = 'test-only Behavior storage vault phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;

beforeAll(async () => {
  vault = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(vault.keys));

async function openWorkspace(mode: Mode): Promise<{
  storage: WorkspaceStorage;
  close(): Promise<void>;
  reopen(): Promise<Repository>;
}> {
  const name = `behavior-storage-${mode}-${crypto.randomUUID()}`;
  if (mode === 'legacy') {
    const physical = new WorkspaceDatabase(name);
    const storage = physical.asStorage();
    await storage.open();
    return {
      storage,
      close: () => physical.delete(),
      reopen: async () => {
        storage.close();
        await storage.open();
        return new Repository(storage);
      },
    };
  }

  const physical = new VaultRecordStorage(name);
  await physical.create(vault.header);
  const session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  const storage = new EncryptedWorkspaceDatabase(
    session,
    new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
  );
  await storage.open();
  return {
    storage,
    close: async () => {
      storage.dispose();
      await session.dispose();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Behavior storage fixture remained open.'));
      });
    },
    reopen: async () => {
      storage.close();
      await session.lock();
      await session.unlock(password);
      await storage.open();
      return new Repository(storage);
    },
  };
}

function expectWholeCopy(original: Graph, copy: Graph) {
  const source = getBehaviorLibrary(original);
  const originalWork = original.simulation!.nodes.find((node) => node.type === 'work')!;
  const work = copy.simulation!.nodes.find((node) => node.type === 'work')!;
  const staff = copy.simulation!.resources[0];
  expect(copy.diagram.id).not.toBe(original.diagram.id);
  expect(work.id).not.toBe(originalWork.id);
  expect(copy.nodes.find((node) => node.externalId === 'work')?.id).toBe(work.id);
  // Whole copies get their own simulation model. Resource IDs are scoped to that model.
  expect(staff).toEqual(original.simulation!.resources[0]);
  expect(work.work.resourceRequirements).toEqual([{ resourceId: staff.id, units: 1 }]);
  expect(getBehaviorLibrary(copy)).toEqual({
    definitions: source.definitions,
    bindings: source.bindings.map((binding) => ({
      ...binding,
      nodeId: work.id,
      parameters:
        binding.definitionId !== 'future' && binding.parameters.receiver === originalWork.id
          ? { ...binding.parameters, receiver: work.id }
          : binding.parameters,
    })),
  });
  return { work, staff };
}

describe.each<Mode>(['legacy', 'encrypted'])('%s Behavior storage', (mode) => {
  let workspace: Awaited<ReturnType<typeof openWorkspace>>;
  let repository: Repository;

  beforeEach(async () => {
    workspace = await openWorkspace(mode);
    repository = new Repository(workspace.storage);
  });

  afterEach(async () => {
    useEditor.getState().setGraph(null);
    await workspace.close();
  });

  it('opens historical native documents with and without an attached Behavior library', async () => {
    const old = parseImport('json', stagedJson);
    delete old.diagram.settings.behaviors;
    const without = await repository.importGraph(old);
    const staged = await repository.importGraph(parseImport('json', stagedJson));

    repository = await workspace.reopen();
    const opened = await repository.getGraph(without.diagram.id);
    expect(opened.formatVersion).toBe(1);
    expect(opened.diagram.settings.behaviors).toBeUndefined();
    expect(opened.simulation).toEqual(without.simulation);

    const saved = await repository.getGraph(staged.diagram.id);
    const native = parseImport('json', JSON.stringify(saved));
    expect(native.formatVersion).toBe(1);
    expect(getBehaviorLibrary(native).definitions).toEqual(previewLibrary.definitions);
    const { work } = expectWholeCopy(fixture, native);
    const library = getBehaviorLibrary(native);
    expect(
      validateBehaviorConfiguration(native, library.definitions[0], library.bindings[0].parameters),
    ).toMatchObject({ ok: true, bindings: { receiver: work.id, threshold: 15 } });
    expect(await new SimulationRunStore(workspace.storage).list(staged.diagram.id)).toEqual([]);
  });

  it('remaps declared v1 and v2 node refs but preserves future source and opaque values on native reimport', async () => {
    const graph = mixedVersionFixture();
    const definitions = getBehaviorLibrary(graph).definitions;
    expect(compileBehavior(definitions[2].source, definitions[2].version).ok).toBe(true);
    const native = JSON.stringify(graph);
    const original = await repository.importGraph(parseImport('json', native));
    const copied = await repository.importGraph(parseImport('json', native));
    repository = await workspace.reopen();

    expect(getBehaviorLibrary(await repository.getGraph(original.diagram.id))).toEqual(
      getBehaviorLibrary(graph),
    );
    const opened = await repository.getGraph(copied.diagram.id);
    const { work, staff } = expectWholeCopy(original, opened);
    const library = getBehaviorLibrary(opened);
    expect(library.definitions.map(({ version }) => version)).toEqual([
      1,
      1,
      2,
      Number.MAX_SAFE_INTEGER,
    ]);
    expect(library.bindings.map(({ id, enabled }) => [id, enabled])).toEqual([
      ['watch-binding', true],
      ['future-binding', false],
      ['v2-binding', false],
      ['reserve-binding', true],
    ]);
    expect(library.bindings[2].parameters).toEqual({
      receiver: work.id,
      staffing: staff.id,
      label: checkoutId,
    });
    expect(library.bindings[1].parameters).toEqual({
      receiver: checkoutId,
      staffing: staffId,
      quantity: 17,
      active: true,
    });
    for (const index of [2, 3])
      expect(validateBehaviorConfiguration(opened, library.definitions[index], {})).toMatchObject({
        ok: false,
        error: { code: 'version', line: 1, column: 1 },
      });
  });

  it('preserves a dangling parameter ID and diagnoses it after a colliding native import', async () => {
    const graph = parseImport('json', stagedJson);
    const missing = 'unavailable-checkout';
    getBehaviorLibrary(graph).bindings[0].parameters.receiver = missing;
    await repository.importGraph(graph);
    const copy = await repository.importGraph(parseImport('json', JSON.stringify(graph)));
    const { work } = expectWholeCopy(graph, copy);
    repository = await workspace.reopen();
    const reopened = await repository.getGraph(copy.diagram.id);
    const { definitions, bindings } = getBehaviorLibrary(reopened);
    expect(bindings[0]).toMatchObject({
      nodeId: work.id,
      enabled: true,
      parameters: { receiver: missing },
    });
    expect(validateBehaviorConfiguration(reopened, definitions[0], bindings[0].parameters)).toEqual(
      {
        ok: false,
        error: {
          code: 'binding',
          line: 2,
          column: 11,
          message: 'The node for "receiver" is unavailable.',
        },
      },
    );
  });

  it('round trips snapshots, edited bindings and saved simulation traces in a backup merge', async () => {
    const original = await repository.importGraph(mixedVersionFixture());
    const baseline = await repository.history.create(original.diagram.id, {
      name: 'Staging sources and bindings',
      baseVersion: original.diagram.version,
    });
    const editor = useEditor.getState();
    editor.setGraph(original);
    editor.command('Change checkout threshold', (graph) =>
      updateBehaviorBinding(graph, 'watch-binding', {
        enabled: false,
        parameters: { receiver: checkoutId, threshold: 22 },
      }),
    );
    const editedLibrary = getBehaviorLibrary(useEditor.getState().graph!);
    expect(editedLibrary.bindings[0]).toMatchObject({
      enabled: false,
      parameters: { receiver: checkoutId, threshold: 22 },
    });
    editor.undo();
    expect(getBehaviorLibrary(useEditor.getState().graph!)).toEqual(getBehaviorLibrary(original));
    editor.redo();
    expect(getBehaviorLibrary(useEditor.getState().graph!)).toEqual(editedLibrary);
    const edited = await repository.saveGraph(
      useEditor.getState().graph!,
      original.diagram.version,
    );
    const restored = await repository.history.restore(original.diagram.id, baseline.id, {
      baseVersion: edited.diagram.version,
    });
    expect(getBehaviorLibrary(restored.graph)).toEqual(getBehaviorLibrary(original));
    const safety = await repository.history.read(original.diagram.id, restored.safetySnapshot.id);
    expect(getBehaviorLibrary(safety.graph)).toEqual(editedLibrary);

    const store = new SimulationRunStore(workspace.storage);
    const options = {
      runId: 'frozen-checkout-run',
      durationSeconds: 75,
      seed: 42,
      behaviors: captureSimulationBehaviors(restored.graph)!,
    };
    const model = restored.graph.simulation!;
    const result = runSimulation(model, options);
    expect(result.metrics.completed).toBe(2);
    await store.put({
      id: result.runId,
      diagramId: restored.graph.diagram.id,
      status: result.status,
      createdAt: timestamp,
      updatedAt: timestamp,
      model,
      options,
      result,
    });
    await store.putCheckpoint(result.runId, result.timeSeconds, result);

    const [copy] = await repository.restore(
      JSON.parse(JSON.stringify(await workspace.storage.backup())),
      'merge',
    );
    const { work, staff } = expectWholeCopy(restored.graph, copy);
    repository = await workspace.reopen();
    const snapshots = await repository.history.list(copy.diagram.id);
    const copiedBaseline = snapshots.find((snapshot) => snapshot.name === baseline.name)!;
    const copiedSafety = snapshots.find((snapshot) => snapshot.kind === 'pre-restore')!;
    expectWholeCopy(
      original,
      (await repository.history.read(copy.diagram.id, copiedBaseline.id)).graph,
    );
    const archivedEdit = (await repository.history.read(copy.diagram.id, copiedSafety.id)).graph;
    expectWholeCopy(edited, archivedEdit);
    expect(getBehaviorLibrary(archivedEdit).bindings[0].parameters).toEqual({
      receiver: work.id,
      threshold: 22,
    });

    const recent = new SimulationRunStore(workspace.storage);
    const [run] = await recent.list(copy.diagram.id);
    expect(run.id).not.toBe(result.runId);
    expect(run.options.behaviors?.definitions).toEqual(options.behaviors.definitions);
    expect(
      run.options.behaviors?.bindings.map(({ nodeId, parameters }) => ({ nodeId, parameters })),
    ).toEqual([
      { nodeId: work.id, parameters: { receiver: work.id } },
      { nodeId: work.id, parameters: { staffing: staff.id } },
    ]);
    expect(run.result?.behaviorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'send', nodeId: work.id, targetNodeId: work.id }),
        expect.objectContaining({ kind: 'reserve', nodeId: work.id, resourceId: staff.id }),
      ]),
    );
    const [checkpoint] = await recent.checkpoints(run.id);
    expect(checkpoint.state.behaviorTrace).toEqual(run.result?.behaviorTrace);
    expect(runSimulation(run.model, run.options).behaviorTrace).toEqual(run.result?.behaviorTrace);
    expect((await recent.get(result.runId)).result).toEqual(result);
  });

  it('rolls back staged history and graph writes and rejects a version-zero backup atomically', async () => {
    const original = await repository.importGraph(mixedVersionFixture());
    const baseline = await repository.history.create(original.diagram.id, {
      name: 'Before checkout change',
      baseVersion: original.diagram.version,
    });
    const current = await repository.saveGraph(
      updateBehaviorBinding(original, 'watch-binding', {
        enabled: false,
        parameters: { receiver: checkoutId, threshold: 21 },
      }),
      original.diagram.version,
    );
    const before = await workspace.storage.backup();
    const failing = new HistoryStore(workspace.storage, async (graph, version, scope) => {
      expect(scope.inTransaction).toBe(true);
      const scoped = new Repository(scope);
      await scoped.saveGraph(graph, version);
      expect(getBehaviorLibrary(await scoped.getGraph(graph.diagram.id))).toEqual(
        getBehaviorLibrary(original),
      );
      expect(await scope.historySnapshots.count()).toBe(2);
      throw new Error('Stop after staging the restored Behavior graph');
    });

    await expect(
      failing.restore(original.diagram.id, baseline.id, { baseVersion: current.diagram.version }),
    ).rejects.toThrow('Stop after staging the restored Behavior graph');

    const invalid = structuredClone(before);
    invalid.diagrams[0].settings.behaviors!.definitions[0].version = 0;
    await expect(repository.restore(invalid, 'replace')).rejects.toMatchObject({
      status: 422,
      message: 'Invalid Behavior library.',
    });

    repository = await workspace.reopen();
    const after = await workspace.storage.backup();
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    expect(await repository.getGraph(original.diagram.id)).toEqual(current);
    expect((await repository.history.list(original.diagram.id)).map(({ id }) => id)).toEqual([
      baseline.id,
    ]);
  });
});
