import {
  BEHAVIOR_DEVELOPMENT_VERSION,
  BEHAVIOR_LIMITS,
  BEHAVIOR_PREVIEW_VERSION,
  behaviorLanguageContract,
  type BehaviorActionKind,
  type BehaviorComparison,
  type BehaviorContext,
  type BehaviorLanguageContract,
  type BehaviorParameterType,
} from './language-contract';

export {
  BEHAVIOR_DEVELOPMENT_VERSION,
  BEHAVIOR_LIMITS,
  BEHAVIOR_PREVIEW_VERSION,
} from './language-contract';
export type { BehaviorContext, BehaviorParameterType } from './language-contract';
export type BehaviorValue = string | number | boolean;
export type BehaviorBindings = Readonly<Record<string, BehaviorValue>>;

export interface BehaviorLocation {
  line: number;
  column: number;
}

export interface BehaviorDiagnostic extends BehaviorLocation {
  code: 'version' | 'syntax' | 'type' | 'context' | 'binding' | 'limit';
  message: string;
}

export interface BehaviorParameter extends BehaviorLocation {
  name: string;
  type: BehaviorParameterType;
  defaultValue?: BehaviorValue;
}

export interface BehaviorProperty extends BehaviorLocation {
  name: string;
  type: 'text' | 'number' | 'boolean';
  initialValue: BehaviorValue;
}

export type BehaviorInstanceState = Readonly<Record<string, BehaviorValue>>;

export type BehaviorEditorEvent = {
  kind: 'connectionAdded';
  edgeId: string;
  source: string;
  target: string;
};
export type BehaviorSimulationEvent =
  | { kind: 'queueChanged'; nodeId: string; previous: number; current: number }
  | { kind: 'message'; name: string; source: string; target: string };
export type BehaviorEvent = BehaviorEditorEvent | BehaviorSimulationEvent;

export type BehaviorEditorAction = BehaviorLocation &
  (
    | { kind: 'rename'; nodeId: string; title: string }
    | { kind: 'setStatus'; nodeId: string; status: string }
  );
export type BehaviorSimulationAction = BehaviorLocation &
  (
    | { kind: 'send'; nodeId: string; message: string; delaySeconds?: number }
    | { kind: 'openReserve'; nodeId: string; resourceId: string }
  );
export type BehaviorAction = BehaviorEditorAction | BehaviorSimulationAction;

export interface BehaviorBindingResolver {
  nodeExists?: (id: string) => boolean;
  resourceExists?: (id: string) => boolean;
}

export interface BehaviorRunOptions extends BehaviorBindingResolver {
  budget?: BehaviorBudget;
  depth?: number;
  timeSeconds?: number;
  state?: BehaviorInstanceState;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: BehaviorDiagnostic };

type Token = BehaviorLocation & {
  kind: 'word' | 'string' | 'number' | 'symbol' | 'end';
  text: string;
};

type Operand = BehaviorLocation & { type: BehaviorParameterType } & (
    | { kind: 'literal'; value: BehaviorValue }
    | { kind: 'parameter' | 'field' | 'property'; name: string }
    | { kind: 'local'; slot: number }
  );
type Expression = Operand | (BehaviorLocation & { kind: 'sum'; type: 'number'; terms: Operand[] });

interface LocalVariable {
  slot: number;
  type: BehaviorParameterType;
}

type Operator = BehaviorComparison;

type Condition =
  | { kind: 'boolean'; left: Expression }
  | { kind: 'comparison'; left: Expression; operator: Operator; right: Expression };

type Statement = BehaviorLocation &
  (
    | {
        kind: 'if';
        conditions: readonly Condition[];
        body: readonly Statement[];
        otherwise?: readonly Statement[];
      }
    | { kind: 'writeLocal'; slot: number; value: Expression }
    | { kind: 'writeProperty'; name: string; value: Expression }
    | { kind: 'repeat'; count: Expression; body: readonly Statement[] }
    | { kind: 'rename'; target: Expression; title: Expression }
    | { kind: 'setStatus'; target: Expression; status: Expression }
    | { kind: 'send'; target: Expression; message: string; delay?: Expression }
    | { kind: 'openReserve'; resource: Expression }
  );

type Handler = BehaviorLocation & { body: readonly Statement[] } & (
    | { kind: 'connectionAdded' | 'queueChanged' }
    | { kind: 'message'; name: string }
  );

