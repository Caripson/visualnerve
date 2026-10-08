import { Extraction } from './special/common';
import type { ExtractedCode } from './types';

const blank = (text: string) => text.replace(/[^\r\n]/g, ' ');
const unescape = (text: string) =>
  text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~ ])/g, '$1');
const referenceName = (text: string) => unescape(text).trim().replace(/\s+/g, ' ').toLowerCase();

/** Preserve offsets while excluding comments, fenced/indented code and inline code. */
function visibleMarkdown(content: string, maskInline = true): string {
  const source = content.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  let fence: { marker: string; length: number } | undefined;
  let frontMatter = false;
  return source
    .split('\n')
    .map((line, index) => {
      if (index === 0 && /^\uFEFF?---\s*$/.test(line)) {
        frontMatter = true;
        return blank(line);
      }
      if (frontMatter) {
        if (/^(?:---|\.\.\.)\s*$/.test(line)) frontMatter = false;
        return blank(line);
      }
      if (fence) {
        const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
        if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length)
          fence = undefined;
        return blank(line);
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
        fence = { marker: opening[1][0], length: opening[1].length };
        return blank(line);
      }
      if (/^(?:\t| {4})/.test(line) && !/^\s*(?:[-+*]|\d+[.)])\s/.test(line)) return blank(line);
      if (!maskInline) return line;
      let result = '';
      let offset = 0;
      while (offset < line.length) {
        if (line[offset] === '\\') {
          result += line.slice(offset, offset + 2);
          offset += 2;
          continue;
        }
        if (line[offset] !== '`') {
          result += line[offset++];
          continue;
        }
        const length = line.slice(offset).match(/^`+/)![0].length;
        const marker = '`'.repeat(length);
        let end = line.indexOf(marker, offset + length);
        while (end !== -1 && (line[end - 1] === '`' || line[end + length] === '`'))
          end = line.indexOf(marker, end + length);
        if (end === -1) {
          result += marker;
          offset += length;
        } else {
          result += blank(line.slice(offset, end + length));
          offset = end + length;
        }
      }
      return result;
    })
    .join('\n');
}

/** One linear pass also bounds pathological rows containing thousands of unmatched brackets. */
function closingDelimiters(source: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const square: number[] = [];
  const round: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '\\') i++;
    else if (character === '\n') {
      square.length = 0;
      round.length = 0;
    } else if (character === '[') square.push(i);
    else if (character === '(') round.push(i);
    else if (character === ']' && square.length) pairs.set(square.pop()!, i);
    else if (character === ')' && round.length) pairs.set(round.pop()!, i);
  }
  return pairs;
}

function destination(value: string): string | undefined {
  const text = value.trim();
  const angle = text.match(/^<([^<>]*)>(?:\s|$)/);
  const token = angle?.[1] ?? text.match(/^(?:\\.|[^\s])+/)?.[0];
  if (!token) return undefined;
  const target = unescape(token);
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return undefined;
  try {
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(decodeURIComponent(target))) return undefined;
  } catch {
    // Malformed local paths remain unresolved review objects, rather than failing the project.
  }
  // Query values are not topology and can contain credentials. Keep only a local path/anchor.
  const query = target.indexOf('?');
  const fragment = target.indexOf('#');
  return query === -1
    ? target
    : target.slice(0, query) + (fragment > query ? target.slice(fragment) : '');
}

/** GitHub-style heading fragments, kept solely in the transient resolver index. */
function anchorIds(source: string, htmlSource: string): string[] {
  const anchors: string[] = [];
  const used = new Set<string>();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heading =
      lines[i].match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/)?.[1] ??
      (i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]) && lines[i].trim()
        ? lines[i].trim()
        : undefined);
    if (!heading) continue;
    const slug = heading
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    if (!slug) continue;
    let candidate = slug;
    for (let duplicate = 1; used.has(candidate); duplicate++) candidate = `${slug}-${duplicate}`;
    used.add(candidate);
    anchors.push(candidate);
  }
  for (const match of htmlSource.matchAll(
    /<(?:a|h[1-6])\b[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ))
    anchors.push(match[1]);
  return anchors;
}

/** Bounded link extraction; prose, labels, URLs and source buffers never enter graph metadata. */
export function extractMarkdown(content: string): ExtractedCode {
  const extraction = new Extraction(content);
  const source = visibleMarkdown(content);
  const delimiters = closingDelimiters(source);
  const references = new Map<string, string>();
  const definitions = new Set<number>();
  for (const match of source.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(.+)$/gm)) {
    definitions.add(source.lastIndexOf('\n', match.index - 1) + 1);
    const target = destination(match[2]);
    const name = referenceName(match[1]);
    if (target && !references.has(name)) references.set(name, target);
  }
  const add = (target: string | undefined, offset: number, markdownWiki = false) => {
    if (!target) return;
    extraction.dependency(
      {
        target,
        kind: 'references',
        targetType: 'module',
        confidence: 'syntax',
        ...(markdownWiki ? { markdownWiki: true } : {}),
      },
      offset,
    );
  };
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === '\\') {
      offset++;
      continue;
    }
    if (source[offset] !== '[') continue;
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    if (definitions.has(lineStart)) continue;
    const image = source[offset - 1] === '!' && source[offset - 2] !== '\\';
    if (source[offset + 1] === '[') {
      const closing = delimiters.get(offset);
      if (closing === undefined || source[closing - 1] !== ']') continue;
      const end = closing - 1;
      if (!image) {
        const value = source
          .slice(offset + 2, end)
          .split('|')[0]
          .trim();
        add(destination(`<${value}>`), offset, true);
      }
      offset = end + 1;
      continue;
    }
    const end = delimiters.get(offset);
    if (end === undefined) continue;
    const label = source.slice(offset + 1, end);
    const after = source[end + 1];
    if (after === '(') {
      const targetEnd = delimiters.get(end + 1);
      if (targetEnd !== undefined) {
        if (!image) add(destination(source.slice(end + 2, targetEnd)), offset);
        offset = targetEnd;
      }
    } else if (after === '[') {
      const referenceEnd = delimiters.get(end + 1);
      if (referenceEnd !== undefined) {
        if (!image)
          add(references.get(referenceName(source.slice(end + 2, referenceEnd) || label)), offset);
        offset = referenceEnd;
      }
    } else {
      if (!image) add(references.get(referenceName(label)), offset);
      offset = end;
    }
  }
  return { ...extraction.result, anchors: anchorIds(visibleMarkdown(content, false), source) };
}

export function resolveMarkdownTarget(
  sourcePath: string,
  target: string,
): { path: string; anchor?: string } | undefined {
  const fragment = target.indexOf('#');
  let path: string;
  let anchor: string | undefined;
  try {
    path = decodeURIComponent(fragment === -1 ? target : target.slice(0, fragment));
    anchor = fragment === -1 ? undefined : decodeURIComponent(target.slice(fragment + 1));
  } catch {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f]/.test(path) || path.includes('\\')) return undefined;
  if (!path) return { path: sourcePath, ...(anchor ? { anchor } : {}) };
  const parts = path.startsWith('/') ? [] : sourcePath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return { path: parts.join('/'), ...(anchor ? { anchor } : {}) };
}
