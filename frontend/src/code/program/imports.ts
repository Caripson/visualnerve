import type { CodeDependency, CodeLanguage } from '../types';
import type { SourceLine } from '../lex';

const moduleName = (value: string) =>
  value.trim() &&
  value.length <= 500 &&
  !/[\u0000-\u001f\u007f${}]/.test(value) &&
  !/^(?:https?|ftp|data|file):/i.test(value)
    ? value
    : undefined;
/** Only syntax-marked import statements may turn string literals into module identifiers. */
export function importsAt(
  line: SourceLine,
  language: CodeLanguage,
  goBlock: boolean,
): CodeDependency[] {
  const output: CodeDependency[] = [];
  const add = (value: string | undefined) => {
    const target = value && moduleName(value);
    if (target)
      output.push({
        target,
        kind: 'imports',
        line: line.line,
        targetType: 'module',
        confidence: 'syntax',
      });
  };
  const code = line.masked.trim();
  const raw = line.raw.trim();
  if (language === 'python') {
    const from = code.match(/^from\s+([.\w]+)\s+import\b/);
    if (from) add(from[1]);
    else if (/^import\s/.test(code))
      for (const part of code.replace(/^import\s+/, '').split(','))
        add(part.trim().split(/\s+/)[0]);
  } else if (language === 'javascript' || language === 'typescript') {
    if (/^(?:import|export)\b/.test(code)) {
      const match = raw.match(/(?:\bfrom\s*|^import\s*)['"]([^'"]+)['"]/);
      add(match?.[1]);
    }
    for (const match of code.matchAll(/\b(?:require|import)\s*\(/g)) {
      add(line.raw.slice(match.index).match(/^(?:require|import)\s*\(\s*['"]([^'"]+)['"]/)?.[1]);
    }
  } else if (language === 'go') {
    if (/^import\b/.test(code) || goBlock)
      add(raw.match(/(?:^import\s+)?(?:\w+\s+)?"([^"]+)"/)?.[1]);
  } else if (language === 'cpp' || language === 'c' || language === 'objective-c') {
    if (/^#\s*(?:include|import)\b/.test(code))
      add(raw.match(/^#\s*(?:include|import)\s*[<"]([^>"]+)[>"]/)?.[1]);
  } else if (
    ['java', 'kotlin', 'scala', 'groovy', 'dart', 'swift', 'csharp', 'vbnet'].includes(language)
  ) {
    const match = code.match(/^(?:import|using|Imports)\s+(?:static\s+)?([\w.]+)/i);
    if (match) add(match[1]);
    else if (language === 'dart' && /^import\b/.test(code))
      add(raw.match(/^import\s*['"]([^'"]+)['"]/)?.[1]);
  } else if (language === 'rust') {
    const match = code.match(/^(?:pub\s+)?(?:use|mod|extern\s+crate)\s+([\w:]+)/);
    if (match) add(match[1].replace(/::$/, ''));
  } else if (language === 'php') {
    if (/^(?:require(?:_once)?|include(?:_once)?)\b/.test(code))
      add(raw.match(/^(?:require(?:_once)?|include(?:_once)?)\s*\(?\s*['"]([^'"]+)['"]/)?.[1]);
    const match = code.match(/^use\s+([\w\\]+)/);
    if (match) add(match[1].replaceAll('\\', '/'));
  } else if (language === 'ruby' || language === 'lua' || language === 'r') {
    const command =
      language === 'ruby'
        ? 'require(?:_relative)?'
        : language === 'lua'
          ? 'require'
          : '(?:library|require|source)';
    if (new RegExp(`\\b${command}\\b`).test(code)) {
      const regex = new RegExp(`\\b${command}\\s*\\(?\\s*(?:['"]([^'"]+)['"]|([\\w.]+))`);
      const match = raw.match(regex);
      add(match?.[1] ?? match?.[2]);
    }
  } else if (language === 'shell') {
    if (/^(?:source|\.)\s/.test(code)) add(raw.match(/^(?:source|\.)\s+['"]?([\w./+-]+)/)?.[1]);
  } else if (language === 'powershell') {
    if (/^(?:Import-Module|using\s+module)\b/i.test(code))
      add(raw.match(/^(?:Import-Module|using\s+module)\s+['"]?([\w./+-]+)/i)?.[1]);
    else if (/^\.\s/.test(code))
      add(raw.match(/^\.\s+['"]?([\w./\\+-]+)/)?.[1]?.replaceAll('\\', '/'));
  } else if (language === 'perl') {
    add(code.match(/^(?:use|require)\s+([\w:]+)/)?.[1]);
  } else if (language === 'julia') {
    const match = code.match(/^(?:using|import)\s+([\w.]+)/);
    if (match) add(match[1]);
    if (/\binclude\s*\(/.test(code)) add(raw.match(/\binclude\s*\(\s*"([^"]+)"/)?.[1]);
  } else if (language === 'elixir') {
    add(code.match(/^(?:alias|import|require|use)\s+([\w.]+)/)?.[1]);
  } else if (language === 'haskell') {
    add(code.match(/^import\s+(?:qualified\s+)?([\w.]+)/)?.[1]);
  } else if (language === 'fsharp') {
    add(code.match(/^open\s+([\w.]+)/)?.[1]);
    if (/^#load\b/.test(code)) add(raw.match(/^#load\s+"([^"]+)"/)?.[1]);
  } else if (language === 'clojure') {
    for (const match of code.matchAll(/\[([\w.-]+)\s+(?::as|:refer)/g)) add(match[1]);
    if (/\((?:require|use)\b/.test(code)) add(raw.match(/\((?:require|use)\s+'([\w.-]+)/)?.[1]);
  } else if (language === 'solidity') {
    if (/^import\b/.test(code)) add(raw.match(/(?:\bfrom\s*|^import\s*)['"]([^'"]+)['"]/)?.[1]);
  } else if (language === 'fortran') {
    add(code.match(/^\s*use\s+(?:,\s*\w+\s*::\s*)?(\w+)/i)?.[1]);
    if (/^include\b/i.test(code)) add(raw.match(/^include\s*['"]([^'"]+)['"]/i)?.[1]);
  } else if (language === 'pascal') {
    const match = code.match(/^uses\s+([^;]+)/i);
    if (match) for (const part of match[1].split(',')) add(part.trim().split(/\s+/)[0]);
  } else if (language === 'gdscript') {
    if (/\b(?:preload|load)\s*\(/.test(code))
      add(raw.match(/\b(?:preload|load)\s*\(\s*['"]([^'"]+)['"]/)?.[1]);
  }
  return output;
}
