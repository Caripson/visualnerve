import { maskCode } from '../lex';
import type { CodeLanguage, ExtractedCode } from '../types';
import { boundedContent, Extraction, visible } from './common';

type Block = { key: string; start: number; end: number };
function endOfBlock(masked: string, opening: number): number {
  let depth = 1;
  let position = opening;
  while (++position < masked.length && depth) {
    if (masked[position] === '{') depth++;
    if (masked[position] === '}') depth--;
  }
  return position;
}
function containing(blocks: Block[], position: number): string | undefined {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (blocks[middle].start <= position) low = middle + 1;
    else high = middle;
  }
  const block = blocks[low - 1];
  return block && block.end >= position ? block.key : undefined;
}

export function extractInfrastructure(content: string, language: CodeLanguage): ExtractedCode {
  const out = new Extraction(content);
  const source = boundedContent(content, out);
  const masked = maskCode(source, language);
  if (language === 'hcl') {
    const blocks: Block[] = [];
    for (const match of source.matchAll(
      /\b(resource|data|module|provider|variable|output|locals|terraform)\s*((?:"[\w.-]+"\s*){0,2})\{/g,
    )) {
      if (!visible(masked, match.index, match[1])) continue;
      const opening = match.index + match[0].lastIndexOf('{');
      if (!visible(masked, opening, '{')) continue;
      const labels = [...match[2].matchAll(/"([^"\n]+)"/g)].map((label) => label[1]);
      const blockType = match[1];
      if ((blockType === 'resource' || blockType === 'data') && labels.length !== 2) continue;
      if (['module', 'provider', 'variable', 'output'].includes(blockType) && labels.length !== 1)
        continue;
      const name =
        blockType === 'resource'
          ? labels.join('.')
          : blockType === 'variable'
            ? `var.${labels[0]}`
            : [blockType, ...labels].join('.');
      const key = out.symbol(
        name,
        blockType === 'variable' || blockType === 'locals' || blockType === 'output'
          ? 'variable'
          : 'resource',
        match.index,
      );
      const end = endOfBlock(masked, opening);
      if (key) blocks.push({ key, start: match.index, end });
      if (blockType === 'locals') {
        const body = masked.slice(opening + 1, end);
        for (const value of body.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm))
          out.symbol(`local.${value[1]}`, 'variable', opening + 1 + value.index, key);
      }
      if (blockType === 'module' && key) {
        const body = source.slice(opening + 1, end);
        for (const imported of body.matchAll(/\bsource\s*=\s*"([^"\n]+)"/g)) {
          const offset = opening + 1 + imported.index;
          if (!visible(masked, offset, 'source')) continue;
          if (/^\.{1,2}\/[-\w./]+$/.test(imported[1]))
            out.dependency(
              {
                source: key,
                target: imported[1],
                kind: 'imports',
                targetType: 'module',
                confidence: 'syntax',
              },
              offset,
            );
          else
            out.warn(
              'Remote module source values are omitted. Local module paths and symbolic resource references are retained.',
            );
        }
      }
    }
    for (const match of masked.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_][\w-]*)+)\b/g)) {
      const parts = match[1].split('.');
      if (parts.length < 2 || ['terraform', 'path', 'count', 'each', 'self'].includes(parts[0]))
        continue;
      const target = parts.slice(0, parts[0] === 'data' ? 3 : 2).join('.');
      const owner = containing(blocks, match.index);
      if (owner && out.result.symbols.find((symbol) => symbol.name === target)?.key === owner)
        continue;
      out.dependency(
        { source: owner, target, kind: 'depends-on', targetType: 'symbol', confidence: 'syntax' },
        match.index,
      );
    }
    out.warn(
      'HCL blocks and static resource references are outlined. Terraform provider behavior, interpolation inside strings and dynamic blocks are not evaluated.',
    );
  } else {
    const bindings: { key: string; offset: number; name: string }[] = [];
    for (const match of masked.matchAll(
      /\b([A-Za-z_][\w'-]*(?:\.[A-Za-z_][\w'-]*)*)\s*=\s*(?:([A-Za-z_][\w'-]*)\s*:)?/g,
    )) {
      const key = out.symbol(match[1], match[2] ? 'function' : 'variable', match.index);
      if (key) bindings.push({ key, offset: match.index, name: match[1] });
    }
    const ownerAt = (offset: number) => {
      let low = 0;
      let high = bindings.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (bindings[middle].offset <= offset) low = middle + 1;
        else high = middle;
      }
      return bindings[low - 1]?.key;
    };
    for (const match of masked.matchAll(
      /\b(?:import|callPackage)\s+(\.{1,2}\/[-\w./]+|<[-\w./]+>)/g,
    ))
      out.dependency(
        {
          source: ownerAt(match.index),
          target: match[1],
          kind: 'imports',
          targetType: 'module',
          confidence: 'syntax',
        },
        match.index,
      );
    for (const match of masked.matchAll(/\bimports\s*=\s*\[([^\]]+)\]/g)) {
      for (const path of match[1].matchAll(/\.{1,2}\/[-\w./]+/g))
        out.dependency(
          {
            source: ownerAt(match.index),
            target: path[0],
            kind: 'imports',
            targetType: 'module',
            confidence: 'syntax',
          },
          match.index + match[0].indexOf(match[1]) + path.index,
        );
    }
    const known = new Map(bindings.map((binding) => [binding.name, binding.key]));
    for (const match of masked.matchAll(/\b([A-Za-z_][\w'-]*(?:\.[A-Za-z_][\w'-]*)*)\b/g)) {
      const target = match[1];
      const owner = ownerAt(match.index);
      const local = known.get(target);
      if (local && local !== owner)
        out.dependency(
          {
            source: owner,
            target,
            kind: 'references',
            targetType: 'symbol',
            confidence: 'heuristic',
          },
          match.index,
        );
      else if (target.includes('.') && /^(?:pkgs|lib|config|inputs)\./.test(target))
        out.dependency(
          {
            source: owner,
            target,
            kind: 'depends-on',
            targetType: 'symbol',
            confidence: 'heuristic',
          },
          match.index,
        );
    }
    out.warn(
      'Nix bindings, local imports and explicit attribute references are outlined. Lazy evaluation, overlays and dynamic attribute names are not resolved.',
    );
  }
  return out.result;
}
