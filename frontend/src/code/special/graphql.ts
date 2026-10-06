import { maskCode } from '../lex';
import type { ExtractedCode } from '../types';
import { boundedContent, Extraction } from './common';

const scalars = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
const operationKinds = new Set(['query', 'mutation', 'subscription', 'fragment']);
type Declaration = {
  key: string;
  kind: string;
  name: string;
  start: number;
  open: number;
  end: number;
  root?: string;
};

/** One scan pairs braces so overlapping/unclosed declarations cannot force repeated scans. */
function closingBraces(masked: string): Map<number, number> {
  const stack: number[] = [];
  const pairs = new Map<number, number>();
  for (let index = 0; index < masked.length; index++) {
    if (masked[index] === '{') stack.push(index);
    else if (masked[index] === '}') {
      const opening = stack.pop();
      if (opening !== undefined) pairs.set(opening, index);
    }
  }
  return pairs;
}

function operationFields(masked: string, declaration: Declaration, out: Extraction): void {
  if (!declaration.root || declaration.open < 0) return;
  const body = masked.slice(declaration.open, declaration.end + 1);
  const tokens = [...body.matchAll(/\.\.\.|[{}():@]|[A-Za-z_]\w*/g)];
  let depth = 0;
  let argumentsDepth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index][0];
    if (token === '{') {
      depth++;
      continue;
    }
    if (token === '}') {
      depth--;
      continue;
    }
    if (token === '(') {
      argumentsDepth++;
      continue;
    }
    if (token === ')') {
      argumentsDepth--;
      continue;
    }
    if (depth !== 1 || argumentsDepth) continue;
    if (token === '@') {
      index++;
      continue;
    }
    if (token === '...') {
      index += tokens[index + 1]?.[0] === 'on' ? 2 : 1;
      continue;
    }
    if (!/^[A-Za-z_]/.test(token)) continue;
    const alias = tokens[index + 1]?.[0] === ':';
    const name = alias ? tokens[index + 2]?.[0] : token;
    if (alias) index += 2;
    if (!name || name === '__typename') continue;
    out.dependency(
      {
        source: declaration.key,
        target: `${declaration.root}.${name}`,
        kind: 'reads',
        targetType: 'symbol',
        confidence: 'heuristic',
      },
      declaration.open + tokens[index].index,
    );
  }
}

export function extractGraphql(content: string): ExtractedCode {
  const out = new Extraction(content);
  const masked = maskCode(boundedContent(content, out), 'graphql');
  const pairs = closingBraces(masked);
  const roots: Record<string, string> = {
    query: 'Query',
    mutation: 'Mutation',
    subscription: 'Subscription',
  };
  const schema = /\bschema\s*\{([^}]*)}/.exec(masked);
  if (schema)
    for (const match of schema[1].matchAll(/\b(query|mutation|subscription)\s*:\s*([A-Za-z_]\w*)/g))
      roots[match[1]] = match[2];
  const declarations: Declaration[] = [];
  const matches = [
    ...masked.matchAll(
      /\b(?:extend\s+)?(type|interface|input|enum|scalar|union|query|mutation|subscription|fragment)\s+([A-Za-z_]\w*)/g,
    ),
  ];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const kind = match[1];
    const key = out.symbol(match[2], operationKinds.has(kind) ? 'query' : 'type', match.index);
    if (!key) continue;
    const candidate = masked.indexOf('{', match.index);
    const open =
      !['scalar', 'union'].includes(kind) &&
      candidate >= 0 &&
      candidate < (matches[index + 1]?.index ?? masked.length)
        ? candidate
        : -1;
    const candidateEnd =
      open >= 0 ? (pairs.get(open) ?? masked.length) : masked.indexOf('\n', match.index);
    const end = candidateEnd < 0 ? masked.length : candidateEnd;
    let root: string | undefined = roots[kind];
    const rest = masked.slice(match.index + match[0].length, open < 0 ? end : open);
    const inherits = /^\s+implements\s+([\w\s&]+)/.exec(rest);
    if (inherits)
      for (const parent of inherits[1].match(/[A-Za-z_]\w*/g) ?? [])
        out.dependency(
          {
            source: key,
            target: parent,
            kind: 'inherits',
            targetType: 'symbol',
            confidence: 'syntax',
          },
          match.index,
        );
    if (kind === 'fragment') {
      root = /^\s+on\s+([A-Za-z_]\w*)/.exec(rest)?.[1];
      if (root)
        out.dependency(
          {
            source: key,
            target: root,
            kind: 'references',
            targetType: 'symbol',
            confidence: 'syntax',
          },
          match.index,
        );
    }
    if (kind === 'union') {
      const union = /^\s*=\s*([^\n]+)/.exec(rest);
      if (union)
        for (const member of union[1].match(/[A-Za-z_]\w*/g) ?? [])
          out.dependency(
            {
              source: key,
              target: member,
              kind: 'references',
              targetType: 'symbol',
              confidence: 'syntax',
            },
            match.index,
          );
    }
    declarations.push({
      key,
      kind,
      name: match[2],
      start: match.index,
      open,
      end: end < 0 ? masked.length : end,
      root,
    });
  }
  for (const match of masked.matchAll(/\b(query|mutation|subscription)\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = match.index + match[0].lastIndexOf('{');
    const key = out.symbol(`Anonymous ${match[1]}`, 'query', match.index);
    if (key)
      declarations.push({
        key,
        kind: match[1],
        name: `Anonymous ${match[1]}`,
        start: match.index,
        open,
        end: pairs.get(open) ?? masked.length,
        root: roots[match[1]],
      });
  }
  if (/^\s*\{/.test(masked)) {
    const open = masked.indexOf('{');
    const key = out.symbol('Anonymous query', 'query', open);
    if (key)
      declarations.push({
        key,
        kind: 'query',
        name: 'Anonymous query',
        start: open,
        open,
        end: pairs.get(open) ?? masked.length,
        root: roots.query,
      });
  }
  for (const declaration of declarations) {
    const body = declaration.open >= 0 ? masked.slice(declaration.open + 1, declaration.end) : '';
    if (['type', 'interface', 'input'].includes(declaration.kind)) {
      for (const match of body.matchAll(
        /([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*\[?\s*([A-Za-z_]\w*)/g,
      )) {
        const offset = declaration.open + 1 + match.index;
        const field = out.symbol(
          `${declaration.name}.${match[1]}`,
          'variable',
          offset,
          declaration.key,
        );
        if (!scalars.has(match[2]))
          out.dependency(
            {
              source: field,
              target: match[2],
              kind: 'references',
              targetType: 'symbol',
              confidence: 'syntax',
            },
            offset,
          );
      }
    } else if (operationKinds.has(declaration.kind)) operationFields(masked, declaration, out);
    for (const match of body.matchAll(/\.\.\.\s*([A-Za-z_]\w*)/g))
      if (match[1] !== 'on')
        out.dependency(
          {
            source: declaration.key,
            target: match[1],
            kind: 'references',
            targetType: 'symbol',
            confidence: 'syntax',
          },
          declaration.open + 1 + match.index,
        );
  }
  if (declarations.some((declaration) => operationKinds.has(declaration.kind)))
    out.warn(
      'GraphQL operations reference declared root fields, types and fragments. Resolver implementations and nested runtime field bindings are not inferred.',
    );
  if (declarations.some((declaration) => declaration.open >= 0 && !pairs.has(declaration.open)))
    out.warn(
      'An unclosed GraphQL declaration was outlined heuristically; check the original source.',
    );
  return out.result;
}
