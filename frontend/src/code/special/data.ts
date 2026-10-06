import { maskCode } from '../lex';
import type { CodeLanguage, ExtractedCode } from '../types';
import { boundedContent, Extraction, visible } from './common';

type Owner = { key: string; offset: number; name: string };
function nearest(owners: Owner[], offset: number): string | undefined {
  let low = 0;
  let high = owners.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (owners[middle].offset <= offset) low = middle + 1;
    else high = middle;
  }
  return owners[low - 1]?.key;
}

export function extractBi(content: string, language: CodeLanguage): ExtractedCode {
  const out = new Extraction(content);
  const source = boundedContent(content, out);
  const masked = maskCode(source, language);
  const owners: Owner[] = [];
  const declarationEnds = new Map<string, number>();
  if (language === 'dax') {
    for (const match of source.matchAll(
      /^(?:[ \t]*(?:DEFINE\s+)?MEASURE\s+(?:'[^'\n]+'|[A-Za-z_]\w*)\[([^\]\n]+)\]|[ \t]*([A-Za-z_][\w ]*?))\s*(?::=|=)/gim,
    )) {
      const equals = match.index + match[0].lastIndexOf('=');
      if (!visible(masked, equals, '=')) continue;
      const name = (match[1] ?? match[2]).trim();
      const key = out.symbol(name, 'measure', match.index);
      if (key) {
        owners.push({ key, offset: match.index, name });
        declarationEnds.set(key, equals);
      }
    }
    owners.sort((a, b) => a.offset - b.offset);
    for (const match of source.matchAll(/(?:'([^'\n]+)'|\b([A-Za-z_]\w*))?\[([^\]\n]+)\]/g)) {
      const bracket = match.index + match[0].indexOf('[');
      if (!visible(masked, bracket, '[')) continue;
      const owner = nearest(owners, match.index);
      if (owner && bracket < (declarationEnds.get(owner) ?? 0)) continue;
      const table = match[1] ?? match[2];
      out.dependency(
        {
          source: owner,
          target: table ?? match[3],
          kind: table ? 'reads' : 'references',
          targetType: 'symbol',
          confidence: table ? 'syntax' : 'heuristic',
        },
        match.index,
      );
    }
    if (/\b(?:EVALUATE|CALCULATETABLE)\b/i.test(masked) && !owners.length)
      out.symbol('DAX query', 'query', 0);
    out.warn(
      'DAX table and measure references are extracted syntactically. Filter context and calculated runtime dependencies are not evaluated.',
    );
  } else if (language === 'powerquery') {
    for (const match of source.matchAll(
      /(?:\blet\s+|^\s*|,\s*)(#"(?:[^"]|"")+"|[A-Za-z_]\w*)\s*=/gm,
    )) {
      const equals = match.index + match[0].lastIndexOf('=');
      if (!visible(masked, equals, '=')) continue;
      const name = match[1].startsWith('#"') ? match[1].slice(2, -1).replace(/""/g, '"') : match[1];
      const isFunction = /^\s*\([^)]*\)\s*=>/.test(masked.slice(equals + 1, equals + 501));
      const key = out.symbol(name, isFunction ? 'function' : 'variable', match.index);
      if (key) owners.push({ key, offset: match.index, name });
    }
    owners.sort((a, b) => a.offset - b.offset);
    const known = new Map(owners.map((owner) => [owner.name, owner.key]));
    for (const match of masked.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g))
      out.dependency(
        {
          source: nearest(owners, match.index),
          target: match[1],
          kind: 'calls',
          targetType: 'symbol',
          confidence: 'syntax',
        },
        match.index,
      );
    for (const match of source.matchAll(/#"(?:[^"]|"")+"|\b[A-Za-z_]\w*\b/g)) {
      const name = match[0].startsWith('#"') ? match[0].slice(2, -1).replace(/""/g, '"') : match[0];
      if (
        !known.has(name) ||
        !visible(masked, match.index, match[0].startsWith('#"') ? '#' : match[0])
      )
        continue;
      const owner = nearest(owners, match.index);
      if (owner === known.get(name)) continue;
      out.dependency(
        {
          source: owner,
          target: name,
          kind: 'depends-on',
          targetType: 'symbol',
          confidence: 'syntax',
        },
        match.index,
      );
    }
    out.warn(
      'Power Query steps and explicit function calls are shown. Connector destinations, literal values and runtime table schemas are omitted.',
    );
  } else {
    for (const match of masked.matchAll(
      /\b(?:WITH\s+)?(MEMBER|SET)\s+((?:\[[^\]\n]+\]\s*\.?\s*)+)\s+AS\b/gi,
    )) {
      const name = [...match[2].matchAll(/\[([^\]]+)\]/g)].map((part) => part[1]).join('.');
      const key = out.symbol(
        name,
        match[1].toUpperCase() === 'MEMBER' ? 'measure' : 'variable',
        match.index,
      );
      if (key) owners.push({ key, offset: match.index, name });
    }
    const select = /\bSELECT\b/i.exec(masked);
    if (select) {
      const key = out.symbol('MDX query', 'query', select.index);
      if (key) owners.push({ key, offset: select.index, name: 'MDX query' });
    }
    owners.sort((a, b) => a.offset - b.offset);
    const measures = new Map(owners.map((owner) => [owner.name, owner.key]));
    for (const match of masked.matchAll(/\bFROM\s+\[([^\]\n]+)\]/gi))
      out.dependency(
        {
          source: nearest(owners, match.index),
          target: match[1],
          kind: 'reads',
          targetType: 'symbol',
          confidence: 'syntax',
        },
        match.index,
      );
    for (const match of masked.matchAll(/\[Measures\]\s*\.\s*\[([^\]\n]+)\]/gi)) {
      const name = `Measures.${match[1]}`;
      const owner = nearest(owners, match.index);
      if (measures.get(name) === owner) continue;
      out.dependency(
        {
          source: owner,
          target: name,
          kind: 'references',
          targetType: 'symbol',
          confidence: 'syntax',
        },
        match.index,
      );
    }
    out.warn(
      'MDX cube and measure names are shown. Quoted expressions and runtime cell calculations are not evaluated.',
    );
  }
  return out.result;
}

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const safeName = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[\w .:-]{1,500}$/.test(value) ? value : undefined;

