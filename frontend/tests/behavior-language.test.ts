import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_LIMITS,
  behaviorHandlerLocation,
  compileBehavior,
  createBehaviorBudget,
  hasBehaviorHandler,
  runBehavior,
  validateBehaviorBindings,
  type BehaviorEvent,
} from '../src/behaviors/language';

const renameSource = `parameter nextName as text = "Kvalitetskontroll"

on connectionAdded
  rename event.target to nextName
end`;
const queueSource = `parameter threshold as number = 15
parameter receiver as node

on queueChanged
  if queue.previousLength <= threshold and queue.length > threshold then
    send "öppna" to node receiver
  end if
end`;
const reserveSource = `parameter staffing as resource

on "öppna"
  open reserve slot using resource staffing
end`;
const connection = {
  kind: 'connectionAdded',
  edgeId: 'edge-id',
  source: 'source-id',
  target: 'target-id',
} as const;
const queue = { kind: 'queueChanged', nodeId: 'work-id', previous: 15, current: 16 } as const;
const message = {
  kind: 'message',
  name: 'öppna',
  source: 'work-id',
  target: 'reserve-id',
} as const;

function compiled(source: string) {
  const result = compileBehavior(source);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.program;
}

function sending(count: number) {
  return compiled(
    ['on "echo"', ...Array<string>(count).fill('  send "echo" to node event.source'), 'end'].join(
      '\n',
    ),
  );
}

