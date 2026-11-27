import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BehaviorLibrary } from '../src/behaviors/BehaviorLibrary';
import { createBehaviorDemo } from '../src/behaviors/demo';
import {
  bindBehavior,
  getBehaviorLibrary,
  saveBehaviorDefinition,
  setBehaviorLibrary,
  updateBehaviorBinding,
  validateBehaviorConfiguration,
  validateBehaviorLibrary,
} from '../src/behaviors/document';
import { BEHAVIOR_PREVIEW_VERSION } from '../src/behaviors/language';
import { captureSimulationBehaviors } from '../src/simulation/behaviors';
import { runSimulation, SimulationEngine, simulationModelHash } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

vi.mock('../src/behaviors/feature', () => ({ behaviorsEnabled: true }));
const futureVersion = Number.MAX_SAFE_INTEGER;

afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
});

it.each([2, futureVersion])(
  'preserves language version %s and the existing source when a draft is edited',
  (version) => {
    const graph = createBehaviorDemo('behaviors-editor');
    const library = getBehaviorLibrary(graph);
    const saved = { ...library.definitions[0], version };
    useEditor.getState().setGraph(setBehaviorLibrary(graph, { ...library, definitions: [saved] }));
    render(<BehaviorLibrary />);
    fireEvent.click(screen.getByRole('button', { name: 'Behavior library' }));
    expect(screen.getByText('Unsupported language version')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `Edit ${saved.name}` }));
    expect(screen.getByRole('button', { name: 'Activate source' })).toBeDisabled();
    expect(screen.getByText(/Line 1, column 1/)).toBeVisible();
    const draftSource = 'A draft for the later compiler.';
    fireEvent.change(screen.getByLabelText('Behavior source'), { target: { value: draftSource } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(getBehaviorLibrary(useEditor.getState().graph!).definitions).toEqual([
      { ...saved, draftSource },
    ]);
  },
);

it('keeps unknown imported bindings as data and rejects activation or editor execution', () => {
  const diagram = createBehaviorDemo('behaviors-editor');
  const [source, , target] = diagram.nodes;
  const definition = { ...getBehaviorLibrary(diagram).definitions[0], version: futureVersion };
  const binding = {
    id: 'already-imported',
    definitionId: definition.id,
    nodeId: source.id,
    enabled: true,
    parameters: {},
  };
  const graph = setBehaviorLibrary(diagram, { definitions: [definition], bindings: [binding] });
  expect(validateBehaviorConfiguration(graph, definition, {})).toMatchObject({
    ok: false,
    error: { code: 'version', line: 1, column: 1 },
  });
  expect(bindBehavior(graph, target.id, definition.id)).toBe(graph);
  expect(saveBehaviorDefinition(graph, { ...definition, version: BEHAVIOR_PREVIEW_VERSION })).toBe(
    graph,
  );
  expect(saveBehaviorDefinition(graph, { ...definition, source: 'on connectionAdded\nend' })).toBe(
    graph,
  );
  const disabled = updateBehaviorBinding(graph, binding.id, { enabled: false });
  expect(updateBehaviorBinding(disabled, binding.id, { enabled: true })).toBe(disabled);
  useEditor.getState().setGraph(graph);
  useEditor.getState().connect(source.id, target.id);
  const state = useEditor.getState();
  expect(state.graph!.edges).toHaveLength(1);
  expect(state.graph!.nodes.find(({ id }) => id === target.id)?.title).toBe(target.title);
  expect(state.behaviorTrace).toMatchObject([{ outcome: 'rejected', line: 1, column: 1 }]);
  expect(getBehaviorLibrary(state.graph!).bindings).toEqual([binding]);
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])(
  'rejects invalid stored version %s without rejecting genuine future integers',
  (version) => {
    const source = getBehaviorLibrary(createBehaviorDemo('behaviors-editor')).definitions[0];
    expect(() =>
      validateBehaviorLibrary({ definitions: [{ ...source, version }], bindings: [] }),
    ).toThrow('Invalid Behavior library');
    expect(() =>
      validateBehaviorLibrary({
        definitions: [{ ...source, version: futureVersion }],
        bindings: [],
      }),
    ).not.toThrow();
  },
);

it('restores future captured sources and opaque parameters while preventing their replay', async () => {
  const db = new WorkspaceDatabase(`behavior-version-${crypto.randomUUID()}`);
  try {
    await db.initialize();
    const repository = new Repository(db);
    const store = new SimulationRunStore(db);
    const graph = await repository.importGraph(createBehaviorDemo('behaviors-cashier'));
    const active = captureSimulationBehaviors(graph)!;
    const library = getBehaviorLibrary(graph);
    const futureDefinition = {
      ...library.definitions[0],
      version: futureVersion,
      draftSource: 'Source draft for a future compiler',
    };
    await repository.saveGraph(
      setBehaviorLibrary(graph, {
        ...library,
        definitions: [futureDefinition, ...library.definitions.slice(1)],
      }),
      graph.diagram.version,
    );
    const snapshot = structuredClone(active);
    snapshot.definitions[0].version = futureVersion;
    const now = new Date().toISOString();
    const model = graph.simulation!;
    const options = { durationSeconds: 75, seed: 42, runId: 'future', behaviors: snapshot };
    const result = {
      ...runSimulation(model, { ...options, behaviors: active }),
      modelHash: simulationModelHash(model, snapshot),
    };
    await store.put({
      id: 'future',
      diagramId: graph.diagram.id,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      model,
      options,
      result,
    });
    const backup = JSON.parse(JSON.stringify(await db.backup()));
    const [restored] = await repository.restore(backup, 'merge');
    const [run] = await store.list(restored.diagram.id);
    const captured = run.options.behaviors!;
    expect(captured.definitions).toEqual(snapshot.definitions);
    expect(captured.bindings[0].parameters).toEqual(snapshot.bindings[0].parameters);
    expect(captured.bindings[0].nodeId).not.toBe(snapshot.bindings[0].nodeId);
    expect(captured.bindings[0].nodeId).toBe(captured.bindings[1].nodeId);
    expect(run.result?.metrics.completed).toBe(result.metrics.completed);
    expect(() => new SimulationEngine(run.model, run.options)).toThrow(/Kötröskel \(1:1\)/);
    expect(getBehaviorLibrary(restored).definitions[0]).toEqual(futureDefinition);
    expect(() => captureSimulationBehaviors(restored)).toThrow(/Kötröskel \(1:1\)/);
  } finally {
    await db.delete();
  }
});
