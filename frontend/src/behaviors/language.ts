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

export type BehaviorParameterType = 'text' | 'number' | 'boolean' | 'node' | 'resource';
export type BehaviorValue = string | number | boolean;
export type BehaviorBindings = Readonly<Record<string, BehaviorValue>>;
export type BehaviorContext = 'editor' | 'simulation';

export interface BehaviorLocation {
  line: number;
  column: number;
}

export interface BehaviorDiagnostic extends BehaviorLocation {
  code: 'syntax' | 'type' | 'context' | 'binding' | 'limit';
  message: string;
}

export interface BehaviorParameter extends BehaviorLocation {
  name: string;
  type: BehaviorParameterType;
  defaultValue?: BehaviorValue;
}

export type BehaviorEvent =
  | { kind: 'connectionAdded'; edgeId: string; source: string; target: string }
  | { kind: 'queueChanged'; nodeId: string; previous: number; current: number }
  | { kind: 'message'; name: string; source: string; target: string };

export type BehaviorAction = BehaviorLocation &
  (
    | { kind: 'rename'; nodeId: string; title: string }
    | { kind: 'send'; nodeId: string; message: string }
    | { kind: 'openReserve'; nodeId: string; resourceId: string }
  );

export interface BehaviorBindingResolver {
  nodeExists?: (id: string) => boolean;
  resourceExists?: (id: string) => boolean;
}

export interface BehaviorRunOptions extends BehaviorBindingResolver {
  budget?: BehaviorBudget;
  depth?: number;
  timeSeconds?: number;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: BehaviorDiagnostic };

type Token = BehaviorLocation & {
  kind: 'word' | 'string' | 'number' | 'symbol' | 'end';
  text: string;
};

type Expression = BehaviorLocation & { type: BehaviorParameterType } & (
    | { kind: 'literal'; value: BehaviorValue }
    | { kind: 'parameter' | 'field'; name: string }
  );

type Operator = '==' | '!=' | '<' | '<=' | '>' | '>=';

type Condition =
  | { kind: 'boolean'; left: Expression }
  | { kind: 'comparison'; left: Expression; operator: Operator; right: Expression };

type Statement = BehaviorLocation &
  (
    | { kind: 'if'; conditions: readonly Condition[]; body: readonly Statement[] }
    | { kind: 'rename'; target: Expression; title: Expression }
    | { kind: 'send'; target: Expression; message: string }
    | { kind: 'openReserve'; resource: Expression }
  );

type Handler = BehaviorLocation & { body: readonly Statement[] } & (
    | { kind: 'connectionAdded' | 'queueChanged' }
    | { kind: 'message'; name: string }
  );

export interface BehaviorProgram {
  readonly parameters: readonly BehaviorParameter[];
  readonly contexts: readonly BehaviorContext[];
  readonly handlers: readonly Handler[];
}

const PARAMETER_TYPES = new Set<string>(['text', 'number', 'boolean', 'node', 'resource']);
const RESERVED_NAMES = new Set([
  ...PARAMETER_TYPES,
  'parameter',
  'as',
  'on',
  'end',
  'if',
  'then',
  'and',
  'rename',
  'to',
  'send',
  'open',
  'reserve',
  'slot',
  'using',
  'true',
  'false',
  'event',
  'queue',
]);
const OPERATORS = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
const IDENTIFIER_START = /^[\p{L}_]/u;
const FIELD_TYPES: Readonly<
  Record<BehaviorEvent['kind'], Readonly<Record<string, BehaviorParameterType>>>
> = {
  connectionAdded: { 'event.edgeId': 'text', 'event.source': 'node', 'event.target': 'node' },
  queueChanged: { 'queue.previousLength': 'number', 'queue.length': 'number' },
  message: { 'event.source': 'node', 'event.target': 'node' },
};
const START: BehaviorLocation = { line: 1, column: 1 };

function location({ line, column }: BehaviorLocation): BehaviorLocation {
  return { line, column };
}

class LanguageError extends Error {
  readonly diagnostic: BehaviorDiagnostic;

  constructor(code: BehaviorDiagnostic['code'], where: BehaviorLocation, message: string) {
    super(message);
    this.diagnostic = { ...location(where), code, message };
  }
}

function fail(code: BehaviorDiagnostic['code'], where: BehaviorLocation, message: string): never {
  throw new LanguageError(code, where, message);
}

function failure(error: unknown): { ok: false; error: BehaviorDiagnostic } {
  if (!(error instanceof LanguageError)) throw error;
  return { ok: false, error: error.diagnostic };
}

