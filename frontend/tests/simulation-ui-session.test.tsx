import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationFeature } from '../src/simulation/SimulationFeature';
import { Workspace } from '../src/storage/workspace';
import { Repository } from '../src/storage/repository';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import { useEditor } from '../src/state/editor';
import type { Graph } from '../src/model/types';
import type { SimulationStartOptions, SimulationView } from '../src/simulation/service';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown as Workspace,
  compact: false,
  view: undefined as SimulationView | undefined,
  start: vi.fn(),
  control: vi.fn(),
  list: vi.fn(),
  setSpeed: vi.fn(),
  selectRun: vi.fn(),
  seek: vi.fn(),
  compare: vi.fn(),
}));
vi.mock('../src/storage/workspace', async (original) => {
  const actual = await original<typeof import('../src/storage/workspace')>();
  return {
    ...actual,
    get workspace() {
      return fixture.workspace;
    },
  };
});
vi.mock('../src/simulation/service', () => ({
  simulationService: {
    start: fixture.start,
    control: fixture.control,
    list: fixture.list,
    setSpeed: fixture.setSpeed,
    selectRun: fixture.selectRun,
    seek: fixture.seek,
    compare: fixture.compare,
  },
}));
vi.mock('../src/simulation/useSimulationCanvasLifecycle', () => ({
  useSimulationCanvasLifecycle: () => ({
    view: fixture.view,
    resultsView: fixture.view,
    topologyChanged: false,
  }),
}));
vi.mock('../src/hooks/useCompactLayout', () => ({ useCompactLayout: () => fixture.compact }));
vi.mock('../src/simulation/MetricsDashboard', () => ({ MetricsDashboard: () => null }));
vi.mock('../src/simulation/SimulationModelDialogs', () => ({
  SimulationModelDialogs: ({ close }: { close: () => void }) => (
    <button onClick={close}>Close assumptions fixture</button>
  ),
}));

