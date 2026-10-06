import type { CodeLanguage } from './types';

function delimited(
  content: string,
  index: number,
  open: string,
  close: string,
  nested = false,
): number {
  let cursor = index + open.length;
  let depth = 1;
  while (cursor < content.length && depth) {
    if (nested && content.startsWith(open, cursor)) {
      depth++;
      cursor += open.length;
    } else if (content.startsWith(close, cursor)) {
      depth--;
      cursor += close.length;
    } else cursor++;
  }
  return cursor;
}
function lineTerminated(
  content: string,
  start: number,
  delimiter: string,
  trim = true,
  punctuation = false,
): number {
  let cursor = content.indexOf('\n', start);
  if (cursor < 0) return content.length;
  cursor++;
  while (cursor < content.length) {
    const next = content.indexOf('\n', cursor);
    const end = next < 0 ? content.length : next;
    const line = content.slice(cursor, end);
    const value = trim ? line.trim() : line;
    if (
      value === delimiter ||
      (punctuation &&
        value.startsWith(delimiter) &&
        /^[;,)\]}]/.test(value.slice(delimiter.length)))
    )
      return end;
    cursor = end + 1;
  }
  return content.length;
}
function bracketLiteralEnd(
  content: string,
  start: number,
  prefixLength: number,
  open: string,
  close: string,
): number {
  let cursor = start + prefixLength;
  let depth = 1;
  while (cursor < content.length && depth) {
    const char = content[cursor++];
    if (char === '\\') {
      cursor++;
      continue;
    }
    if (open !== close && char === open) depth++;
    if (char === close) depth--;
  }
  return cursor;
}
/** Additional opaque literal/comment forms. All scans advance linearly. */
export function opaqueBlockEnd(
  content: string,
  index: number,
  language: CodeLanguage,
  lineStart: number,
): number | undefined {
  const char = content[index];
  const next = content[index + 1];
  if (['sql', 'tsql', 'plsql'].includes(language) && char === '$') {
    const match = content.slice(index, index + 520).match(/^\$(?:[A-Za-z_]\w*)?\$/);
    if (match) return delimited(content, index, match[0], match[0]);
  }
  if (['sql', 'plsql'].includes(language) && /[qQ]/.test(char) && next === "'") {
    const opening = content[index + 2];
    const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
    if (opening && !/\s/.test(opening))
      return delimited(content, index, char + "'" + opening, (pairs[opening] ?? opening) + "'");
  }
  if (language === 'php' && content.startsWith('<<<', index)) {
    const match = content.slice(index, index + 520).match(/^<<<\s*(['"]?)([A-Za-z_]\w*)\1/);
    if (match) return lineTerminated(content, index, match[2], true, true);
  }
  if (language === 'swift' && char === '#') {
    const match = content.slice(index, index + 260).match(/^(#{1,255})("""|")/);
    if (match) return delimited(content, index, match[0], match[2] + match[1]);
  }
  if (language === 'cpp' && char === 'R' && next === '"') {
    const match = content.slice(index, index + 25).match(/^R"([^\s()\\]{0,16})\(/);
    if (match) return delimited(content, index, match[0], ')' + match[1] + '"');
  }
  if (language === 'rust' && char === 'r') {
    const match = content.slice(index, index + 260).match(/^r(#{0,255})"/);
    if (match) return delimited(content, index, match[0], '"' + match[1]);
  }
  if (language === 'perl' && char === 'q' && !/[\w]/.test(content[index - 1] ?? '')) {
    const match = content.slice(index, index + 5).match(/^q[qwxr]?([^\w\s])/);
    if (match) {
      const open = match[1];
      const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
      return bracketLiteralEnd(content, index, match[0].length, open, pairs[open] ?? open);
    }
  }
  if (language === 'julia' && char === '#' && next === '=')
    return delimited(content, index, '#=', '=#', true);
  if (language === 'matlab' && char === '%' && next === '{')
    return delimited(content, index, '%{', '%}');
  if (language === 'lua' && (char === '[' || (char === '-' && next === '-'))) {
    const offset = char === '-' ? 2 : 0;
    const match = content.slice(index + offset, index + offset + 30).match(/^\[(=*)\[/);
    if (match)
      return delimited(content, index, (offset ? '--' : '') + match[0], ']' + match[1] + ']');
  }
  if (language === 'powershell' && char === '@' && (next === '"' || next === "'"))
    return lineTerminated(content, index, next + '@');
  if (language === 'ruby') {
    if (
      index === lineStart &&
      content.startsWith('=begin', index) &&
      /\s/.test(content[index + 6] ?? '\n')
    )
      return lineTerminated(content, index, '=end');
    if (char === '%' && /[qQwWiIrRx]/.test(next ?? '')) {
      const opener = content[index + 2];
      const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
      if (opener && !/[\w\s]/.test(opener))
        return bracketLiteralEnd(content, index, 3, opener, pairs[opener] ?? opener);
    }
  }
  if ((language === 'shell' || language === 'ruby') && char === '<' && next === '<') {
    const match = content.slice(index, index + 520).match(/^<<[-~]?\s*(['"]?)([A-Za-z_][\w]*)\1/);
    if (match) return lineTerminated(content, index, match[2]);
  }
  return undefined;
}
