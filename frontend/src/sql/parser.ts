import { blankGraph, newEdge, newNode, type Graph } from '../model/types';
import type { SqlColumn, SqlRelationship, SqlTable } from './schema';
import { parseSqlQueries } from './query';
import {
  assertImportBytes,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
  LARGE_IMPORT_WARNING,
  utf8Bytes,
} from '../imports/limits';

export const sqlLimits = {
  bytes: DEFAULT_IMPORT_LIMIT_BYTES,
  tables: 2000,
  columns: 100_000,
  relationships: 10_000,
  warnings: 100,
} as const;

export interface SqlImportResult {
  graph: Graph;
  warnings: string[];
  tableCount: number;
  columnCount: number;
  relationshipCount: number;
  ignoredStatementCount: number;
  kind?: 'schema' | 'query';
  queryCount?: number;
  sourceCount?: number;
  outputColumnCount?: number;
}

export type Token = {
  kind: 'word' | 'identifier' | 'literal' | 'symbol';
  text: string;
  key?: string;
  raw?: string;
  start?: number;
  end?: number;
};
type Name = { parts: string[]; keys: string[] };
type ForeignKey = {
  columns: Token[];
  target: Name;
  referenced?: Token[];
  name?: string;
  onDelete?: string;
  onUpdate?: string;
};
type Table = {
  name: Name;
  columns: Map<string, SqlColumn>;
  primary: Token[];
  unique: Token[][];
  foreign: ForeignKey[];
};
const word = (token: Token | undefined, value: string) =>
  token?.kind === 'word' && token.text.toUpperCase() === value;
const identifier = (token: Token | undefined): token is Token =>
  !!token && (token.kind === 'word' || token.kind === 'identifier') && !!token.text;
const key = (name: Name) => JSON.stringify(name.keys);
const columnKey = (token: Token) => token.key ?? token.text.toLowerCase();
function fail(message: string): never {
  throw new Error(`SQL import: ${message}`);
}

/** Scan quotes/comments once. Literal contents are never interpreted as SQL. */
function atom(sql: string, start: number): { end: number; token?: Token } | undefined {
  const char = sql[start];
  if (sql.startsWith('--', start) || char === '#') {
    const end = sql.indexOf('\n', start);
    return { end: end < 0 ? sql.length : end };
  }
  if (sql.startsWith('/*', start)) {
    let depth = 1;
    let i = start + 2;
    while (i < sql.length && depth) {
      if (sql.startsWith('/*', i)) {
        depth++;
        i += 2;
      } else if (sql.startsWith('*/', i)) {
        depth--;
        i += 2;
      } else i++;
    }
    if (depth) fail('Unterminated block comment.');
    return { end: i };
  }
  if ((char === 'q' || char === 'Q') && sql[start + 1] === "'") {
    const opening = sql[start + 2];
    const closing =
      ({ '[': ']', '(': ')', '{': '}', '<': '>' } as Record<string, string>)[opening] ?? opening;
    const end = sql.indexOf(`${closing}'`, start + 3);
    if (end < 0) fail('Unterminated quoted string.');
    return { end: end + 2, token: { kind: 'literal', text: sql.slice(start, end + 2) } };
  }
  if (char === '$') {
    const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start, start + 1024))?.[0];
    if (delimiter) {
      const end = sql.indexOf(delimiter, start + delimiter.length);
      if (end < 0) fail('Unterminated dollar-quoted block.');
      return {
        end: end + delimiter.length,
        token: { kind: 'literal', text: sql.slice(start, end + delimiter.length) },
      };
    }
  }
  if (char !== "'" && char !== '"' && char !== '`' && char !== '[') return;
  const closing = char === '[' ? ']' : char;
  let i = start + 1;
  let text = '';
  let chunk = i;
  while (i < sql.length) {
    if (sql[i] === '\\' && char === "'") {
      i += 2;
      continue;
    }
    if (sql[i] === closing) {
      text += sql.slice(chunk, i);
      if (sql[i + 1] === closing) {
        text += closing;
        i += 2;
        chunk = i;
        continue;
      }
      const end = i + 1;
      return {
        end,
        token:
          char === "'"
            ? { kind: 'literal', text: sql.slice(start, end) }
            : {
                kind: 'identifier',
                text,
                key: char === '"' ? text : text.toLowerCase(),
                raw: sql.slice(start, end),
              },
      };
    }
    i++;
  }
  fail(char === "'" ? 'Unterminated string literal.' : 'Unterminated quoted identifier.');
}

