import { blankGraph, newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import type { SqlImportResult, Token } from './parser';
import {
  sqlQueryLimits,
  validateSqlQueryGraph,
  type SqlQueryClauses,
  type SqlQueryOutput,
  type SqlQueryReference,
  type SqlQueryRelationship,
  type SqlQueryResult,
  type SqlQuerySource,
} from './query-schema';

type Input = { sql: string; tokens: Token[] };
type Source = {
  value: SqlQuerySource;
  key: string;
  qualifiedKey?: string;
  node: GraphNode;
  columnKeys: Set<string>;
};
type Join = {
  right: Source;
  left: Source;
  type: string;
  condition: Token[];
  using: boolean;
  available: Source[];
};
type Block = {
  value: SqlQueryResult;
  node: GraphNode;
  sources: Source[];
  outer?: Block;
  depth: number;
};
type ClauseKey = keyof SqlQueryClauses;
const isWord = (token: Token | undefined, value: string) =>
  token?.kind === 'word' && token.text.toUpperCase() === value;
const isIdentifier = (token: Token | undefined): token is Token & { kind: 'word' | 'identifier' } =>
  !!token && (token.kind === 'word' || token.kind === 'identifier');
const tokenKey = (token: Token) => token.key ?? token.text.toLowerCase();
function syntax(message: string): never {
  throw new Error(`SQL query import: ${message}`);
}
const keywords = new Set(
  `SELECT DISTINCT ALL AS FROM WHERE JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON USING AND OR NOT IS NULL TRUE FALSE UNKNOWN CASE WHEN THEN ELSE END LIKE ILIKE RLIKE REGEXP BETWEEN IN EXISTS ANY SOME ASC DESC NULLS FIRST LAST GROUP BY HAVING ORDER LIMIT OFFSET TOP WITH RECURSIVE OVER PARTITION ROWS RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT ROW FILTER WITHIN COLLATE AT TIME ZONE INTERVAL DATE TIMESTAMP STRING VARCHAR CHAR TEXT INT INTEGER BIGINT NUMERIC DECIMAL FLOAT DOUBLE REAL BOOLEAN BOOL YEAR MONTH DAY HOUR MINUTE SECOND EXTRACT CAST TRY_CAST CURRENT_DATE CURRENT_TIMESTAMP CURRENT_TIME`.split(
    ' ',
  ),
);
const joinWords = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'DIRECTED',
]);
const wordOperators = new Set([
  'AND',
  'OR',
  'NOT',
  'IS',
  'LIKE',
  'ILIKE',
  'RLIKE',
  'REGEXP',
  'BETWEEN',
  'IN',
  'COLLATE',
  'ZONE',
]);
const sourceStop = new Set([
  ...joinWords,
  'ON',
  'USING',
  'LATERAL',
  'PIVOT',
  'UNPIVOT',
  'SAMPLE',
  'TABLESAMPLE',
  'AT',
  'BEFORE',
  'CHANGES',
  'MATCH_RECOGNIZE',
  'ASOF',
]);
const isSourceStop = (token: Token) =>
  token.kind === 'word' && sourceStop.has(token.text.toUpperCase());
const isJoinWord = (token: Token) =>
  token.kind === 'word' && joinWords.has(token.text.toUpperCase());

