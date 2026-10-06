import { maskCode } from '../lex';
import { codeLimits, type CodeLanguage, type ExtractedCode } from '../types';
import { boundedContent, Extraction } from './common';

const sqlIdentifier = '(?:[A-Za-z_#][\\w$#]*|"[^"\\n]+"|`[^`\\n]+`|\\[[^\\]\\n]+\\])';
const sqlName = `${sqlIdentifier}(?:\\s*\\.\\s*${sqlIdentifier})*`;
const cleanSqlName = (name: string) => name.replace(/\s*\.\s*/g, '.').replace(/["`\[\]]/g, '');

export function extractSql(content: string, language: CodeLanguage): ExtractedCode {
  const out = new Extraction(content);
  const source = boundedContent(content, out);
  const masked = maskCode(source, language, { quotedIdentifiers: true });
  const owners: { key: string; start: number; end: number }[] = [];
  const create = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+|OR\\s+ALTER\\s+)?(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|PACKAGE(?:\\s+BODY)?)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${sqlName})`,
    'gi',
  );
  for (const match of masked.matchAll(create)) {
    const kind = /TABLE|VIEW/i.test(match[1])
      ? 'resource'
      : /PACKAGE/i.test(match[1])
        ? 'class'
        : 'function';
    const key = out.symbol(cleanSqlName(match[2]), kind, match.index);
    if (key)
      owners.push({
        key,
        start: match.index,
        end: /TABLE/i.test(match[1]) ? masked.indexOf(';', match.index) : masked.length,
      });
  }
  if (language === 'plsql') {
    const signatures = new Set(out.result.symbols.map((symbol) => `${symbol.name}:${symbol.line}`));
    const packageKeys = new Set(
      out.result.symbols.filter((symbol) => symbol.kind === 'class').map((symbol) => symbol.key),
    );
    const packages = owners.filter((owner) => packageKeys.has(owner.key));
    let packagePosition = 0;
    for (const match of masked.matchAll(/\b(PROCEDURE|FUNCTION)\s+([A-Za-z_]\w*)/gi)) {
      if (signatures.has(`${match[2]}:${out.line(match.index)}`)) continue;
      while (
        packagePosition + 1 < packages.length &&
        packages[packagePosition + 1].start < match.index
      )
        packagePosition++;
      const packageOwner =
        packages[packagePosition]?.start < match.index ? packages[packagePosition] : undefined;
      const key = out.symbol(match[2], 'function', match.index, packageOwner?.key);
      signatures.add(`${match[2]}:${out.line(match.index)}`);
      if (key) owners.push({ key, start: match.index, end: masked.length });
    }
  }
  const containers = [...owners].sort((a, b) => a.start - b.start);
  let containerPosition = 0;
  let queryNumber = 0;
  for (const match of masked.matchAll(/\bSELECT\b/gi)) {
    if (queryNumber >= codeLimits.symbols)
      throw new Error(`Code analysis exceeds the ${codeLimits.symbols} query limit.`);
    while (
      containerPosition + 1 < containers.length &&
      containers[containerPosition + 1].start < match.index
    )
      containerPosition++;
    const candidate = containers[containerPosition];
    const parent =
      candidate?.start < match.index && (candidate.end < 0 || candidate.end > match.index)
        ? candidate
        : undefined;
    const key = out.symbol(`Query ${++queryNumber}`, 'query', match.index, parent?.key);
    const end = masked.indexOf(';', match.index);
    if (key) owners.push({ key, start: match.index, end: end < 0 ? masked.length : end });
  }
  owners.sort((a, b) => a.start - b.start);
  const ownerAt = (offset: number) => {
    let low = 0;
    let high = owners.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (owners[middle].start <= offset) low = middle + 1;
      else high = middle;
    }
    const owner = owners[low - 1];
    return owner && owner.end >= offset ? owner.key : undefined;
  };
  for (const match of masked.matchAll(
    /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_]\w*)\s+AS\s*\(\s*SELECT\b/gi,
  )) {
    out.symbol(match[1], 'query', match.index);
  }
  const relation = new RegExp(
    `\\b(FROM|JOIN|UPDATE|INSERT\\s+INTO|DELETE\\s+FROM|MERGE\\s+INTO|REFERENCES|CALL|EXEC(?:UTE)?)\\s+(${sqlName})`,
    'gi',
  );
  for (const match of masked.matchAll(relation)) {
    const keyword = match[1].replace(/\s+/g, ' ').toUpperCase();
    const target = cleanSqlName(match[2]);
    if (/^(?:SELECT|LATERAL|UNNEST|ONLY)$/i.test(target)) continue;
    out.dependency(
      {
        source: ownerAt(match.index),
        target,
        kind: /^(?:CALL|EXEC)/.test(keyword)
          ? 'calls'
          : /^(?:UPDATE|INSERT|DELETE|MERGE)/.test(keyword)
            ? 'writes'
            : keyword === 'REFERENCES'
              ? 'references'
              : 'reads',
        targetType: 'symbol',
        confidence: 'heuristic',
      },
      match.index,
    );
  }
  if (language !== 'sql' || /\b(?:BEGIN|EXECUTE\s+IMMEDIATE|EXEC\s*\(|PREPARE)\b/i.test(masked))
    out.warn(
      'Procedural SQL is shown as an outline. Dynamic SQL and procedural control flow are not resolved.',
    );
  out.warn(
    'SQL code analysis shows statement and table dependencies. Use SQL import for scoped SELECT column lineage.',
  );
  return out.result;
}

export function extractCypher(content: string): ExtractedCode {
  const out = new Extraction(content);
  const masked = maskCode(boundedContent(content, out), 'cypher');
  const query = out.symbol('Graph query', 'query', 0);
  const seen = new Set<string>();
  const clauses = [...masked.matchAll(/\b(MATCH|CREATE|MERGE|SET|DELETE|REMOVE)\b/gi)];
  let clausePosition = 0;
  for (const match of masked.matchAll(/[\[(]\s*(?:[A-Za-z_]\w*\s*)?:\s*([A-Za-z_]\w*)/g)) {
    const name = match[1];
    if (!seen.has(name)) {
      out.symbol(name, 'resource', match.index);
      seen.add(name);
    }
    while (clausePosition + 1 < clauses.length && clauses[clausePosition + 1].index < match.index)
      clausePosition++;
    const lastClause = clauses[clausePosition]?.[1].toUpperCase();
    out.dependency(
      {
        source: query,
        target: name,
        kind: lastClause === 'CREATE' || lastClause === 'MERGE' ? 'writes' : 'reads',
        targetType: 'symbol',
        confidence: 'heuristic',
      },
      match.index,
    );
  }
  for (const match of masked.matchAll(/\bCALL\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/gi))
    out.dependency(
      {
        source: query,
        target: match[1],
        kind: 'calls',
        targetType: 'symbol',
        confidence: 'syntax',
      },
      match.index,
    );
  out.warn(
    'Cypher labels, relationship types and procedure calls are structural hints; runtime graph contents and variable bindings are not inferred.',
  );
  return out.result;
}