function leadingWords(sql: string, start = 0): string[] {
  const result: string[] = [];
  let i = start;
  while (i < sql.length && result.length < 6) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    const quoted = atom(sql, i);
    if (quoted) {
      if (quoted.token) break;
      i = quoted.end;
      continue;
    }
    const match = /^[A-Za-z_][\w$]*/.exec(sql.slice(i, i + 256));
    if (!match) break;
    result.push(match[0].toUpperCase());
    i += match[0].length;
  }
  return result;
}

/** Statements are streamed; large INSERT/COPY payloads never become token arrays. */
function* statements(sql: string): Generator<string> {
  let start = 0;
  let i = 0;
  let lineStart = 0;
  let depth = 0;
  let delimiter = ';';
  let prefix: string[] | undefined;
  let routine = false;
  let beginDepth = 0;
  let sawBegin = false;
  let previousRoutineWord = '';
  const reset = (next: number) => {
    start = next;
    depth = 0;
    prefix = undefined;
    routine = false;
    beginDepth = 0;
    sawBegin = false;
    previousRoutineWord = '';
  };
  while (i < sql.length) {
    if (i === lineStart) {
      const lineEnd = sql.indexOf('\n', i);
      const end = lineEnd < 0 ? sql.length : lineEnd;
      const line = sql.slice(i, end).trim();
      if (/^GO(?:\s+\d+)?(?:\s*--.*)?$/i.test(line)) {
        yield sql.slice(start, i);
        i = end;
        reset(end);
        continue;
      }
      const custom = /^DELIMITER\s+(\S+)$/i.exec(line);
      if (custom) {
        if (leadingWords(sql.slice(start, i)).length) yield sql.slice(start, i);
        delimiter = custom[1];
        i = end;
        reset(end);
        continue;
      }
    }
    if (/\s/.test(sql[i])) {
      if (sql[i] === '\n') lineStart = i + 1;
      i++;
      continue;
    }
    if (!prefix) {
      prefix = leadingWords(sql, start);
      routine =
        prefix[0] === 'CREATE' &&
        prefix.some((part) => ['FUNCTION', 'PROCEDURE', 'PROC', 'TRIGGER'].includes(part));
    }
    if (
      sql.startsWith(delimiter, i) &&
      depth === 0 &&
      (delimiter !== ';' ||
        !routine ||
        (sawBegin && beginDepth === 0) ||
        (!sawBegin && prefix?.includes('FUNCTION')))
    ) {
      const statement = sql.slice(start, i);
      yield statement;
      i += delimiter.length;
      if (prefix?.[0] === 'COPY' && /\bFROM\s+STDIN\b/i.test(statement)) {
        // PostgreSQL COPY's following lines are data, with their own quoting rules.
        let found = false;
        while (i < sql.length) {
          const end = sql.indexOf('\n', i);
          const next = end < 0 ? sql.length : end + 1;
          if (/^\s*\\\.\s*$/.test(sql.slice(i, end < 0 ? sql.length : end))) {
            i = next;
            found = true;
            break;
          }
          i = next;
        }
        if (!found) fail('Unterminated COPY data section.');
        lineStart = i;
      }
      reset(i);
      continue;
    }
    const quoted = atom(sql, i);
    if (quoted) {
      i = quoted.end;
      continue;
    }
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth < 0) fail('Unbalanced closing parenthesis.');
    } else if (routine && delimiter === ';' && /[A-Za-z_]/.test(sql[i])) {
      const token = /^[A-Za-z_][\w$]*/.exec(sql.slice(i, i + 256))![0].toUpperCase();
      const nextWord = leadingWords(sql, i + token.length)[0];
      const transaction =
        token === 'BEGIN' && ['TRAN', 'TRANSACTION', 'DISTRIBUTED'].includes(nextWord);
      if (
        !transaction &&
        (token === 'BEGIN' || token === 'CASE') &&
        previousRoutineWord !== 'END'
      ) {
        beginDepth++;
        sawBegin = true;
      }
      if (token === 'END' && !['IF', 'LOOP', 'WHILE', 'REPEAT'].includes(nextWord))
        beginDepth = Math.max(0, beginDepth - 1);
      previousRoutineWord = token;
      i += token.length;
      continue;
    }
    i++;
  }
  if (depth) fail('Unbalanced or incomplete SQL statement.');
  if (routine && beginDepth) fail('Incomplete routine body.');
  yield sql.slice(start);
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    const start = i;
    const before = tokens.length;
    const quoted = atom(sql, i);
    if (quoted) {
      if (quoted.token) tokens.push(quoted.token);
      i = quoted.end;
    } else if (/[\p{L}_]/u.test(sql[i])) {
      const start = i++;
      while (i < sql.length && /[\p{L}\p{N}_$]/u.test(sql[i])) i++;
      const text = sql.slice(start, i);
      tokens.push({ kind: 'word', text, key: text.toLowerCase() });
    } else if (/[0-9]/.test(sql[i])) {
      const start = i++;
      while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      if (sql[i] === '.' && /[0-9]/.test(sql[i + 1] ?? '')) {
        i++;
        while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      }
      if (sql[i] === 'e' || sql[i] === 'E') {
        let exponent = i + 1;
        if (sql[exponent] === '+' || sql[exponent] === '-') exponent++;
        if (/[0-9]/.test(sql[exponent] ?? '')) {
          i = exponent + 1;
          while (i < sql.length && /[0-9]/.test(sql[i])) i++;
        }
      }
      tokens.push({ kind: 'symbol', text: sql.slice(start, i) });
    } else tokens.push({ kind: 'symbol', text: sql[i++] });
    if (tokens.length > before) {
      tokens[tokens.length - 1].start = start;
      tokens[tokens.length - 1].end = i;
    }
    if (tokens.length > 1_000_000) fail('One SQL statement is too large to parse safely.');
  }
  return tokens;
}

