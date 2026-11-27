import { describe, expect, it } from 'vitest';
import { createBehaviorDemo, type BehaviorDemo } from '../src/behaviors/demo';
import { bindBehavior, getBehaviorLibrary } from '../src/behaviors/document';
import { evaluateConnectionBehaviors } from '../src/behaviors/editor';
import { behaviorLanguageContract } from '../src/behaviors/language-contract';
import {
  BEHAVIOR_PREVIEW_VERSION,
  behaviorHandlerLocation,
  compileBehavior,
  createBehaviorBudget,
  runBehavior,
  type BehaviorAction,
  type BehaviorBindings,
  type BehaviorEvent,
  type BehaviorProgram,
} from '../src/behaviors/language';
import { newEdge } from '../src/model/types';
import { captureSimulationBehaviors } from '../src/simulation/behaviors';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import type { SimulationBehaviorSnapshot, SimulationBehaviorTrace } from '../src/simulation/types';

// Freeze the source shipped in the staging recipes independently of future demo edits.
const rename = {
  name: 'Namnge nästa nod',
  version: 1,
  source: `parameter nextName as text = "Kvalitetskontroll"

on connectionAdded
  rename event.target to nextName
end`,
};
const threshold = {
  name: 'Kötröskel',
  version: 1,
  source: `parameter threshold as number = 15
parameter receiver as node

on queueChanged
  if queue.previousLength <= threshold and queue.length > threshold then
    send "öppna" to node receiver
  end if
end`,
};
const reserve = {
  name: 'Öppna reservkassa',
  version: 1,
  source: `parameter staffing as resource

on "öppna"
  open reserve slot using resource staffing
end`,
};

const connection = {
  kind: 'connectionAdded',
  edgeId: 'edge',
  source: 'source',
  target: 'target',
} as const;
const crossing = { kind: 'queueChanged', nodeId: 'watch', previous: 15, current: 16 } as const;
const delivery = { kind: 'message', name: 'öppna', source: 'watch', target: 'checkout' } as const;

function compilePreview(source: string): BehaviorProgram {
  const result = compileBehavior(source, 1);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.program;
}

type TestBinding = { nodeId: string; program: BehaviorProgram; parameters: BehaviorBindings };

function createTestHost(bindings: readonly TestBinding[]) {
  const titles = new Map([
    ['source', 'Källa A'],
    ['target', 'Mål A'],
    ['watch', 'Kö'],
    ['checkout', 'Kassor'],
  ]);
  const actions: BehaviorAction[] = [];
  const reserveRequests = new Map<string, string>();
  const budget = createBehaviorBudget();

  function dispatch(nodeId: string, event: BehaviorEvent) {
    const events = [{ nodeId, event, depth: 0 }];
    for (const pending of events) {
      for (const binding of bindings.filter((item) => item.nodeId === pending.nodeId)) {
        const result = runBehavior(binding.program, binding.parameters, pending.event, {
          budget,
          depth: pending.depth,
          timeSeconds: 0,
          nodeExists: (id) => titles.has(id),
          resourceExists: (id) => id === 'staff',
        });
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        for (const action of result.actions) {
          actions.push(action);
          switch (action.kind) {
            case 'rename':
              titles.set(action.nodeId, action.title);
              break;
            case 'openReserve':
              reserveRequests.set(action.nodeId, action.resourceId);
              break;
            case 'send':
              events.push({
                nodeId: action.nodeId,
                depth: pending.depth + 1,
                event: {
                  kind: 'message',
                  name: action.message,
                  source: pending.nodeId,
                  target: action.nodeId,
                },
              });
              break;
          }
        }
      }
    }
  }

  return { dispatch, titles, actions, reserveRequests };
}

