import type { CodeLanguage, CodeObjectKind } from '../types';
export interface Declaration {
  name: string;
  kind: Exclude<CodeObjectKind, 'file' | 'external'>;
  base?: string;
  opens?: boolean;
}
const identifier = '[A-Za-z_$][\\w$]*';
const modifiers =
  '(?:(?:pub(?:\\([^)]*\\))?|public|private|protected|internal|static|final|abstract|virtual|override|async|export|default|inline|extern|const|constexpr|sealed|open|suspend|fun|mut|unsafe)\\s+)*';
const braceLanguages = new Set<CodeLanguage>([
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
  'scala',
  'solidity',
  'apex',
]);

/** Families are deliberately separate from graph resolution and worker transport. */
export function declarationAt(text: string, language: CodeLanguage): Declaration | undefined {
  const line = text.trim();
  let match: RegExpMatchArray | null;
  if (language === 'python' || language === 'gdscript') {
    match = line.match(/^(?:async\s+)?(?:def|func)\s+([\w]+)\s*\(/);
    if (match) return { name: match[1], kind: 'function', opens: true };
    match = line.match(/^(?:class|class_name)\s+(\w+)(?:\s*\(\s*([\w.]+))?/);
    if (match) return { name: match[1], kind: 'class', base: match[2], opens: /:/.test(line) };
  }
  if (braceLanguages.has(language)) {
    match = line.match(
      new RegExp(
        `^${modifiers}(?:class|interface|struct|enum|trait|contract|actor|record|object)\\s+(${identifier})(?:[^{};]*?\\b(?:extends|implements)\\s+([\\w.]+)|\\s*:\\s*(?:public\\s+)?([\\w.]+))?`,
      ),
    );
    if (match)
      return {
        name: match[1],
        kind: ['interface', 'enum', 'trait', 'record'].some((word) => line.includes(word + ' '))
          ? 'type'
          : 'class',
        base: match[2] ?? match[3],
        opens: line.includes('{'),
      };
    if (language === 'go') {
      match = line.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/);
      if (match) return { name: match[1], kind: 'function', opens: line.includes('{') };
      match = line.match(/^type\s+(\w+)\s+/);
      if (match) return { name: match[1], kind: 'type', opens: line.includes('{') };
    }
    if (language === 'objective-c') {
      match = line.match(/^@(?:interface|implementation|protocol)\s+(\w+)(?:\s*:\s*(\w+))?/);
      if (match) return { name: match[1], kind: 'class', base: match[2], opens: true };
      match = line.match(/^[-+]\s*\([^)]*\)\s*(\w+)/);
      if (match) return { name: match[1], kind: 'function', opens: line.includes('{') };
    }
    match = line.match(
      new RegExp(
        `^${modifiers}(?:function|fn|func|fun|def)\\s+(${identifier})\\s*(?:<[^>]*>)?\\s*\\(`,
      ),
    );
    if (match)
      return {
        name: match[1],
        kind: 'function',
        opens: line.includes('{') || /(?:=>|=)/.test(line),
      };
    match = line.match(
      /^(?:(?:export|declare)\s+)?(?:const|let|var)\s+([\w$]+)(?:\s*:[^=;]+)?\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/,
    );
    if (match) return { name: match[1], kind: 'function', opens: line.includes('{') };
    match = line.match(
      new RegExp(
        `^${modifiers}(?:[\\w$.<>?\\[\\]\\*&]+\\s+)+(${identifier})\\s*\\([^;{}]*\\)\\s*(?::[^={]+)?(?:\\{|=>|throws\\b|;|$)`,
      ),
    );
    if (match && !/^(?:return|throw|new|delete|if|while|for|switch|catch)\b/.test(line))
      return { name: match[1], kind: 'function', opens: line.includes('{') };
    match = line.match(
      new RegExp(`^${modifiers}(${identifier})\\s*\\([^;{}]*\\)\\s*(?::[^={]+)?(?:\\{|=>)`),
    );
    if (match && !/^(?:if|while|for|switch|catch|with)\b/.test(line))
      return { name: match[1], kind: 'function', opens: line.includes('{') };
    if (language === 'typescript') {
      match = line.match(/^(?:export\s+)?type\s+([\w$]+)\s*(?:<[^>]*>)?\s*=/);
      if (match) return { name: match[1], kind: 'type' };
    }
  }
  if (language === 'shell') {
    match = line.match(/^(?:function\s+)?([\w-]+)\s*\(\s*\)\s*(?:\{|$)|^function\s+([\w-]+)\s*\{/);
    if (match) return { name: match[1] ?? match[2], kind: 'function', opens: true };
  }
  if (language === 'powershell') {
    match = line.match(/^(function|filter|class|enum)\s+([\w-]+)/i);
    if (match)
      return {
        name: match[2],
        kind: /class/i.test(match[1]) ? 'class' : /enum/i.test(match[1]) ? 'type' : 'function',
        opens: true,
      };
  }
  if (language === 'r') {
    match = line.match(/^([\w.]+)\s*(?:<-|=)\s*function\s*\(/);
    if (match) return { name: match[1], kind: 'function', opens: line.includes('{') };
  }
  if (language === 'perl') {
    match = line.match(/^(?:my\s+)?sub\s+([\w:]+)/);
    if (match) return { name: match[1], kind: 'function', opens: line.includes('{') };
    match = line.match(/^package\s+([\w:]+)/);
    if (match) return { name: match[1], kind: 'class' };
  }
  if (language === 'ruby') {
    match = line.match(/^(class|module|def)\s+([\w.?!]+)(?:\s*<\s*([\w:]+))?/);
    if (match)
      return {
        name: match[2],
        kind: match[1] === 'def' ? 'function' : 'class',
        base: match[3],
        opens: true,
      };
  }
  if (language === 'vba' || language === 'vbnet') {
    match = line.match(
      /^(?:(?:Public|Private|Friend|Protected|Shared|Static|Partial|Overrides|Async)\s+)*(Sub|Function|Class|Module|Interface|Structure|Enum|Property)\s+(\w+)/i,
    );
    if (match)
      return {
        name: match[2],
        kind: /sub|function|property/i.test(match[1])
          ? 'function'
          : /interface|enum/i.test(match[1])
            ? 'type'
            : 'class',
        opens: true,
      };
  }
  if (language === 'lua') {
    match = line.match(
      /^(?:local\s+)?function\s+([\w.:]+)|^(?:local\s+)?(\w+)\s*=\s*function\s*\(/,
    );
    if (match) return { name: match[1] ?? match[2], kind: 'function', opens: true };
  }
  if (language === 'matlab') {
    match = line.match(/^function\s+(?:\[[^\]]*\]\s*=\s*|\w+\s*=\s*)?(\w+)/);
    if (match) return { name: match[1], kind: 'function', opens: true };
    match = line.match(/^classdef\s+(?:\([^)]*\)\s*)?(\w+)(?:\s*<\s*(\w+))?/);
    if (match) return { name: match[1], kind: 'class', base: match[2], opens: true };
  }
  if (language === 'julia') {
    match = line.match(/^(?:mutable\s+)?(function|struct|module|abstract\s+type)\s+([\w!]+)/);
    if (match)
      return { name: match[2], kind: match[1] === 'function' ? 'function' : 'class', opens: true };
    match = line.match(/^([\w!]+)\s*\([^)]*\)\s*=/);
    if (match) return { name: match[1], kind: 'function' };
  }
  if (language === 'elixir') {
    match = line.match(/^(defmodule|defprotocol|defimpl|defp?|defmacro[p]?)\s+([\w.!?]+)/);
    if (match)
      return {
        name: match[2],
        kind: /^def(?:module|protocol|impl)$/.test(match[1]) ? 'class' : 'function',
        opens: /\bdo\s*$/.test(line),
      };
  }
  if (language === 'fortran') {
    match = line.match(
      /^(?:(?:recursive|pure|elemental|real|integer|logical|character|double\s+precision)\s+)*(program|module|subroutine|function)\s+(\w+)/i,
    );
    if (match && !/^module\s+procedure/i.test(line))
      return {
        name: match[2],
        kind: /subroutine|function/i.test(match[1]) ? 'function' : 'class',
        opens: true,
      };
  }
  if (language === 'pascal') {
    match = line.match(/^(?:class\s+)?(?:procedure|function|constructor|destructor)\s+([\w.]+)/i);
    if (match) return { name: match[1], kind: 'function', opens: true };
    match = line.match(/^(\w+)\s*=\s*(class|record|interface)(?:\s*\(\s*(\w+))?/i);
    if (match)
      return {
        name: match[1],
        kind: /class/i.test(match[2]) ? 'class' : 'type',
        base: match[3],
        opens: true,
      };
  }
  if (language === 'haskell') {
    match = line.match(/^(?:data|newtype|type|class)\s+(?:\([^)]*\)\s*=>\s*)?([A-Z]\w*)/);
    if (match) return { name: match[1], kind: 'type' };
    match = line.match(/^([a-z]\w*)\s+(?!::)(?:[^=]*)=/);
    if (match) return { name: match[1], kind: 'function' };
  }
  if (language === 'fsharp') {
    match = line.match(/^type\s+(\w+)(?:<[^>]*>)?\s*=/);
    if (match) return { name: match[1], kind: 'type' };
    match = line.match(/^let\s+(?:rec\s+|private\s+|inline\s+)*(\w+)\s+[^=]*=/);
    if (match) return { name: match[1], kind: 'function' };
    match = line.match(/^member\s+(?:\w+\.)?(\w+)\s*\(/);
    if (match) return { name: match[1], kind: 'function' };
  }
  if (language === 'clojure') {
    match = line.match(
      /^\((defn-?|defmacro|defrecord|deftype|defprotocol|def)\s+([\w!?*+<>=./-]+)/,
    );
    if (match)
      return {
        name: match[2],
        kind: /record|type|protocol/.test(match[1])
          ? 'type'
          : /defn|macro/.test(match[1])
            ? 'function'
            : 'variable',
        opens: true,
      };
  }
  return undefined;
}