function tokenize(line: string, lineNumber: number): Token[] {
  const pattern =
    /\s+|#.*|"(?:[^"\\\x00-\x1f]|\\.)*"|-?\d+|[\p{L}_][\p{L}\p{N}_.]*|==|!=|<=|>=|[=<>]/uy;
  const tokens: Token[] = [];
  while (pattern.lastIndex < line.length) {
    const column = pattern.lastIndex + 1;
    const match = pattern.exec(line);
    if (!match)
      fail('syntax', { line: lineNumber, column }, 'Unexpected character or unclosed string.');
    const text = match[0];
    if (text.startsWith('#')) break;
    if (/^\s/u.test(text)) continue;
    let kind: Token['kind'] = 'symbol';
    if (text.startsWith('"')) kind = 'string';
    else if (/^[-\d]/u.test(text)) kind = 'number';
    else if (IDENTIFIER_START.test(text)) kind = 'word';
    tokens.push({ kind, text, line: lineNumber, column });
  }
  tokens.push({ kind: 'end', text: '', line: lineNumber, column: line.length + 1 });
  return tokens;
}

class SourceLine {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  peek(): Token {
    return this.tokens[this.index];
  }

  take(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index += 1;
    return token;
  }

  accept(word: string): boolean {
    if (this.peek().text !== word) return false;
    this.take();
    return true;
  }

  expect(word: string): void {
    if (!this.accept(word)) fail('syntax', this.peek(), `Expected "${word}".`);
  }

  finish(): void {
    if (this.peek().kind !== 'end')
      fail('syntax', this.peek(), 'Unexpected text at the end of the line.');
  }
}

function stringValue(token: Token): string {
  if (token.kind !== 'string') fail('syntax', token, 'Expected a quoted string.');
  try {
    return JSON.parse(token.text) as string;
  } catch {
    fail('syntax', token, 'Invalid string escape.');
  }
}

function messageName(token: Token): string {
  const name = stringValue(token);
  if (!name.trim() || name.length > BEHAVIOR_LIMITS.messageLength || /\p{Cc}/u.test(name)) {
    fail(
      'type',
      token,
      `A message name must use 1–${BEHAVIOR_LIMITS.messageLength} printable characters.`,
    );
  }
  return name;
}

function literal(token: Token): Expression | undefined {
  if (token.kind === 'string')
    return { ...location(token), kind: 'literal', type: 'text', value: stringValue(token) };
  if (token.kind === 'number') {
    const value = Number(token.text);
    if (!Number.isSafeInteger(value)) fail('type', token, 'Expected a safe integer.');
    return { ...location(token), kind: 'literal', type: 'number', value };
  }
  if (token.text === 'true' || token.text === 'false') {
    return { ...location(token), kind: 'literal', type: 'boolean', value: token.text === 'true' };
  }
}

class Parser {
  private index = 0;
  private readonly parameters = new Map<string, BehaviorParameter>();
  private readonly handlers: Handler[] = [];

  constructor(
    private readonly lines: readonly string[],
    private readonly end: BehaviorLocation,
  ) {}

  parse(): BehaviorProgram {
    let line = this.nextLine();
    while (line) {
      const start = line.take();
      if (start.text === 'parameter') this.parseParameter(line, start);
      else if (start.text === 'on') this.parseHandler(line, start);
      else fail('syntax', start, 'Expected a parameter declaration or an event handler.');
      line = this.nextLine();
    }
    if (!this.handlers.length)
      fail('syntax', START, 'A Behavior needs at least one event handler.');
    const contexts: BehaviorContext[] = [];
    if (this.handlers.some((handler) => handler.kind === 'connectionAdded'))
      contexts.push('editor');
    if (this.handlers.some((handler) => handler.kind !== 'connectionAdded'))
      contexts.push('simulation');
    return { parameters: [...this.parameters.values()], contexts, handlers: this.handlers };
  }

  private nextLine(): SourceLine | undefined {
    while (this.index < this.lines.length) {
      const source = this.lines[this.index];
      const line = new SourceLine(tokenize(source, ++this.index));
      if (line.peek().kind !== 'end') return line;
    }
  }

