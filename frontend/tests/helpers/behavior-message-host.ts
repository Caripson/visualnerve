import {
  BEHAVIOR_LIMITS,
  createBehaviorBudget,
  createBehaviorInstanceState,
  hasBehaviorHandler,
  runBehavior,
  type BehaviorBindings,
  type BehaviorDiagnostic,
  type BehaviorInstanceState,
  type BehaviorProgram,
  type BehaviorSimulationAction,
  type BehaviorSimulationEvent,
} from '../../src/behaviors/language';

type Binding = {
  nodeId: string;
  program?: BehaviorProgram;
  parameters?: BehaviorBindings;
  enabled?: boolean;
};
type Chain = { causeId: number; depth: number; parentMessageId?: number };
type Message = Chain & {
  messageId: number;
  sourceNodeId: string;
  targetNodeId: string;
  name: string;
  sentAtMs: number;
  dueAtMs: number;
  line: number;
  column: number;
};
type SendOutcome = 'queued' | 'pending-limit' | 'run-limit' | 'chain-limit';
type DeliveryOutcome = 'handled' | 'no-active-handler' | 'due-time-limit';
type DiscardOutcome = 'cancelled' | 'beyond-horizon';
type TraceRow = { atMs: number } & (
  | (Message & { kind: 'send'; outcome: SendOutcome })
  | (Message & { kind: 'delivery'; outcome: DeliveryOutcome })
  | (Message & { kind: 'discard'; outcome: DiscardOutcome })
  | (Chain & { kind: 'error'; nodeId: string; diagnostic: BehaviorDiagnostic })
);

const schedulerLimits = {
  pending: BEHAVIOR_LIMITS.messagesPerRun,
  perTime: BEHAVIOR_LIMITS.messagesPerTime,
  perRun: BEHAVIOR_LIMITS.messagesPerRun,
  depth: BEHAVIOR_LIMITS.messageDepth,
};
type Limits = { [Name in keyof typeof schedulerLimits]: number };
type ReserveAction = Extract<BehaviorSimulationAction, { kind: 'openReserve' }>;
type Effects = {
  resourceExists?: (id: string) => boolean;
  reserve?: (action: ReserveAction, atMs: number) => void;
};

/** A controlled scheduler for language tests, independent of the product simulation engine. */
export class BehaviorMessageHost {
  private readonly bindings: Map<string, Binding>;
  private readonly states = new Map<string, BehaviorInstanceState>();
  private readonly limits: Limits;
  private budget = createBehaviorBudget();
  private active = true;
  private clock = 0;
  private messageSequence = 0;
  private causeSequence = 0;
  private enqueued = 0;
  private lastDueTime: number | undefined;
  private deliveriesAtTime = 0;
  private pending: Message[] = [];
  private rows: TraceRow[] = [];

  constructor(
    bindings: readonly Binding[],
    limits: Partial<Limits> = {},
    private readonly effects: Effects = {},
  ) {
    this.bindings = new Map(bindings.map((binding) => [binding.nodeId, structuredClone(binding)]));
    this.limits = { ...schedulerLimits, ...limits };
    this.initializeStates();
  }

  get trace(): readonly TraceRow[] {
    return this.rows;
  }

  get pendingCount() {
    return this.pending.length;
  }

  instanceState(nodeId: string) {
    return structuredClone(this.states.get(nodeId));
  }

  queueChanged(nodeId: string, previous: number, current: number) {
    if (!this.active) return;
    this.execute(
      nodeId,
      { kind: 'queueChanged', nodeId, previous, current },
      { causeId: ++this.causeSequence, depth: 0 },
    );
  }

  /** Deliver through the inclusive horizon, retaining future messages for a later advance. */
  advance(horizonMs: number) {
    if (!this.active) return;
    if (!Number.isSafeInteger(horizonMs) || horizonMs < this.clock)
      throw new RangeError('Expected a safe integer horizon at or after the host clock.');
    while (this.pending[0] && this.pending[0].dueAtMs <= horizonMs)
      this.deliver(this.pending.shift()!);
    this.clock = horizonMs;
  }

  finish(horizonMs: number, { drain = false } = {}) {
    if (!this.active) return;
    this.advance(horizonMs);
    if (drain) {
      while (this.pending.length) this.deliver(this.pending.shift()!);
    } else this.discard('beyond-horizon');
    this.active = false;
  }

