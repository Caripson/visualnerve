import { describe, expect, it } from 'vitest';
import { behaviorLanguageContract } from '../src/behaviors/language-contract';
import {
  compileBehavior,
  createBehaviorBudget,
  runBehavior,
  type BehaviorDiagnostic,
} from '../src/behaviors/language';

const connection = {
  kind: 'connectionAdded',
  edgeId: 'edge',
  source: 'source',
  target: 'target',
} as const;
const crossing = { kind: 'queueChanged', nodeId: 'watch', previous: 15, current: 16 } as const;
const delivered = { kind: 'message', name: 'öppna', source: 'watch', target: 'checkout' } as const;

function compileV2(source: string) {
  const result = compileBehavior(source, 2);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.program;
}

function marked(source: string) {
  const [before, after] = source.split('^');
  const lines = before.split('\n');
  return {
    source: before + after,
    location: { line: lines.length, column: lines[lines.length - 1].length + 1 },
  };
}

const editorSource = `parameter choose as boolean = true
parameter prefer as boolean = false
parameter nextName as text = "Kvalitetskontroll"

on connectionAdded
  local title as text = "Default"
  if choose then
    local candidate as text = nextName
    if prefer then
      set title to "Preferred"
    else
      set title to candidate
    end if
  else
    local candidate as text = "Fallback"
    set title to candidate
  end if
  rename event.target to title
end`;

const simulatorSource = `parameter recipient as node
parameter fallback as node
parameter staffing as resource
parameter threshold as number = 15

on queueChanged
  local candidate as number = queue.previousLength + 0 + 1
  local target as node = recipient
  if candidate + 0 > threshold and queue.length >= candidate then
    send "öppna" to node target
  else
    set target to fallback
    send "steg" to node target
  end if
end

on "öppna"
  local staff as resource = staffing
  open reserve slot using resource staff
end`;