function checkoutTrace(
  snapshot: SimulationBehaviorSnapshot,
  nodeId: string,
  busy: boolean,
): SimulationBehaviorTrace[] {
  const [watch, cashier] = snapshot.bindings;
  const queue = (
    sequence: number,
    eventSequence: number,
    timeSeconds: number,
    previousLength: number,
    length: number,
  ): SimulationBehaviorTrace => ({
    kind: 'queueChanged',
    sequence,
    eventSequence,
    timeSeconds,
    nodeId,
    phase: 5,
    bindingId: watch.id,
    definitionId: watch.definitionId,
    line: 4,
    column: 1,
    previousLength,
    length,
  });
  const message = { nodeId, phase: 5, timeSeconds: 0, messageId: 1 };
  const receiver = {
    ...message,
    bindingId: cashier.id,
    definitionId: cashier.definitionId,
    eventSequence: 70,
  };
  return [
    ...Array.from({ length: 16 }, (_, index) => queue(index + 1, index + 54, 0, index, index + 1)),
    {
      ...message,
      kind: 'send',
      sequence: 17,
      eventSequence: 69,
      bindingId: watch.id,
      definitionId: watch.definitionId,
      line: 6,
      column: 5,
      targetNodeId: nodeId,
      message: 'öppna',
    },
    {
      ...receiver,
      kind: 'message',
      sequence: 18,
      line: 3,
      column: 1,
      sourceNodeId: nodeId,
      message: 'öppna',
    },
    {
      ...receiver,
      kind: 'reserve',
      sequence: 19,
      line: 4,
      column: 3,
      resourceId: 'staff',
      ...(busy ? { decision: 'staff-busy' } : { decision: 'opened-and-allocated', particleId: 2 }),
    },
    ...(busy
      ? [queue(20, 73, 60, 16, 15)]
      : [queue(20, 71, 0, 16, 15), queue(21, 76, 60, 15, 14), queue(22, 78, 60, 14, 13)]),
  ];
}