  cancel() {
    if (!this.active) return;
    this.discard('cancelled');
    this.active = false;
  }

  reset() {
    this.budget = createBehaviorBudget();
    this.active = true;
    this.clock = 0;
    this.messageSequence = 0;
    this.causeSequence = 0;
    this.enqueued = 0;
    this.lastDueTime = undefined;
    this.deliveriesAtTime = 0;
    this.pending = [];
    this.rows = [];
    this.initializeStates();
  }

  private initializeStates() {
    this.states.clear();
    for (const { nodeId, program } of this.bindings.values()) {
      if (program?.properties?.length)
        this.states.set(nodeId, createBehaviorInstanceState(program));
    }
  }

  private discard(outcome: DiscardOutcome) {
    for (const message of this.pending)
      this.rows.push({ ...message, kind: 'discard', outcome, atMs: this.clock });
    this.pending = [];
  }

  private deliver(message: Message) {
    this.clock = message.dueAtMs;
    if (this.lastDueTime !== this.clock) {
      this.lastDueTime = this.clock;
      this.deliveriesAtTime = 0;
    }
    const event = {
      kind: 'message',
      source: message.sourceNodeId,
      target: message.targetNodeId,
      name: message.name,
    } as const;
    const binding = this.bindings.get(event.target);
    const hasHandler =
      binding?.enabled !== false && binding?.program && hasBehaviorHandler(binding.program, event);
    const outcome: DeliveryOutcome =
      this.deliveriesAtTime++ >= this.limits.perTime
        ? 'due-time-limit'
        : hasHandler
          ? 'handled'
          : 'no-active-handler';
    this.rows.push({ ...message, kind: 'delivery', outcome, atMs: this.clock });
    if (outcome === 'handled')
      this.execute(event.target, event, {
        causeId: message.causeId,
        depth: message.depth,
        parentMessageId: message.messageId,
      });
  }

  private execute(nodeId: string, event: BehaviorSimulationEvent, chain: Chain) {
    const binding = this.bindings.get(nodeId);
    if (!binding?.program || binding.enabled === false) return;
    const result = runBehavior(binding.program, binding.parameters ?? {}, event, {
      budget: this.budget,
      depth: chain.depth,
      timeSeconds: this.clock / 1_000,
      nodeExists: (id) => this.bindings.has(id),
      resourceExists: this.effects.resourceExists,
      state: this.states.get(nodeId),
    });
    if (!result.ok) {
      this.rows.push({
        ...chain,
        kind: 'error',
        nodeId,
        diagnostic: result.error,
        atMs: this.clock,
      });
      return;
    }
    if (result.state) this.states.set(nodeId, result.state);
    for (const action of result.actions) {
      if (action.kind === 'send') this.enqueue(nodeId, chain, action);
      if (action.kind === 'openReserve') this.effects.reserve?.(action, this.clock);
    }
  }

  private enqueue(
    sourceNodeId: string,
    chain: Chain,
    action: Extract<BehaviorSimulationAction, { kind: 'send' }>,
  ) {
    const dueAtMs = this.clock + (action.delaySeconds ?? 0) * 1_000;
    if (!Number.isSafeInteger(dueAtMs))
      throw new RangeError('Message due time overflows the host clock.');
    const message: Message = {
      ...chain,
      depth: chain.depth + 1,
      messageId: ++this.messageSequence,
      sourceNodeId,
      targetNodeId: action.nodeId,
      name: action.message,
      sentAtMs: this.clock,
      dueAtMs,
      line: action.line,
      column: action.column,
    };
    const outcome: SendOutcome =
      message.depth > this.limits.depth
        ? 'chain-limit'
        : this.enqueued >= this.limits.perRun
          ? 'run-limit'
          : this.pending.length >= this.limits.pending
            ? 'pending-limit'
            : 'queued';
    this.rows.push({ ...message, kind: 'send', outcome, atMs: this.clock });
    if (outcome === 'queued') {
      this.enqueued++;
      this.pending.push(message);
      // The ID is assigned at enqueue. Rejected proposals may leave harmless gaps.
      this.pending.sort(
        (left, right) => left.dueAtMs - right.dueAtMs || left.messageId - right.messageId,
      );
    }
  }
}