describe('Visual Nerve Script v2 control flow', () => {
  it('executes the selected nested editor branch with independent sibling locals', () => {
    const program = compileV2(editorSource);
    const bindings = Object.freeze({ nextName: 'Anpassat namn' });
    expect(program.version).toBe(2);
    expect(program.contexts).toEqual(['editor']);
    expect(runBehavior(program, bindings, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Anpassat namn', line: 18, column: 3 }],
    });
    expect(runBehavior(program, { prefer: true }, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Preferred', line: 18, column: 3 }],
    });
    expect(runBehavior(program, { choose: false, prefer: true }, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Fallback', line: 18, column: 3 }],
    });
    expect(bindings).toEqual({ nextName: 'Anpassat namn' });
  });

  it('uses typed locals, expressions and branch assignment in simulation actions', () => {
    const program = compileV2(simulatorSource);
    const bindings = { recipient: 'checkout', fallback: 'another-checkout', staffing: 'staff' };
    expect(program.contexts).toEqual(['simulation']);
    expect(runBehavior(program, bindings, crossing)).toEqual({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'checkout', message: 'öppna', line: 10, column: 5 }],
    });
    expect(runBehavior(program, bindings, { ...crossing, previous: 14, current: 15 })).toEqual({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'another-checkout', message: 'steg', line: 13, column: 5 }],
    });
    expect(runBehavior(program, bindings, delivered)).toEqual({
      ok: true,
      actions: [
        { kind: 'openReserve', nodeId: 'checkout', resourceId: 'staff', line: 19, column: 3 },
      ],
    });
  });

  it('matches local identifiers by case and initializes them for each handler invocation', () => {
    const program = compileV2(`parameter receiver as node

on queueChanged
  local count as number = 0
  local Count as number = queue.length
  if count == 0 and Count == 16 then
    set count to count + 1
  end if
  if count == 1 then
    send "one" to node receiver
  end if
end`);
    const bindings = { receiver: 'checkout' };
    const first = runBehavior(program, bindings, crossing);
    expect(first).toMatchObject({ ok: true, actions: [{ kind: 'send', message: 'one' }] });
    expect(runBehavior(program, bindings, { ...crossing, current: 15 })).toEqual({
      ok: true,
      actions: [],
    });
    expect(runBehavior(program, bindings, crossing)).toEqual(first);
  });

  it.each([
    {
      description: 'parameter assignment',
      code: 'context',
      text: `parameter nextName as text = "Before"
on connectionAdded
  set ^nextName to "After"
end`,
    },
    {
      description: 'editor event field assignment',
      code: 'context',
      text: `on connectionAdded
  set ^event.target to event.source
end`,
    },
    {
      description: 'queue field assignment',
      code: 'context',
      text: `on queueChanged
  set ^queue.length to 0
end`,
    },
    {
      description: 'assignment before declaration',
      code: 'syntax',
      text: `on connectionAdded
  set ^title to "After"
  local title as text = "Before"
end`,
    },
    {
      description: 'self-reference before initialization',
      code: 'syntax',
      text: `on connectionAdded
  local title as text = ^title
end`,
    },
    {
      description: 'read outside a finished branch',
      code: 'syntax',
      text: `on connectionAdded
  if true then
    local branch as text = "Internal"
  end if
  rename event.target to ^branch
end`,
    },
    {
      description: 'read from the sibling branch',
      code: 'syntax',
      text: `on connectionAdded
  if true then
    local branch as text = "Internal"
  else
    rename event.target to ^branch
  end if
end`,
    },
    {
      description: 'read from another handler',
      code: 'syntax',
      text: `on queueChanged
  local count as number = 1
end
on "öppna"
  if ^count == 1 then
  end if
end`,
    },
    {
      description: 'shadowing a visible parameter',
      code: 'syntax',
      text: `parameter title as text = "Outer"
on connectionAdded
  local ^title as text = "Inner"
end`,
    },
    {
      description: 'shadowing a visible local',
      code: 'syntax',
      text: `on connectionAdded
  local title as text = "Outer"
  if true then
    local ^title as text = "Inner"
  end if
end`,
    },
    {
      description: 'missing initializer',
      code: 'syntax',
      text: `on connectionAdded
  local title as text^
end`,
    },
    {
      description: 'initializer with the wrong type',
      code: 'type',
      text: `on connectionAdded
  local title as text = ^false
end`,
    },
    {
      description: 'assignment with the wrong type',
      code: 'type',
      text: `on queueChanged
  local count as number = 0
  set count to ^"one"
end`,
    },
    {
      description: 'duplicate else',
      code: 'syntax',
      text: `on connectionAdded
  if true then
  else
  ^else
  end if
end`,
    },
  ] satisfies { description: string; code: BehaviorDiagnostic['code']; text: string }[])(
    'reports $description at the exact source position',
    ({ code, text }) => {
      const { source, location } = marked(text);
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code, ...location },
      });
    },
  );

  it('short-circuits and leaves earlier actions unpublished on arithmetic overflow', () => {
    const { source, location } = marked(`parameter allow as boolean = false
on connectionAdded
  local total as number = 9007199254740991
  rename event.target to "Before check"
  if allow and total + ^1 + -1 > 0 then
    rename event.target to "Then"
  else
    rename event.target to "Else"
  end if
end`);
    const program = compileV2(source);
    expect(runBehavior(program, {}, connection)).toEqual({
      ok: true,
      actions: [
        { kind: 'rename', nodeId: 'target', title: 'Before check', line: 4, column: 3 },
        { kind: 'rename', nodeId: 'target', title: 'Else', line: 8, column: 5 },
      ],
    });
    const failure = runBehavior(program, { allow: true }, connection);
    expect(failure).toEqual({
      ok: false,
      error: { code: 'type', ...location, message: expect.any(String) },
    });
    expect(runBehavior(program, { allow: true }, connection)).toEqual(failure);
  });

  it('charges declarations and assignments to the handler budget without publishing earlier actions on exhaustion', () => {
    const contract = behaviorLanguageContract(2);
    if (!contract) throw new Error('Missing the v2 language contract');
    const assignments = '  set value to value\n'.repeat(contract.limits.instructionsPerHandler - 2);
    const prefix = `on connectionAdded
  local value as number = 0
  rename event.target to "Before assignments"
${assignments}`;
    expect(runBehavior(compileV2(prefix + 'end'), {}, connection)).toEqual({
      ok: true,
      actions: [
        { kind: 'rename', nodeId: 'target', title: 'Before assignments', line: 3, column: 3 },
      ],
    });
    const { source, location } = marked(prefix + '  ^set value to value\nend');
    expect(runBehavior(compileV2(source), {}, connection)).toEqual({
      ok: false,
      error: { code: 'limit', ...location, message: expect.any(String) },
    });
  });

  it('charges each addition in source order within a single statement', () => {
    const contract = behaviorLanguageContract(2);
    if (!contract) throw new Error('Missing the v2 language contract');
    const terms = ' + 1'.repeat(contract.limits.instructionsPerHandler - 3);
    const prefix = `on connectionAdded
  local value as number = 0
  rename event.target to "Before addition"
  set value to value${terms}`;
    expect(runBehavior(compileV2(prefix + '\nend'), {}, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Before addition', line: 3, column: 3 }],
    });
    const { source, location } = marked(prefix + ' + ^1\nend');
    expect(runBehavior(compileV2(source), {}, connection)).toEqual({
      ok: false,
      error: { code: 'limit', ...location, message: expect.any(String) },
    });
  });

  it('keeps the default compiler on v1 and preserves old parameter names', () => {
    expect(compileBehavior(editorSource)).toEqual(compileBehavior(editorSource, 1));
    expect(compileBehavior(editorSource)).toMatchObject({
      ok: false,
      error: { code: 'syntax', line: 6, column: 3 },
    });
    const oldSource = `parameter local as text = "Preview v1"
parameter else as boolean = true
parameter set as number = 1
on connectionAdded
  if else and set == 1 then
    rename event.target to local
  end if
end`;
    const legacy = compileBehavior(oldSource);
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.error));
    expect(legacy.program.version).toBe(1);
    expect(runBehavior(legacy.program, {}, connection)).toMatchObject({
      ok: true,
      actions: [{ kind: 'rename', title: 'Preview v1' }],
    });
  });
});

