import type { CodeLanguage } from './types';
import { opaqueBlockEnd } from './lex-blocks';

export interface SourceLine {
  raw: string;
  masked: string;
  line: number;
  offset: number;
}
const hashLanguages = new Set<CodeLanguage>([
  'python',
  'shell',
  'r',
  'ruby',
  'powershell',
  'perl',
  'julia',
  'elixir',
  'gdscript',
  'nix',
  'graphql',
  'hcl',
]);
const dashLanguages = new Set<CodeLanguage>(['sql', 'tsql', 'plsql', 'lua', 'haskell', 'mdx']);
const percentLanguages = new Set<CodeLanguage>(['matlab']);
const apostropheLanguages = new Set<CodeLanguage>(['vba', 'vbnet']);
const slashLanguages = new Set<CodeLanguage>([
  'javascript',
  'typescript',
  'java',
  'csharp',
  'cpp',
  'c',
  'go',
  'rust',
  'php',
  'kotlin',
  'swift',
  'dart',
  'objective-c',
  'groovy',
  'solidity',
  'apex',
  'graphql',
  'cypher',
  'hcl',
  'powerquery',
  'dax',
  'scala',
  'fsharp',
  'mdx',
]);

/** Linear scan. Removed characters become spaces so source locations remain stable. */
export function maskCode(
  content: string,
  language: CodeLanguage,
  options: { quotedIdentifiers?: boolean } = {},
): string {
  const output = content.split('');
  const erase = (start: number, end: number) => {
    for (let index = start; index < end; index++)
      if (content[index] !== '\n' && content[index] !== '\r') output[index] = ' ';
  };
  let index = 0;
  let lineStart = 0;
  let lineHasCode = false;
  while (index < content.length) {
    const char = content[index];
    if (char === '\n') {
      lineStart = ++index;
      lineHasCode = false;
      continue;
    }
    const next = content[index + 1];
    const opaqueEnd = opaqueBlockEnd(content, index, language, lineStart);
    if (opaqueEnd !== undefined) {
      erase(index, opaqueEnd);
      index = opaqueEnd;
      continue;
    }
    const atLineStart = !lineHasCode;
    const lineComment =
      (char === '#' && hashLanguages.has(language)) ||
      (char === '-' &&
        next === '-' &&
        dashLanguages.has(language) &&
        !(language === 'lua' && content.startsWith('--[[', index))) ||
      (char === '/' && next === '/' && slashLanguages.has(language)) ||
      (char === '%' && percentLanguages.has(language)) ||
      (char === "'" && apostropheLanguages.has(language)) ||
      (language === 'abap' && (char === '"' || (char === '*' && atLineStart))) ||
      (language === 'assembly' && char === ';') ||
      (language === 'clojure' && char === ';') ||
      (language === 'cobol' &&
        ((char === '*' && next === '>') || (index - lineStart === 6 && char === '*'))) ||
      (language === 'fortran' &&
        (char === '!' ||
          (index === lineStart &&
            (char === '*' || ((char === 'c' || char === 'C') && /\s/.test(next ?? ''))))));
    if (lineComment) {
      const end = content.indexOf('\n', index);
      const finish = end < 0 ? content.length : end;
      erase(index, finish);
      index = finish;
      continue;
    }
    const blockStart =
      char === '/' && next === '*'
        ? ['/*', '*/']
        : language === 'powershell' && char === '<' && next === '#'
          ? ['<#', '#>']
          : (language === 'fsharp' || language === 'pascal') && char === '(' && next === '*'
            ? ['(*', '*)']
            : language === 'haskell' && char === '{' && next === '-'
              ? ['{-', '-}']
              : language === 'lua' && content.startsWith('--[[', index)
                ? ['--[[', ']]']
                : language === 'pascal' && char === '{'
                  ? ['{', '}']
                  : undefined;
    if (blockStart) {
      const start = index;
      index += blockStart[0].length;
      let nesting = 1;
      const nested = ['rust', 'swift', 'kotlin', 'scala', 'fsharp', 'haskell'].includes(language);
      while (index < content.length && nesting) {
        if (nested && content.startsWith(blockStart[0], index)) {
          nesting++;
          index += blockStart[0].length;
        } else if (content.startsWith(blockStart[1], index)) {
          nesting--;
          index += blockStart[1].length;
        } else index++;
      }
      erase(start, index);
      continue;
    }
    if (language === 'sas' && ((char === '*' && atLineStart) || (char === '%' && next === '*'))) {
      const end = content.indexOf(';', index);
      const finish = end < 0 ? content.length : end + 1;
      erase(index, finish);
      index = finish;
      continue;
    }
    // Rust lifetimes and functional type/name apostrophes differ from character literals.
    const charLiteral = content[index + 2] === "'" || (next === '\\' && content[index + 3] === "'");
    const matlabString = language === 'matlab' && !/[\w)\].]/.test(content[index - 1] ?? '');
    const singleIsQuote =
      language === 'matlab'
        ? matlabString
        : ['rust', 'haskell', 'fsharp'].includes(language)
          ? charLiteral
          : !['clojure', 'nix'].includes(language);
    const nixString = language === 'nix' && char === "'" && next === "'";
    // A regex literal starts where an expression is expected; division remains source text.
    if (
      ['javascript', 'typescript', 'ruby', 'perl'].includes(language) &&
      char === '/' &&
      next !== '/' &&
      next !== '*'
    ) {
      let before = index - 1;
      while (before >= 0 && /\s/.test(content[before])) before--;
      if (
        before < 0 ||
        /[=~(:,[!&|?{};]/.test(content[before]) ||
        /\b(?:return|throw|yield|case)\s*$/.test(content.slice(Math.max(0, index - 30), index))
      ) {
        const start = index++;
        let characterClass = false;
        while (index < content.length && content[index] !== '\n') {
          if (content[index] === '\\') {
            index += 2;
            continue;
          }
          if (content[index] === '[') characterClass = true;
          if (content[index] === ']') characterClass = false;
          if (content[index] === '/' && !characterClass) {
            index++;
            while (/[a-z]/i.test(content[index] ?? '') && index < content.length) index++;
            break;
          }
          index++;
        }
        erase(start, index);
        continue;
      }
    }
    if (char === '"' || (char === "'" && singleIsQuote) || char === '`' || nixString) {
      const triple = content.startsWith(char.repeat(3), index);
      const delimiter = nixString ? "''" : triple ? char.repeat(3) : char;
      const start = index;
      index += delimiter.length;
      while (index < content.length) {
        if (content[index] === '\\') {
          index += 2;
          continue;
        }
        if (content.startsWith(delimiter, index)) {
          if (
            !triple &&
            content[index + 1] === char &&
            ['vba', 'vbnet', 'sql', 'tsql', 'plsql', 'powerquery'].includes(language)
          ) {
            index += 2;
            continue;
          }
          index += delimiter.length;
          break;
        }
        index++;
      }
      const identifier =
        options.quotedIdentifiers &&
        ['sql', 'tsql', 'plsql'].includes(language) &&
        (char === '"' || char === '`');
      if (!identifier) erase(start, index);
      continue;
    }
    if (!/\s/.test(char)) lineHasCode = true;
    index++;
  }
  return output.join('');
}

export function sourceLines(
  content: string,
  language: CodeLanguage,
  options: { quotedIdentifiers?: boolean } = {},
): SourceLine[] {
  const masked = maskCode(content, language, options).split('\n');
  let offset = 0;
  return content.split('\n').map((raw, index) => {
    const result = { raw, masked: masked[index], line: index + 1, offset };
    offset += raw.length + 1;
    return result;
  });
}