function readName(tokens: Token[], start: number): { name: Name; next: number } {
  const parts: string[] = [];
  const keys: string[] = [];
  let i = start;
  while (true) {
    const token = tokens[i];
    if (!identifier(token)) fail('Expected a table or column identifier.');
    parts.push(token.text);
    keys.push(columnKey(token));
    i++;
    if (tokens[i]?.text !== '.') break;
    i++;
  }
  return { name: { parts, keys }, next: i };
}

function closing(tokens: Token[], start: number): number {
  if (tokens[start]?.text !== '(') fail('Expected an opening parenthesis.');
  let depth = 1;
  for (let i = start + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== 'symbol') continue;
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')' && --depth === 0) return i;
  }
  fail('Unbalanced or incomplete parenthesized definition.');
}

function split(tokens: Token[]): Token[][] {
  const result: Token[][] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === '(' && tokens[i].kind === 'symbol') {
      i = closing(tokens, i);
      continue;
    }
    if (tokens[i].text === ',' && tokens[i].kind === 'symbol') {
      result.push(tokens.slice(start, i));
      start = i + 1;
    }
  }
  result.push(tokens.slice(start));
  return result;
}

function readColumns(tokens: Token[], start: number): { columns: Token[]; next: number } {
  const end = closing(tokens, start);
  const entries = split(tokens.slice(start + 1, end));
  const columns = entries.map((entry) => {
    if (!identifier(entry[0])) fail('Key constraint needs column names.');
    // MySQL index prefix lengths and SQL Server ASC/DESC do not change column identity.
    let next = 1;
    if (entry[next]?.text === '(') next = closing(entry, next) + 1;
    if (word(entry[next], 'ASC') || word(entry[next], 'DESC')) next++;
    if (next !== entry.length) fail('Unsupported expression in a key column list.');
    return entry[0];
  });
  if (!columns.length || new Set(columns.map(columnKey)).size !== columns.length)
    fail('Key column list must contain distinct columns.');
  return { columns, next: end + 1 };
}

function readReference(
  tokens: Token[],
  start: number,
  columns: Token[],
  name?: string,
): { foreign: ForeignKey; next: number } {
  if (!word(tokens[start], 'REFERENCES')) fail('Foreign key is missing REFERENCES.');
  const target = readName(tokens, start + 1);
  let i = target.next;
  let referenced: Token[] | undefined;
  if (tokens[i]?.text === '(') {
    const result = readColumns(tokens, i);
    referenced = result.columns;
    i = result.next;
  }
  const foreign: ForeignKey = { columns, target: target.name, referenced, name };
  while (i < tokens.length) {
    if (word(tokens[i], 'ON') && (word(tokens[i + 1], 'DELETE') || word(tokens[i + 1], 'UPDATE'))) {
      const action = word(tokens[i + 1], 'DELETE') ? 'onDelete' : 'onUpdate';
      i += 2;
      let value: string;
      if (word(tokens[i], 'CASCADE') || word(tokens[i], 'RESTRICT'))
        value = tokens[i++].text.toUpperCase();
      else if (word(tokens[i], 'NO') && word(tokens[i + 1], 'ACTION')) {
        value = 'NO ACTION';
        i += 2;
      } else if (
        word(tokens[i], 'SET') &&
        (word(tokens[i + 1], 'NULL') || word(tokens[i + 1], 'DEFAULT'))
      ) {
        value = `SET ${tokens[i + 1].text.toUpperCase()}`;
        i += 2;
        if (tokens[i]?.text === '(') {
          const subset = readColumns(tokens, i);
          value += ` (${subset.columns.map((column) => column.text).join(', ')})`;
          i = subset.next;
        }
      } else fail('Unsupported or incomplete foreign-key action.');
      if (foreign[action] !== undefined) fail('Duplicate foreign-key action.');
      foreign[action] = value;
    } else if (word(tokens[i], 'MATCH')) {
      if (!['FULL', 'SIMPLE', 'PARTIAL'].some((value) => word(tokens[i + 1], value)))
        fail('Incomplete foreign-key MATCH clause.');
      i += 2;
    } else break;
  }
  return { foreign, next: i };
}