  private parseParameter(line: SourceLine, start: Token): void {
    if (this.handlers.length) fail('syntax', start, 'Declare parameters before the first handler.');
    if (this.parameters.size >= BEHAVIOR_LIMITS.parameters)
      fail('limit', start, 'Too many parameters.');
    const name = line.take();
    if (name.kind !== 'word' || name.text.includes('.') || RESERVED_NAMES.has(name.text)) {
      fail('syntax', name, 'Expected a parameter name.');
    }
    if (name.text.length > BEHAVIOR_LIMITS.parameterNameLength) {
      fail('limit', name, 'Parameter name is too long.');
    }
    if (this.parameters.has(name.text))
      fail('syntax', name, `Parameter "${name.text}" is already declared.`);
    line.expect('as');
    const typeToken = line.take();
    if (!PARAMETER_TYPES.has(typeToken.text)) {
      fail('type', typeToken, 'Expected text, number, boolean, node or resource.');
    }
    const type = typeToken.text as BehaviorParameterType;
    const parameter: BehaviorParameter = { ...location(name), name: name.text, type };
    if (line.accept('=')) {
      const value = line.take();
      if (type === 'node' || type === 'resource') {
        fail('type', value, `Choose a ${type} in each instance's parameters.`);
      }
      const expression = literal(value);
      if (expression?.kind !== 'literal' || expression.type !== type) {
        fail('type', value, `Expected a ${type} literal for the default value.`);
      }
      parameter.defaultValue = expression.value;
    }
    line.finish();
    this.parameters.set(parameter.name, parameter);
  }

  private parseHandler(line: SourceLine, start: Token): void {
    const event = line.take();
    line.finish();
    if (event.text === 'connectionAdded' || event.text === 'queueChanged') {
      const kind = event.text;
      if (this.handlers.some((handler) => handler.kind === kind)) {
        fail('syntax', event, 'This event already has a handler.');
      }
      this.handlers.push({ ...location(start), kind, body: this.parseBlock(kind, 0) });
      return;
    }
    if (event.kind !== 'string')
      fail('syntax', event, 'Expected connectionAdded, queueChanged or a quoted message name.');
    const name = messageName(event);
    if (this.handlers.some((handler) => handler.kind === 'message' && handler.name === name)) {
      fail('syntax', event, 'This message already has a handler.');
    }
    this.handlers.push({
      ...location(start),
      kind: 'message',
      name,
      body: this.parseBlock('message', 0),
    });
  }

  private parseBlock(event: BehaviorEvent['kind'], depth: number): Statement[] {
    const body: Statement[] = [];
    const ending = depth === 0 ? 'end' : 'end if';
    let line = this.nextLine();
    while (line) {
      const start = line.take();
      if (start.text === 'end') {
        if (depth > 0) line.expect('if');
        line.finish();
        return body;
      }
      if (start.text === 'on')
        fail('syntax', start, `Expected "${ending}" before the next handler.`);
      body.push(this.parseStatement(line, start, event, depth));
      line = this.nextLine();
    }
    fail('syntax', this.end, `Expected "${ending}" before the end of the source.`);
  }

  private parseStatement(
    line: SourceLine,
    start: Token,
    event: BehaviorEvent['kind'],
    depth: number,
  ): Statement {
    const where = location(start);
    switch (start.text) {
      case 'if': {
        if (depth >= BEHAVIOR_LIMITS.nestingDepth)
          fail('limit', start, 'Too many nested if blocks.');
        const conditions = [this.parseCondition(line, event)];
        while (line.accept('and')) conditions.push(this.parseCondition(line, event));
        line.expect('then');
        line.finish();
        return { ...where, kind: 'if', conditions, body: this.parseBlock(event, depth + 1) };
      }
      case 'rename': {
        if (event !== 'connectionAdded')
          fail('context', start, 'Rename is only available in connectionAdded.');
        const target = this.parseExpression(line, event, 'node');
        line.expect('to');
        const title = this.parseExpression(line, event, 'text');
        line.finish();
        return { ...where, kind: 'rename', target, title };
      }
      case 'send': {
        if (event === 'connectionAdded')
          fail('context', start, 'Send is only available during simulation.');
        const message = messageName(line.take());
        line.expect('to');
        line.expect('node');
        const target = this.parseExpression(line, event, 'node');
        line.finish();
        return { ...where, kind: 'send', target, message };
      }
      case 'open': {
        if (event === 'connectionAdded')
          fail('context', start, 'Reserve slots are only available during simulation.');
        line.expect('reserve');
        line.expect('slot');
        line.expect('using');
        line.expect('resource');
        const resource = this.parseExpression(line, event, 'resource');
        line.finish();
        return { ...where, kind: 'openReserve', resource };
      }
      default:
        fail('syntax', start, 'Expected if, rename, send or open reserve slot.');
    }
  }

