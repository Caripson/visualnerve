import { codeLimits, type CodeLanguage, type CodeSymbol } from '../types';
import type { SourceLine } from '../lex';
import { declarationAt } from './declarations';

interface Scope {
  symbol: CodeSymbol;
  depth: number;
  indent: number;
}
const indentLanguages = new Set<CodeLanguage>(['python', 'gdscript', 'fsharp', 'haskell']);
const endLanguages = new Set<CodeLanguage>([
  'ruby',
  'lua',
  'matlab',
  'vba',
  'vbnet',
  'julia',
  'elixir',
  'fortran',
  'pascal',
]);
const count = (text: string, char: string) => {
  let total = 0;
  for (const current of text) if (current === char) total++;
  return total;
};

export function findSymbols(lines: SourceLine[], language: CodeLanguage): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const scopes: Scope[] = [];
  let depth = 0;
  let pending: CodeSymbol | undefined;
  const close = (line: number) => {
    const scope = scopes.pop();
    if (scope) scope.symbol.endLine = Math.max(scope.symbol.line, line);
  };
  for (const line of lines) {
    const text = line.masked.trim();
    if (!text) continue;
    const indent = line.masked.match(/^\s*/)?.[0].replaceAll('\t', '    ').length ?? 0;
    if (indentLanguages.has(language) && !/^[)\]}]/.test(text))
      while (scopes.length && indent <= scopes.at(-1)!.indent) close(line.line - 1);
    if (endLanguages.has(language)) {
      if (
        /^(?:end\b|End\s+(?:Sub|Function|Class|Module|Property|If|Select|While|Structure|Interface|Enum)|Next\b|Wend\b|Loop\b|until\b)/i.test(
          text,
        )
      ) {
        depth = Math.max(0, depth - 1);
        while (scopes.length && depth < scopes.at(-1)!.depth) close(line.line);
      }
    }
    if (language === 'objective-c' && /^@end\b/.test(text)) {
      while (scopes.length) close(line.line);
      depth = 0;
      continue;
    }
    if (pending && text.includes('{')) {
      delete pending.endLine;
      scopes.push({ symbol: pending, depth: depth + 1, indent });
      pending = undefined;
    }
    if (pending && (text.includes(';') || line.line - pending.line > 30)) pending = undefined;
    const declaration = declarationAt(text, language);
    if (declaration) {
      const existingClass =
        language === 'objective-c' && declaration.kind === 'class'
          ? symbols.find((symbol) => symbol.name === declaration.name && symbol.kind === 'class')
          : undefined;
      if (existingClass) {
        delete existingClass.endLine;
        scopes.push({ symbol: existingClass, depth: -1, indent });
        continue;
      }
      const previous = symbols.at(-1);
      // Haskell multi-equation functions and forward declarations share one symbol.
      if (
        previous?.name === declaration.name &&
        previous.kind === declaration.kind &&
        !scopes.length
      )
        continue;
      const symbol: CodeSymbol = {
        key: `${line.line}:${declaration.name}`,
        name: declaration.name,
        kind: declaration.kind,
        line: line.line,
      };
      if (scopes.length) symbol.parent = scopes.at(-1)!.symbol.key;
      symbols.push(symbol);
      if (symbols.length > codeLimits.symbols)
        throw new Error('Code exceeds 10,000 declarations. Import fewer files.');
      if (language === 'objective-c' && declaration.kind === 'class')
        scopes.push({ symbol, depth: -1, indent });
      else if (indentLanguages.has(language)) scopes.push({ symbol, depth: 0, indent });
      else if (endLanguages.has(language) && declaration.opens) {
        depth++;
        scopes.push({ symbol, depth, indent });
      } else if (language === 'clojure') {
        scopes.push({ symbol, depth: depth + 1, indent });
      } else if (declaration.opens && line.masked.includes('{'))
        scopes.push({ symbol, depth: depth + 1, indent });
      else {
        symbol.endLine = line.line;
        if (
          !indentLanguages.has(language) &&
          !endLanguages.has(language) &&
          ['class', 'function', 'type'].includes(symbol.kind) &&
          !text.includes(';') &&
          !text.includes('=') &&
          !text.includes('{')
        )
          pending = symbol;
      }
    }
    if (language === 'clojure') {
      depth += count(line.masked, '(') - count(line.masked, ')');
      while (scopes.length && depth < scopes.at(-1)!.depth) close(line.line);
    } else if (!indentLanguages.has(language) && !endLanguages.has(language)) {
      depth += count(line.masked, '{') - count(line.masked, '}');
      while (scopes.length && depth < scopes.at(-1)!.depth) close(line.line);
    } else if (endLanguages.has(language) && !declaration) {
      if (
        /^(?:if\b|for\b|while\b|case\b|select\s+case\b|try\b|begin\b|do\b|repeat\b|let\b)/i.test(
          text,
        ) &&
        !/\bend\b|\bthen\s+\S|\bdo:\s*\S/i.test(text)
      )
        depth++;
    }
  }
  while (scopes.length) close(lines.length);
  return symbols;
}

/** The narrowest surrounding declaration is the syntactic call owner. */
export function ownerAt(symbols: CodeSymbol[], line: number): CodeSymbol | undefined {
  let owner: CodeSymbol | undefined;
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    if (line <= (symbol.endLine ?? symbol.line)) owner = symbol;
  }
  return owner;
}