export function extractVega(content: string): ExtractedCode {
  const out = new Extraction(content);
  let document: Record<string, unknown> | undefined;
  const source = boundedContent(content, out);
  try {
    document = objectValue(JSON.parse(source));
  } catch {
    out.warn(
      'Vega input is not valid JSON; no structured visualization dependencies could be extracted.',
    );
    return out.result;
  }
  if (!document) {
    out.warn('Vega input must be a JSON specification object.');
    return out.result;
  }
  const root = out.symbol('Visualization', 'query', 0);
  const named = new Map<string, string | undefined>();
  const resource = (name: string, offset: number) => {
    if (!named.has(name)) {
      named.set(name, out.symbol(name, 'resource', offset, root));
    }
  };
  const identifierPositions = new Map<string, number>();
  for (const literal of content.matchAll(
    /"(?:name|source|data|type|mark)"\s*:\s*("(?:[^"\\]|\\.)*")/g,
  )) {
    if (literal[1].length > 512 || identifierPositions.size >= 10000) continue;
    try {
      const name = JSON.parse(literal[1]) as string;
      if (!identifierPositions.has(name))
        identifierPositions.set(name, literal.index + literal[0].lastIndexOf(literal[1]));
    } catch {
      /* JSON validity is checked above. */
    }
  }
  const locate = (name: string): number => identifierPositions.get(name) ?? 0;
  const dataEntries = Array.isArray(document.data)
    ? document.data
    : document.data
      ? [document.data]
      : [];
  for (const value of dataEntries) {
    const data = objectValue(value);
    if (!data) continue;
    const name = safeName(data.name) ?? `Data ${named.size + 1}`;
    const offset = Math.max(0, locate(name));
    resource(name, offset);
    const owner = named.get(name);
    const sources = Array.isArray(data.source) ? data.source : [data.source];
    for (const value of sources) {
      const target = safeName(value);
      if (target)
        out.dependency(
          { source: owner, target, kind: 'depends-on', targetType: 'symbol', confidence: 'syntax' },
          offset,
        );
    }
    if (data.url !== undefined)
      out.warn(
        'External data URLs and inline data values are omitted; only named visualization dependencies are retained.',
      );
    const transforms = Array.isArray(data.transform) ? data.transform : [];
    for (const transform of transforms) {
      const target = safeName(objectValue(transform)?.from);
      if (target)
        out.dependency(
          { source: owner, target, kind: 'reads', targetType: 'symbol', confidence: 'syntax' },
          offset,
        );
    }
  }
  let visited = 0;
  const walk = (value: unknown, parent: string | undefined, depth: number): void => {
    if (++visited > 10000 || depth > 40) {
      throw new Error('Code analysis exceeds the Vega specification traversal limit.');
    }
    const record = objectValue(value);
    if (!record) return;
    let owner = parent;
    if (record.mark !== undefined || (record.type && record.from)) {
      const mark =
        typeof record.mark === 'string'
          ? safeName(record.mark)
          : (safeName(objectValue(record.mark)?.type) ?? safeName(record.type));
      const name = safeName(record.name) ?? `${mark ?? 'Visual'} mark ${visited}`;
      owner = out.symbol(name, 'resource', Math.max(0, locate(name)), parent);
      const target =
        safeName(objectValue(record.from)?.data) ?? safeName(objectValue(record.data)?.name);
      if (target)
        out.dependency(
          { source: owner, target, kind: 'reads', targetType: 'symbol', confidence: 'syntax' },
          Math.max(0, locate(target)),
        );
      else if (!Array.isArray(document.data) && named.size === 1)
        out.dependency(
          {
            source: owner,
            target: [...named.keys()][0],
            kind: 'reads',
            targetType: 'symbol',
            confidence: 'heuristic',
          },
          0,
        );
    }
    if (Array.isArray(record.transform))
      for (const value of record.transform) {
        const transform = objectValue(value);
        const target = safeName(objectValue(objectValue(transform?.from)?.data)?.name);
        if (target) {
          resource(target, Math.max(0, locate(target)));
          out.dependency(
            { source: owner, target, kind: 'reads', targetType: 'symbol', confidence: 'syntax' },
            Math.max(0, locate(target)),
          );
        }
      }
    for (const field of ['layer', 'marks', 'hconcat', 'vconcat', 'concat'])
      if (Array.isArray(record[field]))
        for (const child of record[field]) walk(child, owner, depth + 1);
    if (record.spec) walk(record.spec, owner, depth + 1);
  };
  walk(document, root, 0);
  out.warn(
    'Vega and Vega-Lite analysis follows named datasets, lookup transforms and marks. Signal expressions and data-dependent rendering are not executed.',
  );
  return out.result;
}

