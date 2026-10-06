import { codeLimits, type CodeLanguage, type ExtractedCode } from './types';
import { sourceLines } from './lex';
import { findSymbols } from './program/scopes';
import { importsAt } from './program/imports';
import { callsAt } from './program/calls';
import { bindingsAt, type ImportBinding } from './program/bindings';

export function extractProgramCode(content: string, language: CodeLanguage): ExtractedCode {
  const lines = sourceLines(content, language);
  if (lines.some((line) => line.raw.length > codeLimits.lineLength))
    throw new Error(
      `A source line exceeds the ${codeLimits.lineLength.toLocaleString()} character limit. Format generated/minified files before importing.`,
    );
  const symbols = findSymbols(lines, language);
  if (symbols.length > codeLimits.symbols)
    throw new Error('Code has more than 10,000 declarations. Import fewer files.');
  const dependencies: ExtractedCode['dependencies'] = [];
  const functions = new Set(
    symbols.filter((symbol) => symbol.kind === 'function').map((symbol) => symbol.name),
  );
  const active: typeof symbols = [];
  let symbolIndex = 0;
  let goBlock = false;
  let pendingImport: (typeof lines)[number] | undefined;
  const seen = new Set<string>();
  const bindings = new Map<string, ImportBinding>();
  for (const line of lines) {
    if (language === 'go' && /^\s*import\s*\(/.test(line.masked)) goBlock = true;
    while (active.length && (active.at(-1)!.endLine ?? active.at(-1)!.line) < line.line)
      active.pop();
    while (symbolIndex < symbols.length && symbols[symbolIndex].line <= line.line)
      active.push(symbols[symbolIndex++]);
    let importLine = line;
    let imports = importsAt(line, language, goBlock);
    if (language === 'javascript' || language === 'typescript') {
      if (pendingImport) {
        pendingImport = {
          ...pendingImport,
          raw: pendingImport.raw + '\n' + line.raw,
          masked: pendingImport.masked + '\n' + line.masked,
        };
        importLine = pendingImport;
        imports = importsAt(pendingImport, language, false);
        if (imports.length || line.line - pendingImport.line >= 30 || line.masked.includes(';'))
          pendingImport = undefined;
      } else if (
        !imports.length &&
        /^\s*(?:import\b(?!\s*\()|export\s*(?:\*|\{))/.test(line.masked) &&
        !line.masked.includes(';')
      )
        pendingImport = line;
    }
    for (const [name, binding] of bindingsAt(importLine, language))
      if (imports.some((entry) => entry.target === binding.module)) bindings.set(name, binding);
    const entries = [...imports, ...callsAt(line, language, functions, active.at(-1))];
    if (goBlock && /^\s*\)/.test(line.masked)) goBlock = false;
    for (const entry of entries) {
      if (entry.targetType === 'symbol') {
        const parts = entry.target.split('.');
        const binding = bindings.get(parts[0]);
        if (binding)
          entry.target = `${binding.module}::${binding.name ?? parts.slice(1).join('.')}`;
      }
      const key = `${entry.source ?? ''}\0${entry.kind}\0${entry.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        dependencies.push(entry);
      }
      if (dependencies.length > codeLimits.edges)
        throw new Error('Code has more than 10,000 dependencies. Import fewer files.');
    }
  }
  const warnings = [
    'Line-based outlines may miss multiline declarations, aliases, overloaded methods and code embedded in templates or interpolated strings. Import paths are matched without package-manager or compiler configuration.',
  ];
  if (['shell', 'powershell', 'perl', 'ruby'].includes(language))
    warnings.push(
      'Shell expansions, command substitutions, quoting escapes and dynamic scripting constructs are approximate. Review unresolved calls.',
    );
  return { symbols, dependencies, warnings };
}
