import { describe, expect, expectTypeOf, it } from 'vitest';
import { createBehaviorDemo } from '../src/behaviors/demo';
import { getBehaviorLibrary, setBehaviorLibrary } from '../src/behaviors/document';
import { evaluateConnectionBehaviors } from '../src/behaviors/editor';
import {
  compileBehavior,
  compilePreviewBehavior,
  runBehavior,
  type BehaviorAction,
  type BehaviorBindings,
  type BehaviorEditorAction,
  type BehaviorSimulationAction,
} from '../src/behaviors/language';
import { behaviorLanguageContract } from '../src/behaviors/language-contract';
import { isValidNodeTitle, newEdge } from '../src/model/types';
import { captureSimulationBehaviors } from '../src/simulation/behaviors';
import { SimulationEngine } from '../src/simulation/engine';
import { BehaviorMessageHost } from './helpers/behavior-message-host';

const reviewRecipe = `parameter reviewTitle as text = "Review dispatch"
parameter nextStatus as text = "in-progress"

on connectionAdded
  rename event.target to reviewTitle
  set status of event.target to nextStatus
end`;

const intakeRecipe = `parameter checkout as node
parameter wait as number = 2
property rises as number = 0

on queueChanged
  if queue.previousLength < queue.length then
    set rises to rises + 1
    if rises == 2 then
      send "reserve please" to node checkout after wait + 1
    end if
  end if
end`;

const checkoutRecipe = `parameter staffing as resource
property requests as number = 0

on "reserve please"
  set requests to requests + 1
  open reserve slot using resource staffing
end`;

const connection = {
  kind: 'connectionAdded',
  source: 'dispatch',
  target: 'review',
  edgeId: 'dispatch-review',
} as const;

function compileRecipe(source: string, version = 2) {
  const result = compileBehavior(source, version);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.program;
}

type EditedNode = { id: string; title: string; status: string };

function commitReview(node: EditedNode, actions: readonly BehaviorAction[]) {
  let next = node;
  for (const action of actions) {
    const { line, column } = action;
    if (action.nodeId !== node.id) return { outcome: 'target-denied', node, line, column };
    if (action.kind === 'rename' && isValidNodeTitle(action.title)) {
      next = { ...next, title: action.title };
    } else if (action.kind === 'setStatus') {
      next = { ...next, status: action.status };
    } else {
      return { outcome: 'action-denied', node, line, column };
    }
  }
  return { outcome: 'applied', node: next };
}

type CheckoutSnapshot = {
  version: number;
  sources: Record<'intake' | 'checkout', string>;
  bindings: { nodeId: string; definition: 'intake' | 'checkout'; parameters: BehaviorBindings }[];
  queueChanges: { atMs: number; nodeId: string; previous: number; current: number }[];
};

const checkoutSnapshot: CheckoutSnapshot = {
  version: 2,
  sources: { intake: intakeRecipe, checkout: checkoutRecipe },
  bindings: [
    { nodeId: 'intake-a', definition: 'intake', parameters: { checkout: 'north' } },
    { nodeId: 'intake-b', definition: 'intake', parameters: { checkout: 'south', wait: 0 } },
    { nodeId: 'north', definition: 'checkout', parameters: { staffing: 'shared-staff' } },
    { nodeId: 'south', definition: 'checkout', parameters: { staffing: 'shared-staff' } },
  ],
  queueChanges: [
    { atMs: 0, nodeId: 'intake-a', previous: 0, current: 1 },
    { atMs: 1_000, nodeId: 'intake-a', previous: 1, current: 2 },
    { atMs: 2_000, nodeId: 'intake-b', previous: 0, current: 1 },
    { atMs: 3_000, nodeId: 'intake-b', previous: 1, current: 2 },
  ],
};

type Allocation = {
  atMs: number;
  action: Extract<BehaviorSimulationAction, { kind: 'openReserve' }>;
  outcome: 'opened' | 'staff-busy';
};

function runCheckout(snapshot: CheckoutSnapshot) {
  const programs = {
    intake: compileRecipe(snapshot.sources.intake, snapshot.version),
    checkout: compileRecipe(snapshot.sources.checkout, snapshot.version),
  };
  const allocations: Allocation[] = [];
  let staffAvailable = true;
  const host = new BehaviorMessageHost(
    snapshot.bindings.map(({ definition, ...binding }) => ({
      ...binding,
      program: programs[definition],
    })),
    {},
    {
      resourceExists: (id) => id === 'shared-staff',
      reserve: (action, atMs) => {
        allocations.push({ action, atMs, outcome: staffAvailable ? 'opened' : 'staff-busy' });
        staffAvailable = false;
      },
    },
  );
  for (const { atMs, nodeId, previous, current } of snapshot.queueChanges) {
    host.advance(atMs);
    host.queueChanged(nodeId, previous, current);
  }
  host.advance(3_999);
  const beforeDelivery = { pending: host.pendingCount, allocations: [...allocations] };
  host.finish(4_000);
  return {
    beforeDelivery,
    allocations,
    trace: host.trace,
    states: snapshot.bindings.map(({ nodeId }) => [nodeId, host.instanceState(nodeId)]),
  };
}