describe('Behavior language', () => {
  it('compiles the planned editor example and applies defaults and per-instance overrides', () => {
    const program = compiled(renameSource);
    expect(program.contexts).toEqual(['editor']);
    expect(program.parameters).toEqual([
      { name: 'nextName', type: 'text', defaultValue: 'Kvalitetskontroll', line: 1, column: 11 },
    ]);
    expect(behaviorHandlerLocation(program, connection)).toEqual({ line: 3, column: 1 });
    expect(behaviorHandlerLocation(program, queue)).toBeUndefined();
    expect(runBehavior(program, {}, connection)).toEqual({
      ok: true,
      actions: [
        { kind: 'rename', nodeId: 'target-id', title: 'Kvalitetskontroll', line: 4, column: 3 },
      ],
    });
    expect(runBehavior(program, { nextName: 'Annan nod' }, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target-id', title: 'Annan nod', line: 4, column: 3 }],
    });
    expect(runBehavior(program, { nextName: '' }, connection)).toMatchObject({
      ok: true,
      actions: [{ kind: 'rename', title: '' }],
    });
  });

  it('sends to the configured stable node ID at a threshold crossing and opens its configured resource', () => {
    const sender = compiled(queueSource);
    const receiver = compiled(reserveSource);
    const bindings = { receiver: 'reserve-id' };
    const resolver = { nodeExists: (id: string) => id === 'reserve-id' };
    expect(sender.contexts).toEqual(['simulation']);
    expect(hasBehaviorHandler(receiver, message)).toBe(true);
    expect(hasBehaviorHandler(receiver, { ...message, name: 'other' })).toBe(false);
    expect(
      runBehavior(sender, bindings, { ...queue, previous: 14, current: 15 }, resolver),
    ).toEqual({
      ok: true,
      actions: [],
    });
    expect(runBehavior(sender, bindings, queue, resolver)).toEqual({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'reserve-id', message: 'öppna', line: 6, column: 5 }],
    });
    expect(
      runBehavior(sender, bindings, { ...queue, previous: 16, current: 17 }, resolver),
    ).toEqual({
      ok: true,
      actions: [],
    });
    expect(
      runBehavior(sender, { ...bindings, threshold: 16 }, { ...queue, previous: 16, current: 17 }),
    ).toMatchObject({
      ok: true,
      actions: [{ kind: 'send' }],
    });
    expect(
      runBehavior(receiver, { staffing: 'staff-id' }, message, {
        resourceExists: (id) => id === 'staff-id',
      }),
    ).toEqual({
      ok: true,
      actions: [
        { kind: 'openReserve', nodeId: 'reserve-id', resourceId: 'staff-id', line: 4, column: 3 },
      ],
    });
    expect(runBehavior(receiver, {}, { ...message, name: 'other' })).toEqual({
      ok: true,
      actions: [],
    });
  });

  it('supports boolean values, escaped text, comments, and typed event references', () => {
    const program = compiled(`parameter active as boolean = false
parameter owner as node

on connectionAdded # comment
  if active and event.source == owner and event.edgeId != "" then
    if true then
      rename event.target to "A \\"note\\" #1"
    end if
  end if
end

on "probe"
end`);
    expect(program.contexts).toEqual(['editor', 'simulation']);
    expect(runBehavior(program, { owner: 'source-id' }, connection)).toEqual({
      ok: true,
      actions: [],
    });
    expect(runBehavior(program, { owner: 'other-id', active: true }, connection)).toEqual({
      ok: true,
      actions: [],
    });
    expect(runBehavior(program, { owner: 'source-id', active: true }, connection)).toMatchObject({
      ok: true,
      actions: [{ kind: 'rename', title: 'A "note" #1' }],
    });
  });

  it.each([
    ['on connectionAdded\n  rename event.target to "broken\nend', 'syntax', 2, 26],
    ['on connectionAdded\n  eval 1\n  rename event.target to "broken\nend', 'syntax', 2, 3],
    ['on connectionAdded\n  rename event.target to 2\nend', 'type', 2, 26],
    ['on connectionAdded\n  rename queue.length to "Name"\nend', 'context', 2, 10],
    ['on queueChanged\n  rename event.target to "Name"\nend', 'context', 2, 3],
    ['on connectionAdded\n  send "name" to node event.target\nend', 'context', 2, 3],
    ['on connectionAdded\n  open reserve slot using resource staffing\nend', 'context', 2, 3],
    ['on "reply"\n  send "ping" to node "literal-id"\nend', 'type', 2, 23],
    ['on "reply"\n  eval "danger"\nend', 'syntax', 2, 3],
    ['on connectionAdded\n  if true then\nend', 'syntax', 3, 4],
    ['parameter valid as boolean = 0\non queueChanged\nend', 'type', 1, 30],
    ['parameter count as number = 9007199254740992\non queueChanged\nend', 'type', 1, 29],
    ['parameter receiver as node = "literal-id"\non queueChanged\nend', 'type', 1, 30],
    ['on "duplicate"\nend\non "duplicate"\nend', 'syntax', 3, 4],
  ])('reports the source position and category for %s', (source, code, line, column) => {
    expect(compileBehavior(source)).toMatchObject({ ok: false, error: { code, line, column } });
  });

  it('rejects missing, ill-typed and missing-ID references with declaration positions', () => {
    const sender = compiled(queueSource);
    const receiver = compiled(reserveSource);
    expect(validateBehaviorBindings(sender, {})).toMatchObject({
      ok: false,
      error: { code: 'binding', line: 2, column: 11 },
    });
    expect(
      validateBehaviorBindings(sender, { threshold: 15.5, receiver: 'reserve-id' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'binding', line: 1, column: 11 },
    });
    expect(
      validateBehaviorBindings(sender, { receiver: 'reserve-id' }, { nodeExists: () => false }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'binding',
        line: 2,
        column: 11,
        message: 'The node for "receiver" is unavailable.',
      },
    });
    expect(
      runBehavior(receiver, { staffing: 'missing-id' }, message, { resourceExists: () => false }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'binding',
        line: 1,
        column: 11,
        message: 'The resource for "staffing" is unavailable.',
      },
    });
    expect(
      validateBehaviorBindings(sender, { receiver: 'reserve-id', oldParameter: 'unused' }),
    ).toEqual({
      ok: true,
      bindings: { threshold: 15, receiver: 'reserve-id' },
    });
  });

  it('distinguishes own bindings from inherited ones and bounds externally supplied strings', () => {
    const program = compiled(renameSource);
    const inherited = Object.create({ nextName: 'Prototype value' });
    expect(validateBehaviorBindings(program, inherited)).toEqual({
      ok: true,
      bindings: { nextName: 'Kvalitetskontroll' },
    });
    expect(
      runBehavior(program, { nextName: 'a'.repeat(BEHAVIOR_LIMITS.sourceLength + 1) }, connection),
    ).toMatchObject({
      ok: false,
      error: { code: 'limit', line: 1, column: 11 },
    });
  });

  it('checks source, line, parameter, and nesting limits during compilation', () => {
    const depth = BEHAVIOR_LIMITS.nestingDepth + 1;
    expect(compileBehavior(' '.repeat(BEHAVIOR_LIMITS.sourceLength + 1))).toMatchObject({
      ok: false,
      error: { code: 'limit', line: 1, column: 1 },
    });
    expect(compileBehavior('\n'.repeat(BEHAVIOR_LIMITS.lines))).toMatchObject({
      ok: false,
      error: { code: 'limit', line: BEHAVIOR_LIMITS.lines + 1, column: 1 },
    });
    expect(
      compileBehavior(
        Array.from(
          { length: BEHAVIOR_LIMITS.parameters + 1 },
          (_, index) => `parameter p${index} as number`,
        ).join('\n'),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'limit', line: BEHAVIOR_LIMITS.parameters + 1, column: 1 },
    });
    expect(
      compileBehavior(
        `parameter ${'p'.repeat(BEHAVIOR_LIMITS.parameterNameLength + 1)} as text\non queueChanged\nend`,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'limit', line: 1, column: 11 },
    });
    expect(
      compileBehavior(
        `on queueChanged\n${'if true then\n'.repeat(depth)}${'end if\n'.repeat(depth)}end`,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'limit', line: depth + 1, column: 1 },
    });
  });

  it('bounds executed comparisons and actions without releasing partial actions', () => {
    const program = compiled(`on connectionAdded
  rename event.target to "Earlier proposal"
  if ${Array<string>(BEHAVIOR_LIMITS.instructionsPerHandler).fill('true').join(' and ')} then
  end if
end`);
    expect(runBehavior(program, {}, connection)).toEqual({
      ok: false,
      error: {
        code: 'limit',
        line: 3,
        column: 6 + (BEHAVIOR_LIMITS.instructionsPerHandler - 2) * 'true and '.length,
        message: 'Too much work in one handler.',
      },
    });
    const actions = sending(BEHAVIOR_LIMITS.actionsPerHandler + 1);
    expect(runBehavior(actions, {}, { ...message, name: 'echo' })).toEqual({
      ok: false,
      error: {
        code: 'limit',
        line: BEHAVIOR_LIMITS.actionsPerHandler + 2,
        column: 3,
        message: 'Too many actions in one handler.',
      },
    });
  });

  it('caps a directed A→B→A chain with a stable diagnostic at the sending line', () => {
    const program = sending(1);
    const budget = createBehaviorBudget();
    let event: BehaviorEvent = { kind: 'message', name: 'echo', source: 'a', target: 'b' };
    for (let depth = 0; depth < BEHAVIOR_LIMITS.messageDepth; depth += 1) {
      const result = runBehavior(program, {}, event, { budget, depth, timeSeconds: 25 });
      expect(result).toEqual({
        ok: true,
        actions: [
          {
            kind: 'send',
            nodeId: depth % 2 === 0 ? 'a' : 'b',
            message: 'echo',
            line: 2,
            column: 3,
          },
        ],
      });
      if (!result.ok || result.actions[0].kind !== 'send')
        throw new Error('Expected a directed send');
      event = {
        kind: 'message',
        name: result.actions[0].message,
        source: event.target,
        target: result.actions[0].nodeId,
      };
    }
    expect(
      runBehavior(program, {}, event, {
        budget,
        depth: BEHAVIOR_LIMITS.messageDepth,
        timeSeconds: 25,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'limit', line: 2, column: 3, message: 'Message chain is too deep.' },
    });
  });

  it('shares send limits across instances at one simulated time and resets the time limit on the next tick', () => {
    const program = sending(BEHAVIOR_LIMITS.actionsPerHandler - 1);
    const budget = createBehaviorBudget();
    const event = { ...message, name: 'echo' };
    const timeSeconds = 1.25;
    for (let index = 0; index < 4; index += 1) {
      expect(runBehavior(program, {}, event, { budget, timeSeconds }).ok).toBe(true);
    }
    expect(runBehavior(sending(5), {}, event, { budget, timeSeconds })).toEqual({
      ok: false,
      error: {
        code: 'limit',
        line: 6,
        column: 3,
        message: 'Too many messages at this simulation time.',
      },
    });
    expect(runBehavior(sending(4), {}, event, { budget, timeSeconds }).ok).toBe(true);
    expect(runBehavior(program, {}, event, { budget, timeSeconds: 1.5 }).ok).toBe(true);
  });

  it('caps sends across simulated times for the entire shared run budget', () => {
    const program = sending(BEHAVIOR_LIMITS.actionsPerHandler);
    const budget = createBehaviorBudget();
    const event = { ...message, name: 'echo' };
    for (
      let index = 0;
      index < BEHAVIOR_LIMITS.messagesPerRun / BEHAVIOR_LIMITS.actionsPerHandler;
      index += 1
    ) {
      expect(runBehavior(program, {}, event, { budget, timeSeconds: index }).ok).toBe(true);
    }
    expect(runBehavior(program, {}, event, { budget, timeSeconds: 200 })).toEqual({
      ok: false,
      error: {
        code: 'limit',
        line: 2,
        column: 3,
        message: 'Too many messages in this simulation run.',
      },
    });
  });
});
