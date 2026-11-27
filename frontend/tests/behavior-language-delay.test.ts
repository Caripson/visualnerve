import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_LIMITS,
  compileBehavior,
  runBehavior,
  type BehaviorProgram,
} from '../src/behaviors/language';
import { behaviorLanguageContract } from '../src/behaviors/language-contract';
import { SeededRandom } from '../src/simulation/random';
import { BehaviorMessageHost } from './helpers/behavior-message-host';

const queueEvent = { kind: 'queueChanged', nodeId: 'sender', previous: 0, current: 1 } as const;
const makeSend = (after = '') =>
  `parameter receiver as node\non queueChanged\n  send "ping" to node receiver${after}\nend`;

function program(source: string): BehaviorProgram {
  const compiled = compileBehavior(source, 2);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  return compiled.program;
}

const to = (nodeId: string, target: string, after = '') => ({
  nodeId,
  program: program(makeSend(after)),
  parameters: { receiver: target },
});

describe('delayed send action', () => {
  it('advertises the version 2 limit and preserves the immediate action shape', () => {
    expect(behaviorLanguageContract(2)?.delayedSendSeconds).toBe(86_400);
    expect(compileBehavior(makeSend(' after 1'), 1)).toMatchObject({ ok: false });
    expect(compileBehavior(makeSend(' after 1.5'), 2)).toMatchObject({ ok: false });
    const actions = (source: string) =>
      runBehavior(program(source), { receiver: 'node-id' }, queueEvent);
    expect(actions(makeSend(' after 0'))).toEqual(actions(makeSend()));
    expect(actions(makeSend())).toEqual({
      ok: true,
      actions: [{ kind: 'send', nodeId: 'node-id', message: 'ping', line: 3, column: 3 }],
    });
    for (const seconds of [1, 86_400]) {
      expect(actions(makeSend(` after ${seconds}`))).toMatchObject({
        ok: true,
        actions: [{ kind: 'send', nodeId: 'node-id', delaySeconds: seconds }],
      });
    }
  });

  it.each(['-1', '86401', '9007199254740991'])(
    'reports out-of-range literal %s at the delay expression',
    (delay) => {
      const source = makeSend(` after ${delay}`);
      const column = source.split('\n')[2].indexOf(' after ') + ' after '.length + 1;
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code: 'limit', line: 3, column },
      });
    },
  );

  it.each(['"one second"', 'true', 'receiver'])(
    'rejects a nonnumber delay %s while compiling',
    (delay) => {
      const source = makeSend(` after ${delay}`);
      const column = source.split('\n')[2].indexOf(' after ') + ' after '.length + 1;
      expect(compileBehavior(source, 2)).toMatchObject({
        ok: false,
        error: { code: 'type', line: 3, column },
      });
    },
  );

  it('evaluates a typed local integer expression and rejects an out-of-range result before effects', () => {
    const source = `parameter receiver as node
parameter waiting as number
on queueChanged
  local seconds as number = waiting + 1
  send "earlier proposal" to node receiver
  send "ping" to node receiver after seconds
end`;
    const compiled = program(source);
    expect(runBehavior(compiled, { receiver: 'node-id', waiting: 41 }, queueEvent)).toMatchObject({
      ok: true,
      actions: [{ message: 'earlier proposal' }, { message: 'ping', delaySeconds: 42 }],
    });
    const column = source.split('\n')[5].indexOf('seconds') + 1;
    for (const waiting of [-2, 86_400]) {
      expect(runBehavior(compiled, { receiver: 'node-id', waiting }, queueEvent)).toMatchObject({
        ok: false,
        error: { code: 'limit', line: 6, column },
      });
      const host = new BehaviorMessageHost([
        { nodeId: 'sender', program: compiled, parameters: { receiver: 'node-id', waiting } },
        { nodeId: 'node-id' },
      ]);
      host.queueChanged('sender', 0, 1);
      host.finish(0, { drain: true });
      expect(host.trace).toMatchObject([{ kind: 'error', atMs: 0, diagnostic: { code: 'limit' } }]);
      expect(host.pendingCount).toBe(0);
    }
  });
});