  private parseCondition(line: SourceLine, event: BehaviorEvent['kind']): Condition {
    const left = this.parseExpression(line, event);
    const token = line.peek();
    if (!OPERATORS.has(token.text)) {
      if (left.type !== 'boolean') fail('type', left, 'Expected a comparison or a boolean value.');
      return { kind: 'boolean', left };
    }
    const operator = line.take().text as Operator;
    const right = this.parseExpression(line, event, left.type);
    if (operator !== '==' && operator !== '!=' && left.type !== 'number') {
      fail('type', token, 'Ordering comparisons require number values.');
    }
    return { kind: 'comparison', operator, left, right };
  }

  private parseExpression(
    line: SourceLine,
    event: BehaviorEvent['kind'],
    expected?: BehaviorParameterType,
  ): Expression {
    const token = line.take();
    let expression = literal(token);
    if (!expression) {
      const name = token.text;
      const fields = FIELD_TYPES[event];
      if (Object.hasOwn(fields, name)) {
        expression = { ...location(token), kind: 'field', name, type: fields[name] };
      } else if (name.includes('.')) {
        fail('context', token, `Field "${name}" is unavailable in this handler.`);
      } else {
        const parameter = this.parameters.get(name);
        if (!parameter) fail('syntax', token, 'Expected a literal, parameter or event field.');
        expression = { ...location(token), kind: 'parameter', name, type: parameter.type };
      }
    }
    if (expected && expression.type !== expected)
      fail('type', token, `Expected a ${expected} value.`);
    return expression;
  }
}

