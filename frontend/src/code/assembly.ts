import {
  newEdge,
  newNode,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
} from '../model/types';
import type {
  CodeInput,
  CodeObject,
  CodeObjectKind,
  CodeRelation,
  ProjectDirectory,
} from './types';

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
const labels: Record<CodeRelation['kind'], string> = {
  contains: 'contains',
  imports: 'imports',
  calls: 'calls',
  inherits: 'inherits',
  references: 'references',
  reads: 'reads',
  writes: 'writes',
  'depends-on': 'depends on',
};

/** Semantic assembly owns visual defaults and deduplicates/aggregates extracted connections. */
export class CodeGraphBuilder {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];
  private edgeKeys = new Map<string, GraphEdge>();
  constructor(
    private graph: Graph,
    private mode: CodeInput['mode'],
  ) {}

  object(key: string, metadata: CodeObject): GraphNode {
    if (!this.nodes.has(key))
      this.nodes.set(
        key,
        newNode(this.graph.diagram.id, {
          title: metadata.kind === 'file' ? metadata.path.split('/').at(-1)! : metadata.name,
          nodeType: kinds[metadata.kind],
          color: colors[metadata.kind],
          width: 300,
          height: metadata.kind === 'file' ? 240 : 150,
          metadata: { codeObject: metadata },
        }),
      );
    return this.nodes.get(key)!;
  }

  directory(metadata: ProjectDirectory): void {
    this.nodes.set(
      `directory:${metadata.path}`,
      newNode(this.graph.diagram.id, {
        title: metadata.path === '.' ? 'Project root' : metadata.path.split('/').at(-1)!,
        nodeType: 'system',
        color: '#ede9fe',
        width: 300,
        height: 180,
        metadata: { projectDirectory: metadata },
      }),
    );
  }

  relation(sourceKey: string, targetKey: string, metadata: CodeRelation): void {
    if (
      sourceKey === targetKey &&
      (this.mode !== 'symbols' || !['calls', 'references'].includes(metadata.kind))
    )
      return;
    const key = `${sourceKey}\0${targetKey}\0${metadata.kind}`;
    const existing = this.edgeKeys.get(key);
    if (existing) {
      if (this.mode === 'folders' && metadata.kind !== 'contains') {
        const relation = existing.metadata.codeRelation as CodeRelation;
        relation.occurrences = (relation.occurrences ?? 1) + 1;
        existing.label = `${labels[metadata.kind]} (${relation.occurrences})`;
        if (relation.confidence !== metadata.confidence) {
          relation.confidence =
            relation.confidence === 'unresolved' || metadata.confidence === 'unresolved'
              ? 'unresolved'
              : 'heuristic';
          existing.style = relation.confidence === 'unresolved' ? 'dashed' : 'solid';
        }
      }
      return;
    }
    const source = this.nodes.get(sourceKey);
    const target = this.nodes.get(targetKey);
    if (!source || !target) return;
    const edge = newEdge(this.graph.diagram.id, source.id, target.id, {
      edgeType: `code-${metadata.kind}`,
      label: labels[metadata.kind],
      style:
        metadata.confidence === 'unresolved'
          ? 'dashed'
          : metadata.kind === 'contains'
            ? 'dotted'
            : 'solid',
      metadata: {
        codeRelation:
          this.mode === 'folders' && metadata.kind !== 'contains'
            ? { ...metadata, occurrences: 1 }
            : metadata,
      },
    });
    this.edgeKeys.set(key, edge);
    this.edges.push(edge);
  }
}
