import { describe, expect, it } from 'vitest';
import { blankGraph, newNode, type Graph, type GraphNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { createNotationGraph, notationTemplates } from '../src/notation/templates';
import { getNotationSymbol } from '../src/notation/registry';
import { addConnectedNode, connectedNodeChoices } from '../src/nodes/connected-node';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import type { NodeNotation, NotationProfile } from '../src/notation/types';

function example(value: NodeNotation, profile?: NotationProfile) {
  const graph = blankGraph('Connected notation');
  graph.diagram.notation = profile;
  const symbol = getNotationSymbol(value.collection, value.symbol)!;
  const anchor = newNode(graph.diagram.id, {
    title: 'Existing design element',
    ...symbol.defaultSize,
    notation: value,
    color: '#456789',
    backgroundColor: '#E4EEE9',
  });
  graph.nodes.push(anchor);
  return { graph, anchor };
}
const addedNode = (result: { graph: Graph; nodeId: string }) =>
  result.graph.nodes.find((node) => node.id === result.nodeId)!;
const choiceId = (node: GraphNode, symbol: string) =>
  `notation:${node.notation!.collection}:${symbol}` as const;

describe('notation-aware connected objects', () => {
  it.each(notationTemplates.map((template) => [template.key]))(
    'creates a valid family-specific next object in %s without copying content',
    (key) => {
      const graph = createNotationGraph(key, 'Editable design')!;
      const anchor = graph.nodes.find((node) => connectedNodeChoices(graph, node.id).length > 0)!;
      expect(anchor).toBeDefined();
      const before = structuredClone(graph);
      const choices = connectedNodeChoices(graph, anchor.id);
      expect(choices.every((choice) => choice.type.startsWith('notation:'))).toBe(true);
      for (const choice of choices) {
        const result = addConnectedNode(graph, anchor.id, choice.type)!;
        const node = addedNode(result),
          definition = getNotationSymbol(node.notation!.collection, node.notation!.symbol)!;
        expect(node.notation!.collection).toBe(anchor.notation!.collection);
        expect(definition.diagramKinds).toContain(node.notation!.diagramKind);
        expect(node).toMatchObject({
          width: Math.max(40, definition.defaultSize.width),
          height: Math.max(30, definition.defaultSize.height),
        });
        expect(node.notation?.compartments?.every((section) => !section.lines.length) ?? true).toBe(
          true,
        );
        expect(node.notation?.attachmentId).toBeUndefined();
        expect(node.notation?.relatedNodeId).toBeUndefined();
        expect(node.notation?.ports).toBeUndefined();
        validateGraph(result.graph);
      }
      expect(graph).toEqual(before);
    },
  );

  it('creates a UML decision instead of duplicating an action and preserves its parent and colors', () => {
    const { graph, anchor } = example({
      collection: 'uml',
      symbol: 'action',
      diagramKind: 'activity',
    });
    const group = newNode(graph.diagram.id, {
      title: 'Activity scope',
      nodeType: 'group',
      width: 900,
      height: 500,
    });
    graph.nodes.unshift(group);
    anchor.parentId = group.id;
    const result = addConnectedNode(graph, anchor.id, choiceId(anchor, 'decision'))!;
    const node = addedNode(result);
    expect(node).toMatchObject({
      title: 'Decision',
      nodeType: 'generic',
      parentId: group.id,
      color: '#456789',
      backgroundColor: '#E4EEE9',
      notation: { collection: 'uml', symbol: 'decision', diagramKind: 'activity' },
    });
    expect(result.graph.edges.at(-1)?.notation).toEqual({
      collection: 'uml',
      symbol: 'control-flow',
    });
    expect(node.title).not.toBe(anchor.title);
    validateGraph(result.graph);
  });

  it('uses fresh empty class compartments and never copies fields or references', () => {
    const { graph, anchor } = example({
      collection: 'uml',
      symbol: 'class',
      diagramKind: 'class',
      properties: { abstract: true, stereotype: 'Entity' },
      compartments: [{ id: 'attributes', title: 'Attributes', lines: ['privateKey: Secret'] }],
      ports: [{ id: 'owned-port', side: 'right' }],
    });
    const result = addConnectedNode(graph, anchor.id, choiceId(anchor, 'class'))!;
    const node = addedNode(result);
    expect(node.notation?.properties).toBeUndefined();
    expect(node.notation?.compartments).toEqual([
      { id: 'section-0', title: 'Attributes', lines: [] },
      { id: 'section-1', title: 'Operations', lines: [] },
    ]);
    expect(node.notation?.compartments).not.toBe(anchor.notation?.compartments);
    expect(result.graph.edges.at(-1)?.notation).toMatchObject({ symbol: 'association' });
    validateGraph(result.graph);
  });

  it('filters by an explicit object family before the document profile', () => {
    const { graph, anchor } = example(
      { collection: 'uml', symbol: 'action', diagramKind: 'activity' },
      { schemaVersion: 1, collection: 'uml', diagramKind: 'class' },
    );
    const choices = connectedNodeChoices(graph, anchor.id);
    expect(choices.some((choice) => choice.type === choiceId(anchor, 'decision'))).toBe(true);
    expect(choices.some((choice) => choice.type === choiceId(anchor, 'class'))).toBe(false);
    expect(addConnectedNode(graph, anchor.id, 'decision')).toBeUndefined();
    expect(addConnectedNode(graph, anchor.id, 'notation:uml:unknown')).toBeUndefined();
  });

  it.each(['dfd-yourdon', 'dfd-gane-sarson'] as const)(
    'keeps %s flows attached to a transformation',
    (collection) => {
      const { graph, anchor } = example({
        collection,
        symbol: 'external-entity',
        diagramKind: 'data-flow',
      });
      expect(
        connectedNodeChoices(graph, anchor.id).map((choice) => choice.notation?.symbol),
      ).toEqual(['process']);
      const result = addConnectedNode(graph, anchor.id)!;
      expect(result.graph.edges.at(-1)?.notation).toEqual({ collection, symbol: 'data-flow' });
      const process = addedNode(result);
      const store = addConnectedNode(result.graph, process.id, choiceId(process, 'data-store'))!;
      expect(addedNode(store).notation?.symbol).toBe('data-store');
      expect(store.graph.edges.at(-1)?.notation).toEqual({ collection, symbol: 'data-flow' });
      validateGraph(store.graph);
    },
  );

  it('distinguishes HIPO hierarchy from a reference to another IPO', () => {
    const vtoc = example({ collection: 'hipo', symbol: 'vtoc-module', diagramKind: 'vtoc' });
    expect(addConnectedNode(vtoc.graph, vtoc.anchor.id)!.graph.edges.at(-1)?.notation).toEqual({
      collection: 'hipo',
      symbol: 'hierarchy',
    });
    const ipo = example({ collection: 'hipo', symbol: 'ipo-chart', diagramKind: 'detail-ipo' });
    const result = addConnectedNode(ipo.graph, ipo.anchor.id, choiceId(ipo.anchor, 'ipo-chart'))!;
    expect(result.graph.edges.at(-1)?.notation).toEqual({
      collection: 'hipo',
      symbol: 'reference',
    });
    expect(addedNode(result).notation?.compartments).toHaveLength(4);
    validateGraph(result.graph);
  });

  it('chooses class realization and orients a stereotype extension towards the metaclass', () => {
    const classifier = example({ collection: 'uml', symbol: 'class', diagramKind: 'class' });
    expect(
      addConnectedNode(
        classifier.graph,
        classifier.anchor.id,
        choiceId(classifier.anchor, 'interface'),
      )!.graph.edges.at(-1)?.notation,
    ).toEqual({ collection: 'uml', symbol: 'realization' });
    const metaclass = example({
      collection: 'uml',
      symbol: 'class',
      diagramKind: 'profile',
      properties: { stereotype: 'metaclass' },
    });
    const result = addConnectedNode(
      metaclass.graph,
      metaclass.anchor.id,
      choiceId(metaclass.anchor, 'stereotype'),
    )!;
    expect(result.graph.edges.at(-1)).toMatchObject({
      sourceNodeId: result.nodeId,
      targetNodeId: metaclass.anchor.id,
      notation: { collection: 'uml', symbol: 'extension' },
    });
    validateGraph(result.graph);
  });

  it('creates sequence flow, data association and receive-task alternatives in the right BPMN contexts', () => {
    const task = example({
      collection: 'bpmn',
      symbol: 'task',
      diagramKind: 'process',
      properties: { taskType: 'service' },
    });
    const end = addConnectedNode(task.graph, task.anchor.id, choiceId(task.anchor, 'end-event'))!;
    expect(end.graph.edges.at(-1)?.notation).toEqual({
      collection: 'bpmn',
      symbol: 'sequence-flow',
    });
    const final = addedNode(end);
    expect(
      connectedNodeChoices(end.graph, final.id).map((choice) => choice.notation?.symbol),
    ).toEqual(['text-annotation']);
    const data = addConnectedNode(
      task.graph,
      task.anchor.id,
      choiceId(task.anchor, 'data-object'),
    )!;
    expect(data.graph.edges.at(-1)?.notation).toEqual({
      collection: 'bpmn',
      symbol: 'data-association',
    });
    const gateway = example({
      collection: 'bpmn',
      symbol: 'event-based-gateway',
      diagramKind: 'process',
    });
    const result = addConnectedNode(
      gateway.graph,
      gateway.anchor.id,
      choiceId(gateway.anchor, 'task'),
    )!;
    expect(addedNode(result).notation?.properties).toEqual({ taskType: 'receive' });
    expect(
      connectedNodeChoices(gateway.graph, gateway.anchor.id).map(
        (choice) => choice.notation?.symbol,
      ),
    ).not.toContain('end-event');
    validateGraph(result.graph);
  });

  it('connects conversations to participants and keeps owner-bound symbols in the palette', () => {
    const { graph, anchor } = example({
      collection: 'bpmn',
      symbol: 'conversation',
      diagramKind: 'conversation',
    });
    expect(connectedNodeChoices(graph, anchor.id).map((choice) => choice.notation?.symbol)).toEqual(
      ['pool'],
    );
    const result = addConnectedNode(graph, anchor.id)!;
    expect(addedNode(result).nodeType).toBe('group');
    expect(result.graph.edges.at(-1)?.notation).toEqual({
      collection: 'bpmn',
      symbol: 'conversation-link',
    });
    const component = example({ collection: 'uml', symbol: 'component', diagramKind: 'component' });
    expect(
      connectedNodeChoices(component.graph, component.anchor.id).map(
        (choice) => choice.notation?.symbol,
      ),
    ).not.toContain('port');
    validateGraph(result.graph);
  });

  it('retains ordinary, mind-map and simulation quick-add behavior without leaking saved notation', () => {
    const graph = blankGraph('Timeline', 'timeline'),
      anchor = newNode(graph.diagram.id);
    graph.nodes.push(anchor);
    expect(connectedNodeChoices(graph, anchor.id).map((choice) => choice.type)).toEqual([
      'timeline',
      'decision',
      'end',
      'note',
    ]);
    expect(addedNode(addConnectedNode(graph, anchor.id, 'decision')!).notation).toBeUndefined();
    graph.diagram.type = 'mindmap';
    expect(connectedNodeChoices(graph, anchor.id)).toEqual([]);
    const simulation = createSimulationGraph('Capacity', createBasicModel({ particles: 1 }));
    const work = simulation.nodes.find((node) => node.externalId === 'work')!;
    work.notation = { collection: 'uml', symbol: 'action', diagramKind: 'activity' };
    const result = addConnectedNode(simulation, work.id, 'work')!;
    expect(addedNode(result).notation).toBeUndefined();
    expect(addedNode(result).nodeType).toBe('process');
    expect(
      connectedNodeChoices(simulation, work.id).some((choice) =>
        choice.type.startsWith('notation:'),
      ),
    ).toBe(false);
    validateGraph(result.graph);
  });
});
