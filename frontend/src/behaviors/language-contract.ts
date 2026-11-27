/** The staging language version is stored independently of the diagram format version. */
export const BEHAVIOR_PREVIEW_VERSION = 1;
export const BEHAVIOR_DEVELOPMENT_VERSION = 2;

export const BEHAVIOR_LIMITS = {
  sourceLength: 16_384,
  lines: 256,
  parameters: 16,
  parameterNameLength: 200,
  nestingDepth: 8,
  instructionsPerHandler: 128,
  actionsPerHandler: 32,
  messageLength: 80,
  messageDepth: 16,
  messagesPerTime: 128,
  messagesPerRun: 4096,
} as const;

const contexts = ['editor', 'simulation'] as const;
const parameterTypes = ['text', 'number', 'boolean', 'node', 'resource'] as const;
const comparisons = ['==', '!=', '<', '<=', '>', '>='] as const;

export type BehaviorContext = (typeof contexts)[number];
export type BehaviorParameterType = (typeof parameterTypes)[number];
export type BehaviorComparison = (typeof comparisons)[number];
export type BehaviorEventKind = 'connectionAdded' | 'queueChanged' | 'message';
export type BehaviorActionKind = 'rename' | 'setStatus' | 'send' | 'openReserve';

interface EventContract {
  readonly context: BehaviorContext;
  readonly syntax: string;
  readonly fields: Readonly<Record<string, BehaviorParameterType>>;
}

interface ActionContract<Argument extends string> {
  readonly syntax: string;
  readonly events: readonly BehaviorEventKind[];
  readonly arguments: Readonly<Record<Argument, BehaviorParameterType>>;
  readonly optionalArguments?: Readonly<Record<string, BehaviorParameterType>>;
  readonly unavailable: string;
}

interface ActionArguments {
  rename: 'target' | 'title';
  setStatus: 'target' | 'status';
  send: 'message' | 'target';
  openReserve: 'staffing';
}

type ActionContracts = {
  readonly [Kind in BehaviorActionKind]?: ActionContract<ActionArguments[Kind]>;
};

type BehaviorLimits = { readonly [Key in keyof typeof BEHAVIOR_LIMITS]: number };

export interface BehaviorLanguageContract {
  readonly version: number;
  readonly contexts: readonly BehaviorContext[];
  readonly parameterTypes: readonly BehaviorParameterType[];
  readonly comparisons: readonly BehaviorComparison[];
  /** Highest precedence first. Every level is evaluated from left to right. */
  readonly precedence: readonly (readonly string[])[];
  readonly events: Readonly<Record<BehaviorEventKind, EventContract>>;
  readonly actions: ActionContracts;
  readonly limits: BehaviorLimits;
  readonly properties?: {
    readonly context: 'simulation';
    readonly types: readonly ('text' | 'number' | 'boolean')[];
    readonly limit: number;
  };
  readonly repeatCount?: number;
  readonly delayedSendSeconds?: number;
}

const previewContract = {
  version: BEHAVIOR_PREVIEW_VERSION,
  contexts,
  parameterTypes,
  comparisons,
  precedence: [comparisons, ['and']],
  events: {
    connectionAdded: {
      context: 'editor',
      syntax: 'on connectionAdded',
      fields: { 'event.edgeId': 'text', 'event.source': 'node', 'event.target': 'node' },
    },
    queueChanged: {
      context: 'simulation',
      syntax: 'on queueChanged',
      fields: { 'queue.previousLength': 'number', 'queue.length': 'number' },
    },
    message: {
      context: 'simulation',
      syntax: 'on "message name"',
      fields: { 'event.source': 'node', 'event.target': 'node' },
    },
  },
  actions: {
    rename: {
      syntax: 'rename target to title',
      events: ['connectionAdded'],
      arguments: { target: 'node', title: 'text' },
      unavailable: 'Rename is only available in connectionAdded.',
    },
    send: {
      syntax: 'send "message name" to node target',
      events: ['queueChanged', 'message'],
      arguments: { message: 'text', target: 'node' },
      unavailable: 'Send is only available during simulation.',
    },
    openReserve: {
      syntax: 'open reserve slot using resource staffing',
      events: ['queueChanged', 'message'],
      arguments: { staffing: 'resource' },
      unavailable: 'Reserve slots are only available during simulation.',
    },
  },
  limits: BEHAVIOR_LIMITS,
} satisfies BehaviorLanguageContract;

const developmentContract: BehaviorLanguageContract = {
  ...previewContract,
  version: BEHAVIOR_DEVELOPMENT_VERSION,
  precedence: [['+'], comparisons, ['and']],
  actions: {
    ...previewContract.actions,
    send: {
      ...previewContract.actions.send,
      syntax: 'send "message name" to node target [after seconds]',
      optionalArguments: { seconds: 'number' },
    },
    setStatus: {
      syntax: 'set status of target to status',
      events: ['connectionAdded'],
      arguments: { target: 'node', status: 'text' },
      unavailable: 'Set status is only available in connectionAdded.',
    },
  },
  properties: { context: 'simulation', types: ['text', 'number', 'boolean'], limit: 16 },
  repeatCount: 32,
  delayedSendSeconds: 86_400,
};

export function behaviorLanguageContract(version: number): BehaviorLanguageContract | undefined {
  if (version === BEHAVIOR_PREVIEW_VERSION) return previewContract;
  if (version === BEHAVIOR_DEVELOPMENT_VERSION) return developmentContract;
}