describe('Visual Nerve Script staging v1 compatibility', () => {
  it('retains the saved source, language level, typed parameters and handler source positions', () => {
    expect(BEHAVIOR_PREVIEW_VERSION).toBe(1);
    const savedEditor = getBehaviorLibrary(createBehaviorDemo('behaviors-editor')).definitions;
    const savedCheckout = getBehaviorLibrary(createBehaviorDemo('behaviors-cashier')).definitions;
    expect(savedEditor).toEqual([{ id: expect.any(String), ...rename }]);
    expect(savedCheckout).toEqual([
      { id: expect.any(String), ...threshold },
      { id: expect.any(String), ...reserve },
    ]);
    for (const { source, version } of [...savedEditor, ...savedCheckout]) {
      expect(compileBehavior(source)).toEqual(compileBehavior(source, version));
    }
    const editor = compilePreview(rename.source);
    const queue = compilePreview(threshold.source);
    const receiver = compilePreview(reserve.source);
    expect([editor.version, queue.version, receiver.version]).toEqual([1, 1, 1]);
    expect([editor.contexts, queue.contexts, receiver.contexts]).toEqual([
      ['editor'],
      ['simulation'],
      ['simulation'],
    ]);
    expect([editor.parameters, queue.parameters, receiver.parameters]).toEqual([
      [{ name: 'nextName', type: 'text', defaultValue: 'Kvalitetskontroll', line: 1, column: 11 }],
      [
        { name: 'threshold', type: 'number', defaultValue: 15, line: 1, column: 11 },
        { name: 'receiver', type: 'node', line: 2, column: 11 },
      ],
      [{ name: 'staffing', type: 'resource', line: 1, column: 11 }],
    ]);
    expect(behaviorHandlerLocation(editor, connection)).toEqual({ line: 3, column: 1 });
    expect(behaviorHandlerLocation(queue, crossing)).toEqual({ line: 4, column: 1 });
    expect(behaviorHandlerLocation(receiver, delivery)).toEqual({ line: 3, column: 1 });
  });

  it('produces the exact typed actions on controlled editor and simulation hosts', () => {
    const host = createTestHost([
      { nodeId: 'source', program: compilePreview(rename.source), parameters: {} },
      {
        nodeId: 'watch',
        program: compilePreview(threshold.source),
        parameters: { receiver: 'checkout' },
      },
      {
        nodeId: 'checkout',
        program: compilePreview(reserve.source),
        parameters: { staffing: 'staff' },
      },
    ]);
    host.dispatch('source', connection);
    host.dispatch('watch', { ...crossing, previous: 14, current: 15 });
    host.dispatch('watch', crossing);
    host.dispatch('watch', { ...crossing, previous: 16, current: 17 });
    expect(host.actions).toEqual([
      { kind: 'rename', nodeId: 'target', title: 'Kvalitetskontroll', line: 4, column: 3 },
      { kind: 'send', nodeId: 'checkout', message: 'öppna', line: 6, column: 5 },
      { kind: 'openReserve', nodeId: 'checkout', resourceId: 'staff', line: 4, column: 3 },
    ]);
    expect(host.titles.get('target')).toBe('Kvalitetskontroll');
    expect([...host.reserveRequests]).toEqual([['checkout', 'staff']]);
  });

  it('preserves the editor rename outcome and recorded source position', () => {
    const demo = createBehaviorDemo('behaviors-editor');
    const [source, , target] = demo.nodes;
    const [definition] = getBehaviorLibrary(demo).definitions;
    const graph = bindBehavior(demo, source.id, definition.id);
    const [binding] = getBehaviorLibrary(graph).bindings;
    const edge = newEdge(graph.diagram.id, source.id, target.id);
    const actual = evaluateConnectionBehaviors(graph, edge);
    expect(actual.nodes.find(({ id }) => id === target.id)?.title).toBe('Kvalitetskontroll');
    expect(actual.trace).toEqual([
      {
        definitionName: 'Namnge nästa nod',
        bindingId: binding.id,
        edgeId: edge.id,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        previousName: 'Mål A',
        proposedName: 'Kvalitetskontroll',
        outcome: 'renamed',
        message: 'Renamed the target node.',
        line: 4,
        column: 3,
      },
    ]);
  });

  it.each([
    { demo: 'behaviors-cashier', completed: 2, capacity: 2 },
    { demo: 'behaviors-cashier-busy', completed: 1, capacity: 1 },
    { demo: 'behaviors-cashier-off', completed: 1, capacity: 1 },
  ] satisfies { demo: BehaviorDemo; completed: number; capacity: number }[])(
    'preserves the exact saved checkout trace for $demo and replay',
    ({ demo, completed, capacity }) => {
      const graph = createBehaviorDemo(demo);
      const model = graph.simulation;
      const snapshot = captureSimulationBehaviors(graph);
      if (!model || !snapshot) throw new Error('Missing captured checkout recipe');
      const checkout = model.nodes.find(({ type }) => type === 'work');
      if (!checkout) throw new Error('Missing checkout Work node');
      const options = { behaviors: snapshot, runId: 'checkout-v1' };
      const result = runSimulation(model, options);
      expect(result).toMatchObject({
        status: 'completed',
        timeSeconds: 75,
        metrics: { completed, scalingCost: 0 },
        finalCapacities: { [checkout.id]: capacity },
      });
      expect(result.behaviorTrace).toEqual(
        demo === 'behaviors-cashier-off'
          ? []
          : checkoutTrace(snapshot, checkout.id, demo === 'behaviors-cashier-busy'),
      );
      const recorded = structuredClone({ model, options });
      const replay = new SimulationEngine(recorded.model, recorded.options);
      replay.advance(1);
      replay.advance(60);
      replay.advance(75);
      expect(replay.result()).toEqual(result);
    },
  );

  it.each([
    {
      source: rename.source.replace('\nend', ''),
      error: {
        code: 'syntax',
        line: 4,
        column: 34,
        message: 'Expected "end" before the end of the source.',
      },
    },
    {
      source: rename.source.replace('to nextName', 'to 2'),
      error: { code: 'type', line: 4, column: 26, message: 'Expected a text value.' },
    },
    {
      source: reserve.source.replace('on "öppna"', 'on connectionAdded'),
      error: {
        code: 'context',
        line: 4,
        column: 3,
        message: 'Reserve slots are only available during simulation.',
      },
    },
  ])('keeps exact v1 diagnostic $error.code at $error.line:$error.column', ({ source, error }) => {
    expect(compileBehavior(source, 1)).toEqual({ ok: false, error });
  });

  it('reports the original v1 diagnostic for an unavailable bound node', () => {
    expect(
      runBehavior(compilePreview(threshold.source), { receiver: 'removed' }, crossing, {
        nodeExists: () => false,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'binding',
        line: 2,
        column: 11,
        message: 'The node for "receiver" is unavailable.',
      },
    });
  });

  it('uses the registered action restrictions and diagnostics in the compiler', () => {
    const contract = behaviorLanguageContract(1);
    if (!contract) throw new Error('Missing the staging language contract');
    const cases = [
      ['rename', 'queueChanged', 'rename event.target to "New name"'],
      ['send', 'connectionAdded', 'send "öppna" to node event.target'],
      ['openReserve', 'connectionAdded', 'open reserve slot using resource staffing'],
    ] as const;
    for (const [action, event, statement] of cases) {
      const registered = contract.actions[action];
      if (!registered) throw new Error(`Missing the staging action ${action}`);
      expect(registered.events).not.toContain(event);
      expect(compileBehavior(`${contract.events[event].syntax}\n  ${statement}\nend`, 1)).toEqual({
        ok: false,
        error: { code: 'context', line: 2, column: 3, message: registered.unavailable },
      });
    }
  });

  it('interprets the registered event fields and comparison precedence', () => {
    const contract = behaviorLanguageContract(1);
    if (!contract) throw new Error('Missing the staging language contract');
    expect(contract.events.connectionAdded.fields).toEqual({
      'event.edgeId': 'text',
      'event.source': 'node',
      'event.target': 'node',
    });
    expect(contract.events.queueChanged.fields).toEqual({
      'queue.previousLength': 'number',
      'queue.length': 'number',
    });
    expect(contract.events.message.fields).toEqual({
      'event.source': 'node',
      'event.target': 'node',
    });
    expect(contract.precedence).toEqual([['==', '!=', '<', '<=', '>', '>='], ['and']]);

    const program = compilePreview(`parameter editorSource as node
parameter recipient as node

on connectionAdded
  if event.edgeId == "edge" and event.source == editorSource and event.target != editorSource then
    rename event.target to "Matched edge"
  end if
end

on queueChanged
  if queue.previousLength < queue.length and queue.previousLength <= 15 and queue.length >= 16 and queue.length > 15 then
    send "öppna" to node recipient
  end if
end

on "öppna"
  if event.target == recipient and event.source != recipient then
    send "ack" to node event.source
  end if
end`);
    const parameters = { editorSource: 'source', recipient: 'checkout' };
    expect(runBehavior(program, parameters, connection)).toMatchObject({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Matched edge' }],
    });
    expect(runBehavior(program, parameters, crossing)).toMatchObject({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'checkout', message: 'öppna' }],
    });
    expect(runBehavior(program, parameters, { ...crossing, previous: 16, current: 17 })).toEqual({
      ok: true,
      actions: [],
    });
    expect(runBehavior(program, parameters, delivery)).toMatchObject({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'watch', message: 'ack' }],
    });
  });

  it('rejects an unknown version before interpreting source through the preview grammar', () => {
    for (const source of [rename.source, 'invalid source']) {
      expect(compileBehavior(source, 999)).toEqual({
        ok: false,
        error: { code: 'version', line: 1, column: 1, message: expect.stringContaining('999') },
      });
    }
  });
});
