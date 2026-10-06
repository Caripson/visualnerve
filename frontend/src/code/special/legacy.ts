import { maskCode } from '../lex';
import type { CodeLanguage, ExtractedCode } from '../types';
import { boundedContent, Extraction, visible } from './common';

type Declaration = { key: string; offset: number };
function current(declarations: Declaration[], offset: number): string | undefined {
  let low = 0;
  let high = declarations.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (declarations[middle].offset <= offset) low = middle + 1;
    else high = middle;
  }
  return declarations[low - 1]?.key;
}

export function extractLegacy(content: string, language: CodeLanguage): ExtractedCode {
  const out = new Extraction(content);
  const source = boundedContent(content, out);
  const masked = maskCode(source, language);
  const declarations: Declaration[] = [];
  if (language === 'abap') {
    for (const match of masked.matchAll(
      /\b(CLASS|INTERFACE|CLASS-METHODS|METHODS?|FORM|FUNCTION|REPORT|PROGRAM)\s+([A-Za-z_][\w\/-]*)/gi,
    )) {
      const keyword = match[1].toUpperCase();
      if (
        (keyword === 'CLASS' || keyword === 'INTERFACE') &&
        !/^\s+(?:DEFINITION|IMPLEMENTATION)\b/i.test(masked.slice(match.index + match[0].length))
      )
        continue;
      const key = out.symbol(
        match[2],
        keyword === 'CLASS'
          ? 'class'
          : keyword === 'INTERFACE'
            ? 'type'
            : keyword === 'REPORT' || keyword === 'PROGRAM'
              ? 'resource'
              : 'function',
        match.index,
      );
      if (key) declarations.push({ key, offset: match.index });
    }
    for (const match of masked.matchAll(
      /\bPERFORM\s+([A-Za-z_]\w*)|\bCALL\s+METHOD\s+([A-Za-z_]\w*(?:(?:=>|->)[A-Za-z_]\w*)?)|\b(?:FROM|JOIN|UPDATE|MODIFY|INTO\s+TABLE)\s+([A-Za-z_][\w\/-]*)/gi,
    )) {
      if (
        /^FROM\b/i.test(match[0]) &&
        /INHERITING\s*$/i.test(masked.slice(Math.max(0, match.index - 50), match.index))
      )
        continue;
      const target = match[1] ?? match[2] ?? match[3];
      const writes = /^(?:UPDATE|MODIFY|INTO)/i.test(match[0]);
      out.dependency(
        {
          source: current(declarations, match.index),
          target,
          kind: match[1] || match[2] ? 'calls' : writes ? 'writes' : 'reads',
          targetType: 'symbol',
          confidence: 'heuristic',
        },
        match.index,
      );
    }
    for (const match of source.matchAll(/\bCALL\s+FUNCTION\s+'([A-Za-z_][\w\/-]*)'/gi))
      if (visible(masked, match.index, match[0].slice(0, 4)))
        out.dependency(
          {
            source: current(declarations, match.index),
            target: match[1],
            kind: 'calls',
            targetType: 'symbol',
            confidence: 'syntax',
          },
          match.index,
        );
    for (const match of masked.matchAll(/\bINHERITING\s+FROM\s+([A-Za-z_]\w*)/gi))
      out.dependency(
        {
          source: current(declarations, match.index),
          target: match[1],
          kind: 'inherits',
          targetType: 'symbol',
          confidence: 'syntax',
        },
        match.index,
      );
    out.warn(
      'ABAP classes, forms, methods and explicit calls are outlined. SAP dictionary metadata and dynamic calls are not resolved.',
    );
  } else if (language === 'cobol') {
    for (const match of masked.matchAll(
      /\bPROGRAM-ID\s*\.\s*([A-Za-z_][\w-]*)|^\s*(?:\d{6}\s+)?([A-Za-z_][\w-]*)(?:[ \t]+SECTION)?[ \t]*\.(?=\s*(?:\n|$))/gim,
    )) {
      const name = match[1] ?? match[2];
      if (
        /^(?:IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE|WORKING-STORAGE|LINKAGE|FILE|CONFIGURATION|INPUT-OUTPUT|END-IF|END-PERFORM|GOBACK|STOP|EXIT)$/i.test(
          name,
        )
      )
        continue;
      const key = out.symbol(name, match[1] ? 'resource' : 'function', match.index);
      if (key) declarations.push({ key, offset: match.index });
    }
    for (const match of source.matchAll(/\bCALL\s+["']([A-Za-z_][\w.-]*)["']/gi))
      if (/^CALL/i.test(masked.slice(match.index, match.index + 4)))
        out.dependency(
          {
            source: current(declarations, match.index),
            target: match[1],
            kind: 'calls',
            targetType: 'symbol',
            confidence: 'syntax',
          },
          match.index,
        );
    for (const match of masked.matchAll(
      /\b(PERFORM|CALL|READ|WRITE|REWRITE|OPEN\s+INPUT|OPEN\s+OUTPUT)\s+([A-Za-z_][\w-]*)/gi,
    )) {
      if (/^(?:UNTIL|VARYING|WITH|TIMES)$/i.test(match[2])) continue;
      const keyword = match[1].toUpperCase();
      out.dependency(
        {
          source: current(declarations, match.index),
          target: match[2],
          kind:
            keyword === 'PERFORM'
              ? 'calls'
              : keyword === 'CALL'
                ? 'references'
                : /WRITE|OUTPUT/.test(keyword)
                  ? 'writes'
                  : 'reads',
          targetType: 'symbol',
          confidence: 'heuristic',
        },
        match.index,
      );
    }
    for (const match of masked.matchAll(/\bSELECT\s+([A-Za-z_][\w-]*)\s+ASSIGN\b/gi))
      out.symbol(match[1], 'resource', match.index);
    for (const match of source.matchAll(/\bCOPY\s+(?:["']([-\w./]+)["']|([-\w.]+))/gi)) {
      if (!/^COPY/i.test(masked.slice(match.index, match.index + 4))) continue;
      out.dependency(
        {
          source: current(declarations, match.index),
          target: match[1] ?? match[2],
          kind: 'imports',
          targetType: 'module',
          confidence: 'syntax',
        },
        match.index,
      );
    }
    out.warn(
      'COBOL programs, paragraphs, files and explicit calls are outlined. COPY expansion and dynamic CALL targets are not resolved.',
    );
  } else {
    for (const match of masked.matchAll(
      /^\s*([A-Za-z_.$?][\w.$?]*)\s*:\s*|^\s*([A-Za-z_.$?][\w.$?]*)\s+(?:PROC|EQU)\b/gim,
    )) {
      const key = out.symbol(
        match[1] ?? match[2],
        /\bEQU\b/i.test(match[0]) ? 'variable' : 'function',
        match.index,
      );
      if (key) declarations.push({ key, offset: match.index });
    }
    for (const match of masked.matchAll(
      /\b(?:call|bl|jal|jmp|j[a-z]+|b(?:eq|ne|gt|lt|ge|le)?)\s+([A-Za-z_.$?][\w.$?]*)/gi,
    )) {
      if (/^(?:rax|rbx|rcx|rdx|eax|ebx|ecx|edx|lr|r\d+|x\d+|w\d+)$/i.test(match[1])) {
        out.warn('Indirect assembly transfers through registers are not resolved.');
        continue;
      }
      out.dependency(
        {
          source: current(declarations, match.index),
          target: match[1],
          kind: /^(?:call|bl|jal)\b/i.test(match[0]) ? 'calls' : 'depends-on',
          targetType: 'symbol',
          confidence: 'heuristic',
        },
        match.index,
      );
    }
    for (const match of masked.matchAll(
      /\b(?:extern|extrn|global|globl)\s+([A-Za-z_.$?][\w.$?]*)/gi,
    ))
      out.dependency(
        { target: match[1], kind: 'references', targetType: 'symbol', confidence: 'syntax' },
        match.index,
      );
    for (const match of source.matchAll(
      /(?:%|\.)?\binclude\s+(?:["']([-\w./]+)["']|([-\w./]+))/gi,
    )) {
      const marker = match[0].slice(0, match[0].toLowerCase().indexOf('include') + 7);
      if (
        masked.slice(match.index, match.index + marker.length).toLowerCase() !==
        marker.toLowerCase()
      )
        continue;
      out.dependency(
        {
          source: current(declarations, match.index),
          target: match[1] ?? match[2],
          kind: 'imports',
          targetType: 'module',
          confidence: 'syntax',
        },
        match.index,
      );
    }
    out.warn(
      'Assembly labels and direct transfers are outlined across common instruction spellings. Macros, relocations and indirect addresses are not resolved.',
    );
  }
  return out.result;
}