describe('Visual Nerve Script v2 recipe conformance', () => {
  it('registers the exact v2 extension without changing the preview language', () => {
    const development = behaviorLanguageContract(2);
    const preview = behaviorLanguageContract(1);
    if (!development || !preview) throw new Error('Missing the language contract');
    const previewSend = preview.actions.send;
    if (!previewSend) throw new Error('Missing the preview send action');
    expect(Object.keys(development.actions).sort()).toEqual([
      'openReserve',
      'rename',
      'send',
      'setStatus',
    ]);
    expect(development.actions.setStatus).toEqual({
      syntax: 'set status of target to status',
      events: ['connectionAdded'],
      arguments: { target: 'node', status: 'text' },
      unavailable: 'Set status is only available in connectionAdded.',
    });
    expect(development.actions.send).toEqual({
      ...previewSend,
      syntax: 'send "message name" to node target [after seconds]',
      optionalArguments: { seconds: 'number' },
    });
    expect(development.events).toEqual(preview.events);
    expect(development.parameterTypes).toEqual(['text', 'number', 'boolean', 'node', 'resource']);
    expect(development.properties).toEqual({
      context: 'simulation',
      types: ['text', 'number', 'boolean'],
      limit: 16,
    });
    expect(development.repeatCount).toBe(32);
    expect(development.delayedSendSeconds).toBe(86_400);
    expect(preview.actions.setStatus).toBeUndefined();
    expect(previewSend.optionalArguments).toBeUndefined();
    expectTypeOf<BehaviorEditorAction['kind']>().toEqualTypeOf<'rename' | 'setStatus'>();
    expectTypeOf<BehaviorSimulationAction['kind']>().toEqualTypeOf<'send' | 'openReserve'>();
  });

  it('proposes an ordered rename and status update that the editor test host commits together', () => {
    const program = compileRecipe(reviewRecipe);
    const before = Object.freeze({ id: 'review', title: 'Review', status: 'planned' });
    expect(program.contexts).toEqual(['editor']);
    const result = runBehavior(program, {}, connection);
    expect(result).toEqual({
      ok: true,
      actions: [
        { kind: 'rename', nodeId: 'review', title: 'Review dispatch', line: 5, column: 3 },
        { kind: 'setStatus', nodeId: 'review', status: 'in-progress', line: 6, column: 3 },
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(commitReview(before, result.actions)).toEqual({
      outcome: 'applied',
      node: { id: 'review', title: 'Review dispatch', status: 'in-progress' },
    });
    expect(before).toEqual({ id: 'review', title: 'Review', status: 'planned' });
    expect(runBehavior(program, { nextStatus: '' }, connection)).toMatchObject({
      ok: true,
      actions: [{ kind: 'rename' }, { kind: 'setStatus', status: '' }],
    });
  });

  it('reports status type and context errors and lets the editor test host deny a target atomically', () => {
    expect(
      compileBehavior('on connectionAdded\n  set status of event.target to 7\nend', 2),
    ).toMatchObject({
      ok: false,
      error: { code: 'type', line: 2, column: 33 },
    });
    expect(
      compileBehavior('on queueChanged\n  set status of event.target to "done"\nend', 2),
    ).toEqual({
      ok: false,
      error: {
        code: 'context',
        line: 2,
        column: 3,
        message: 'Set status is only available in connectionAdded.',
      },
    });
    const before = Object.freeze({ id: 'review', title: 'Review', status: 'planned' });
    const wrongTarget = reviewRecipe.replace(
      'set status of event.target',
      'set status of event.source',
    );
    const result = runBehavior(compileRecipe(wrongTarget), {}, connection);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(commitReview(before, result.actions)).toEqual({
      outcome: 'target-denied',
      node: before,
      line: 6,
      column: 3,
    });
    expect(before).toEqual({ id: 'review', title: 'Review', status: 'planned' });
  });

  it('replays combined instance properties and delayed shared-staff requests from a serialized snapshot', () => {
    const live = structuredClone(checkoutSnapshot);
    const captured = JSON.parse(JSON.stringify(live)) as CheckoutSnapshot;
    const result = runCheckout(live);
    expect(result.beforeDelivery).toEqual({ pending: 2, allocations: [] });
    expect(result.trace).toMatchObject([
      {
        kind: 'send',
        atMs: 1_000,
        dueAtMs: 4_000,
        causeId: 2,
        messageId: 1,
        sourceNodeId: 'intake-a',
        targetNodeId: 'north',
        name: 'reserve please',
        line: 9,
        column: 7,
      },
      {
        kind: 'send',
        atMs: 3_000,
        dueAtMs: 4_000,
        causeId: 4,
        messageId: 2,
        sourceNodeId: 'intake-b',
        targetNodeId: 'south',
        name: 'reserve please',
        line: 9,
        column: 7,
      },
      { kind: 'delivery', atMs: 4_000, messageId: 1, targetNodeId: 'north', outcome: 'handled' },
      { kind: 'delivery', atMs: 4_000, messageId: 2, targetNodeId: 'south', outcome: 'handled' },
    ]);
    expect(result.allocations).toEqual([
      {
        atMs: 4_000,
        outcome: 'opened',
        action: {
          kind: 'openReserve',
          nodeId: 'north',
          resourceId: 'shared-staff',
          line: 6,
          column: 3,
        },
      },
      {
        atMs: 4_000,
        outcome: 'staff-busy',
        action: {
          kind: 'openReserve',
          nodeId: 'south',
          resourceId: 'shared-staff',
          line: 6,
          column: 3,
        },
      },
    ]);
    expect(result.states).toEqual([
      ['intake-a', { rises: 2 }],
      ['intake-b', { rises: 2 }],
      ['north', { requests: 1 }],
      ['south', { requests: 1 }],
    ]);

    live.sources.intake = live.sources.intake.replace('rises as number = 0', 'rises as number = 2');
    live.bindings[0].parameters = { checkout: 'south' };
    expect(runCheckout(live).allocations).toEqual([]);
    expect(runCheckout(captured)).toEqual(result);
  });

  it('leaves state and allocation unchanged for a delivered request with an unavailable resource', () => {
    const invalid = structuredClone(checkoutSnapshot);
    invalid.bindings[3].parameters = { staffing: 'missing-staff' };
    const result = runCheckout(invalid);
    expect(result.allocations).toHaveLength(1);
    expect(result.states).toContainEqual(['south', { requests: 0 }]);
    expect(result.trace.at(-1)).toMatchObject({
      kind: 'error',
      nodeId: 'south',
      atMs: 4_000,
      parentMessageId: 2,
      diagnostic: {
        code: 'binding',
        line: 1,
        column: 11,
        message: 'The resource for "staffing" is unavailable.',
      },
    });
  });

  it('keeps valid v2 recipes inactive at both real staging host boundaries', () => {
    expect(compileBehavior(reviewRecipe)).toMatchObject({ ok: false, error: { code: 'syntax' } });
    expect(compileBehavior(reviewRecipe, 2)).toMatchObject({ ok: true, program: { version: 2 } });
    expect(compilePreviewBehavior(reviewRecipe, 2)).toMatchObject({
      ok: false,
      error: { code: 'version', line: 1, column: 1 },
    });

    const editor = createBehaviorDemo('behaviors-editor');
    const [source, , target] = editor.nodes;
    const definition = {
      ...getBehaviorLibrary(editor).definitions[0],
      source: reviewRecipe,
      version: 2,
    };
    const graph = setBehaviorLibrary(editor, {
      definitions: [definition],
      bindings: [
        {
          id: 'imported',
          definitionId: definition.id,
          nodeId: source.id,
          enabled: true,
          parameters: {},
        },
      ],
    });
    const proposed = evaluateConnectionBehaviors(
      graph,
      newEdge(graph.diagram.id, source.id, target.id),
    );
    expect(proposed.nodes).toBe(graph.nodes);
    expect(proposed.trace).toMatchObject([
      { outcome: 'rejected', code: 'version', line: 1, column: 1 },
    ]);

    const simulation = createBehaviorDemo('behaviors-cashier');
    const captured = captureSimulationBehaviors(simulation);
    if (!simulation.simulation || !captured) throw new Error('Missing captured staging model');
    expect(
      () => new SimulationEngine(simulation.simulation!, { behaviors: captured }),
    ).not.toThrow();
    captured.definitions[0] = { ...captured.definitions[0], source: intakeRecipe, version: 2 };
    expect(() => new SimulationEngine(simulation.simulation!, { behaviors: captured })).toThrow(
      /\(1:1\): Behavior language version 2 is not supported/u,
    );
  });
});