export function compileBehavior(source: string): Result<{ program: BehaviorProgram }> {
  try {
    if (source.length > BEHAVIOR_LIMITS.sourceLength)
      fail('limit', START, 'Behavior source is too long.');
    const lines = source.split(/\r\n|\r|\n/u);
    if (lines.length > BEHAVIOR_LIMITS.lines) {
      fail('limit', { line: BEHAVIOR_LIMITS.lines + 1, column: 1 }, 'Behavior has too many lines.');
    }
    const end = { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
    return { ok: true, program: new Parser(lines, end).parse() };
  } catch (error) {
    return failure(error);
  }
}

export function validateBehaviorBindings(
  program: BehaviorProgram,
  bindings: BehaviorBindings,
  resolver: BehaviorBindingResolver = {},
): Result<{ bindings: BehaviorBindings }> {
  try {
    const values: Record<string, BehaviorValue> = Object.create(null);
    for (const parameter of program.parameters) {
      const { name, type, defaultValue } = parameter;
      const value = Object.hasOwn(bindings, name) ? bindings[name] : defaultValue;
      if (value === undefined) fail('binding', parameter, `Set a value for parameter "${name}".`);
      if (typeof value === 'string' && value.length > BEHAVIOR_LIMITS.sourceLength) {
        fail('limit', parameter, `The value of parameter "${name}" is too long.`);
      }
      switch (type) {
        case 'number':
          if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            fail('binding', parameter, `Parameter "${name}" requires a safe integer.`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean')
            fail('binding', parameter, `Parameter "${name}" requires a boolean.`);
          break;
        case 'text':
          if (typeof value !== 'string')
            fail('binding', parameter, `Parameter "${name}" requires text.`);
          break;
        case 'node':
        case 'resource': {
          if (typeof value !== 'string' || !value.trim()) {
            fail('binding', parameter, `Choose a ${type} for parameter "${name}".`);
          }
          const exists = type === 'node' ? resolver.nodeExists : resolver.resourceExists;
          if (exists && !exists(value))
            fail('binding', parameter, `The ${type} for "${name}" is unavailable.`);
          break;
        }
      }
      values[name] = value;
    }
    return { ok: true, bindings: values };
  } catch (error) {
    return failure(error);
  }
}

function findHandler(program: BehaviorProgram, event: BehaviorEvent): Handler | undefined {
  return program.handlers.find(
    (handler) =>
      handler.kind === event.kind &&
      (handler.kind !== 'message' || (event.kind === 'message' && handler.name === event.name)),
  );
}

export function behaviorHandlerLocation(
  program: BehaviorProgram,
  event: BehaviorEvent,
): BehaviorLocation | undefined {
  const handler = findHandler(program, event);
  return handler && location(handler);
}

export function hasBehaviorHandler(program: BehaviorProgram, event: BehaviorEvent): boolean {
  return findHandler(program, event) !== undefined;
}

export class BehaviorBudget {
  private lastTime: number | undefined;
  private messagesAtTime = 0;
  private messagesInRun = 0;

  chargeSends(sends: readonly BehaviorLocation[], timeSeconds: number, depth: number): void {
    if (!sends.length) return;
    if (depth >= BEHAVIOR_LIMITS.messageDepth)
      fail('limit', sends[0], 'Message chain is too deep.');
    const alreadyAtTime = this.lastTime === timeSeconds ? this.messagesAtTime : 0;
    const remainingInRun = BEHAVIOR_LIMITS.messagesPerRun - this.messagesInRun;
    const remainingAtTime = BEHAVIOR_LIMITS.messagesPerTime - alreadyAtTime;
    if (sends.length > remainingInRun && remainingInRun <= remainingAtTime) {
      fail('limit', sends[remainingInRun], 'Too many messages in this simulation run.');
    }
    if (sends.length > remainingAtTime) {
      fail('limit', sends[remainingAtTime], 'Too many messages at this simulation time.');
    }
    this.lastTime = timeSeconds;
    this.messagesAtTime = alreadyAtTime + sends.length;
    this.messagesInRun += sends.length;
  }
}

export function createBehaviorBudget(): BehaviorBudget {
  return new BehaviorBudget();
}

function eventFields(event: BehaviorEvent): BehaviorBindings {
  switch (event.kind) {
    case 'connectionAdded':
      return {
        'event.edgeId': event.edgeId,
        'event.source': event.source,
        'event.target': event.target,
      };
    case 'queueChanged':
      return { 'queue.previousLength': event.previous, 'queue.length': event.current };
    case 'message':
      return { 'event.source': event.source, 'event.target': event.target };
  }
}

function compare(operator: Operator, left: BehaviorValue, right: BehaviorValue): boolean {
  if (operator === '==') return left === right;
  if (operator === '!=') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

export function runBehavior(
  program: BehaviorProgram,
  bindings: BehaviorBindings,
  event: BehaviorEvent,
  options: BehaviorRunOptions = {},
): Result<{ actions: BehaviorAction[] }> {
  const handler = findHandler(program, event);
  if (!handler) return { ok: true, actions: [] };
  const resolved = validateBehaviorBindings(program, bindings, options);
  if (!resolved.ok) return resolved;
  const actions: BehaviorAction[] = [];
  const fields = eventFields(event);
  const depth = options.depth ?? 0;
  let instructions = 0;

  function read(expression: Expression): BehaviorValue {
    if (expression.kind === 'literal') return expression.value;
    return (expression.kind === 'field' ? fields : resolvedBindings)[expression.name];
  }

  function step(where: BehaviorLocation): void {
    instructions += 1;
    if (instructions > BEHAVIOR_LIMITS.instructionsPerHandler)
      fail('limit', where, 'Too much work in one handler.');
  }

  function test(condition: Condition): boolean {
    step(condition.left);
    const left = read(condition.left);
    if (condition.kind === 'boolean') return left === true;
    return compare(condition.operator, left, read(condition.right));
  }

  function execute(body: readonly Statement[]): void {
    for (const statement of body) {
      step(statement);
      if (statement.kind === 'if') {
        if (statement.conditions.every(test)) execute(statement.body);
        continue;
      }
      const where = location(statement);
      if (actions.length >= BEHAVIOR_LIMITS.actionsPerHandler)
        fail('limit', where, 'Too many actions in one handler.');
      switch (statement.kind) {
        case 'rename':
          actions.push({
            ...where,
            kind: 'rename',
            nodeId: read(statement.target) as string,
            title: read(statement.title) as string,
          });
          break;
        case 'send':
          actions.push({
            ...where,
            kind: 'send',
            nodeId: read(statement.target) as string,
            message: statement.message,
          });
          break;
        case 'openReserve':
          if (event.kind === 'connectionAdded')
            fail('context', where, 'Reserve slots are only available during simulation.');
          actions.push({
            ...where,
            kind: 'openReserve',
            nodeId: event.kind === 'message' ? event.target : event.nodeId,
            resourceId: read(statement.resource) as string,
          });
          break;
      }
    }
  }

  const resolvedBindings = resolved.bindings;
  try {
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > BEHAVIOR_LIMITS.messageDepth) {
      fail('limit', handler, 'Message chain is too deep.');
    }
    execute(handler.body);
    const sends = actions.filter((action) => action.kind === 'send');
    if (sends.length)
      (options.budget ?? createBehaviorBudget()).chargeSends(
        sends,
        options.timeSeconds ?? 0,
        depth,
      );
    return { ok: true, actions };
  } catch (error) {
    return failure(error);
  }
}