const password = 'test-only simulation UI originating vault';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let graph: Graph;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount() {
  const mounted = render(<SimulationFeature />);
  await waitFor(() => expect(fixture.list).toHaveBeenCalled());
  // Complete the originating-capability read before starting a separately gated action.
  await act(async () => {});
  return mounted;
}
async function lockAndUnlock() {
  await act(async () => {
    await session.lock();
    await session.unlock(password);
    await fixture.workspace.start();
    await fixture.workspace.open(graph.diagram.id);
  });
  expect(useEditor.getState().graph?.diagram.id).toBe(graph.diagram.id);
}
function pendingPlay() {
  const settled = deferred<void>();
  vi.spyOn(fixture.workspace, 'settled').mockReturnValueOnce(settled.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Play simulation' }));
  return settled;
}
function currentRun(status: 'running' | 'paused' = 'running') {
  fixture.view = {
    run: {
      id: crypto.randomUUID(),
      diagramId: graph.diagram.id,
      status,
      model: structuredClone(graph.simulation!),
      options: {
        durationSeconds: graph.simulation!.defaults.durationSeconds,
        seed: graph.simulation!.defaults.seed,
        speed: 10,
        animated: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  return fixture.view.run.id;
}
beforeAll(async () => {
  created = await cipher.createVault(password);
}, 30_000);
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  fixture.compact = false;
  fixture.view = undefined;
  for (const method of ['start', 'control', 'setSpeed', 'selectRun', 'seek'] as const)
    fixture[method].mockReset().mockResolvedValue(undefined);
  fixture.list.mockReset().mockResolvedValue([]);
  fixture.compare.mockReset();
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '', privacyAcknowledged: true });
  physical = new VaultRecordStorage(`vault-simulation-ui-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  const repo = new Repository(db);
  fixture.workspace = new Workspace(repo);
  session.onLock(() => fixture.workspace.clearUnlockedState());
  await db.settings.put({ key: 'storage-consent', value: true });
  graph = await repo.saveGraph(createSimulationGraph('Original process', createBasicModel()), 0);
  await db.settings.put({ key: 'last-diagram', value: graph.diagram.id });
  await fixture.workspace.start();
  await fixture.workspace.open(graph.diagram.id);
}, 30_000);
afterEach(async () => {
  cleanup();
  fixture.workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Simulation UI retained its vault.'));
  });
  vi.unstubAllGlobals();
}, 30_000);
afterAll(() => cipher.destroyKeys(created.keys));

describe('simulation UI originating-session continuations', () => {
  it('never captures a fresh session or starts a run when settled resolves after same-vault unlock', async () => {
    await mount();
    const settled = pendingPlay();
    await waitFor(() => expect(fixture.workspace.settled).toHaveBeenCalledOnce());
    await lockAndUnlock();
    const capture = vi.spyOn(db, 'captureOperation');
    fixture.start.mockImplementation(async () => {
      const operation = await db.captureOperation();
      operation.dispose();
    });
    await act(async () => {
      settled.resolve();
    });
    expect(fixture.start).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await db.simulationRuns.count()).toBe(0);
    expect(useEditor.getState().graph?.simulation).toEqual(graph.simulation);
  });

  it('rechecks the original session after stopping a run, before dispatching a replacement', async () => {
    currentRun();
    await mount();
    const stop = deferred<void>();
    fixture.control.mockReturnValueOnce(stop.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Rerun simulation' }));
    await waitFor(() => expect(fixture.control).toHaveBeenCalledOnce());
    expect(fixture.control.mock.calls[0][1]).toBe('stop');
    await lockAndUnlock();
    const capture = vi.spyOn(db, 'captureOperation');
    await act(async () => stop.resolve());
    expect(fixture.start).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('allows geometry saves on the same diagram and uses the authoritative saved model and settings', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Simulation duration hours'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Simulation random seed'), {
      target: { value: '12345' },
    });
    fireEvent.change(screen.getByLabelText('Simulation speed'), { target: { value: 'max' } });
    const settled = deferred<void>();
    const saveAll = fixture.workspace.settled.bind(fixture.workspace);
    vi.spyOn(fixture.workspace, 'settled').mockReturnValueOnce(settled.promise);
    fixture.start.mockImplementation(async (_id, _model, options: SimulationStartOptions) => {
      // Initial commit guards use the borrowed UI capability, not a persisted credential.
      await options.beforeWrite!(db);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play simulation' }));
    await waitFor(() => expect(fixture.workspace.settled).toHaveBeenCalledOnce());
    act(() => useEditor.getState().updateNode(graph.nodes[0].id, { x: 987, y: 654 }));
    await act(async () => {
      await saveAll();
      settled.resolve();
    });
    await waitFor(() => expect(fixture.start).toHaveBeenCalledOnce());
    expect(fixture.start).toHaveBeenCalledWith(graph.diagram.id, graph.simulation, {
      durationSeconds: 7200,
      seed: 12345,
      speed: 'max',
      animated: false,
      untilComplete: false,
      scenarioId: undefined,
      origin: 'ui',
      beforeWrite: expect.any(Function),
    });
    const saved = await db.graph(graph.diagram.id);
    expect(saved?.nodes[0]).toMatchObject({ x: 987, y: 654 });
    expect(saved!.diagram.version).toBeGreaterThan(graph.diagram.version);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['Simulation duration preset', 'Simulation speed'])(
    'keeps subsequent controls and Play usable after choosing the current %s',
    async (control) => {
      await mount();
      const select = screen.getByLabelText(control) as HTMLSelectElement;
      const currentValue = select.value;
      // Select controls emit change even when the user's chosen option is already selected.
      // Cancelling pending UI work must therefore also refresh the rendered action revision.
      fireEvent.change(select, { target: { value: currentValue } });
      expect(select).toHaveValue(currentValue);
      fireEvent.click(screen.getByLabelText('Finish all generated work'));
      expect(screen.getByLabelText('Finish all generated work')).toBeChecked();
      fireEvent.change(screen.getByLabelText('Simulation random seed'), {
        target: { value: '12345' },
      });
      expect(screen.getByLabelText('Simulation random seed')).toHaveValue(12345);
      fireEvent.change(screen.getByLabelText('Simulation speed'), { target: { value: 'max' } });
      expect(screen.getByLabelText('Simulation speed')).toHaveValue('max');
      fireEvent.click(screen.getByRole('button', { name: 'Play simulation' }));
      await waitFor(() => expect(fixture.start).toHaveBeenCalledOnce());
      expect(fixture.start).toHaveBeenCalledWith(graph.diagram.id, graph.simulation, {
        durationSeconds: graph.simulation!.defaults.durationSeconds,
        seed: 12345,
        speed: 'max',
        animated: false,
        untilComplete: true,
        scenarioId: undefined,
        origin: 'ui',
        beforeWrite: expect.any(Function),
      });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled(),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('does not start or publish a late save error after the component unmounts', async () => {
    const mounted = await mount();
    const settled = pendingPlay();
    await waitFor(() => expect(fixture.workspace.settled).toHaveBeenCalledOnce());
    mounted.unmount();
    const capture = vi.spyOn(db, 'captureOperation');
    await act(async () => settled.reject(new Error('Old private simulation failure')));
    expect(fixture.start).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Old private simulation failure');
  });

  it('does not start or publish a late error into a newly selected diagram', async () => {
    await mount();
    const settled = pendingPlay();
    await waitFor(() => expect(fixture.workspace.settled).toHaveBeenCalledOnce());
    const other = await fixture.workspace.repo.saveGraph(
      createSimulationGraph('Second process', createBasicModel()),
      0,
    );
    await act(async () => fixture.workspace.open(other.diagram.id));
    await act(async () => settled.reject(new Error('Old diagram confidential failure')));
    expect(fixture.start).not.toHaveBeenCalled();
    expect(useEditor.getState().graph?.diagram.id).toBe(other.diagram.id);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled();
  });

  it('cancels a pending dialog Play and cannot close a newly opened workbench', async () => {
    fixture.compact = true;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open simulation details' }));
    const settled = deferred<void>();
    vi.spyOn(fixture.workspace, 'settled').mockReturnValueOnce(settled.promise);
    fireEvent.click(await screen.findByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(fixture.workspace.settled).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Back to diagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open simulation details' }));
    await act(async () => settled.resolve());
    expect(fixture.start).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Simulation details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['result', 'error'] as const)(
    'does not publish a saved-run %s from the previous unlocked session',
    async (completion) => {
      const saved = deferred<Awaited<ReturnType<typeof fixture.list>>>();
      fixture.list.mockReturnValueOnce(saved.promise);
      await mount();
      await lockAndUnlock();
      await act(async () => {
        if (completion === 'error') saved.reject(new Error('Private old run error'));
        else
          saved.resolve([
            {
              id: crypto.randomUUID(),
              scenarioName: 'Private previous-session scenario',
              status: 'completed',
              createdAt: new Date().toISOString(),
              currency: 'SEK',
            },
          ]);
      });
      expect(document.body.textContent).not.toContain('Private previous-session scenario');
      expect(document.body.textContent).not.toContain('Private old run error');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('preserves resume, pause, stop, reset and live speed controls with initial-session guards', async () => {
    const runId = currentRun('paused');
    await mount();
    fixture.control.mockImplementation(async (_id, _action, options) => options.beforeWrite(db));
    fixture.setSpeed.mockImplementation(async (_id, _speed, beforeWrite) => beforeWrite(db));
    fireEvent.click(screen.getByRole('button', { name: 'Resume simulation' }));
    await waitFor(() =>
      expect(fixture.control).toHaveBeenCalledWith(runId, 'resume', {
        beforeWrite: expect.any(Function),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume simulation' })).toBeEnabled(),
    );
    expect(fixture.start).not.toHaveBeenCalled();
    fixture.view = { ...fixture.view!, run: { ...fixture.view!.run, status: 'running' } };
    act(() => useEditor.setState({ message: 'Refresh simulation fixture' }));
    // Changing an observed graph field renders the real controller without changing its identity.
    act(() => useEditor.getState().updateNode(graph.nodes[0].id, { x: 123 }));
    for (const [label, action] of [
      ['Pause', 'pause'],
      ['Stop', 'stop'],
      ['Reset', 'reset'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: `${label} simulation` }));
      await waitFor(() =>
        expect(fixture.control).toHaveBeenCalledWith(runId, action, {
          beforeWrite: expect.any(Function),
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Rerun simulation' })).toBeEnabled(),
      );
    }
    fireEvent.change(screen.getByLabelText('Simulation speed'), { target: { value: '100' } });
    await waitFor(() =>
      expect(fixture.setSpeed).toHaveBeenCalledWith(runId, 100, expect.any(Function)),
    );
    expect(screen.getByLabelText('Simulation speed')).toHaveValue('100');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a started native encrypted run independent of the disposed UI capability', async () => {
    class HeldWorker {
      static instance: HeldWorker;
      onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
      engine?: SimulationEngine;
      constructor() {
        HeldWorker.instance = this;
      }
      postMessage(command: WorkerCommand) {
        if (command.kind === 'start')
          this.engine = new SimulationEngine(command.model, command.options);
      }
      finish() {
        this.engine!.advance(this.engine!.options.durationSeconds);
        this.onmessage?.({
          data: { kind: 'state', state: this.engine!.state(), result: this.engine!.result() },
        } as MessageEvent<WorkerUpdate>);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', HeldWorker);
    const { SimulationService } = await vi.importActual<typeof import('../src/simulation/service')>(
      '../src/simulation/service',
    );
    const service = new SimulationService(db);
    fixture.start.mockImplementation(service.start.bind(service));
    try {
      const mounted = await mount();
      fireEvent.click(screen.getByRole('button', { name: 'Play simulation' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled(),
      );
      expect(fixture.start).toHaveBeenCalledOnce();
      const run = service.current(graph.diagram.id)!.run;
      expect(run.options).not.toHaveProperty('beforeWrite');
      const initialGuard = fixture.start.mock.calls[0][2].beforeWrite;
      await expect(initialGuard(db)).rejects.toMatchObject({ name: 'AbortError' });
      mounted.unmount();
      HeldWorker.instance.finish();
      const completed = await service.result(run.id);
      expect(completed.status).toBe('completed');
      expect(completed.metrics.completed).toBe(completed.metrics.created);
      expect(completed.metrics.created).toBeGreaterThan(0);
      expect((await db.simulationRuns.get(run.id))?.result).toEqual(completed);
    } finally {
      service.dispose();
    }
  });
});
