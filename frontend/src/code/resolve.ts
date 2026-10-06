import type { CodeDependency, CodeSymbol, ExtractedCode } from './types';
import type { NormalizedFile } from './input';

export interface AnalyzedFile extends NormalizedFile {
  extracted: ExtractedCode;
}
export interface Target {
  file?: AnalyzedFile;
  symbol?: CodeSymbol;
}
const leaf = (path: string) =>
  path
    .split('/')
    .at(-1)!
    .replace(/\.(?:[^.]+)$/, '');
const insensitive = new Set([
  'sql',
  'tsql',
  'plsql',
  'vba',
  'vbnet',
  'powershell',
  'fortran',
  'pascal',
  'abap',
  'cobol',
  'assembly',
  'sas',
]);
function relative(base: string, target: string): string | undefined {
  const segments = base.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '.' || !segment) continue;
    if (segment === '..') {
      if (!segments.length) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join('/');
}
const unique = <T>(values: T[]): T | undefined => (values.length === 1 ? values[0] : undefined);
const append = <T>(map: Map<string, T[]>, key: string, value: T) =>
  map.set(key, [...(map.get(key) ?? []), value]);
interface SymbolIndex {
  names: Map<string, CodeSymbol[]>;
  keys: Map<string, CodeSymbol>;
  fold: (name: string) => string;
}