function closing(tokens: Token[], start: number): number {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].kind !== 'symbol') continue;
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')' && --depth === 0) return i;
  }
  return syntax('Unbalanced parenthesized query.');
}
function split(tokens: Token[]): Token[][] {
  const parts: Token[][] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'symbol' && tokens[i].text === '(') i = closing(tokens, i);
    else if (tokens[i].kind === 'symbol' && tokens[i].text === ',') {
      parts.push(tokens.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(tokens.slice(start));
  return parts;
}
function output(
  tokens: Token[],
  ordinal: number,
  raw: (tokens: Token[]) => string,
): { value: SqlQueryOutput; expression: Token[]; key: string } {
  if (!tokens.length) syntax('An empty SELECT output expression is unsupported.');
  let wildcard = tokens[0].text === '*' ? 0 : -1;
  if (isIdentifier(tokens[0])) {
    let cursor = 0;
    while (tokens[cursor + 1]?.text === '.' && isIdentifier(tokens[cursor + 2])) cursor += 2;
    if (tokens[cursor + 1]?.text === '.' && tokens[cursor + 2]?.text === '*') wildcard = cursor + 2;
  }
  if (wildcard >= 0) {
    const modifier = tokens
      .slice(wildcard + 1)
      .find(
        (token) =>
          token.kind === 'word' &&
          ['EXCLUDE', 'REPLACE', 'RENAME', 'ILIKE'].includes(token.text.toUpperCase()),
      );
    if (modifier)
      syntax(
        `Wildcard ${modifier.text.toUpperCase()} is not supported; expand the SELECT output columns explicitly.`,
      );
  }
  let alias: Token | undefined;
  let expression = tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'symbol' && tokens[i].text === '(') i = closing(tokens, i);
    else if (isWord(tokens[i], 'AS')) {
      if (i !== tokens.length - 2 || !isIdentifier(tokens[i + 1]))
        syntax('SELECT AS needs one output alias.');
      alias = tokens[i + 1];
      expression = tokens.slice(0, i);
      break;
    }
  }
  const last = tokens.at(-1);
  const previous = tokens.at(-2);
  if (
    !alias &&
    tokens.length > 1 &&
    isIdentifier(last) &&
    (last.kind === 'identifier' || !keywords.has(last.text.toUpperCase())) &&
    previous &&
    !['.', '+', '-', '*', '/', '%', '=', '<', '>', '|', '&', '^', ':'].includes(previous.text) &&
    !(
      previous.kind === 'word' &&
      wordOperators.has(previous.text.toUpperCase()) &&
      tokens.at(-3)?.text !== '.'
    )
  ) {
    alias = last;
    expression = tokens.slice(0, -1);
  }
  if (!expression.length) syntax('SELECT output has an alias without an expression.');
  const expressionText = raw(expression);
  const simple =
    expression.length === 1 && isIdentifier(expression[0])
      ? expression[0]
      : expression.length >= 3 && expression.at(-2)?.text === '.' && isIdentifier(expression.at(-1))
        ? expression.at(-1)
        : undefined;
  const name =
    alias?.text ?? simple?.text ?? (expressionText === '*' ? '*' : `Expression ${ordinal}`);
  return {
    value: {
      ordinal,
      name,
      ...(alias ? { alias: alias.text } : {}),
      expression: expressionText,
      references: [],
    },
    expression,
    key: alias ? tokenKey(alias) : simple ? tokenKey(simple) : name.toLowerCase(),
  };
}