export function extractSas(content: string): ExtractedCode {
  const out = new Extraction(content);
  const masked = maskCode(boundedContent(content, out), 'sas');
  const owners: Owner[] = [];
  for (const match of masked.matchAll(
    /%MACRO\s+([A-Za-z_]\w*)|\bDATA\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|\bPROC\s+([A-Za-z_]\w*)/gi,
  )) {
    const name = match[1] ?? match[2] ?? `${match[3]} procedure`;
    const key = out.symbol(
      name,
      match[1] ? 'function' : match[2] ? 'resource' : 'query',
      match.index,
    );
    if (key) owners.push({ key, offset: match.index, name });
  }
  for (const match of masked.matchAll(
    /\b(?:SET|MERGE|FROM|JOIN)\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|\b(?:DATA|OUT)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|%([A-Za-z_]\w*)\s*\(/gi,
  )) {
    const target = match[1] ?? match[2] ?? match[3];
    const keyword = match[0].split(/\s|=/)[0].toUpperCase();
    out.dependency(
      {
        source: nearest(owners, match.index),
        target,
        kind: match[3] ? 'calls' : keyword === 'OUT' ? 'writes' : 'reads',
        targetType: 'symbol',
        confidence: 'heuristic',
      },
      match.index,
    );
  }
  out.warn(
    'SAS data steps, procedures and explicit macro calls are outlined. Macro expansion and generated SQL are not evaluated.',
  );
  return out.result;
}
