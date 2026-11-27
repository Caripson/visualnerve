import { afterEach, describe, expect, it } from 'vitest';
import { createBehaviorDemo } from '../src/behaviors/demo';
import {
  behaviorDocumentLimits,
  getBehaviorLibrary,
  setBehaviorLibrary,
  type BehaviorDefinition,
} from '../src/behaviors/document';
import { blankGraph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection, type Clip } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';

const editor = useEditor.getState;
afterEach(() => editor().setGraph(null));

describe('Behavior selection clipboard', () => {
  it('duplicates bound nodes with shared definitions and pools in one reversible edit', () => {
    const source = createBehaviorDemo('behaviors-cashier-off');
    const library = getBehaviorLibrary(source);
    const work = source.simulation!.nodes.find((node) => node.type === 'work')!;
    editor().setGraph(source);
    editor().select([work.id]);
    const clip = editor().copy()!;
    editor().paste(clip);

    const duplicated = editor().graph!;
    const [copiedNodeId] = editor().selectedNodes;
    const copies = getBehaviorLibrary(duplicated).bindings.slice(library.bindings.length);
    expect(duplicated.simulation!.resources).toEqual(source.simulation!.resources);
    expect(getBehaviorLibrary(duplicated).definitions).toEqual(library.definitions);
    expect(copies).toEqual([
      {
        ...library.bindings[0],
        id: expect.any(String),
        nodeId: copiedNodeId,
        parameters: { receiver: copiedNodeId },
      },
      { ...library.bindings[1], id: expect.any(String), nodeId: copiedNodeId },
    ]);
    expect(new Set(getBehaviorLibrary(duplicated).bindings.map(({ id }) => id)).size).toBe(4);
    expect(editor().history).toHaveLength(1);
    validateGraph(duplicated);

    editor().undo();
    expect(editor().graph).toEqual(source);
    editor().redo();
    expect(editor().graph).toEqual(duplicated);
  });

  it('copies only selected bindings, remaps version 2 references, and keeps future data opaque', () => {
    const sample = createBehaviorDemo('behaviors-cashier');
    const work = sample.simulation!.nodes.find((node) => node.type === 'work')!;
    delete work.work.resourceRequirements;
    const { definitions, bindings } = getBehaviorLibrary(sample);
    const current = {
      ...definitions[0],
      version: 2,
      source: definitions[0].source.replace('to node receiver', 'to node receiver after 1'),
    };
    const future = {
      id: 'future',
      name: 'Future definition',
      version: 100,
      source: 'Future active source',
      draftSource: 'Future draft source',
    };
    const opaque = { receiver: work.id, staffing: 'staff', value: true };
    const source = setBehaviorLibrary(sample, {
      definitions: [current, definitions[1], future, { ...future, id: 'unused' }],
      bindings: [
        ...bindings,
        {
          id: 'future-binding',
          definitionId: future.id,
          nodeId: work.id,
          enabled: true,
          parameters: opaque,
        },
        { ...bindings[0], id: 'other-node', nodeId: sample.nodes[0].id },
      ],
    });
    const destination = createBehaviorDemo('behaviors-cashier-busy');
    const existing = getBehaviorLibrary(destination);
    // Both diagrams have a pool named staff and the destination owns a different definition with the same ID.
    const target = setBehaviorLibrary(destination, {
      definitions: [{ ...existing.definitions[0], id: current.id }],
      bindings: [{ ...existing.bindings[0], definitionId: current.id }],
    });

    const clip = copySelection(source, [work.id]);
    expect(clip.behaviors!.library.bindings.map(({ id }) => id)).toEqual([
      bindings[0].id,
      bindings[1].id,
      'future-binding',
    ]);
    expect(clip.behaviors!.library.definitions.map(({ id }) => id)).toEqual([
      current.id,
      definitions[1].id,
      future.id,
    ]);
    expect(clip.simulation!.model.resources.map(({ id }) => id)).toEqual(['staff']);
    editor().setGraph(target);
    editor().paste(JSON.parse(JSON.stringify(clip)) as Clip);
    const pasted = editor().graph!;
    expect(pasted).not.toBe(target);
    validateGraph(pasted);
    const [copiedNodeId] = editor().selectedNodes;
    const [destinationPool, copiedPool] = pasted.simulation!.resources;
    expect(destinationPool).toMatchObject({ id: 'staff', capacity: 1 });
    expect(copiedPool).toMatchObject({ name: 'Personal', capacity: 2 });
    expect(copiedPool.id).not.toBe(destinationPool.id);
    const pastedLibrary = getBehaviorLibrary(pasted);
    const [existingDefinition, ...copiedDefinitions] = pastedLibrary.definitions;
    expect(existingDefinition).toEqual({ ...existing.definitions[0], id: current.id });
    expect(copiedDefinitions).toEqual(
      [current, definitions[1], future].map((definition) => ({
        ...definition,
        id: expect.any(String),
      })),
    );
    expect(copiedDefinitions[0].id).not.toBe(current.id);
    const [, ...copiedBindings] = pastedLibrary.bindings;
    expect(copiedBindings.map(({ definitionId }) => definitionId)).toEqual(
      copiedDefinitions.map(({ id }) => id),
    );
    expect(
      copiedBindings.map(({ nodeId, parameters, enabled }) => ({ nodeId, parameters, enabled })),
    ).toEqual([
      { nodeId: copiedNodeId, parameters: { receiver: copiedNodeId }, enabled: true },
      { nodeId: copiedNodeId, parameters: { staffing: copiedPool.id }, enabled: true },
      { nodeId: copiedNodeId, parameters: opaque, enabled: true },
    ]);
  });

  it('keeps an outside node reference within its diagram and prevents a cross-diagram match by ID', () => {
    const sample = createBehaviorDemo('behaviors-editor');
    const [host, outside] = sample.nodes;
    const [original] = getBehaviorLibrary(sample).definitions;
    const definition = { ...original, source: `parameter neighbor as node\n${original.source}` };
    const source = setBehaviorLibrary(sample, {
      definitions: [definition],
      bindings: [
        {
          id: 'binding',
          definitionId: definition.id,
          nodeId: host.id,
          enabled: true,
          parameters: { neighbor: outside.id, nextName: outside.id },
        },
      ],
    });
    const clip = copySelection(source, [host.id]);
    expect(pasteSelection(clip, source).behaviors!.bindings.at(-1)).toMatchObject({
      enabled: true,
      parameters: { neighbor: outside.id, nextName: outside.id },
    });

    const target = blankGraph('Other diagram');
    target.nodes = [{ ...outside, diagramId: target.diagram.id }];
    const [copied] = pasteSelection(clip, target).behaviors!.bindings;
    expect(copied.enabled).toBe(false);
    expect(copied.parameters).toEqual({ nextName: outside.id });
  });

  it('rejects an unselected host and an over-capacity merge before changing the graph', () => {
    const source = createBehaviorDemo('behaviors-cashier');
    const work = source.simulation!.nodes.find((node) => node.type === 'work')!;
    const clip = copySelection(source, [work.id]);
    const invalid = structuredClone(clip);
    invalid.behaviors!.library.bindings[0].nodeId = source.nodes[0].id;
    const destination = createBehaviorDemo('behaviors-cashier');
    const [definition] = getBehaviorLibrary(destination).definitions;
    const definitions: BehaviorDefinition[] = Array.from(
      { length: behaviorDocumentLimits.definitions },
      (_, index) => ({ ...definition, id: `definition-${index}` }),
    );
    const target = setBehaviorLibrary(destination, { definitions, bindings: [] });
    editor().setGraph(target);
    editor().select([target.nodes[0].id]);

    editor().paste(invalid);
    expect(editor().commandError).toMatch(/clipboard binding refers to a missing node/);
    editor().paste(clip);
    expect(editor().commandError).toMatch(/Invalid Behavior library/);
    expect(editor().graph).toBe(target);
    expect(editor().selectedNodes).toEqual([target.nodes[0].id]);
    expect(editor().history).toEqual([]);
  });
});