describe('Visual Nerve Script v2 counted repeat', () => {
  it('captures the count once and reinitializes body locals on each iteration', () => {
    const program = compileV2(`on connectionAdded
  local count as number = 2
  local visits as number = 0
  repeat count
    local increment as number = 0
    set increment to increment + 1
    set visits to visits + increment
    set count to 0
  end repeat
  if visits == 2 and count == 0 then
    rename event.target to "Exactly twice"
  end if
end`);
    expect(runBehavior(program, {}, connection)).toEqual({
      ok: true,
      actions: [{ kind: 'rename', nodeId: 'target', title: 'Exactly twice', line: 11, column: 5 }],
    });
  });

  it('accepts both zero and the documented maximum count', () => {
    const program = compileV2(`on connectionAdded
  local visits as number = 0
  repeat 0
    set visits to 9007199254740991 + 1
    rename event.target to "Unexpected visit"
  end repeat
  repeat 32
    set visits to visits + 1
  end repeat
  if visits == 32 then
    rename event.target to "Exactly thirty-two"
  end if
end`);
    expect(runBehavior(program, {}, connection)).toEqual({
      ok: true,
      actions: [
        { kind: 'rename', nodeId: 'target', title: 'Exactly thirty-two', line: 11, column: 5 },
      ],
    });
  });

  it.each([-1, 33])('rejects the literal count %d at the repeat statement', (count) => {
    const { source, location } = marked(`on connectionAdded
  ^repeat ${count}
  end repeat
end`);
    expect(compileBehavior(source, 2)).toMatchObject({
      ok: false,
      error: { code: 'limit', ...location },
    });
  });

  it.each([-1, 33])(
    'rejects dynamic count %d before its body or earlier proposals are published',
    (count) => {
      const { source, location } = marked(`parameter count as number
on connectionAdded
  rename event.target to "Before validation"
  ^repeat count
    rename event.target to "Inside repeat"
  end repeat
end`);
      expect(runBehavior(compileV2(source), { count }, connection)).toEqual({
        ok: false,
        error: { code: 'limit', ...location, message: expect.any(String) },
      });
    },
  );

  it.each([
    {
      description: 'a text count',
      code: 'type',
      text: `on connectionAdded
  repeat ^"two"
  end repeat
end`,
    },
    {
      description: 'a local outside the repeat body',
      code: 'syntax',
      text: `on connectionAdded
  repeat 1
    local title as text = "Internal"
  end repeat
  rename event.target to ^title
end`,
    },
    {
      description: 'a prohibited host action in a zero-count repeat',
      code: 'context',
      text: `on connectionAdded
  repeat 0
    ^send "öppna" to node event.target
  end repeat
end`,
    },
    {
      description: 'an invalid block terminator',
      code: 'syntax',
      text: `on connectionAdded
  repeat 1
  end ^if
end`,
    },
  ] satisfies { description: string; code: BehaviorDiagnostic['code']; text: string }[])(
    'rejects $description at the exact source position',
    ({ code, text }) => {
      const { source, location } = marked(text);
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code, ...location },
      });
    },
  );

  it('applies one depth limit across mixed if and repeat blocks', () => {
    const contract = behaviorLanguageContract(2);
    if (!contract) throw new Error('Missing the v2 language contract');
    const blocks = Array.from({ length: contract.limits.nestingDepth }, (_, index) =>
      index % 2 === 0 ? ['  if true then', '  end if'] : ['  repeat 1', '  end repeat'],
    );
    const opening = ['on connectionAdded', ...blocks.map(([open]) => open)];
    const closing = [...blocks.map(([, close]) => close).reverse(), 'end'];
    expect(compileBehavior([...opening, ...closing].join('\n'), 2).ok).toBe(true);

    for (const [open, close] of [
      ['repeat 1', 'end repeat'],
      ['if true then', 'end if'],
    ]) {
      const { source, location } = marked(
        [...opening, `  ^${open}`, `  ${close}`, ...closing].join('\n'),
      );
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code: 'limit', ...location },
      });
    }
  });

  it('counts empty nested iterations and drops all proposals at the exact budget failure', () => {
    const { source, location } = marked(`on connectionAdded
  rename event.target to "Before loops"
  repeat 4
    ^repeat 32
    end repeat
  end repeat
end`);
    const program = compileV2(source);
    const failed = runBehavior(program, {}, connection);
    expect(failed).toEqual({
      ok: false,
      error: { code: 'limit', ...location, message: expect.any(String) },
    });
    expect(runBehavior(program, {}, connection)).toEqual(failed);
  });

  it('charges loop-generated sends against the same action and message limits', () => {
    const contract = behaviorLanguageContract(2);
    if (!contract) throw new Error('Missing the v2 language contract');
    const bindings = { receiver: 'checkout' };
    const { source, location } = marked(`parameter receiver as node
on queueChanged
  repeat 32
    ^send "tick" to node receiver
  end repeat
end`);
    const program = compileV2(source);
    const actions = Array.from({ length: 32 }, () => ({
      ...location,
      kind: 'send',
      nodeId: 'checkout',
      message: 'tick',
    }));
    const budget = createBehaviorBudget();
    const options = { budget, timeSeconds: 25 };
    for (let index = 0; index < contract.limits.messagesPerTime / 32; index += 1) {
      expect(runBehavior(program, bindings, crossing, options)).toEqual({ ok: true, actions });
    }
    expect(runBehavior(program, bindings, crossing, options)).toEqual({
      ok: false,
      error: { code: 'limit', ...location, message: 'Too many messages at this simulation time.' },
    });
    expect(runBehavior(program, bindings, crossing, { ...options, timeSeconds: 26 })).toEqual({
      ok: true,
      actions,
    });

    const withEarlierAction = source.replace(
      '  repeat 32',
      '  send "earlier" to node receiver\n  repeat 32',
    );
    expect(runBehavior(compileV2(withEarlierAction), bindings, crossing)).toEqual({
      ok: false,
      error: {
        code: 'limit',
        line: location.line + 1,
        column: location.column,
        message: 'Too many actions in one handler.',
      },
    });
  });

  it('keeps repeat out of the v1 grammar without reserving the old parameter name', () => {
    expect(compileBehavior('on connectionAdded\n  repeat 1\n  end repeat\nend')).toMatchObject({
      ok: false,
      error: { code: 'syntax', line: 2, column: 3 },
    });
    expect(
      compileBehavior('parameter repeat as text = "Preview v1"\non connectionAdded\nend'),
    ).toMatchObject({
      ok: true,
      program: {
        version: 1,
        parameters: [{ name: 'repeat', type: 'text', defaultValue: 'Preview v1' }],
      },
    });
  });
});
