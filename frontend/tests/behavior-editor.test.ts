import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBehaviorDemo } from '../src/behaviors/demo';
import {
  bindBehavior,
  getBehaviorLibrary,
  isBehaviorCompatible,
  saveBehaviorDefinition,
  updateBehaviorBinding,
  type BehaviorDefinition,
} from '../src/behaviors/document';
import { validateGraph } from '../src/model/validation';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

vi.mock('../src/behaviors/feature', () => ({ behaviorsEnabled: true }));

function example() {
  const graph = createBehaviorDemo('behaviors-editor');
  const { definitions } = getBehaviorLibrary(graph);
  const [source, otherSource, target, otherTarget] = graph.nodes.map(({ id }) => id);
  const bound = bindBehavior(graph, source, definitions[0].id);
  return { bound, source, otherSource, target, otherTarget, definition: definitions[0] };
}

const state = useEditor.getState;
const title = (id: string) => state().graph!.nodes.find((node) => node.id === id)!.title;
afterEach(() => state().setGraph(null));

describe('Behavior connection command', () => {
  it('allows a mixed program on an ordinary card and requires a Work card in simulator diagrams', () => {
    const { bound, source, definition } = example();
    const mixed = { ...definition, source: `${definition.source}\n\non queueChanged\nend` };
    expect(isBehaviorCompatible(bound, source, mixed)).toBe(true);

    const simulation = createBehaviorDemo('behaviors-cashier');
    expect(isBehaviorCompatible(simulation, simulation.nodes[0].id, mixed)).toBe(false);
    const work = simulation.simulation!.nodes.find(({ type }) => type === 'work')!;
    expect(isBehaviorCompatible(simulation, work.id, mixed)).toBe(true);
  });

  it('records one graph edit and restores the edge and title together without another evaluation', () => {
    const { bound, source, target } = example();
    state().setGraph(bound);
    state().connect(source, target);
    expect(title(target)).toBe('Kvalitetskontroll');
    expect(state().graph!.edges).toHaveLength(1);
    expect(state().history).toHaveLength(1);
    expect(state().behaviorTrace).toMatchObject([
      {
        definitionName: 'Namnge nästa nod',
        line: 4,
        previousName: 'Mål A',
        proposedName: 'Kvalitetskontroll',
        outcome: 'renamed',
      },
    ]);

    const edgeId = state().graph!.edges[0].id;
    state().undo();
    expect(title(target)).toBe('Mål A');
    expect(state().graph!.edges).toHaveLength(0);
    state().redo();
    expect(title(target)).toBe('Kvalitetskontroll');
    expect(state().graph!.edges[0].id).toBe(edgeId);
    expect(state().behaviorTrace).toHaveLength(1);
  });

  it('uses independent parameters for separate source nodes and ignores a disabled binding', () => {
    const { bound, source, otherSource, target, otherTarget, definition } = example();
    const attached = bindBehavior(bound, otherSource, definition.id);
    const [first, second] = getBehaviorLibrary(attached).bindings;
    const configured = updateBehaviorBinding(attached, second.id, {
      parameters: { nextName: 'Packing' },
    });
    state().setGraph(configured);
    state().connect(source, target);
    state().connect(otherSource, otherTarget);
    expect([title(target), title(otherTarget)]).toEqual(['Kvalitetskontroll', 'Packing']);

    state().setGraph(updateBehaviorBinding(configured, first.id, { enabled: false }));
    state().connect(source, target);
    expect(title(target)).toBe('Mål A');
    expect(state().behaviorTrace).toHaveLength(0);
  });

  it.each([' ', 'x'.repeat(1001)])(
    'keeps the edge when the proposed title is invalid',
    (nextName) => {
      const { bound, source, target } = example();
      const [binding] = getBehaviorLibrary(bound).bindings;
      state().setGraph(updateBehaviorBinding(bound, binding.id, { parameters: { nextName } }));
      state().connect(source, target);
      expect(title(target)).toBe('Mål A');
      expect(state().graph!.edges).toHaveLength(1);
      expect(state().behaviorTrace).toMatchObject([
        { outcome: 'rejected', proposedName: nextName.trim() },
      ]);
      validateGraph(state().graph!);
    },
  );

  it('keeps the original title for conflicting proposals, and skips existing connections', () => {
    const { bound, source, target, definition } = example();
    const second: BehaviorDefinition = {
      ...definition,
      id: crypto.randomUUID(),
      name: 'Secondary rename',
    };
    const attached = bindBehavior(saveBehaviorDefinition(bound, second), source, second.id);
    const binding = getBehaviorLibrary(attached).bindings[1];
    state().setGraph(
      updateBehaviorBinding(attached, binding.id, { parameters: { nextName: 'Packing' } }),
    );
    state().connect(source, target, 'out', 'in');
    expect(title(target)).toBe('Mål A');
    expect(state().graph!.edges).toHaveLength(1);
    expect(state().behaviorTrace.map(({ outcome }) => outcome)).toEqual(['rejected', 'rejected']);
    state().connect(source, target);
    expect(state().behaviorTrace).toHaveLength(2);
  });

  it('keeps same-name changes out of the node delta and does not run again on reconnect or open', () => {
    const { bound, source, target, otherTarget } = example();
    const [binding] = getBehaviorLibrary(bound).bindings;
    state().setGraph(
      updateBehaviorBinding(bound, binding.id, { parameters: { nextName: 'Mål A' } }),
    );
    state().connect(source, target);
    expect(state().history[0].nodes).toEqual([]);
    expect(state().behaviorTrace).toMatchObject([{ outcome: 'unchanged' }]);
    state().updateEdge(state().graph!.edges[0].id, { targetNodeId: otherTarget });
    expect(title(otherTarget)).toBe('Mål B');
    expect(state().behaviorTrace).toHaveLength(1);
    state().setGraph(state().graph);
    expect(state().behaviorTrace).toEqual([]);
    expect(title(otherTarget)).toBe('Mål B');
  });

  it('persists edge and title, and remaps stable IDs on import without running handlers', async () => {
    const db = new WorkspaceDatabase(`behavior-${crypto.randomUUID()}`);
    try {
      await db.initialize();
      const repository = new Repository(db);
      const { bound, source, target } = example();
      state().setGraph(await repository.importGraph(bound));
      state().connect(source, target);
      const first = await repository.saveGraph(state().graph!, state().graph!.diagram.version);
      expect(first.nodes.find(({ id }) => id === target)!.title).toBe('Kvalitetskontroll');
      expect(first.edges[0]).toMatchObject({ sourceNodeId: source, targetNodeId: target });
      const imported = await repository.importGraph({
        ...first,
        nodes: first.nodes.map((node) =>
          node.id === target ? { ...node, title: 'Original on import' } : node,
        ),
      });
      expect(imported.nodes.find(({ title }) => title === 'Original on import')!.id).not.toBe(
        target,
      );
      expect(getBehaviorLibrary(imported).bindings[0].nodeId).toBe(imported.edges[0].sourceNodeId);

      const demo = createBehaviorDemo('behaviors-cashier');
      await repository.importGraph(demo);
      const copy = await repository.importGraph(demo);
      const [threshold, reserve] = getBehaviorLibrary(copy).bindings;
      expect(threshold.nodeId).not.toBe(getBehaviorLibrary(demo).bindings[0].nodeId);
      expect(threshold.parameters.receiver).toBe(threshold.nodeId);
      expect(reserve.parameters.staffing).toBe('staff');
    } finally {
      await db.delete();
    }
  });
});