const columnConstraints = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'UNIQUE',
  'REFERENCES',
  'NOT',
  'NULL',
  'DEFAULT',
  'CHECK',
  'GENERATED',
  'AS',
  'COLLATE',
  'COMMENT',
  'AUTO_INCREMENT',
  'IDENTITY',
  'STORAGE',
  'COMPRESSION',
  'SPARSE',
  'ROWGUIDCOL',
  'MASKED',
  'ENCRYPTED',
]);
const constraint = (token: Token | undefined) =>
  token?.kind === 'word' && columnConstraints.has(token.text.toUpperCase());

function expressionEnd(tokens: Token[], start: number): number {
  let i = start;
  let cases = 0;
  for (; i < tokens.length; i++) {
    if (tokens[i].text === '(' && tokens[i].kind === 'symbol') {
      i = closing(tokens, i);
      continue;
    }
    if (word(tokens[i], 'CASE')) cases++;
    else if (word(tokens[i], 'END') && cases) cases--;
    else if (i > start && cases === 0 && constraint(tokens[i])) break;
  }
  return i;
}

function dataType(tokens: Token[]): string {
  let result = '';
  let previous = '';
  for (const token of tokens) {
    const value = token.raw ?? token.text;
    const punctuation = token.kind === 'symbol' && ['(', ')', ',', '.'].includes(value);
    const array = token.raw?.startsWith('[') && /^\d*$/.test(token.text);
    const space = result && !punctuation && !array && previous !== '(' && previous !== '.';
    result += `${space ? ' ' : ''}${value}`;
    previous = token.text;
  }
  return result;
}

function parseColumn(tokens: Token[], table: Table): void {
  if (!identifier(tokens[0])) fail('Column definition needs a name.');
  let i = 1;
  while (i < tokens.length && !constraint(tokens[i])) {
    if (tokens[i].text === '(' && tokens[i].kind === 'symbol') i = closing(tokens, i) + 1;
    else i++;
  }
  if (i === 1) fail(`Column ${tokens[0].text} is missing its data type.`);
  const type = dataType(tokens.slice(1, i));
  const column: SqlColumn = {
    name: tokens[0].text,
    dataType: type,
    nullable: true,
    primaryKey: false,
    foreignKey: false,
    unique: false,
  };
  const columnId = columnKey(tokens[0]);
  if (table.columns.has(columnId)) fail(`Duplicate column ${column.name}.`);
  table.columns.set(columnId, column);
  let name: string | undefined;
  while (i < tokens.length) {
    if (word(tokens[i], 'CONSTRAINT')) {
      if (!identifier(tokens[i + 1])) fail('Column constraint is missing its name.');
      name = tokens[i + 1].text;
      i += 2;
    } else if (word(tokens[i], 'NOT') && word(tokens[i + 1], 'NULL')) {
      column.nullable = false;
      i += 2;
    } else if (word(tokens[i], 'NULL')) {
      column.nullable = true;
      i++;
    } else if (word(tokens[i], 'PRIMARY')) {
      if (!word(tokens[i + 1], 'KEY')) fail('Incomplete PRIMARY KEY constraint.');
      if (table.primary.length) fail('A table has multiple primary keys.');
      table.primary = [tokens[0]];
      i += 2;
      name = undefined;
    } else if (word(tokens[i], 'UNIQUE')) {
      table.unique.push([tokens[0]]);
      i++;
      if (word(tokens[i], 'NULLS')) {
        i++;
        if (word(tokens[i], 'NOT')) i++;
        if (!word(tokens[i], 'DISTINCT')) fail('Incomplete UNIQUE NULLS clause.');
        i++;
      }
      name = undefined;
    } else if (word(tokens[i], 'REFERENCES')) {
      const result = readReference(tokens, i, [tokens[0]], name);
      table.foreign.push(result.foreign);
      i = result.next;
      name = undefined;
    } else if (word(tokens[i], 'DEFAULT') || word(tokens[i], 'COMMENT')) {
      if (!tokens[i + 1]) fail('Incomplete column default/comment.');
      i = expressionEnd(tokens, i + 1);
    } else if (word(tokens[i], 'CHECK')) {
      i = closing(tokens, i + 1) + 1;
      name = undefined;
    } else if (tokens[i].text === '(' && tokens[i].kind === 'symbol') i = closing(tokens, i) + 1;
    else i++;
  }
}