/** A bounded structural SELECT reader, not a SQL execution or optimizer engine. */
export function parseSqlQueries(
  inputs: Input[],
  name: string,
  ignoredStatementCount: number,
): SqlImportResult {
  const graph = blankGraph(name.trim().slice(0, 500) || 'Imported SQL query', 'dependency');
  const warnings: string[] = [];
  const warningKeys = new Set<string>();
  let droppedWarnings = 0;
  let blockCount = 0;
  let sourceCount = 0;
  let outputCount = 0;
  let referenceCount = 0;
  const warn = (message: string) => {
    if (warningKeys.has(message)) return;
    warningKeys.add(message);
    if (warnings.length < 99) warnings.push(message);
    else droppedWarnings++;
  };
  const edge = (
    source: GraphNode,
    target: GraphNode,
    value: SqlQueryRelationship,
    label: string,
  ) => {
    if (graph.edges.length >= sqlQueryLimits.relationships)
      syntax('At most 10,000 query relationships can be imported.');
    graph.edges.push(
      newEdge(graph.diagram.id, source.id, target.id, {
        label: label.slice(0, 1000),
        edgeType: `sql-${value.kind}`,
        direction: 'forward',
        style: value.kind === 'lineage' || value.kind === 'input' ? 'dashed' : 'solid',
        ...(value.condition ? { description: value.condition } : {}),
        metadata: { sqlQueryRelationship: value },
      }),
    );
  };

  for (const input of inputs) {
    const raw = (tokens: Token[]) => {
      let result = '';
      let previous: Token | undefined;
      for (const token of tokens) {
        if (previous) {
          const gap = input.sql.slice(previous.end ?? 0, token.start ?? 0);
          // Lexer offsets preserve formatting but discarded comments never enter metadata.
          result += /^\s*$/.test(gap) ? gap : ' ';
        }
        result += input.sql.slice(token.start ?? 0, token.end ?? 0) || token.raw || token.text;
        previous = token;
      }
      result = result.trim();
      if (result.length > sqlQueryLimits.expressionLength)
        syntax('One query expression or clause exceeds 100,000 characters.');
      return result;
    };
    const nested = new Map<Token, Block>();
    const sourceLookup = (block: Block, qualifier: Token[]): Source | undefined => {
      const key = qualifier.map(tokenKey).join('.');
      return block.sources.find(
        (source) => (qualifier.length === 1 && source.key === key) || source.qualifiedKey === key,
      );
    };
    const observe = (source: Source, column: Token) => {
      if (!source.columnKeys.has(tokenKey(column))) {
        source.columnKeys.add(tokenKey(column));
        source.value.columns.push(column.text);
      }
    };
    const references = (
      tokens: Token[],
      block: Block,
      ctes: Map<string, Block>,
      available = block.sources,
      outputAliases = new Set<string>(),
    ): SqlQueryReference[] => {
      const refs: SqlQueryReference[] = [];
      const seen = new Set<string>();
      const add = (value: SqlQueryReference) => {
        const key = JSON.stringify(value);
        if (seen.has(key)) return;
        seen.add(key);
        refs.push(value);
        if (++referenceCount > sqlQueryLimits.references)
          syntax('At most 100,000 query column references can be imported.');
      };
      for (let i = 0; i < tokens.length; i++) {
        if (
          tokens[i].text === '(' &&
          (isWord(tokens[i + 1], 'SELECT') || isWord(tokens[i + 1], 'WITH'))
        ) {
          const end = closing(tokens, i);
          if (!nested.has(tokens[i])) {
            const child = parseBlock(tokens.slice(i + 1, end), block, ctes, true);
            nested.set(tokens[i], child);
            edge(
              child.node,
              block.node,
              { version: 1, scope: block.value.scope, kind: 'subquery' },
              'Subquery',
            );
          }
          i = end;
          continue;
        }
        const first = tokens[i];
        if (!isIdentifier(first) && first.text !== '*') continue;
        if (tokens[i - 1]?.text === '.' || tokens[i - 1]?.text === ':') continue;
        const chain: Token[] = [first];
        let end = i;
        while (
          tokens[end + 1]?.text === '.' &&
          (isIdentifier(tokens[end + 2]) || tokens[end + 2]?.text === '*')
        ) {
          chain.push(tokens[end + 2]);
          end += 2;
        }
        if (chain.length > 1) {
          const column = chain.at(-1)!;
          const qualifier = chain.slice(0, -1);
          let owner: Block | undefined = block;
          let source: Source | undefined;
          while (owner && !source) {
            source = sourceLookup(owner, qualifier);
            if (!source) owner = owner.outer;
          }
          if (source && owner && (owner !== block || available.includes(source))) {
            observe(source, column);
            add({
              scope: owner.value.scope,
              sourceAlias: source.value.alias,
              column: column.text,
              resolution: 'resolved',
              ...(owner !== block ? { correlated: true } : {}),
            });
          } else {
            add({
              sourceAlias: qualifier.map((token) => token.raw ?? token.text).join('.'),
              column: column.text,
              resolution: 'unresolved',
            });
            warn(
              `${block.value.scope}: reference ${raw(chain)} has no matching source alias in this scope.`,
            );
          }
          i = end;
          continue;
        }
        if (first.kind === 'word' && keywords.has(first.text.toUpperCase())) continue;
        if (first.text === '*' && tokens.length !== 1) continue;
        if (
          tokens[i + 1]?.text === '(' ||
          isWord(tokens[i - 1], 'AS') ||
          outputAliases.has(tokenKey(first))
        )
          continue;
        if (first.text === '*' && tokens[i - 1]?.text === '(') continue; // COUNT(*) is not source-column lineage.
        if (available.length === 1) {
          observe(available[0], first);
          add({
            scope: block.value.scope,
            sourceAlias: available[0].value.alias,
            column: first.text,
            resolution: 'resolved',
          });
        } else if (available.length > 1) {
          add({ column: first.text, resolution: 'ambiguous' });
          warn(
            `${block.value.scope}: unqualified column ${first.text} is ambiguous without database schemas.`,
          );
        } else if (block.outer) {
          let owner: Block | undefined = block.outer;
          while (owner && !owner.sources.length) owner = owner.outer;
          if (owner?.sources.length === 1) {
            observe(owner.sources[0], first);
            add({
              scope: owner.value.scope,
              sourceAlias: owner.sources[0].value.alias,
              column: first.text,
              resolution: 'resolved',
              correlated: true,
            });
          } else add({ column: first.text, resolution: owner ? 'ambiguous' : 'unresolved' });
        } else {
          add({ column: first.text, resolution: 'unresolved' });
          warn(`${block.value.scope}: column ${first.text} cannot be resolved without a source.`);
        }
      }
      return refs;
    };
    const parseBlock = (
      original: Token[],
      parent: Block | undefined,
      inherited: Map<string, Block>,
      allowOuter: boolean,
    ): Block => {
      const depth = (parent?.depth ?? -1) + 1;
      if (depth >= sqlQueryLimits.depth) syntax('Nested queries are limited to 16 levels.');
      if (++blockCount > sqlQueryLimits.blocks) syntax('At most 100 query blocks can be imported.');
      const scope = `q${blockCount}`;
      const value: SqlQueryResult = {
        version: 1,
        scope,
        ...(parent ? { parentScope: parent.value.scope } : {}),
        name: parent ? `Subquery ${scope}` : `SELECT ${scope}`,
        distinct: false,
        columns: [],
        clauses: {},
      };
      const node = newNode(graph.diagram.id, {
        nodeType: 'output',
        title: value.name,
        description: 'Logical query result; SQL is not executed.',
        width: 400,
        height: 430,
        x: 1000 + depth * 560,
        y: (blockCount - 1) * 520,
        metadata: { sqlQueryResult: value },
      });
      graph.nodes.push(node);
      const block: Block = {
        value,
        node,
        sources: [],
        depth,
        ...(allowOuter && parent ? { outer: parent } : {}),
      };
      const ctes = new Map(inherited);
      let tokens = original;
      if (isWord(tokens[0], 'WITH')) {
        let cursor = 1;
        if (isWord(tokens[cursor], 'RECURSIVE'))
          syntax('WITH RECURSIVE requires recursive set-operation semantics and is not supported.');
        while (true) {
          const nameToken = tokens[cursor++];
          if (!isIdentifier(nameToken)) syntax('WITH needs a CTE identifier.');
          if (ctes.has(tokenKey(nameToken)) && !inherited.has(tokenKey(nameToken)))
            syntax(`Duplicate CTE ${nameToken.text}.`);
          let names: Token[] | undefined;
          if (tokens[cursor]?.text === '(') {
            const end = closing(tokens, cursor);
            names = split(tokens.slice(cursor + 1, end)).map((entry) => {
              if (entry.length !== 1 || !isIdentifier(entry[0]))
                syntax('CTE column names must be identifiers.');
              return entry[0];
            });
            cursor = end + 1;
          }
          if (!isWord(tokens[cursor++], 'AS') || tokens[cursor]?.text !== '(')
            syntax(`CTE ${nameToken.text} needs AS (SELECT ...).`);
          const end = closing(tokens, cursor);
          const child = parseBlock(tokens.slice(cursor + 1, end), block, ctes, false);
          child.value.name = `CTE ${nameToken.text}`;
          child.node.title = child.value.name;
          if (names) {
            if (names.length !== child.value.columns.length)
              syntax(`CTE ${nameToken.text} column list does not match its SELECT outputs.`);
            child.value.columns.forEach((column, index) => {
              column.name = names![index].text;
              column.alias = names![index].text;
            });
          }
          ctes.set(tokenKey(nameToken), child);
          cursor = end + 1;
          if (tokens[cursor]?.text !== ',') break;
          cursor++;
        }
        tokens = tokens.slice(cursor);
      }
      if (!isWord(tokens[0], 'SELECT'))
        syntax('WITH must end in a SELECT query; data-changing statements are not visualized.');
      let selectStart = 1;
      if (isWord(tokens[selectStart], 'DISTINCT') || isWord(tokens[selectStart], 'ALL')) {
        value.distinct = isWord(tokens[selectStart], 'DISTINCT');
        selectStart++;
        if (value.distinct && isWord(tokens[selectStart], 'ON'))
          syntax('DISTINCT ON is not supported.');
      }
      if (isWord(tokens[selectStart], 'TOP')) {
        const limit = tokens[selectStart + 1];
        if (!limit || limit.kind !== 'symbol' || !/^\d+$/.test(limit.text))
          syntax('Only literal TOP row counts are supported.');
        value.clauses.limit = raw(tokens.slice(selectStart, selectStart + 2));
        selectStart += 2;
      }
      const markers: { index: number; key: ClauseKey; width: number }[] = [];
      for (let i = selectStart; i < tokens.length; i++) {
        if (tokens[i].kind === 'symbol' && tokens[i].text === '(') {
          i = closing(tokens, i);
          continue;
        }
        if (tokens[i].kind !== 'word') continue;
        const word = tokens[i].text.toUpperCase();
        if (['UNION', 'INTERSECT', 'EXCEPT', 'MINUS'].includes(word))
          syntax(`${word} set operations are not supported; visualize each SELECT separately.`);
        if (
          [
            'QUALIFY',
            'WINDOW',
            'INTO',
            'FOR',
            'FETCH',
            'CONNECT',
            'START',
            'PIVOT',
            'UNPIVOT',
          ].includes(word)
        )
          syntax(`The ${word} clause is not supported.`);
        const key: ClauseKey | undefined =
          word === 'FROM'
            ? 'from'
            : word === 'WHERE'
              ? 'where'
              : word === 'HAVING'
                ? 'having'
                : word === 'LIMIT' || word === 'OFFSET'
                  ? 'limit'
                  : word === 'GROUP' && isWord(tokens[i + 1], 'BY')
                    ? 'groupBy'
                    : word === 'ORDER' && isWord(tokens[i + 1], 'BY')
                      ? 'orderBy'
                      : undefined;
        if (key) {
          markers.push({ index: i, key, width: key === 'groupBy' || key === 'orderBy' ? 2 : 1 });
          if (key === 'groupBy' || key === 'orderBy') i++;
        }
      }
      const expressionTokens = tokens.slice(selectStart, markers[0]?.index ?? tokens.length);
      const outputs = split(expressionTokens).map((entry, index) => output(entry, index + 1, raw));
      outputCount += outputs.length;
      if (outputCount > sqlQueryLimits.outputs)
        syntax('At most 10,000 SELECT output columns can be imported.');
      value.columns = outputs.map((entry) => entry.value);
      const outputKeys = new Map<string, number[]>();
      for (const entry of outputs)
        outputKeys.set(entry.key, [...(outputKeys.get(entry.key) ?? []), entry.value.ordinal]);
      for (const [key, ordinals] of outputKeys)
        if (ordinals.length > 1) {
          for (const ordinal of ordinals) value.columns[ordinal - 1].duplicateAlias = true;
          warn(
            `${scope}: output name ${value.columns[ordinals[0] - 1].name} is repeated at positions ${ordinals.join(', ')}; outputs remain distinct by ordinal.`,
          );
        }
      const clauses = new Map<ClauseKey, Token[]>();
      const order = ['from', 'where', 'groupBy', 'having', 'orderBy', 'limit'];
      let previousOrder = -1;
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const clause = tokens.slice(
          marker.index + marker.width,
          markers[i + 1]?.index ?? tokens.length,
        );
        if (!clause.length) syntax(`The ${marker.key} clause is empty.`);
        const currentOrder = order.indexOf(marker.key);
        if (
          currentOrder < previousOrder ||
          (clauses.has(marker.key) &&
            !(marker.key === 'limit' && isWord(tokens[marker.index], 'OFFSET')))
        )
          syntax('Query clauses are repeated or out of order.');
        previousOrder = currentOrder;
        if (marker.key === 'limit' && isWord(tokens[marker.index], 'OFFSET')) {
          value.clauses.limit = `${value.clauses.limit ?? ''} OFFSET ${raw(clause)}`.trim();
          clauses.set('limit', [...(clauses.get('limit') ?? []), ...clause]);
        } else {
          value.clauses[marker.key] = raw(clause);
          clauses.set(marker.key, clause);
        }
      }
      const from = clauses.get('from') ?? [];
      const joins: Join[] = [];
      let cursor = 0;
      const readSource = (): Source => {
        if (++sourceCount > sqlQueryLimits.sources)
          syntax('At most 2,000 query sources can be imported.');
        let kind: SqlQuerySource['kind'] = 'table';
        let qualifiedName: string[] = [];
        const qualifiedKeys: string[] = [];
        let child: Block | undefined;
        let defaultAlias: Token | undefined;
        if (from[cursor]?.text === '(') {
          const end = closing(from, cursor);
          if (!isWord(from[cursor + 1], 'SELECT') && !isWord(from[cursor + 1], 'WITH'))
            syntax('Parenthesized JOIN groups and table expressions are not supported.');
          child = parseBlock(from.slice(cursor + 1, end), block, ctes, false);
          kind = 'derived';
          cursor = end + 1;
        } else {
          if (!isIdentifier(from[cursor]) || isSourceStop(from[cursor]))
            syntax('FROM/JOIN needs a table, CTE, or derived SELECT source.');
          do {
            const part = from[cursor++];
            if (!isIdentifier(part)) syntax('A qualified source name is incomplete.');
            qualifiedName.push(part.text);
            qualifiedKeys.push(tokenKey(part));
            defaultAlias = part;
            if (from[cursor]?.text !== '.') break;
            cursor++;
          } while (true);
          if (from[cursor]?.text === '(') syntax('Table functions in FROM/JOIN are not supported.');
          if (qualifiedName.length === 1 && ctes.has(tokenKey(defaultAlias!))) {
            child = ctes.get(tokenKey(defaultAlias!));
            kind = 'cte';
          }
        }
        let alias = defaultAlias;
        let explicitAlias = false;
        if (isWord(from[cursor], 'AS')) {
          cursor++;
          if (!isIdentifier(from[cursor])) syntax('A source AS needs an alias.');
          alias = from[cursor++];
          explicitAlias = true;
        } else if (isIdentifier(from[cursor]) && !isSourceStop(from[cursor])) {
          alias = from[cursor++];
          explicitAlias = true;
        }
        if (!alias) syntax('A derived SELECT source needs an alias.');
        if (block.sources.some((source) => source.key === tokenKey(alias!)))
          syntax(`Duplicate source alias ${alias.text} in ${scope}.`);
        const sourceValue: SqlQuerySource = {
          version: 1,
          scope,
          alias: alias.text,
          kind,
          qualifiedName,
          columns: [],
          ...(child ? { queryScope: child.value.scope } : {}),
        };
        const sourceNode = newNode(graph.diagram.id, {
          nodeType: 'database',
          title:
            `${alias.text}${qualifiedName.length ? ` · ${qualifiedName.at(-1)}` : ' · subquery'}`.slice(
              0,
              1000,
            ),
          description: 'Columns observed in query expressions; the database schema is unknown.',
          width: 400,
          height: 320,
          x: depth * 560,
          y: (sourceCount - 1) * 390,
          metadata: { sqlQuerySource: sourceValue },
        });
        graph.nodes.push(sourceNode);
        const source: Source = {
          value: sourceValue,
          key: tokenKey(alias),
          ...(!explicitAlias && qualifiedKeys.length
            ? { qualifiedKey: qualifiedKeys.join('.') }
            : {}),
          node: sourceNode,
          columnKeys: new Set(),
        };
        block.sources.push(source);
        if (child)
          edge(
            child.node,
            sourceNode,
            { version: 1, scope, kind: 'subquery' },
            kind === 'cte' ? 'CTE result' : 'Derived result',
          );
        return source;
      };
      if (from.length) {
        let left = readSource();
        while (cursor < from.length) {
          let type = '';
          if (from[cursor].text === ',') {
            type = 'CROSS JOIN';
            cursor++;
          } else {
            const start = cursor;
            while (cursor < from.length && isJoinWord(from[cursor])) {
              if (isWord(from[cursor++], 'JOIN')) break;
            }
            if (cursor === start || !isWord(from[cursor - 1], 'JOIN'))
              syntax(`Unsupported FROM/JOIN syntax near ${raw(from.slice(cursor, cursor + 3))}.`);
            type = raw(from.slice(start, cursor)).toUpperCase();
            if (type === 'JOIN') type = 'INNER JOIN';
          }
          const right = readSource();
          let condition: Token[] = [];
          let using = false;
          if (isWord(from[cursor], 'ON') || isWord(from[cursor], 'USING')) {
            using = isWord(from[cursor++], 'USING');
            const start = cursor;
            while (cursor < from.length) {
              if (from[cursor].text === '(') cursor = closing(from, cursor) + 1;
              else if (from[cursor].text === ',' || isJoinWord(from[cursor])) break;
              else cursor++;
            }
            condition = from.slice(start, cursor);
            if (!condition.length) syntax(`The ${type} ${right.value.alias} predicate is empty.`);
          }
          if ((type.includes('CROSS') || type.includes('NATURAL')) && condition.length)
            syntax(`${type} cannot use an ON/USING predicate.`);
          if (type.includes('NATURAL'))
            warn(
              `${scope}: NATURAL JOIN ${right.value.alias} uses unknown shared schema columns; no matching columns were invented.`,
            );
          else if (!condition.length && !type.includes('CROSS'))
            warn(
              `${scope}: ${type} ${right.value.alias} has no predicate and represents a Cartesian product.`,
            );
          joins.push({ left, right, type, condition, using, available: [...block.sources] });
          left = right;
        }
      }
      for (const join of joins) {
        let refs: SqlQueryReference[];
        if (join.using) {
          if (
            join.condition[0]?.text !== '(' ||
            closing(join.condition, 0) !== join.condition.length - 1
          )
            syntax('USING needs a parenthesized column list.');
          refs = split(join.condition.slice(1, -1)).flatMap((entry) => {
            if (entry.length !== 1 || !isIdentifier(entry[0]))
              syntax('USING columns must be identifiers.');
            const leftInputs = join.available.filter((source) => source !== join.right);
            if (leftInputs.length > 1) {
              observe(join.right, entry[0]);
              warn(
                `${scope}: USING (${entry[0].text}) joins a composite left input; its owning source column is unknown without database schemas.`,
              );
              return [
                { column: entry[0].text, resolution: 'ambiguous' as const },
                {
                  scope,
                  sourceAlias: join.right.value.alias,
                  column: entry[0].text,
                  resolution: 'resolved' as const,
                },
              ];
            }
            return [join.left, join.right].map((source) => {
              observe(source, entry[0]);
              return {
                scope,
                sourceAlias: source.value.alias,
                column: entry[0].text,
                resolution: 'resolved' as const,
              };
            });
          });
        } else refs = references(join.condition, block, ctes, join.available);
        const leftSources = join.available.filter(
          (source) =>
            source !== join.right &&
            ((join.using && join.available.length > 2) ||
              refs.some((ref) => ref.scope === scope && ref.sourceAlias === source.value.alias)),
        );
        const condition = join.condition.length
          ? `${join.using ? 'USING ' : ''}${raw(join.condition)}`
          : undefined;
        if (leftSources.length > 1)
          warn(
            `${scope}: ${join.type} ${join.right.value.alias} depends on multiple earlier aliases (${leftSources.map((source) => source.value.alias).join(', ')}); all dependencies are shown for review.`,
          );
        for (const source of leftSources.length ? leftSources : [join.left])
          edge(
            source.node,
            join.right.node,
            {
              version: 1,
              scope,
              kind: 'join',
              joinType: join.type,
              ...(condition ? { condition } : {}),
              references: refs,
            },
            `${join.type} · ${join.right.value.alias}`,
          );
      }
      for (const entry of outputs)
        entry.value.references = references(entry.expression, block, ctes);
      for (const [key, clause] of clauses)
        if (key !== 'from')
          references(
            clause,
            block,
            ctes,
            block.sources,
            key === 'orderBy' || key === 'groupBy' || key === 'having'
              ? new Set(outputKeys.keys())
              : undefined,
          );
      const sourceByRef = (ref: SqlQueryReference) => {
        let owner: Block | undefined = block;
        while (owner && owner.value.scope !== ref.scope) owner = owner.outer;
        return owner?.sources.find((source) => source.value.alias === ref.sourceAlias);
      };
      const lineage = new Map<Source, number[]>();
      for (const column of value.columns)
        for (const ref of column.references) {
          const source = sourceByRef(ref);
          if (source)
            lineage.set(source, [...new Set([...(lineage.get(source) ?? []), column.ordinal])]);
        }
      for (const source of block.sources)
        if (!lineage.has(source))
          edge(source.node, node, { version: 1, scope, kind: 'input' }, 'Query input');
      for (const [source, ordinals] of lineage)
        edge(
          source.node,
          node,
          { version: 1, scope, kind: 'lineage', outputOrdinals: ordinals },
          `Outputs ${ordinals.slice(0, 5).join(', ')}${ordinals.length > 5 ? ', …' : ''}`,
        );
      node.height = 430 + Object.keys(value.clauses).filter((key) => key !== 'from').length * 44;
      return block;
    };
    parseBlock(input.tokens, undefined, new Map(), false);
  }
  if (ignoredStatementCount)
    warn(
      `${ignoredStatementCount} non-query statement(s) were ignored. SQL was not executed and row data was not imported.`,
    );
  warn(
    'Source columns are observed references, not verified database schemas. The diagram shows query structure, not a physical execution plan.',
  );
  if (droppedWarnings) warnings.push(`${droppedWarnings} additional warning(s) omitted.`);
  validateSqlQueryGraph(graph);
  return {
    graph,
    warnings,
    kind: 'query',
    queryCount: blockCount,
    sourceCount,
    outputColumnCount: outputCount,
    tableCount: sourceCount,
    columnCount: graph.nodes.reduce(
      (sum, node) =>
        sum + ((node.metadata.sqlQuerySource as SqlQuerySource | undefined)?.columns.length ?? 0),
      outputCount,
    ),
    relationshipCount: graph.edges.length,
    ignoredStatementCount,
  };
}
