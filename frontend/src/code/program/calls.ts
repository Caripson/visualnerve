import type { CodeDependency, CodeLanguage, CodeSymbol } from '../types';
import type { SourceLine } from '../lex';
import { declarationAt } from './declarations';

const keywords = new Set([
  'if',
  'else',
  'while',
  'for',
  'switch',
  'catch',
  'with',
  'function',
  'func',
  'fn',
  'fun',
  'def',
  'class',
  'return',
  'throw',
  'new',
  'delete',
  'sizeof',
  'typeof',
  'decltype',
  'alignof',
  'assert',
  'import',
  'require',
  'include',
  'library',
  'source',
  'preload',
  'load',
  'print',
  'println',
  'printf',
  'console.log',
  'log',
  'echo',
  'write-host',
  'range',
  'len',
  'list',
  'dict',
  'set',
  'str',
  'int',
  'float',
  'bool',
  'super',
  'base',
  'this',
  'param',
  'select',
  'where',
  'case',
  'when',
  'do',
  'end',
  'begin',
  'let',
  'match',
  'try',
]);

export function callsAt(
  line: SourceLine,
  language: CodeLanguage,
  functions: Set<string>,
  owner?: CodeSymbol,
): CodeDependency[] {
  const output: CodeDependency[] = [];
  const code = line.masked;
  const declaration = declarationAt(code, language);
  const add = (target: string, kind: 'calls' | 'references' = 'calls') => {
    if (!target || target.length > 500 || keywords.has(target.toLowerCase())) return;
    output.push({
      source: owner?.key,
      target,
      kind,
      targetType: 'symbol',
      line: line.line,
      confidence: 'heuristic',
    });
  };
  for (const match of code.matchAll(
    /\b([A-Za-z_$][\w$]*(?:(?:\.|::|->)[A-Za-z_$][\w$]*)*)\s*\(/g,
  )) {
    if (
      declaration?.name === match[1] &&
      code.slice(0, match.index).trim().length < 100 &&
      line.line === owner?.line
    )
      continue;
    add(match[1]);
  }
  if (declaration?.base) {
    output.push({
      source: owner?.line === line.line ? owner.key : undefined,
      target: declaration.base,
      kind: 'inherits',
      targetType: 'symbol',
      line: line.line,
      confidence: 'syntax',
    });
  }
  if (language === 'objective-c') {
    for (const match of code.matchAll(/\[\s*([\w]+)\s+([\w]+)/g))
      add(match[1] === 'self' || match[1] === 'super' ? match[2] : `${match[1]}.${match[2]}`);
  } else if (language === 'clojure') {
    for (const match of code.matchAll(/\(([\w!?*+<>=./-]+)(?=\s|\))/g)) {
      if (
        ![
          'ns',
          'defn',
          'defn-',
          'defmacro',
          'def',
          'defrecord',
          'deftype',
          'defprotocol',
          'let',
          'fn',
          'require',
          'use',
          'quote',
        ].includes(match[1])
      )
        add(match[1]);
    }
  } else if (language === 'shell') {
    const match = code.match(/^\s*(?:[\w]+=[^;]*\s+)?([\w.-]+)(?:\s|$)/);
    if (
      !declaration &&
      match &&
      ![
        'source',
        'fi',
        'then',
        'done',
        'esac',
        'exit',
        'local',
        'export',
        'function',
        'return',
      ].includes(match[1])
    )
      add(match[1]);
    for (const call of code.matchAll(/\$\(\s*([\w.-]+)/g)) add(call[1]);
  } else if (language === 'powershell') {
    for (const match of code.matchAll(/(?:^|[;|{]\s*|\s)([A-Za-z]+-[A-Za-z][\w-]*)(?=\s|$)/g)) {
      if (!/^(?:Import-Module|Write-Host)$/i.test(match[1])) add(match[1]);
    }
    const invocation = code.match(/^\s*&?\s*([\w-]+)(?:\s|$)/);
    if (!declaration && invocation && functions.has(invocation[1])) add(invocation[1]);
  } else if (
    [
      'ruby',
      'vba',
      'vbnet',
      'fortran',
      'pascal',
      'lua',
      'perl',
      'haskell',
      'fsharp',
      'elixir',
    ].includes(language)
  ) {
    const explicit = code.match(/\b(?:call|perform|&|go\s+to)\s+([\w.:-]+)/i);
    if (explicit) add(explicit[1]);
    // Whitespace calls in functional/end-delimited languages only bind declared local names.
    for (const match of code.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
      if (match[1] === declaration?.name) continue;
      if (functions.has(match[1]))
        add(match[1], ['haskell', 'fsharp'].includes(language) ? 'references' : 'calls');
    }
  }
  return output;
}