/** Indexed lookups avoid scanning every project symbol for every call. */
export class CodeResolver {
  private paths = new Map<string, AnalyzedFile>();
  private stems = new Map<string, AnalyzedFile[]>();
  private leaves = new Map<string, AnalyzedFile[]>();
  private imports = new Map<string, AnalyzedFile[]>();
  private symbols = new Map<string, SymbolIndex>();
  private shared = new Map<string, Target[]>();
  constructor(files: AnalyzedFile[]) {
    for (const file of files) {
      this.paths.set(file.path, file);
      append(this.stems, file.path.replace(/\.[^.]+$/, ''), file);
      append(this.leaves, leaf(file.path), file);
      const fold = insensitive.has(file.language)
        ? (name: string) => name.toLowerCase()
        : (name: string) => name;
      const index: SymbolIndex = { names: new Map(), keys: new Map(), fold };
      for (const symbol of file.extracted.symbols) {
        append(index.names, fold(symbol.name), symbol);
        index.keys.set(symbol.key, symbol);
      }
      this.symbols.set(file.path, index);
      const namespace = this.namespace(file);
      if (namespace)
        for (const symbol of file.extracted.symbols)
          append(this.shared, `${namespace}:${fold(symbol.name)}`, { file, symbol });
    }
    for (const file of files)
      this.imports.set(file.path, [
        ...new Set(
          file.extracted.dependencies
            .filter((entry) => entry.targetType === 'module')
            .map((entry) => this.module(file, entry.target))
            .filter((value): value is AnalyzedFile => Boolean(value)),
        ),
      ]);
  }
  private namespace(file: AnalyzedFile): string | undefined {
    if (file.language === 'hcl') return `hcl:${file.path.split('/').slice(0, -1).join('/')}`;
    if (['sql', 'tsql', 'plsql'].includes(file.language)) return 'sql';
    if (['graphql', 'dax', 'mdx'].includes(file.language)) return file.language;
    return undefined;
  }
  module(file: AnalyzedFile, target: string): AnalyzedFile | undefined {
    let path = target;
    if (file.language === 'python') {
      const prefix = target.match(/^\.+/)?.[0];
      path = prefix
        ? `${'../'.repeat(Math.max(0, prefix.length - 1))}./${target.slice(prefix.length).replaceAll('.', '/')}`
        : target.replaceAll('.', '/');
    } else if (/^(?:java|kotlin|scala|groovy|csharp|vbnet|haskell|elixir)$/.test(file.language))
      path = target.replaceAll('.', '/');
    else if (file.language === 'rust') path = target.replace(/^crate::/, '').replaceAll('::', '/');
    else if (file.language === 'clojure') path = target.replaceAll('.', '/').replaceAll('-', '_');
    const local = relative(file.path, path);
    for (const candidate of [
      ...new Set([local, path].filter((value): value is string => Boolean(value))),
    ]) {
      const exact = this.paths.get(candidate);
      if (exact) return exact;
      const stem = unique(this.stems.get(candidate) ?? []);
      if (stem) return stem;
      for (const suffix of ['/index', '/__init__']) {
        const entry = unique(this.stems.get(candidate + suffix) ?? []);
        if (entry) return entry;
      }
    }
    if (
      target.startsWith('.') ||
      target.includes('/') ||
      ['javascript', 'typescript', 'php', 'dart', 'solidity'].includes(file.language)
    )
      return undefined;
    return unique(this.leaves.get(path.split('/').at(-1)!) ?? []);
  }
  resolve(file: AnalyzedFile, dependency: CodeDependency): Target | undefined {
    if (dependency.targetType === 'module') {
      const resolved = this.module(file, dependency.target);
      return resolved ? { file: resolved } : undefined;
    }
    const index = this.symbols.get(file.path)!;
    if (
      ['javascript', 'typescript', 'python'].includes(file.language) &&
      dependency.target.includes('::')
    ) {
      const separator = dependency.target.indexOf('::');
      const targetFile = this.module(file, dependency.target.slice(0, separator));
      if (!targetFile || !(this.imports.get(file.path) ?? []).includes(targetFile))
        return undefined;
      const targetIndex = this.symbols.get(targetFile.path)!;
      const symbol = unique(
        targetIndex.names.get(targetIndex.fold(dependency.target.slice(separator + 2))) ?? [],
      );
      return symbol ? { file: targetFile, symbol } : undefined;
    }
    const names = dependency.target.split(/\.|::|->/);
    const name = names.at(-1)!;
    const qualifier = names.length > 1 ? names.slice(0, -1).join('.') : undefined;
    const source = dependency.source ? index.keys.get(dependency.source) : undefined;
    let candidates = [
      ...new Set([
        ...(index.names.get(index.fold(dependency.target)) ?? []),
        ...(index.names.get(index.fold(name)) ?? []),
      ]),
    ];
    if (qualifier) {
      if (qualifier === 'self' || qualifier === 'this')
        candidates = candidates.filter(
          (symbol) => symbol.parent === source?.parent || symbol.parent === source?.key,
        );
      else
        candidates = candidates.filter(
          (symbol) =>
            index.fold(symbol.name) === index.fold(dependency.target) ||
            (symbol.parent &&
              index.fold(index.keys.get(symbol.parent)?.name ?? '') === index.fold(qualifier)),
        );
    } else if (candidates.length > 1 && source) {
      const scoped = candidates.filter(
        (symbol) => symbol.parent === source.parent || symbol.key === source.key,
      );
      if (scoped.length) candidates = scoped;
    }
    const local = unique(candidates);
    if (local) return { file, symbol: local };
    if (candidates.length > 1) return undefined;
    const imported: Target[] = [];
    for (const related of this.imports.get(file.path) ?? []) {
      if (
        qualifier &&
        ![leaf(related.path), related.path.replace(/\.[^.]+$/, '').replaceAll('/', '.')].includes(
          qualifier,
        )
      )
        continue;
      const other = this.symbols.get(related.path)!;
      for (const symbol of new Set([
        ...(other.names.get(other.fold(name)) ?? []),
        ...(other.names.get(other.fold(dependency.target)) ?? []),
      ]))
        imported.push({ file: related, symbol });
    }
    const importedTarget = unique(imported);
    if (importedTarget || imported.length > 1) return importedTarget;
    const namespace = this.namespace(file);
    return namespace
      ? unique(this.shared.get(`${namespace}:${index.fold(dependency.target)}`) ?? [])
      : undefined;
  }
}