function tableDefinition(tokens: Token[], table: Table, warn: (message: string) => void): void {
  let i = 0;
  let name: string | undefined;
  if (word(tokens[i], 'CONSTRAINT')) {
    if (!identifier(tokens[++i])) fail('Table constraint is missing its name.');
    name = tokens[i++].text;
  }
  if (word(tokens[i], 'PRIMARY') || word(tokens[i], 'UNIQUE')) {
    const primary = word(tokens[i], 'PRIMARY');
    i++;
    if (primary) {
      if (!word(tokens[i], 'KEY')) fail('Incomplete PRIMARY KEY constraint.');
      i++;
    } else if (word(tokens[i], 'KEY') || word(tokens[i], 'INDEX')) i++;
    if (word(tokens[i], 'NULLS')) {
      i++;
      if (word(tokens[i], 'NOT')) i++;
      if (!word(tokens[i], 'DISTINCT')) fail('Incomplete UNIQUE NULLS clause.');
      i++;
    }
    if (word(tokens[i], 'CLUSTERED') || word(tokens[i], 'NONCLUSTERED')) i++;
    if (identifier(tokens[i]) && tokens[i + 1]?.text === '(') i++;
    if (!primary && identifier(tokens[i]) && word(tokens[i + 1], 'USING')) i++;
    if (word(tokens[i], 'USING')) {
      if (!identifier(tokens[i + 1])) fail('Index method is missing.');
      i += 2;
    }
    const columns = readColumns(tokens, i).columns;
    if (primary) {
      if (table.primary.length) fail('A table has multiple primary keys.');
      table.primary = columns;
    } else table.unique.push(columns);
  } else if (word(tokens[i], 'FOREIGN')) {
    if (!word(tokens[i + 1], 'KEY')) fail('Incomplete FOREIGN KEY constraint.');
    i += 2;
    if (identifier(tokens[i]) && tokens[i + 1]?.text === '(') {
      name ??= tokens[i].text;
      i++;
    }
    const columns = readColumns(tokens, i);
    const reference = readReference(tokens, columns.next, columns.columns, name);
    table.foreign.push(reference.foreign);
  } else if (word(tokens[i], 'CHECK')) {
    closing(tokens, i + 1); // Validate the expression's shape, never persist its text.
  } else if (
    word(tokens[i], 'KEY') ||
    word(tokens[i], 'INDEX') ||
    word(tokens[i], 'FULLTEXT') ||
    word(tokens[i], 'SPATIAL')
  ) {
    // Non-unique index definitions do not change columns or relationships.
  } else if (word(tokens[i], 'LIKE') || word(tokens[i], 'EXCLUDE') || name) {
    warn(
      `Table ${table.name.parts.join('.')}: an unsupported table constraint or inherited definition was omitted.`,
    );
  } else parseColumn(tokens, table);
}

