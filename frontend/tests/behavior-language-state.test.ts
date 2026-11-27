import { describe, expect, it } from 'vitest';
import {
  compileBehavior,
  createBehaviorBudget,
  createBehaviorInstanceState,
  runBehavior,
  type BehaviorBindings,
  type BehaviorProgram,
  type BehaviorSimulationEvent,
} from '../src/behaviors/language';
import { behaviorLanguageContract } from '../src/behaviors/language-contract';

const counterSource = `property count as number = 0
parameter receiver as node

on queueChanged
  set count to count + 1
  if count == 2 then
    send "second change" to node receiver
  end if
end`;

const queueChange = (nodeId: string, previous = 0): BehaviorSimulationEvent => ({
  kind: 'queueChanged',
  nodeId,
  previous,
  current: previous + 1,
});

function compile(source: string, version = 2): BehaviorProgram {
  const result = compileBehavior(source, version);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.program;
}

type State = ReturnType<typeof createBehaviorInstanceState>;

function execute(
  program: BehaviorProgram,
  bindings: BehaviorBindings,
  event: BehaviorSimulationEvent,
  state?: State,
) {
  const result = runBehavior(program, bindings, event, state === undefined ? {} : { state });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  if (!result.state) throw new Error('Expected instance state for a program with properties.');
  return { state: result.state, actions: result.actions };
}

function runCounter(
  recipe: {
    source: string;
    version: number;
    bindings: { id: string; receiver: string }[];
  },
  events: { bindingId: string; nodeId: string; previous: number }[],
) {
  const program = compile(recipe.source, recipe.version);
  const instances = new Map(
    recipe.bindings.map(({ id }) => [id, createBehaviorInstanceState(program)]),
  );
  const trace = events.map(({ bindingId, nodeId, previous }) => {
    const binding = recipe.bindings.find(({ id }) => id === bindingId)!;
    const result = execute(
      program,
      { receiver: binding.receiver },
      queueChange(nodeId, previous),
      instances.get(bindingId),
    );
    instances.set(bindingId, result.state);
    return { bindingId, state: result.state, actions: result.actions };
  });
  return { trace, finalStates: [...instances] };
}