export interface BehaviorProgram {
  readonly version: number;
  readonly parameters: readonly BehaviorParameter[];
  readonly properties?: readonly BehaviorProperty[];
  readonly contexts: readonly BehaviorContext[];
  readonly handlers: readonly Handler[];
}

const RESERVED_NAMES = new Set([
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
const DEVELOPMENT_RESERVED_NAMES = new Set(['local', 'else', 'set', 'property', 'repeat', 'after']);
const IDENTIFIER_START = /^[\p{L}_]/u;
const START: BehaviorLocation = { line: 1, column: 1 };

function unsupportedVersion(version: number): { ok: false; error: BehaviorDiagnostic } {
  return {
    ok: false,
    error: {
      ...START,
      code: 'version',
      message: `Behavior language version ${version} is not supported.`,
    },
  };
}

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

function integerInRange(value: BehaviorValue, max: number, where: BehaviorLocation, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    fail('limit', where, `${label} must be an integer from 0 through ${max}.`);
  return value;
}

function failure(error: unknown): { ok: false; error: BehaviorDiagnostic } {
  if (!(error instanceof LanguageError)) throw error;
  return { ok: false, error: error.diagnostic };
}

function tokenize(line: string, lineNumber: number, extended: boolean): Token[] {
  const pattern =
    /\s+|#.*|"(?:[^"\\\x00-\x1f]|\\.)*"|-?\d+|[\p{L}_][\p{L}\p{N}_.]*|==|!=|<=|>=|[=<>+]/uy;
  const tokens: Token[] = [];
  while (pattern.lastIndex < line.length) {
    const column = pattern.lastIndex + 1;
    const match = pattern.exec(line);
    if (!match || (!extended && match[0] === '+'))
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

  peek(ahead = 0): Token {
    return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)];
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

function literal(token: Token): Operand | undefined {
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
  private readonly properties = new Map<string, BehaviorProperty>();
  private readonly handlers: Handler[] = [];
  private locals = new Map<string, LocalVariable>();
  private nextLocal = 0;

  constructor(
    private readonly lines: readonly string[],
    private readonly end: BehaviorLocation,
    private readonly contract: BehaviorLanguageContract,
  ) {}

  private get extended() {
    return this.contract.version === BEHAVIOR_DEVELOPMENT_VERSION;
  }

  parse(): BehaviorProgram {
    let line = this.nextLine();
    while (line) {
      const start = line.take();
      if (start.text === 'parameter') this.parseParameter(line, start);
      else if (start.text === 'property' && this.contract.properties)
        this.parseProperty(line, start, this.contract.properties);
      else if (start.text === 'on') this.parseHandler(line, start);
      else
        fail(
          'syntax',
          start,
          this.extended
            ? 'Expected a parameter, a property or an event handler.'
            : 'Expected a parameter declaration or an event handler.',
        );
      line = this.nextLine();
    }
    if (!this.handlers.length)
      fail('syntax', START, 'A Behavior needs at least one event handler.');
    const contexts = this.contract.contexts.filter((context) =>
      this.handlers.some((handler) => this.contract.events[handler.kind].context === context),
    );
    return {
      version: this.contract.version,
      parameters: [...this.parameters.values()],
      contexts,
      handlers: this.handlers,
      ...(this.properties.size ? { properties: [...this.properties.values()] } : {}),
    };
  }

  private nextLine(): SourceLine | undefined {
    while (this.index < this.lines.length) {
      const source = this.lines[this.index];
      const line = new SourceLine(tokenize(source, ++this.index, this.extended));
      if (line.peek().kind !== 'end') return line;
    }
  }

  private parseParameter(line: SourceLine, start: Token): void {
    if (this.handlers.length) fail('syntax', start, 'Declare parameters before the first handler.');
    if (this.parameters.size >= this.contract.limits.parameters)
      fail('limit', start, 'Too many parameters.');
    const name = line.take();
    if (
      name.kind !== 'word' ||
      name.text.includes('.') ||
      this.isReservedName(name.text) ||
      this.contract.parameterTypes.some((type) => type === name.text)
    ) {
      fail('syntax', name, 'Expected a parameter name.');
    }
    if (name.text.length > this.contract.limits.parameterNameLength) {
      fail('limit', name, 'Parameter name is too long.');
    }
    if (this.parameters.has(name.text))
      fail('syntax', name, `Parameter "${name.text}" is already declared.`);
    if (this.properties.has(name.text)) fail('syntax', name, `"${name.text}" is already declared.`);
    line.expect('as');
    const typeToken = line.take();
    const type = this.contract.parameterTypes.find((type) => type === typeToken.text);
    if (!type) {
      fail('type', typeToken, 'Expected text, number, boolean, node or resource.');
    }
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

  private isReservedName(name: string) {
    return RESERVED_NAMES.has(name) || (this.extended && DEVELOPMENT_RESERVED_NAMES.has(name));
  }

  private parseProperty(
    line: SourceLine,
    start: Token,
    contract: NonNullable<BehaviorLanguageContract['properties']>,
  ): void {
    if (this.handlers.length) fail('syntax', start, 'Declare properties before the first handler.');
    if (this.properties.size >= contract.limit) fail('limit', start, 'Too many properties.');
    const name = line.take();
    this.checkVariableName(name, 'property');
    if (this.parameters.has(name.text) || this.properties.has(name.text))
      fail('syntax', name, `"${name.text}" is already declared.`);
    line.expect('as');
    const typeToken = line.take();
    const type = contract.types.find((type) => type === typeToken.text);
    if (!type) fail('type', typeToken, 'Properties require text, number or boolean.');
    line.expect('=');
    const initial = line.take();
    const expression = literal(initial);
    if (expression?.kind !== 'literal' || expression.type !== type)
      fail('type', initial, `Expected a ${type} literal for the initial value.`);
    line.finish();
    this.properties.set(name.text, {
      ...location(name),
      name: name.text,
      type,
      initialValue: expression.value,
    });
  }

  private parseHandler(line: SourceLine, start: Token): void {
    const event = line.take();
    line.finish();
    if (event.text === 'connectionAdded' || event.text === 'queueChanged') {
      const kind = event.text;
      if (this.handlers.some((handler) => handler.kind === kind)) {
        fail('syntax', event, 'This event already has a handler.');
      }
      this.handlers.push({ ...location(start), kind, body: this.parseBlock(kind, 0).body });
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
      body: this.parseBlock('message', 0).body,
    });
  }

  private parseBlock(
    event: BehaviorEvent['kind'],
    depth: number,
    endKeyword?: 'if' | 'repeat',
    allowElse = false,
  ): { body: Statement[]; hasElse?: true } {
    const body: Statement[] = [];
    const ending = endKeyword ? `end ${endKeyword}` : 'end';
    const enclosingLocals = this.locals;
    this.locals = new Map(enclosingLocals);
    try {
      let line = this.nextLine();
      while (line) {
        const start = line.take();
        if (start.text === 'end') {
          if (endKeyword) line.expect(endKeyword);
          line.finish();
          return { body };
        }
        if (this.extended && allowElse && start.text === 'else') {
          line.finish();
          return { body, hasElse: true };
        }
        if (start.text === 'on')
          fail('syntax', start, `Expected "${ending}" before the next handler.`);
        body.push(this.parseStatement(line, start, event, depth));
        line = this.nextLine();
      }
      fail('syntax', this.end, `Expected "${ending}" before the end of the source.`);
    } finally {
      this.locals = enclosingLocals;
    }
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
        if (depth >= this.contract.limits.nestingDepth)
          fail(
            'limit',
            start,
            this.extended ? 'Too many nested blocks.' : 'Too many nested if blocks.',
          );
        const conditions = [this.parseCondition(line, event)];
        while (line.accept('and')) conditions.push(this.parseCondition(line, event));
        line.expect('then');
        line.finish();
        const branch = this.parseBlock(event, depth + 1, 'if', true);
        return {
          ...where,
          kind: 'if',
          conditions,
          body: branch.body,
          ...(branch.hasElse ? { otherwise: this.parseBlock(event, depth + 1, 'if').body } : {}),
        };
      }
      case 'rename': {
        const args = this.actionArguments('rename', event, start);
        const target = this.parseExpression(line, event, args.target);
        line.expect('to');
        const title = this.parseExpression(line, event, args.title);
        line.finish();
        return { ...where, kind: 'rename', target, title };
      }
      case 'send': {
        const args = this.actionArguments('send', event, start);
        const message = messageName(line.take());
        line.expect('to');
        line.expect('node');
        const target = this.parseExpression(line, event, args.target);
        let delay: Expression | undefined;
        const maxDelay = this.contract.delayedSendSeconds;
        const delayType = this.contract.actions.send?.optionalArguments?.seconds;
        if (maxDelay !== undefined && delayType && line.accept('after')) {
          delay = this.parseExpression(line, event, delayType);
          if (delay.kind === 'literal')
            integerInRange(delay.value, maxDelay, delay, 'Message delay in seconds');
        }
        line.finish();
        return { ...where, kind: 'send', target, message, ...(delay ? { delay } : {}) };
      }
      case 'open': {
        const args = this.actionArguments('openReserve', event, start);
        line.expect('reserve');
        line.expect('slot');
        line.expect('using');
        line.expect('resource');
        const resource = this.parseExpression(line, event, args.staffing);
        line.finish();
        return { ...where, kind: 'openReserve', resource };
      }
    }
    if (this.extended) {
      if (start.text === 'local') return this.parseLocal(line, start, event);
      if (start.text === 'set') return this.parseAssignment(line, start, event);
      if (start.text === 'repeat' && this.contract.repeatCount !== undefined) {
        if (depth >= this.contract.limits.nestingDepth)
          fail('limit', start, 'Too many nested blocks.');
        const count = this.parseExpression(line, event, 'number');
        if (count.kind === 'literal')
          integerInRange(count.value, this.contract.repeatCount, start, 'Repeat count');
        line.finish();
        return {
          ...where,
          kind: 'repeat',
          count,
          body: this.parseBlock(event, depth + 1, 'repeat').body,
        };
      }
      fail('syntax', start, 'Expected if, local, set, repeat, rename, send or open reserve slot.');
    }
    fail('syntax', start, 'Expected if, rename, send or open reserve slot.');
  }

  private parseLocal(line: SourceLine, start: Token, event: BehaviorEvent['kind']): Statement {
    const name = line.take();
    this.checkVariableName(name, 'local variable');
    if (
      this.locals.has(name.text) ||
      this.parameters.has(name.text) ||
      this.properties.has(name.text)
    )
      fail('syntax', name, `"${name.text}" is already in scope.`);
    line.expect('as');
    const typeToken = line.take();
    const type = this.contract.parameterTypes.find((type) => type === typeToken.text);
    if (!type) fail('type', typeToken, 'Expected text, number, boolean, node or resource.');
    line.expect('=');
    const value = this.parseExpression(line, event, type);
    line.finish();
    const slot = this.nextLocal++;
    this.locals.set(name.text, { slot, type });
    return { ...location(start), kind: 'writeLocal', slot, value };
  }

  private checkVariableName(name: Token, kind: 'local variable' | 'property') {
    if (
      name.kind !== 'word' ||
      name.text.includes('.') ||
      this.isReservedName(name.text) ||
      this.contract.parameterTypes.some((type) => type === name.text)
    )
      fail('syntax', name, `Expected a ${kind} name.`);
    if (name.text.length > this.contract.limits.parameterNameLength)
      fail('limit', name, `The ${kind} name is too long.`);
  }

  private parseAssignment(line: SourceLine, start: Token, event: BehaviorEvent['kind']): Statement {
    if (line.peek().text === 'status' && line.peek(1).text === 'of') {
      const args = this.actionArguments('setStatus', event, start);
      line.take();
      line.take();
      const target = this.parseExpression(line, event, args.target);
      line.expect('to');
      const status = this.parseExpression(line, event, args.status);
      line.finish();
      return { ...location(start), kind: 'setStatus', target, status };
    }
    const name = line.take();
    if (
      this.parameters.has(name.text) ||
      Object.hasOwn(this.contract.events[event].fields, name.text)
    )
      fail('context', name, `"${name.text}" is read-only.`);
    const variable = this.locals.get(name.text);
    const property = this.readProperty(name, event);
    const mutable = variable ?? property;
    if (!mutable) fail('syntax', name, 'Expected a local variable or property in scope.');
    line.expect('to');
    const value = this.parseExpression(line, event, mutable.type);
    line.finish();
    return variable
      ? { ...location(start), kind: 'writeLocal', slot: variable.slot, value }
      : { ...location(start), kind: 'writeProperty', name: name.text, value };
  }

  private readProperty(name: Token, event: BehaviorEvent['kind']) {
    const property = this.properties.get(name.text);
    if (property && this.contract.events[event].context !== this.contract.properties?.context)
      fail('context', name, 'Properties are only available during simulation.');
    return property;
  }

  private actionArguments<Kind extends BehaviorActionKind>(
    action: Kind,
    event: BehaviorEvent['kind'],
    where: Token,
  ) {
    const entry = this.contract.actions[action];
    if (!entry) fail('context', where, 'This action is unavailable in this language version.');
    if (!entry.events.includes(event)) fail('context', where, entry.unavailable);
    return entry.arguments;
  }

  private parseCondition(line: SourceLine, event: BehaviorEvent['kind']): Condition {
    const left = this.parseExpression(line, event);
    const token = line.peek();
    const operator = this.contract.comparisons.find((operator) => operator === token.text);
    if (!operator) {
      if (left.type !== 'boolean') fail('type', left, 'Expected a comparison or a boolean value.');
      return { kind: 'boolean', left };
    }
    line.take();
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
    const first = this.parseOperand(line, event);
    let expression: Expression = first;
    if (this.extended && line.accept('+')) {
      if (first.type !== 'number') fail('type', first, 'Addition requires number values.');
      const terms = [first];
      do {
        const term = this.parseOperand(line, event);
        if (term.type !== 'number') fail('type', term, 'Addition requires number values.');
        terms.push(term);
      } while (line.accept('+'));
      expression = { ...location(first), kind: 'sum', type: 'number', terms };
    }
    if (expected && expression.type !== expected)
      fail('type', expression, `Expected a ${expected} value.`);
    return expression;
  }

  private parseOperand(line: SourceLine, event: BehaviorEvent['kind']): Operand {
    const token = line.take();
    let expression = literal(token);
    if (!expression) {
      const name = token.text;
      const fields = this.contract.events[event].fields;
      if (Object.hasOwn(fields, name)) {
        expression = { ...location(token), kind: 'field', name, type: fields[name] };
      } else if (name.includes('.')) {
        fail('context', token, `Field "${name}" is unavailable in this handler.`);
      } else {
        const variable = this.locals.get(name);
        if (variable) return { ...location(token), kind: 'local', ...variable };
        const property = this.readProperty(token, event);
        if (property) return { ...location(token), kind: 'property', name, type: property.type };
        const parameter = this.parameters.get(name);
        if (!parameter)
          fail(
            'syntax',
            token,
            this.extended
              ? 'Expected a literal, local variable, parameter or event field.'
              : 'Expected a literal, parameter or event field.',
          );
        expression = { ...location(token), kind: 'parameter', name, type: parameter.type };
      }
    }
    return expression;
  }
}

export function compileBehavior(
  source: string,
  version: number = BEHAVIOR_PREVIEW_VERSION,
): Result<{ program: BehaviorProgram }> {
  const contract = behaviorLanguageContract(version);
  if (!contract) return unsupportedVersion(version);
  try {
    if (source.length > contract.limits.sourceLength)
      fail('limit', START, 'Behavior source is too long.');
    const lines = source.split(/\r\n|\r|\n/u);
    if (lines.length > contract.limits.lines) {
      fail('limit', { line: contract.limits.lines + 1, column: 1 }, 'Behavior has too many lines.');
    }
    const end = { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
    return { ok: true, program: new Parser(lines, end, contract).parse() };
  } catch (error) {
    return failure(error);
  }
}

/** The staging UI and simulator still execute the shipped version only. */
export function compilePreviewBehavior(source: string, version: number) {
  return version === BEHAVIOR_PREVIEW_VERSION
    ? compileBehavior(source, version)
    : unsupportedVersion(version);
}

export function validateBehaviorBindings(
  program: BehaviorProgram,
  bindings: BehaviorBindings,
  resolver: BehaviorBindingResolver = {},
): Result<{ bindings: BehaviorBindings }> {
  const contract = behaviorLanguageContract(program.version);
  if (!contract) return unsupportedVersion(program.version);
  try {
    const values: Record<string, BehaviorValue> = Object.create(null);
    for (const parameter of program.parameters) {
      const { name, type, defaultValue } = parameter;
      const value = Object.hasOwn(bindings, name) ? bindings[name] : defaultValue;
      if (value === undefined) fail('binding', parameter, `Set a value for parameter "${name}".`);
      if (typeof value === 'string' && value.length > contract.limits.sourceLength) {
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

export function createBehaviorInstanceState(program: BehaviorProgram): BehaviorInstanceState {
  return Object.fromEntries(
    (program.properties ?? []).map(({ name, initialValue }) => [name, initialValue]),
  );
}

function copyInstanceState(
  properties: readonly BehaviorProperty[],
  state: BehaviorInstanceState,
  maxText: number,
): Result<{ state: Record<string, BehaviorValue> }> {
  const entries: [string, BehaviorValue][] = [];
  for (const property of properties) {
    const value = Object.hasOwn(state, property.name) ? state[property.name] : undefined;
    if (
      value === undefined ||
      typeof value !== typeof property.initialValue ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      (typeof value === 'string' && value.length > maxText)
    )
      return {
        ok: false,
        error: {
          ...location(property),
          code: 'binding',
          message: `Property "${property.name}" state requires a valid ${property.type}.`,
        },
      };
    entries.push([property.name, value]);
  }
  return { ok: true, state: Object.fromEntries(entries) };
}

export function runBehavior(
  program: BehaviorProgram,
  bindings: BehaviorBindings,
  event: BehaviorEvent,
  options: BehaviorRunOptions = {},
): Result<{ actions: BehaviorAction[]; state?: BehaviorInstanceState }> {
  const contract = behaviorLanguageContract(program.version);
  if (!contract) return unsupportedVersion(program.version);
  const { limits, repeatCount = 0, delayedSendSeconds = 0 } = contract;
  const handler = findHandler(program, event);
  let stagedState: Record<string, BehaviorValue> | undefined;
  if (event.kind !== 'connectionAdded' && program.properties?.length) {
    const copied = copyInstanceState(
      program.properties,
      options.state ?? createBehaviorInstanceState(program),
      limits.sourceLength,
    );
    if (!copied.ok) return copied;
    stagedState = copied.state;
  }
  function success(actions: BehaviorAction[]) {
    return { ok: true as const, actions, ...(stagedState ? { state: stagedState } : {}) };
  }
  if (!handler) return success([]);
  const resolved = validateBehaviorBindings(program, bindings, options);
  if (!resolved.ok) return resolved;
  const actions: BehaviorAction[] = [];
  const fields = eventFields(event);
  const locals = new Map<number, BehaviorValue>();
  const depth = options.depth ?? 0;
  let instructions = 0;

  function readOperand(expression: Operand): BehaviorValue {
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind === 'local') return locals.get(expression.slot)!;
    if (expression.kind === 'property') return stagedState![expression.name];
    return (expression.kind === 'field' ? fields : resolvedBindings)[expression.name];
  }

  function read(expression: Expression): BehaviorValue {
    if (expression.kind !== 'sum') return readOperand(expression);
    const [first, ...terms] = expression.terms;
    let result = readOperand(first) as number;
    for (const term of terms) {
      step(term);
      result += readOperand(term) as number;
      if (!Number.isSafeInteger(result))
        fail('type', term, 'Addition exceeded the safe integer range.');
    }
    return result;
  }

  function step(where: BehaviorLocation): void {
    instructions += 1;
    if (instructions > limits.instructionsPerHandler)
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
        else if (statement.otherwise) execute(statement.otherwise);
        continue;
      }
      if (statement.kind === 'writeLocal') {
        locals.set(statement.slot, read(statement.value));
        continue;
      }
      if (statement.kind === 'writeProperty') {
        stagedState![statement.name] = read(statement.value);
        continue;
      }
      if (statement.kind === 'repeat') {
        const count = integerInRange(read(statement.count), repeatCount, statement, 'Repeat count');
        for (let index = 0; index < count; index += 1) {
          step(statement);
          execute(statement.body);
        }
        continue;
      }
      const where = location(statement);
      if (actions.length >= limits.actionsPerHandler)
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
        case 'setStatus':
          actions.push({
            ...where,
            kind: 'setStatus',
            nodeId: read(statement.target) as string,
            status: read(statement.status) as string,
          });
          break;
        case 'send': {
          const delay = statement.delay;
          const seconds = delay
            ? integerInRange(read(delay), delayedSendSeconds, delay, 'Message delay in seconds')
            : 0;
          actions.push({
            ...where,
            kind: 'send',
            nodeId: read(statement.target) as string,
            message: statement.message,
            ...(seconds ? { delaySeconds: seconds } : {}),
          });
          break;
        }
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
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > limits.messageDepth) {
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
    return success(actions);
  } catch (error) {
    return failure(error);
  }
}
