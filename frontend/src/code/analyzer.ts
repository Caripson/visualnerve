import {
  blankGraph,
  newEdge,
  newNode,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
} from '../model/types';
import { normalizeCodeInput } from './input';
import { extractProgramCode } from './program';
import { CodeResolver, type AnalyzedFile } from './resolve';
import { extractSpecialCode } from './special';
import {
  codeLimits,
  type CodeAnalysis,
  type CodeInput,
  type CodeImportResult,
  type CodeLanguage,
  type CodeObject,
  type CodeObjectKind,
  type CodeRelation,
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
const kinds: Record<CodeObjectKind, NodeKind> = {
  file: 'document',
  class: 'system',
  function: 'process',
  type: 'system',
  resource: 'system',
  query: 'database',
  measure: 'process',
  variable: 'input',
  external: 'external',
};
const colors: Record<CodeObjectKind, string> = {
  file: '#dbeafe',
  class: '#ede9fe',
  function: '#dcfce7',
  type: '#ede9fe',
  resource: '#ffedd5',
  query: '#cffafe',
  measure: '#dcfce7',
  variable: '#fef3c7',
  external: '#f1f5f9',
};
const relationLabels = {
  contains: 'contains',
  imports: 'imports',
  calls: 'calls',
  inherits: 'inherits',
  references: 'references',
  reads: 'reads',
  writes: 'writes',
  'depends-on': 'depends on',
};

/** Local structural analysis. Source buffers never enter the saved graph. */
export function parseCode(input: CodeInput): CodeImportResult {
  const normalized = normalizeCodeInput(input);
  const graph = blankGraph(normalized.name, 'dependency');
  const languages = [...new Set(normalized.files.map((file) => file.language))];
  const warnings: string[] = [
    'Structural analysis uses syntax patterns, not a compiler. Dynamic dispatch, macros, generated code and runtime dependencies may be missing. Unresolved objects need review.',
  ];
  const warn = (message: string) => {
    if (warnings.length < codeLimits.warnings && !warnings.includes(message))
      warnings.push(message.slice(0, 1000));
  };
  let symbolCount = 0;
  let dependencyCount = 0;
  const files: AnalyzedFile[] = normalized.files.map((file) => {
    const extracted = specialized.has(file.language)
      ? extractSpecialCode(file.content, file.language)
      : extractProgramCode(file.content, file.language);
    symbolCount += extracted.symbols.length;
    dependencyCount += extracted.dependencies.length;
    if (symbolCount > codeLimits.symbols || dependencyCount > codeLimits.edges)
      throw new Error(
        'Project exceeds 10,000 declarations or dependencies. Import a smaller folder.',
      );
    extracted.warnings.forEach((message) => warn(`${file.path}: ${message}`));
    if (!extracted.symbols.length && !extracted.dependencies.length && file.content.trim())
      warn(
        `${file.path}: No supported declarations or dependencies were recognized. Review this syntax manually.`,
      );
    return { ...file, extracted };
  });
  const resolver = new CodeResolver(files);
  const nodes = new Map<string, GraphNode>();
  const allEdges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  let unresolvedCount = 0;
  const fileKey = (file: AnalyzedFile) => `file:${file.path}`;
  const symbolKey = (file: AnalyzedFile, key: string) => `symbol:${file.path}:${key}`;
  const addNode = (key: string, metadata: CodeObject) => {
    if (!nodes.has(key)) {
      const title = metadata.kind === 'file' ? metadata.path.split('/').at(-1)! : metadata.name;
      nodes.set(
        key,
        newNode(graph.diagram.id, {
          title,
          nodeType: kinds[metadata.kind],
          color: colors[metadata.kind],
          width: 300,
          height: metadata.kind === 'file' ? 240 : 150,
          metadata: { codeObject: metadata },
        }),
      );
    }
    return nodes.get(key)!;
  };
  const addEdge = (sourceKey: string, targetKey: string, metadata: CodeRelation) => {
    if (
      sourceKey === targetKey &&
      (normalized.mode === 'files' || !['calls', 'references'].includes(metadata.kind))
    )
      return;
    const key = `${sourceKey}\0${targetKey}\0${metadata.kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    const source = nodes.get(sourceKey)!;
    const target = nodes.get(targetKey)!;
    if (!source || !target) return;
    allEdges.push(
      newEdge(graph.diagram.id, source.id, target.id, {
        edgeType: `code-${metadata.kind}`,
        label: relationLabels[metadata.kind],
        style:
          metadata.confidence === 'unresolved'
            ? 'dashed'
            : metadata.kind === 'contains'
              ? 'dotted'
              : 'solid',
        metadata: { codeRelation: metadata },
      }),
    );
  };
  for (const file of files) {
    addNode(fileKey(file), {
      version: 1,
      language: file.language,
      path: file.path,
      kind: 'file',
      name: file.path,
      summary: file.extracted.symbols.slice(0, 200).map((symbol) => symbol.name.slice(0, 500)),
    });
    if (normalized.mode === 'symbols')
      for (const symbol of file.extracted.symbols) {
        addNode(symbolKey(file, symbol.key), {
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
        addEdge(
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
          : fileKey(file);
      let targetKey: string;
      if (target?.file)
        targetKey =
          normalized.mode === 'symbols' && target.symbol
            ? symbolKey(target.file, target.symbol.key)
            : fileKey(target.file);
      else {
        unresolvedCount++;
        targetKey = `external:${file.language}:${dependency.targetType}:${dependency.target}`;
        addNode(targetKey, {
          version: 1,
          language: file.language,
          path: file.path,
          kind: 'external',
          name: dependency.target.slice(0, 500),
          external: true,
          summary: [
            dependency.targetType === 'module'
              ? 'Module not included or import could not be resolved'
              : 'Target not uniquely resolved by structural analysis',
          ],
        });
      }
      addEdge(sourceKey, targetKey, {
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
  const analysis: CodeAnalysis = {
    version: 1,
    languages,
    mode: normalized.mode,
    fileCount: files.length,
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
