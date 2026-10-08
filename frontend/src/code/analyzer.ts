import { blankGraph } from '../model/types';
import { CodeGraphBuilder } from './assembly';
import { normalizeCodeInput } from './input';
import { DEFAULT_IMPORT_LIMIT_BYTES, LARGE_IMPORT_WARNING } from '../imports/limits';
import { extractProgramCode } from './program';
import { CodeResolver, type AnalyzedFile } from './resolve';
import { extractSpecialCode } from './special';
import { extractMarkdown, resolveMarkdownTarget } from './markdown';
import { ProjectDirectoryIndex } from './directories';
import {
  codeLimits,
  type CodeAnalysis,
  type CodeInput,
  type CodeImportResult,
  type CodeLanguage,
  type CodeObject,
  type ProjectDirectory,
} from './types';

const specialized = new Set<CodeLanguage>([
  'sql',
  'tsql',
  'plsql',
  'dax',
  'powerquery',
  'graphql',
  'mdx',
  'cypher',
  'vega',
  'hcl',
  'nix',
  'sas',
  'abap',
  'cobol',
  'assembly',
]);
/** Local structural analysis. Source buffers never enter the saved graph. */
export function parseCode(input: CodeInput, byteLimit?: number): CodeImportResult {
  const normalized = normalizeCodeInput(input, byteLimit);
  const graph = blankGraph(normalized.name, 'dependency');
  const languages = [...new Set(normalized.files.map((file) => file.language))];
  const warnings: string[] = [
    'Structural analysis uses syntax patterns, not a compiler. Dynamic dispatch, macros, generated code and runtime dependencies may be missing. Unresolved objects need review.',
  ];
  if (normalized.bytes > DEFAULT_IMPORT_LIMIT_BYTES) warnings.push(LARGE_IMPORT_WARNING);
  const warn = (message: string) => {
    if (warnings.length < codeLimits.warnings && !warnings.includes(message))
      warnings.push(message.slice(0, 1000));
  };
  let symbolCount = 0;
  let dependencyCount = 0;
  const files: AnalyzedFile[] = normalized.files.map((file) => {
    const extracted =
      file.language === 'markdown'
        ? extractMarkdown(file.content)
        : specialized.has(file.language)
          ? extractSpecialCode(file.content, file.language)
          : extractProgramCode(file.content, file.language);
    symbolCount += extracted.symbols.length;
    dependencyCount += extracted.dependencies.length;
    if (symbolCount > codeLimits.symbols || dependencyCount > codeLimits.edges)
      throw new Error(
        'Project exceeds 10,000 declarations or dependencies. Import a smaller folder.',
      );
    extracted.warnings.forEach((message) => warn(`${file.path}: ${message}`));
    if (
      file.language !== 'markdown' &&
      !extracted.symbols.length &&
      !extracted.dependencies.length &&
      file.content.trim()
    )
      warn(
        `${file.path}: No supported declarations or dependencies were recognized. Review this syntax manually.`,
      );
    return { ...file, extracted };
  });
  const resolver = new CodeResolver(files);
  const directories = normalized.mode === 'folders' ? new ProjectDirectoryIndex(files) : undefined;
  const builder = new CodeGraphBuilder(graph, normalized.mode);
  const { nodes, edges: allEdges } = builder;
  let unresolvedCount = 0;
  const fileKey = (file: AnalyzedFile) => `file:${file.path}`;
  const symbolKey = (file: AnalyzedFile, key: string) => `symbol:${file.path}:${key}`;
  const locationKey = (file: AnalyzedFile) =>
    directories ? `directory:${directories.owner(file.path)}` : fileKey(file);
  if (directories) {
    for (const directory of directories.directories) builder.directory(directory);
    for (const { parent, child } of directories.hierarchy)
      builder.relation(`directory:${parent}`, `directory:${child}`, {
        version: 1,
        kind: 'contains',
        confidence: 'syntax',
      });
  }
  for (const file of files) {
    if (!directories)
      builder.object(fileKey(file), {
        version: 1,
        language: file.language,
        path: file.path,
        kind: 'file',
        name: file.path,
        summary: file.extracted.symbols.slice(0, 200).map((symbol) => symbol.name.slice(0, 500)),
      });
    if (normalized.mode === 'symbols')
      for (const symbol of file.extracted.symbols) {
        builder.object(symbolKey(file, symbol.key), {
          version: 1,
          language: file.language,
          path: file.path,
          kind: symbol.kind,
          name: symbol.name.slice(0, 500),
          line: symbol.line,
          ...(symbol.endLine ? { endLine: symbol.endLine } : {}),
        });
      }
  }
  for (const file of files) {
    if (normalized.mode === 'symbols')
      for (const symbol of file.extracted.symbols) {
        builder.relation(
          symbol.parent ? symbolKey(file, symbol.parent) : fileKey(file),
          symbolKey(file, symbol.key),
          {
            version: 1,
            kind: 'contains',
            confidence: 'syntax',
            evidence: { path: file.path, line: symbol.line },
          },
        );
      }
    for (const dependency of file.extracted.dependencies) {
      const target = resolver.resolve(file, dependency);
      const sourceKey =
        normalized.mode === 'symbols' &&
        dependency.source &&
        nodes.has(symbolKey(file, dependency.source))
          ? symbolKey(file, dependency.source)
          : locationKey(file);
      let targetKey: string;
      if (target?.file)
        targetKey =
          normalized.mode === 'symbols' && target.symbol
            ? symbolKey(target.file, target.symbol.key)
            : locationKey(target.file);
      else {
        unresolvedCount++;
        const markdownTarget =
          file.language === 'markdown'
            ? resolveMarkdownTarget(file.path, dependency.target)
            : undefined;
        const unresolvedIdentity =
          file.language === 'markdown'
            ? JSON.stringify(
                markdownTarget
                  ? [markdownTarget.path, markdownTarget.anchor ?? '']
                  : [file.path, dependency.target],
              )
            : dependency.target;
        targetKey = `external:${file.language}:${dependency.targetType}:${unresolvedIdentity}`;
        builder.object(targetKey, {
          version: 1,
          language: file.language,
          path: file.path,
          kind: 'external',
          name: dependency.target.slice(0, 500),
          external: true,
          summary: [
            file.language === 'markdown'
              ? 'Local document or anchor was not included, was ambiguous or could not be resolved'
              : dependency.targetType === 'module'
                ? 'Module not included or import could not be resolved'
                : 'Target not uniquely resolved by structural analysis',
          ],
        });
      }
      builder.relation(sourceKey, targetKey, {
        version: 1,
        kind: dependency.kind,
        confidence: target ? dependency.confidence : 'unresolved',
        evidence: { path: file.path, line: dependency.line },
      });
    }
  }
  let selected = [...nodes.values()];
  if (normalized.focus) {
    const focus = normalized.focus.toLocaleLowerCase();
    const matches = new Set(
      selected
        .filter((node) => {
          if (directories && node.metadata.projectDirectory) {
            const directory = node.metadata.projectDirectory as ProjectDirectory;
            return (
              directory.path.toLocaleLowerCase().includes(focus) ||
              files.some(
                (file) =>
                  directories.owner(file.path) === directory.path &&
                  (file.path.toLocaleLowerCase().includes(focus) ||
                    file.extracted.symbols.some((symbol) =>
                      symbol.name.toLocaleLowerCase().includes(focus),
                    )),
              )
            );
          }
          const metadata = node.metadata.codeObject as CodeObject;
          if (`${metadata.path}\n${metadata.name}`.toLocaleLowerCase().includes(focus)) return true;
          return (
            normalized.mode === 'files' &&
            metadata.kind === 'file' &&
            Boolean(
              files
                .find((file) => file.path === metadata.path)
                ?.extracted.symbols.some((symbol) =>
                  symbol.name.toLocaleLowerCase().includes(focus),
                ),
            )
          );
        })
        .map((node) => node.id),
    );
    const selectedIds = new Set(matches);
    for (const edge of allEdges)
      if (matches.has(edge.sourceNodeId) || matches.has(edge.targetNodeId)) {
        selectedIds.add(edge.sourceNodeId);
        selectedIds.add(edge.targetNodeId);
      }
    selected = selected.filter((node) => selectedIds.has(node.id));
    if (!matches.size)
      throw new Error(
        'Focus did not match a file, declaration or dependency. Change the text and preview again.',
      );
  }
  const selectedIds = new Set(selected.map((node) => node.id));
  const edges = allEdges.filter(
    (edge) => selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId),
  );
  if (selected.length > codeLimits.nodes || edges.length > codeLimits.edges)
    throw new Error(
      'Diagram exceeds 5,000 objects or 10,000 connections. Use file overview or narrow the focus.',
    );
  if (unresolvedCount)
    warn(
      `${unresolvedCount} dependencies could not be uniquely resolved. External objects may represent libraries, missing files or ambiguous names.`,
    );
  if (normalized.mode === 'files')
    warn(
      'File overview combines connections between the same files. Local declarations are listed on each file; choose Symbols to inspect individual functions and types.',
    );
  if (directories)
    warn(
      'Folder overview combines dependencies between owning directories. Same-folder connections are omitted; choose Files or Symbols to inspect them. Directory counts include descendant files.',
    );
  const analysis: CodeAnalysis = {
    version: 1,
    languages,
    mode: normalized.mode,
    fileCount: files.length,
    ...(directories ? { directoryCount: directories.directories.length } : {}),
    symbolCount,
    dependencyCount,
    unresolvedCount,
    warnings,
    ...(normalized.focus ? { focus: normalized.focus } : {}),
  };
  graph.nodes = selected.map((node, index) => ({
    ...node,
    x: (index % Math.ceil(Math.sqrt(selected.length))) * 390,
    y: Math.floor(index / Math.ceil(Math.sqrt(selected.length))) * 310,
  }));
  graph.edges = edges;
  graph.diagram.metadata.codeAnalysis = analysis;
  return { ...analysis, graph };
}
