import type { SourceLine } from '../lex';
import type { CodeLanguage } from '../types';
export interface ImportBinding {
  module: string;
  name?: string;
}
/** Import aliases stay in ephemeral analysis state; source buffers are never serialized. */
export function bindingsAt(line: SourceLine, language: CodeLanguage): Map<string, ImportBinding> {
  const output = new Map<string, ImportBinding>();
  const code = line.masked.trim();
  const raw = line.raw.trim();
  if (language === 'python') {
    const from = code.match(/^from\s+([.\w]+)\s+import\s+([\s\S]+)/);
    if (from)
      for (const part of from[2].replaceAll(/[()]/g, '').split(',')) {
        const match = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        if (match) output.set(match[2] ?? match[1], { module: from[1], name: match[1] });
      }
    else if (/^import\s/.test(code))
      for (const part of code.replace(/^import\s+/, '').split(',')) {
        const match = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
        if (match) output.set(match[2] ?? match[1], { module: match[1] });
      }
  } else if (language === 'javascript' || language === 'typescript') {
    if (!/^import\b/.test(code)) return output;
    const module = raw.match(/\bfrom\s*['"]([^'"]+)['"]/);
    if (!module || !/[\w./@+-]/.test(module[1])) return output;
    const names = code.match(/\{([\s\S]*?)\}/)?.[1];
    if (names)
      for (const part of names.split(',')) {
        const match = part.trim().match(/^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
        if (match) output.set(match[2] ?? match[1], { module: module[1], name: match[1] });
      }
    const namespace = code.match(/\*\s+as\s+([\w$]+)/);
    if (namespace) output.set(namespace[1], { module: module[1] });
  }
  return output;
}