describe('Visual Nerve Script v2 instance properties', () => {
  it('initializes typed defaults as separate state records and starts fresh when state is omitted', () => {
    const program = compile(`property count as number = -1
property label as text = "reserve"
property ready as boolean = false
on queueChanged
  set count to count + 1
  set label to "active"
  set ready to true
end`);
    expect(program.properties).toEqual([
      { name: 'count', type: 'number', initialValue: -1, line: 1, column: 10 },
      { name: 'label', type: 'text', initialValue: 'reserve', line: 2, column: 10 },
      { name: 'ready', type: 'boolean', initialValue: false, line: 3, column: 10 },
    ]);
    const initial = Object.freeze(createBehaviorInstanceState(program));
    const independent = createBehaviorInstanceState(program);
    expect(initial).not.toBe(independent);
    expect(initial).toEqual({ count: -1, label: 'reserve', ready: false });
    const expected = { count: 0, label: 'active', ready: true };
    expect(execute(program, {}, queueChange('a'), initial).state).toEqual(expected);
    expect(execute(program, {}, queueChange('a')).state).toEqual(expected);
    expect(execute(program, {}, queueChange('a')).state).toEqual(expected);
    expect(initial).toEqual(independent);
  });

  it('counts per binding and replays the captured recipe independently of later edits or runs', () => {
    const recipe = {
      source: counterSource,
      version: 2,
      bindings: [
        { id: 'binding-a', receiver: 'receiver-a' },
        { id: 'binding-b', receiver: 'receiver-b' },
      ],
    };
    const events = [
      { bindingId: 'binding-a', nodeId: 'source-a', previous: 0 },
      { bindingId: 'binding-b', nodeId: 'source-b', previous: 6 },
      { bindingId: 'binding-b', nodeId: 'source-b', previous: 7 },
      { bindingId: 'binding-a', nodeId: 'source-a', previous: 1 },
      { bindingId: 'binding-a', nodeId: 'source-a', previous: 2 },
    ];
    const captured = JSON.parse(JSON.stringify({ recipe, events })) as {
      recipe: typeof recipe;
      events: typeof events;
    };
    const first = runCounter(recipe, events);
    expect(first.trace.map(({ state }) => state.count)).toEqual([1, 1, 2, 2, 3]);
    expect(first.trace.map(({ actions }) => actions)).toEqual([
      [],
      [],
      [{ kind: 'send', nodeId: 'receiver-b', message: 'second change', line: 7, column: 5 }],
      [{ kind: 'send', nodeId: 'receiver-a', message: 'second change', line: 7, column: 5 }],
      [],
    ]);
    expect(first.finalStates).toEqual([
      ['binding-a', { count: 3 }],
      ['binding-b', { count: 2 }],
    ]);
    recipe.source = recipe.source.replace('number = 0', 'number = 8');
    expect(runCounter(recipe, events).trace[0].state.count).toBe(9);
    expect(runCounter(captured.recipe, captured.events)).toEqual(first);
  });

  it('keeps the supplied state when a matching handler is absent', () => {
    const program = compile(counterSource);
    const state = Object.freeze({ count: 5 });
    expect(
      execute(program, {}, { kind: 'message', name: 'unhandled', source: 'a', target: 'b' }, state),
    ).toEqual({ actions: [], state });
    expect(state).toEqual({ count: 5 });
  });

  it.each<{ label: string; state: State }>([
    { label: 'missing property', state: {} },
    { label: 'wrong type', state: { count: '5' } },
    { label: 'unsafe number', state: { count: Number.MAX_SAFE_INTEGER + 1 } },
  ])('rejects an explicit state with $label', ({ state }) => {
    const program = compile(counterSource);
    expect(runBehavior(program, { receiver: 'b' }, queueChange('a'), { state })).toMatchObject({
      ok: false,
      error: { code: 'binding', line: 1, column: 10 },
    });
  });

  it('bounds the text stored in a supplied snapshot and ignores undeclared keys', () => {
    const program = compile('property title as text = "Initial"\non queueChanged\nend');
    const textLimit = behaviorLanguageContract(2)!.limits.sourceLength;
    const state = Object.freeze({ title: 'a'.repeat(textLimit), transient: true });
    expect(execute(program, {}, queueChange('a'), state).state).toEqual({ title: state.title });
    expect(state.transient).toBe(true);
    expect(
      runBehavior(program, {}, queueChange('a'), { state: { title: 'a'.repeat(textLimit + 1) } }),
    ).toMatchObject({ ok: false, error: { code: 'binding', line: 1, column: 10 } });
  });

  it('bounds the number of declarations to 16 properties', () => {
    expect(behaviorLanguageContract(2)?.properties).toEqual({
      context: 'simulation',
      types: ['text', 'number', 'boolean'],
      limit: 16,
    });
    const properties = Array.from({ length: 16 }, (_, index) => `property p${index} as number = 0`);
    const handler = ['on queueChanged', 'end'];
    expect(compile([...properties, ...handler].join('\n')).properties).toHaveLength(16);
    expect(
      compileBehavior([...properties, 'property overflow as number = 0', ...handler].join('\n'), 2),
    ).toMatchObject({ ok: false, error: { code: 'limit', line: 17, column: 1 } });
  });

  it('allows a mixed-context definition with property access limited to its simulation handlers', () => {
    const source = `property count as number = 0
on connectionAdded
  rename event.target to "Renamed"
end
on queueChanged
  set count to count + 1
end`;
    const program = compile(source);
    expect(program.contexts).toEqual(['editor', 'simulation']);
    expect(
      runBehavior(
        program,
        {},
        { kind: 'connectionAdded', edgeId: 'edge', source: 'a', target: 'b' },
      ),
    ).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'b', title: 'Renamed', line: 3, column: 3 }],
    });
    expect(execute(program, {}, queueChange('a')).state).toEqual({ count: 1 });
    expect(compileBehavior(source, 1)).toMatchObject({
      ok: false,
      error: { code: 'syntax', line: 1, column: 1 },
    });
  });

  it.each([
    {
      source: 'property watched as node = "a"\non queueChanged\nend',
      code: 'type',
      line: 1,
      column: 21,
    },
    {
      source: 'property total as number\non queueChanged\nend',
      code: 'syntax',
      line: 1,
      column: 25,
    },
    {
      source: 'property total as number = "wrong"\non queueChanged\nend',
      code: 'type',
      line: 1,
      column: 28,
    },
    {
      source: 'property total as number = 0\non queueChanged\n  set total to "wrong"\nend',
      code: 'type',
      line: 3,
      column: 16,
    },
    {
      source:
        'property title as text = "A"\non connectionAdded\n  rename event.target to title\nend',
      code: 'context',
      line: 3,
      column: 26,
    },
    {
      source: 'property total as number = 0\non connectionAdded\n  set total to 1\nend',
      code: 'context',
      line: 3,
      column: 7,
    },
  ])(
    'locates $code at $line:$column in property declarations or access',
    ({ source, code, line, column }) => {
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code, line, column },
      });
    },
  );

  it('discards staged writes and proposals when safe-integer addition fails', () => {
    const program = compile(`property count as number = 0
parameter receiver as node
on queueChanged
  set count to count + 1
  send "staged" to node receiver
  set count to count + 9007199254740991
end`);
    const initial = Object.freeze({ count: 0 });
    const result = runBehavior(program, { receiver: 'b' }, queueChange('a'), { state: initial });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'type', line: 6, column: 24 }),
    });
    expect(initial).toEqual({ count: 0 });
  });

  it('discards staged writes and proposals when a handler exceeds its action budget', () => {
    const actionCap = behaviorLanguageContract(2)!.limits.actionsPerHandler;
    const sends = Array.from({ length: actionCap + 1 }, () => '  send "staged" to node receiver');
    const program = compile(
      [
        'property count as number = 0',
        'parameter receiver as node',
        'on queueChanged',
        '  set count to count + 1',
        ...sends,
        'end',
      ].join('\n'),
    );
    const initial = Object.freeze({ count: 4 });
    const result = runBehavior(program, { receiver: 'b' }, queueChange('a'), { state: initial });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'limit', line: actionCap + 5, column: 3 }),
    });
    expect(initial).toEqual({ count: 4 });
  });

  it('discards staged state when the final message budget check refuses a send', () => {
    const program = compile(counterSource);
    const state = Object.freeze({ count: 1 });
    const budget = createBehaviorBudget();
    const depth = behaviorLanguageContract(2)!.limits.messageDepth;
    const bindings = { receiver: 'b' };
    const event = queueChange('a');
    const result = runBehavior(program, bindings, event, { state, budget, depth });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'limit', line: 7, column: 5 }),
    });
    expect(state).toEqual({ count: 1 });
    expect(runBehavior(program, bindings, event, { state, budget })).toEqual({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'b', message: 'second change', line: 7, column: 5 }],
      state: { count: 2 },
    });
  });

  it('keeps committed state after the host normally denies an action proposal', () => {
    const program = compile(`property attempts as number = 0
parameter staffing as resource
on "open"
  set attempts to attempts + 1
  open reserve slot using resource staffing
end`);
    const event = { kind: 'message', name: 'open', source: 'queue', target: 'checkout' } as const;
    let state = createBehaviorInstanceState(program);
    const reserveDecisions = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = execute(program, { staffing: 'staff' }, event, state);
      state = result.state;
      reserveDecisions.push(...result.actions.map((action) => ({ action, outcome: 'staff-busy' })));
    }
    expect(reserveDecisions).toEqual(
      Array.from({ length: 2 }, () => ({
        action: {
          kind: 'openReserve',
          nodeId: 'checkout',
          resourceId: 'staff',
          line: 5,
          column: 3,
        },
        outcome: 'staff-busy',
      })),
    );
    expect(state).toEqual({ attempts: 2 });
  });
});