describe('controlled delayed message scheduler', () => {
  it('queues zero delay after current work and links its inactive and active delivery outcomes', () => {
    const host = new BehaviorMessageHost([
      {
        nodeId: 'sender',
        parameters: { first: 'active', second: 'inactive' },
        program: program(`parameter first as node
parameter second as node
on queueChanged
  send "start" to node first after 0
  send "start" to node second
end
on "reply"
end`),
      },
      {
        nodeId: 'active',
        program: program('on "start"\n  send "reply" to node event.source after 0\nend'),
      },
      { nodeId: 'inactive', enabled: false, program: program('on "start"\nend') },
    ]);
    host.queueChanged('sender', 0, 1);
    expect(host.pendingCount).toBe(2);
    expect(host.trace.map(({ kind }) => kind)).toEqual(['send', 'send']);
    host.advance(0);
    expect(host.trace).toMatchObject([
      {
        kind: 'send',
        messageId: 1,
        targetNodeId: 'active',
        atMs: 0,
        dueAtMs: 0,
        outcome: 'queued',
      },
      {
        kind: 'send',
        messageId: 2,
        targetNodeId: 'inactive',
        atMs: 0,
        dueAtMs: 0,
        outcome: 'queued',
      },
      { kind: 'delivery', messageId: 1, targetNodeId: 'active', atMs: 0, outcome: 'handled' },
      {
        kind: 'send',
        messageId: 3,
        parentMessageId: 1,
        sourceNodeId: 'active',
        targetNodeId: 'sender',
        depth: 2,
        causeId: 1,
        atMs: 0,
      },
      {
        kind: 'delivery',
        messageId: 2,
        targetNodeId: 'inactive',
        atMs: 0,
        outcome: 'no-active-handler',
      },
      {
        kind: 'delivery',
        messageId: 3,
        parentMessageId: 1,
        targetNodeId: 'sender',
        atMs: 0,
        outcome: 'handled',
      },
    ]);
  });

  it('breaks equal due times by enqueue order across senders and retains stable target IDs', () => {
    const host = new BehaviorMessageHost([
      to('a-sender', 'receiver-id', ' after 2'),
      to('z-sender', 'receiver-id', ' after 3'),
      { nodeId: 'receiver-id', program: program('on "ping"\nend') },
    ]);
    host.advance(250);
    host.queueChanged('z-sender', 0, 1);
    host.advance(1_250);
    host.queueChanged('a-sender', 0, 1);
    host.advance(3_249);
    expect(host.trace.map(({ kind }) => kind)).toEqual(['send', 'send']);
    host.advance(3_250);
    expect(host.trace.filter(({ kind }) => kind === 'delivery')).toMatchObject([
      {
        messageId: 1,
        causeId: 1,
        sourceNodeId: 'z-sender',
        targetNodeId: 'receiver-id',
        sentAtMs: 250,
        dueAtMs: 3_250,
        atMs: 3_250,
        line: 3,
        column: 3,
        outcome: 'handled',
      },
      {
        messageId: 2,
        causeId: 2,
        sourceNodeId: 'a-sender',
        targetNodeId: 'receiver-id',
        sentAtMs: 1_250,
        dueAtMs: 3_250,
        atMs: 3_250,
        outcome: 'handled',
      },
    ]);
  });

  it('finishes at the inclusive normal horizon and drains causally scheduled follow-ups only in drain mode', () => {
    const bindings = [
      {
        nodeId: 'sender',
        parameters: { receiver: 'receiver' },
        program: program(`parameter receiver as node
on queueChanged
  send "on time" to node receiver after 2
  send "later" to node receiver after 3
end
on "follow-up"
end`),
      },
      {
        nodeId: 'receiver',
        program: program(`on "on time"
end
on "later"
  send "follow-up" to node event.source after 1
end`),
      },
    ];
    const normal = new BehaviorMessageHost(bindings);
    normal.queueChanged('sender', 0, 1);
    normal.finish(2_000);
    expect(normal.pendingCount).toBe(0);
    expect(normal.trace.slice(2)).toMatchObject([
      { kind: 'delivery', messageId: 1, atMs: 2_000, outcome: 'handled' },
      { kind: 'discard', messageId: 2, atMs: 2_000, dueAtMs: 3_000, outcome: 'beyond-horizon' },
    ]);
    normal.advance(4_000);
    expect(normal.trace).toHaveLength(4);

    const drain = new BehaviorMessageHost(bindings);
    drain.queueChanged('sender', 0, 1);
    drain.finish(2_000, { drain: true });
    expect(drain.pendingCount).toBe(0);
    expect(drain.trace.filter(({ kind }) => kind === 'delivery')).toMatchObject([
      { messageId: 1, atMs: 2_000, outcome: 'handled' },
      { messageId: 2, atMs: 3_000, outcome: 'handled' },
      { messageId: 3, parentMessageId: 2, causeId: 1, atMs: 4_000, outcome: 'handled' },
    ]);
  });

  it('cancels queued messages and resets the clock, trace, IDs and run budget', () => {
    const host = new BehaviorMessageHost(
      [
        to('sender', 'receiver', ' after 2'),
        { nodeId: 'receiver', program: program('on "ping"\nend') },
      ],
      { perRun: 1 },
    );
    host.queueChanged('sender', 0, 1);
    host.advance(1_000);
    host.cancel();
    host.advance(3_000);
    host.queueChanged('sender', 0, 1);
    expect(host.trace).toMatchObject([
      { kind: 'send', messageId: 1, sentAtMs: 0, outcome: 'queued' },
      { kind: 'discard', messageId: 1, dueAtMs: 2_000, atMs: 1_000, outcome: 'cancelled' },
    ]);
    expect(host.pendingCount).toBe(0);
    host.reset();
    expect(host.trace).toEqual([]);
    host.queueChanged('sender', 0, 1);
    host.finish(2_000);
    expect(host.trace).toMatchObject([
      { kind: 'send', messageId: 1, causeId: 1, sentAtMs: 0, outcome: 'queued' },
      { kind: 'delivery', messageId: 1, causeId: 1, atMs: 2_000, outcome: 'handled' },
    ]);
  });

  it('bounds pending messages and the run independently and admits new work when a queue slot frees', () => {
    const host = new BehaviorMessageHost(
      [
        to('sender', 'receiver', ' after 1'),
        { nodeId: 'receiver', program: program('on "ping"\nend') },
      ],
      { pending: 1, perRun: 2 },
    );
    host.queueChanged('sender', 0, 1);
    host.queueChanged('sender', 1, 2);
    expect(host.pendingCount).toBe(1);
    host.advance(1_000);
    host.queueChanged('sender', 2, 3);
    host.advance(2_000);
    host.queueChanged('sender', 3, 4);
    host.finish(4_000);
    expect(host.trace).toMatchObject([
      { kind: 'send', messageId: 1, outcome: 'queued' },
      { kind: 'send', messageId: 2, outcome: 'pending-limit' },
      { kind: 'delivery', messageId: 1, outcome: 'handled' },
      { kind: 'send', messageId: 3, outcome: 'queued' },
      { kind: 'delivery', messageId: 3, outcome: 'handled' },
      { kind: 'send', messageId: 4, outcome: 'run-limit' },
    ]);
  });

  it('bounds messages converging at one due time independent of their origin timestamps', () => {
    const host = new BehaviorMessageHost(
      [
        to('sender', 'receiver', ' after queue.length'),
        { nodeId: 'receiver', program: program('on "ping"\nend') },
      ],
      { perTime: 1 },
    );
    host.queueChanged('sender', 0, 3);
    host.advance(1_000);
    host.queueChanged('sender', 0, 2);
    host.advance(2_000);
    host.queueChanged('sender', 0, 2);
    host.finish(4_000);
    expect(host.trace.filter(({ kind }) => kind === 'delivery')).toMatchObject([
      { messageId: 1, sentAtMs: 0, atMs: 3_000, outcome: 'handled' },
      { messageId: 2, sentAtMs: 1_000, atMs: 3_000, outcome: 'due-time-limit' },
      { messageId: 3, sentAtMs: 2_000, atMs: 4_000, outcome: 'handled' },
    ]);
  });

  it('charges the origin-time send budget even when due times differ', () => {
    const host = new BehaviorMessageHost([
      to('sender', 'receiver', ' after queue.length'),
      { nodeId: 'receiver', program: program('on "ping"\nend') },
    ]);
    const limit = BEHAVIOR_LIMITS.messagesPerTime;
    for (let delay = 1; delay <= limit + 1; delay++) host.queueChanged('sender', 0, delay);
    expect(host.pendingCount).toBe(limit);
    expect(host.trace.at(-1)).toMatchObject({
      kind: 'error',
      atMs: 0,
      diagnostic: { code: 'limit' },
    });
    host.finish(0, { drain: true });
    const deliveries = host.trace.filter((row) => row.kind === 'delivery');
    expect(deliveries).toHaveLength(limit);
    expect(deliveries.every(({ outcome }) => outcome === 'handled')).toBe(true);
  });

  it('stops a delayed A→B→A cycle at the recorded causal depth across timestamps', () => {
    const bindings = [
      {
        nodeId: 'A',
        program: program(
          `${makeSend(' after 1')}\non "ping"\n  send "ping" to node event.source after 1\nend`,
        ),
        parameters: { receiver: 'B' },
      },
      {
        nodeId: 'B',
        program: program('on "ping"\n  send "ping" to node event.source after 1\nend'),
      },
    ];
    const host = new BehaviorMessageHost(bindings);
    host.queueChanged('A', 0, 1);
    host.finish(0, { drain: true });
    const depthLimit = BEHAVIOR_LIMITS.messageDepth;
    const deliveries = host.trace.filter(({ kind }) => kind === 'delivery');
    expect(deliveries).toHaveLength(depthLimit);
    for (const [index, row] of deliveries.entries()) {
      expect(row).toMatchObject({
        causeId: 1,
        messageId: index + 1,
        depth: index + 1,
        atMs: (index + 1) * 1_000,
        targetNodeId: index % 2 === 0 ? 'B' : 'A',
      });
    }
    expect(host.trace.at(-1)).toMatchObject({
      kind: 'error',
      atMs: depthLimit * 1_000,
      parentMessageId: depthLimit,
      diagnostic: { code: 'limit' },
    });
    expect(host.pendingCount).toBe(0);

    const shorter = new BehaviorMessageHost(bindings, { depth: 2 });
    shorter.queueChanged('A', 0, 1);
    shorter.finish(0, { drain: true });
    expect(shorter.trace.at(-1)).toMatchObject({
      kind: 'send',
      messageId: 3,
      parentMessageId: 2,
      depth: 3,
      outcome: 'chain-limit',
    });
  });

  it('replays exactly from the same seeded timed inputs after reset', () => {
    const host = new BehaviorMessageHost([
      to('first', 'receiver', ' after queue.length'),
      to('second', 'receiver', ' after queue.length'),
      { nodeId: 'receiver', program: program('on "ping"\nend') },
    ]);
    function run(seed: number) {
      const random = new SeededRandom(seed, 'delayed-host-fixture');
      let timeMs = 0;
      for (let index = 0; index < 12; index++) {
        timeMs += Math.floor(random.next() * 250);
        host.advance(timeMs);
        host.queueChanged(
          random.next() < 0.5 ? 'first' : 'second',
          0,
          Math.floor(random.next() * 4),
        );
      }
      host.finish(timeMs, { drain: true });
      return structuredClone(host.trace);
    }
    const first = run(42);
    expect(first).toHaveLength(24);
    host.reset();
    expect(run(42)).toEqual(first);
    host.reset();
    expect(run(43)).not.toEqual(first);
  });
});