/** Local structural import. SQL is never executed or retained as a complete source script. */
export function parseSql(
  sql: string,
  name = 'Imported SQL',
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): SqlImportResult {
  const limit = checkedImportLimitBytes(byteLimit);
  assertImportBytes(sql.length, limit, 'SQL');
  const sourceBytes = utf8Bytes(sql);
  assertImportBytes(sourceBytes, limit, 'SQL');
  const tables = new Map<string, Table>();
  const warnings: string[] = sourceBytes > DEFAULT_IMPORT_LIMIT_BYTES ? [LARGE_IMPORT_WARNING] : [];
  let droppedWarnings = 0;
  const warn = (message: string) => {
    if (warnings.length < sqlLimits.warnings - 1) warnings.push(message);
    else droppedWarnings++;
  };
  const alterations: { name: Name; actions: Token[][] }[] = [];
  let parsedColumnCount = 0;
  const definition = (tokens: Token[], table: Table) => {
    const before = table.columns.size;
    tableDefinition(tokens, table, warn);
    parsedColumnCount += table.columns.size - before;
    if (parsedColumnCount > sqlLimits.columns) fail('SQL import is limited to 100,000 columns.');
  };
  let ignoredStatementCount = 0;
  const queries: { sql: string; tokens: Token[] }[] = [];
  let namespace: Name | undefined;
  const qualify = (value: Name) =>
    value.parts.length === 1 && namespace
      ? { parts: [...namespace.parts, ...value.parts], keys: [...namespace.keys, ...value.keys] }
      : value;
  for (const statement of statements(sql)) {
    const prefix = leadingWords(statement);
    if (!prefix.length) continue;
    const isCreate = prefix[0] === 'CREATE' && prefix.slice(1, 5).includes('TABLE');
    const isAlter = prefix[0] === 'ALTER' && prefix[1] === 'TABLE';
    if (prefix[0] === 'SELECT' || prefix[0] === 'WITH') {
      if (queries.length >= 100) fail('SQL query import is limited to 100 query blocks.');
      queries.push({ sql: statement, tokens: tokenize(statement) });
      continue;
    }
    if (!isCreate && !isAlter) {
      ignoredStatementCount++;
      if (prefix[0] === 'USE') {
        const tokens = tokenize(statement);
        const result = readName(tokens, 1);
        if (result.next === tokens.length) namespace = result.name;
        else warn('Unsupported USE statement; namespace context was not changed.');
      } else if (prefix[0] === 'SET' && prefix[1] === 'SEARCH_PATH') {
        const tokens = tokenize(statement);
        const value = tokens[2]?.text === '=' || word(tokens[2], 'TO') ? 3 : -1;
        if (value >= 0 && identifier(tokens[value]) && tokens[value].text !== '$user')
          namespace = readName(tokens, value).name;
        else warn('Dynamic search_path was not resolved; use schema-qualified table names.');
      } else if (['DROP', 'RENAME'].includes(prefix[0])) {
        warn(
          'DROP/RENAME schema changes are not applied; the diagram represents imported CREATE/ADD definitions.',
        );
      }
      continue;
    }
    const tokens = tokenize(statement);
    let i = isCreate ? 1 : 2;
    if (isCreate) {
      while (
        word(tokens[i], 'GLOBAL') ||
        word(tokens[i], 'LOCAL') ||
        word(tokens[i], 'TEMP') ||
        word(tokens[i], 'TEMPORARY') ||
        word(tokens[i], 'UNLOGGED')
      )
        i++;
      if (!word(tokens[i], 'TABLE')) {
        warn('Unsupported CREATE TABLE variant was not imported.');
        ignoredStatementCount++;
        continue;
      }
      i++;
    } else if (word(tokens[i], 'ONLY')) i++;
    let ifNotExists = false;
    if (isCreate && word(tokens[i], 'IF')) {
      if (!word(tokens[i + 1], 'NOT') || !word(tokens[i + 2], 'EXISTS'))
        fail('Incomplete IF NOT EXISTS clause.');
      ifNotExists = true;
      i += 3;
    } else if (isAlter && word(tokens[i], 'IF') && word(tokens[i + 1], 'EXISTS')) i += 2;
    const target = readName(tokens, i);
    const tableName = qualify(target.name);
    i = target.next;
    if (isAlter) {
      if (!tokens[i]) fail('ALTER TABLE is missing its action.');
      if (
        word(tokens[i], 'WITH') &&
        (word(tokens[i + 1], 'CHECK') || word(tokens[i + 1], 'NOCHECK'))
      )
        i += 2;
      alterations.push({ name: tableName, actions: split(tokens.slice(i)) });
      continue;
    }
    if (tokens[i]?.text !== '(') {
      if (['AS', 'LIKE', 'OF', 'PARTITION'].some((value) => word(tokens[i], value))) {
        warn(
          `Table ${tableName.parts.join('.')}: CREATE AS/LIKE/OF/PARTITION definitions are unsupported and were not imported.`,
        );
        ignoredStatementCount++;
        continue;
      }
      fail(`CREATE TABLE ${tableName.parts.join('.')} needs a parenthesized column definition.`);
    }
    const end = closing(tokens, i);
    if (word(tokens[end + 1], 'AS')) {
      warn(
        `Table ${tableName.parts.join('.')}: CREATE TABLE AS query output is unsupported and was not imported.`,
      );
      ignoredStatementCount++;
      continue;
    }
    if (tables.has(key(tableName))) {
      if (!ifNotExists) fail(`Duplicate table ${tableName.parts.join('.')}.`);
      warn(`Repeated IF NOT EXISTS table ${tableName.parts.join('.')} was skipped.`);
      ignoredStatementCount++;
      continue;
    }
    if (tables.size >= sqlLimits.tables)
      fail('SQL import is limited to 2,000 tables, including external references.');
    const table: Table = {
      name: tableName,
      columns: new Map(),
      primary: [],
      unique: [],
      foreign: [],
    };
    for (const definition of split(tokens.slice(i + 1, end))) {
      if (!definition.length) {
        if (end !== i + 1) fail('Empty column/constraint definition.');
        continue;
      }
      const before = table.columns.size;
      tableDefinition(definition, table, warn);
      parsedColumnCount += table.columns.size - before;
      if (parsedColumnCount > sqlLimits.columns) fail('SQL import is limited to 100,000 columns.');
    }
    if (tokens.slice(end + 1).some((token) => word(token, 'INHERITS')))
      warn(`Table ${tableName.parts.join('.')}: inherited columns are not included.`);
    tables.set(key(tableName), table);
  }
  for (const alteration of alterations) {
    const table = tables.get(key(alteration.name));
    if (!table) {
      warn(
        `ALTER TABLE ${alteration.name.parts.join('.')}: target table is not defined; changes were omitted.`,
      );
      ignoredStatementCount++;
      continue;
    }
    let skipped = false;
    for (const action of alteration.actions) {
      if (!word(action[0], 'ADD') || word(action[1], 'IF')) {
        warn(
          `Table ${table.name.parts.join('.')}: unsupported ALTER action was omitted; the diagram may not reflect DROP/RENAME/MODIFY changes.`,
        );
        skipped = true;
        continue;
      }
      let i = 1;
      if (word(action[i], 'COLUMN')) i++;
      if (!action[i]) fail('ALTER TABLE ADD needs a definition.');
      definition(action.slice(i), table);
    }
    if (skipped) ignoredStatementCount++;
  }
  if (!tables.size && queries.length) {
    const result = parseSqlQueries(queries, name, ignoredStatementCount);
    if (sourceBytes > DEFAULT_IMPORT_LIMIT_BYTES) {
      result.warnings.unshift(LARGE_IMPORT_WARNING);
      result.warnings.splice(sqlLimits.warnings);
    }
    return result;
  }
  if (queries.length) {
    ignoredStatementCount += queries.length;
    warn(
      'This mixed script contains table definitions and SELECT queries. The schema was imported; import SELECT queries separately to visualize their structure.',
    );
  }
  if (!tables.size)
    fail(
      'No supported CREATE TABLE definitions found. Import a SQL schema containing table definitions.',
    );
  let columnCount = 0;
  const displayedTables = new Map<string, string>();
  for (const table of tables.values()) {
    const display = JSON.stringify(table.name.parts);
    const existingDisplay = displayedTables.get(display);
    if (existingDisplay !== undefined && existingDisplay !== key(table.name))
      warn(
        `Distinct quoted/unquoted tables share the displayed name ${table.name.parts.join('.')}; review identifier case before using the diagram.`,
      );
    displayedTables.set(display, key(table.name));
    const displayedColumns = new Map<string, string>();
    for (const [id, column] of table.columns) {
      const existing = displayedColumns.get(column.name);
      if (existing !== undefined && existing !== id)
        warn(
          `Table ${table.name.parts.join('.')}: distinct quoted/unquoted columns share the displayed name ${column.name}; review identifier case.`,
        );
      displayedColumns.set(column.name, id);
    }
    columnCount += table.columns.size;
    if (columnCount > sqlLimits.columns) fail('SQL import is limited to 100,000 columns.');
    for (const primary of table.primary) {
      const column = table.columns.get(columnKey(primary));
      if (!column)
        fail(`Primary key references an unknown column in ${table.name.parts.join('.')}.`);
      column.primaryKey = true;
      column.nullable = false;
      if (table.primary.length === 1) column.unique = true;
    }
    for (const unique of table.unique)
      for (const token of unique) {
        const column = table.columns.get(columnKey(token));
        if (!column)
          fail(`Unique key references an unknown column in ${table.name.parts.join('.')}.`);
        if (unique.length === 1) column.unique = true;
      }
  }
  const graph = blankGraph(name.trim().slice(0, 500) || 'Imported SQL', 'dependency');
  const nodes = new Map<string, Graph['nodes'][number]>();
  const addTable = (tableName: Name, table?: Table) => {
    const id = key(tableName);
    const existing = nodes.get(id);
    if (existing) return existing;
    if (nodes.size >= sqlLimits.tables)
      fail('SQL import is limited to 2,000 tables, including external references.');
    const value: SqlTable = {
      version: 1,
      name: tableName.parts.at(-1)!,
      qualifiedName: tableName.parts,
      columns: table ? [...table.columns.values()] : [],
      primaryKey: table?.primary.map((token) => table.columns.get(columnKey(token))!.name) ?? [],
      uniqueKeys:
        table?.unique.map((unique) =>
          unique.map((token) => table.columns.get(columnKey(token))!.name),
        ) ?? [],
      ...(!table ? { external: true } : {}),
    };
    const node = newNode(graph.diagram.id, {
      title: tableName.parts
        .map((part, index) =>
          /[^\p{L}\p{N}_$]/u.test(part) || tableName.keys[index] !== part.toLowerCase()
            ? `"${part.replace(/"/g, '""')}"`
            : part,
        )
        .join('.')
        .slice(0, 1000),
      nodeType: 'database',
      width: 340,
      height: table
        ? 86 + Math.min(value.columns.length, 12) * 23 + (value.columns.length > 12 ? 22 : 0)
        : 120,
      x: (nodes.size % 8) * 440,
      y: Math.floor(nodes.size / 8) * 460,
      ...(!table
        ? {
            description: 'Referenced table outside the imported SQL script. Its schema is unknown.',
          }
        : {}),
      metadata: { sqlTable: value },
    });
    nodes.set(id, node);
    graph.nodes.push(node);
    return node;
  };
  for (const table of tables.values()) addTable(table.name, table);
  const byShortName = new Map<string, Table[]>();
  for (const table of tables.values()) {
    const short = table.name.keys.at(-1)!;
    const entries = byShortName.get(short) ?? [];
    entries.push(table);
    byShortName.set(short, entries);
  }
  const resolve = (target: Name, source: Table): { name: Name; table?: Table } => {
    if (target.parts.length > 1) return { name: target, table: tables.get(key(target)) };
    const sibling = {
      parts: [...source.name.parts.slice(0, -1), ...target.parts],
      keys: [...source.name.keys.slice(0, -1), ...target.keys],
    };
    const exact = tables.get(key(sibling));
    if (exact) return { name: sibling, table: exact };
    const candidates = byShortName.get(target.keys[0]) ?? [];
    if (candidates.length === 1) return { name: candidates[0].name, table: candidates[0] };
    if (candidates.length > 1)
      warn(
        `Ambiguous unqualified reference ${target.parts[0]}; it remains an external table rather than choosing a schema.`,
      );
    return { name: sibling };
  };
  for (const table of tables.values())
    for (const foreign of table.foreign) {
      if (graph.edges.length >= sqlLimits.relationships)
        fail('SQL import is limited to 10,000 foreign-key relationships.');
      const columns = foreign.columns.map((token) => {
        const column = table.columns.get(columnKey(token));
        if (!column)
          fail(`Foreign key references an unknown source column in ${table.name.parts.join('.')}.`);
        column.foreignKey = true;
        return column.name;
      });
      const target = resolve(foreign.target, table);
      let referenced = foreign.referenced;
      let unresolved = false;
      if (!referenced) {
        if (target.table?.primary.length) referenced = target.table.primary;
        else if (target.table)
          fail(
            `Foreign key to ${target.name.parts.join('.')} omits columns, but that table has no primary key.`,
          );
        else {
          unresolved = true;
          warn(
            `Referenced columns of external table ${target.name.parts.join('.')} are unknown; no primary key was invented.`,
          );
        }
      }
      const referencedColumns =
        referenced?.map((token) => {
          if (!target.table) return token.text;
          const column = target.table.columns.get(columnKey(token));
          if (!column)
            fail(
              `Foreign key references an unknown target column in ${target.name.parts.join('.')}.`,
            );
          return column.name;
        }) ?? columns.map(() => '?');
      if (columns.length !== referencedColumns.length)
        fail('Foreign key source and target column counts differ.');
      const sourceNode = nodes.get(key(table.name))!;
      const targetNode = addTable(target.name, target.table);
      const relationship: SqlRelationship = {
        version: 1,
        columns,
        referencedColumns,
        ...(foreign.name ? { name: foreign.name } : {}),
        ...(foreign.onDelete ? { onDelete: foreign.onDelete } : {}),
        ...(foreign.onUpdate ? { onUpdate: foreign.onUpdate } : {}),
        ...(unresolved ? { unresolved: true } : {}),
      };
      graph.edges.push(
        newEdge(graph.diagram.id, sourceNode.id, targetNode.id, {
          edgeType: 'foreign-key',
          direction: 'forward',
          label: `${columns.join(', ')} → ${unresolved ? 'unknown referenced columns' : referencedColumns.join(', ')}`,
          metadata: { sqlRelationship: relationship },
        }),
      );
    }
  if (ignoredStatementCount)
    warn(
      `${ignoredStatementCount} statement(s) outside the supported table schema were ignored. SQL was not executed and row data was not imported.`,
    );
  if (droppedWarnings) warnings.push(`${droppedWarnings} additional warning(s) omitted.`);
  return {
    kind: 'schema',
    graph,
    warnings,
    tableCount: graph.nodes.length,
    columnCount,
    relationshipCount: graph.edges.length,
    ignoredStatementCount,
  };
}
