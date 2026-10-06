import { getCodeAnalysis, getCodeObject, getCodeRelation } from '../code/schema';
import { codeAnalysisSummary, codeObjectSummary, codeRelationSummary } from './code';
import { getCsvNode } from '../data/csv';
import { graphDatasets, analysisForDataset, isGeneratedCsvNode } from '../data/model';
import type { CsvNodeData } from '../data/types';
import type { Graph, GraphEdge } from '../model/types';
import { getSqlRelationship, getSqlTable, type SqlTable } from '../sql/schema';
import { getSqlQuerySource, getSqlQueryResult, getSqlQueryRelationship } from '../sql/query-schema';
import {
  sqlQuerySourceSummary,
  sqlQueryResultSummary,
  sqlQueryRelationshipSummary,
} from './sql-query';

export const LOVABLE_MAX_PROMPT_LENGTH = 50_000;
/** A local limit on the encoded URL, separate from Lovable's prompt limit. */
export const LOVABLE_MAX_URL_LENGTH = 60_000;

export type LovableScope = 'diagram' | 'selected' | 'csv-view';
export interface LovablePromptOptions {
  scope: LovableScope;
  selectedIds?: string[];
}
export interface LovablePrompt {
  text: string;
  nodeCount: number;
  /** Stored relationships whose two endpoints are included. */
  edgeCount: number;
  /** Crossing relationships, including otherwise implicit parent boundaries. */
  boundaryCount: number;
}

const json = (value: unknown) => JSON.stringify(value);

function sqlTableSchema(table: SqlTable | undefined) {
  if (!table) return undefined;
  return {
    name: table.name,
    qualifiedName: table.qualifiedName,
    columns: table.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      foreignKey: column.foreignKey,
      unique: column.unique,
    })),
    primaryKey: table.primaryKey,
    uniqueKeys: table.uniqueKeys,
    external: table.external ?? false,
  };
}

export function buildLovablePrompt(
  graph: Graph,
  instructions: string,
  options: LovablePromptOptions,
): LovablePrompt {
  const csv = new Map(graph.nodes.map((node) => [node.id, getCsvNode(node)] as const));
  const selected = new Set(options.selectedIds ?? []);
  const included = graph.nodes.filter((node) => {
    if (options.scope === 'selected') return selected.has(node.id);
    const data = csv.get(node.id);
    const generated = isGeneratedCsvNode(node);
    return options.scope !== 'csv-view' || !generated || data?.visible !== false;
  });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const refs = new Map(included.map((node, index) => [node.id, `n${index + 1}`]));
  const externalRefs = new Map<string, string>();
  const ref = (id: string) => {
    const internal = refs.get(id);
    if (internal) return internal;
    if (!byId.has(id)) return undefined;
    let external = externalRefs.get(id);
    if (!external) {
      external = `x${externalRefs.size + 1}`;
      externalRefs.set(id, external);
    }
    return external;
  };
  const owners = new Map(graph.owners.map((owner) => [owner.id, owner]));
  const sources = graphDatasets(graph);
  const sourceRefs = new Map(sources.map((source, index) => [source.id, `s${index + 1}`]));
  const columns = new Map<string, { ref: string; label: string; source?: string }>();
  for (const source of sources)
    for (const column of source.columns)
      columns.set(`${source.id}:${column.id}`, {
        ref: `c${columns.size + 1}`,
        label: column.label,
        ...(sources.length > 1 ? { source: sourceRefs.get(source.id) } : {}),
      });
  const column = (id: string, datasetId = graph.dataset?.id ?? '') => {
    const key = `${datasetId}:${id}`;
    let item = columns.get(key);
    if (!item) {
      item = { ref: `c${columns.size + 1}`, label: 'Source column (original schema unavailable)' };
      columns.set(key, item);
    }
    return item.ref;
  };
  const metricRefs = new Map<string, string>();
  const metricRef = (id: string, datasetId = graph.dataset?.id ?? '') => {
    const key = `${datasetId}:${id}`;
    let item = metricRefs.get(key);
    if (!item) {
      item = `m${metricRefs.size + 1}`;
      metricRefs.set(key, item);
    }
    return item;
  };
  const group = (data: CsvNodeData) => ({
    ...(sources.length > 1 ? { source: sourceRefs.get(data.datasetId) } : {}),
    path: data.path.map((entry) => ({
      column: column(entry.columnId, data.datasetId),
      value: entry.value,
    })),
    matchingRows: data.rowCount,
    totalChildGroups: data.totalChildren,
    childGroupsOutsidePage: data.hiddenChildren,
    retainedOutsideCurrentView: data.visible === false,
    measures: data.measures.map((measure) => ({
      ref: metricRef(measure.id, data.datasetId),
      label: measure.label,
      operation: measure.operation,
      column: measure.columnId ? column(measure.columnId, data.datasetId) : undefined,
      value: measure.value,
      numericCount: measure.numericCount,
      missingCount: measure.missingCount,
      invalidCount: measure.invalidCount,
      hiddenInDiagram: data.hiddenMetricIds?.includes(measure.id) ?? false,
    })),
  });

  const objects = included.map((node) => {
    const ownerIds = [...new Set([...node.ownerIds, ...(node.ownerId ? [node.ownerId] : [])])];
    const responsibilities = ownerIds.flatMap((id) => {
      const owner = owners.get(id);
      return owner
        ? [{ name: owner.name, kind: owner.kind, team: owner.team, role: owner.role }]
        : [];
    });
    const data = csv.get(node.id);
    return {
      ref: refs.get(node.id),
      type: node.nodeType,
      title: node.title,
      description: node.description,
      notes: node.notes,
      status: node.status,
      tags: node.tags,
      parent: node.parentId ? ref(node.parentId) : undefined,
      responsibilities,
      unresolvedResponsibilities: ownerIds.length - responsibilities.length || undefined,
      schedule:
        node.startDate || node.endDate || node.dueDate
          ? { start: node.startDate, end: node.endDate, due: node.dueDate }
          : undefined,
      csvGroup: data ? group(data) : undefined,
      codeObject: codeObjectSummary(getCodeObject(node)),
      sqlTable: sqlTableSchema(getSqlTable(node)),
      sqlQuerySource: sqlQuerySourceSummary(getSqlQuerySource(node)),
      sqlQueryResult: sqlQueryResultSummary(getSqlQueryResult(node)),
    };
  });

  const internalEdges: object[] = [];
  const boundaryEdges: object[] = [];
  const explicitParents = new Set<string>();
  for (const edge of graph.edges) {
    if (
      options.scope === 'csv-view' &&
      edge.metadata.csvModelGenerated === true &&
      edge.metadata.csvModelVisible === false
    )
      continue;
    if (edge.edgeType === 'hierarchy')
      explicitParents.add(json([edge.sourceNodeId, edge.targetNodeId]));
    const sourceIncluded = refs.has(edge.sourceNodeId);
    const targetIncluded = refs.has(edge.targetNodeId);
    if (!sourceIncluded && !targetIncluded) continue;
    const source = ref(edge.sourceNodeId);
    const target = ref(edge.targetNodeId);
    if (!source || !target) continue;
    const boundary = sourceIncluded !== targetIncluded;
    const list = boundary ? boundaryEdges : internalEdges;
    const foreignKey = getSqlRelationship(edge);
    list.push({
      ref: `${boundary ? 'b' : 'e'}${list.length + 1}`,
      source,
      target,
      type: edge.edgeType,
      label: edge.label,
      description: edge.description,
      direction: edge.direction,
      flow: relationshipFlow(edge, source, target),
      loop: source === target,
      codeRelation: codeRelationSummary(getCodeRelation(edge)),
      sqlQueryRelationship: sqlQueryRelationshipSummary(getSqlQueryRelationship(edge)),
      sqlForeignKey: foreignKey
        ? {
            columns: foreignKey.columns,
            referencedColumns: foreignKey.unresolved ? null : foreignKey.referencedColumns,
            ...(foreignKey.unresolved ? { unresolved: true } : {}),
            name: foreignKey.name,
            onDelete: foreignKey.onDelete,
            onUpdate: foreignKey.onUpdate,
          }
        : undefined,
    });
  }
  const parentRelations: object[] = [];
  let parentBoundaries = 0;
  for (const node of graph.nodes) {
    if (!node.parentId || explicitParents.has(json([node.parentId, node.id]))) continue;
    const parentIncluded = refs.has(node.parentId);
    const childIncluded = refs.has(node.id);
    if (!parentIncluded && !childIncluded) continue;
    const parent = ref(node.parentId);
    const child = ref(node.id);
    if (!parent || !child) continue;
    const boundary = parentIncluded !== childIncluded;
    if (boundary) parentBoundaries++;
    parentRelations.push({ parent, child, type: 'implicit hierarchy', externalContext: boundary });
  }

  const analysis = graph.dataset ? analysisForDataset(graph, graph.dataset.id) : undefined;
  const csvSummary = analysis
    ? {
        grouping: analysis.levels.map((id) => column(id)),
        measures: analysis.metrics.map((metric) => ({
          ref: metricRef(metric.id),
          operation: metric.operation,
          column: metric.columnId ? column(metric.columnId) : undefined,
        })),
        filters: analysis.filters.map((filter) => ({
          column: column(filter.columnId),
          operation: filter.operation,
          value: filter.value,
          caseSensitive: filter.caseSensitive ?? false,
        })),
        focus: analysis.focusPath.map((entry) => ({
          column: column(entry.columnId),
          value: entry.value,
        })),
        page: { offset: analysis.offset, groupsPerLevel: analysis.limit },
        sort: {
          by:
            analysis.sortBy === 'label' || analysis.sortBy === 'count'
              ? analysis.sortBy
              : metricRef(analysis.sortBy),
          direction: analysis.sortDirection,
        },
        decimalSeparator: analysis.decimalSeparator,
        displayedColumns: analysis.displayColumns.map((id) => column(id)),
        columnRules: analysis.columnRules.map((rule) => ({
          column: column(rule.columnId),
          trim: rule.trim,
          pattern: rule.pattern,
          replacement: rule.replacement,
          flags: rule.flags,
          numberFormat: rule.numberFormat,
        })),
      }
    : undefined;
  const external = [...externalRefs].map(([id, externalRef]) => {
    const node = byId.get(id)!;
    return {
      ref: externalRef,
      type: node.nodeType,
      title: node.title,
      description: node.description,
      codeObject: codeObjectSummary(getCodeObject(node)),
      sqlTable: sqlTableSchema(getSqlTable(node)),
      sqlQuerySource: sqlQuerySourceSummary(getSqlQuerySource(node)),
      sqlQueryResult: sqlQueryResultSummary(getSqlQueryResult(node)),
    };
  });
  const csvPresent = sources.length > 0 || [...csv.values()].some(Boolean);
  const lines = [
    'Build a web application from the application and workflow specification below.',
    'The diagram describes the desired APP: its features, business objects, roles and workflow. Do not recreate Visual Nerve or build a diagram editor unless the user explicitly asks for one.',
    'Use object references to distinguish duplicate titles. Preserve every included feature and workflow step, including loops and disconnected objects.',
    'Status describes planning progress. A Done object still defines a feature or workflow step to implement; Done is not permission to omit it.',
    'Explicit relationship directions, types, labels and descriptions are authoritative. Preserve branch conditions. Do not invent missing edge labels or infer execution order from position, parent hierarchy, collapse state or status.',
    'Parent relationships describe containment or hierarchy; they are not additional directed workflow transitions.',
    'External x-references are context outside the chosen scope. Preserve their boundary conditions and integration requirements, but do not implement those external objects as additional features unless requested.',
    `Scope: ${options.scope}. Viewport, collapsed branches and ordinary status/owner/tag filters do not remove workflow objects from this specification.`,
    options.scope === 'csv-view'
      ? 'Only CSV groups retained outside the current data view are excluded; all manual objects remain included.'
      : '',
    'User instructions (verbatim):',
    instructions,
    'End user instructions.',
    `Application diagram: ${json({
      name: graph.diagram.name,
      type: graph.diagram.type,
      description: graph.diagram.description,
      tags: graph.diagram.tags,
    })}`,
    'Application objects (one JSON record per object):',
    ...objects.map(json),
    'Explicit internal relationships (source/target are stored endpoints; flow interprets direction):',
    ...internalEdges.map(json),
    'External context objects (not additional objects in the requested app scope):',
    ...external.map(json),
    'Explicit boundary relationships:',
    ...boundaryEdges.map(json),
    'Parent hierarchy not already represented by an explicit hierarchy relationship:',
    ...parentRelations.map(json),
  ];
  if (csvPresent) {
    lines.push(
      'CSV data context: only column schema, analysis settings and already calculated group aggregates are included. Raw dataset rows are not supplied. Do not reconstruct individual records or treat aggregate group values as raw records.',
      `CSV schema: ${json([...columns.values()])}`,
      `CSV analysis: ${json(csvSummary ?? { sourceAnalysisUnavailable: true })}`,
      'CSV group totals may overlap along the hierarchy; do not sum parent and child totals together. Cached groups outside the current view may reflect earlier analysis settings.',
    );
  }
  if (sources.length > 1) {
    lines.push(
      `CSV sources: ${json(
        sources.map((source) => {
          const analysis = analysisForDataset(graph, source.id)!;
          return {
            ref: sourceRefs.get(source.id),
            name: source.name,
            columns: source.columns.map((c) => column(c.id, source.id)),
            grouping: analysis.levels.map((id) => column(id, source.id)),
            measures: analysis.metrics.map((metric) => ({
              ref: metricRef(metric.id, source.id),
              operation: metric.operation,
              column: metric.columnId ? column(metric.columnId, source.id) : undefined,
            })),
            filters: analysis.filters.map((filter) => ({
              column: column(filter.columnId, source.id),
              operation: filter.operation,
              value: filter.value,
              caseSensitive: filter.caseSensitive ?? false,
            })),
            focus: analysis.focusPath.map((p) => ({
              column: column(p.columnId, source.id),
              value: p.value,
            })),
            page: { offset: analysis.offset, groupsPerLevel: analysis.limit },
            decimalSeparator: analysis.decimalSeparator,
            columnRules: analysis.columnRules.map((rule) => ({
              column: column(rule.columnId, source.id),
              trim: rule.trim,
              pattern: rule.pattern,
              replacement: rule.replacement,
              flags: rule.flags,
              numberFormat: rule.numberFormat,
            })),
          };
        }),
      )}`,
    );
    lines.push(
      `CSV column relationships: ${json((graph.diagram.settings.csvRelationships ?? []).map((relationship) => ({ source: sourceRefs.get(relationship.sourceDatasetId), sourceColumn: column(relationship.sourceColumnId, relationship.sourceDatasetId), target: sourceRefs.get(relationship.targetDatasetId), targetColumn: column(relationship.targetColumnId, relationship.targetDatasetId), matching: relationship.matchMode ?? 'trim' })))}`,
    );
    lines.push(
      'Compute each source aggregate from its own original rows once. Relationship matching is a semijoin for entity context, never a joined-row sum; one-to-many or many-to-many matches must not multiply money or counts.',
    );
    const focus = graph.diagram.settings.csvEntityFocus;
    if (focus)
      lines.push(
        `Related entity focus: ${json({ source: sourceRefs.get(focus.datasetId), path: focus.path.map((p) => ({ column: column(p.columnId, focus.datasetId), value: p.value })) })}`,
      );
  }
  if (graph.nodes.some((node) => getSqlTable(node))) {
    lines.push(
      'SQL data schema: use the supplied table names, column types, nullability, primary keys, unique keys and foreign-key column pairs to define the app data model. Composite key columns belong to one key in the stated order.',
      'SQL foreign keys reference the child table (source) to the parent table (target). They express data integrity, not workflow execution order. Preserve the declared ON DELETE and ON UPDATE actions.',
      'External SQL tables with a missing definition are integration context. Their columns and keys are unknown unless explicitly supplied. Do not invent definitions or infer them from a placeholder.',
      'When sqlForeignKey.unresolved is true, referencedColumns is unknown (null). Do not treat placeholder question marks as column names or invent a referenced primary key.',
      'Only the recognized schema fields are included. Raw SQL scripts, inserted rows, default literals and arbitrary metadata are not supplied.',
    );
  }
  if (graph.nodes.some((node) => getSqlQuerySource(node) || getSqlQueryResult(node))) {
    lines.push(
      'SQL query context: source aliases are distinct within each logical scope. Sources list observed column references only; data types, keys and nullability are unknown. Do not invent a database schema.',
      'Preserve SELECT output order, expressions, DISTINCT, JOIN types and full conditions, query scopes and filter/group/order/limit clauses. Duplicate aliases and ambiguous or unresolved references require clarification; do not silently correct them.',
      'SQL join, input, subquery and column-lineage relationships describe query structure, not workflow execution order. This is a static interpretation of SQL, not database results or an EXPLAIN execution plan.',
      'Query expressions and predicates include literal values and are supplied in this prompt. The original SQL script and comments, database rows and arbitrary metadata are not supplied.',
    );
  }
  if (graph.nodes.some((node) => getCodeObject(node))) {
    lines.push(
      `Code analysis notes: ${json(codeAnalysisSummary(getCodeAnalysis(graph)) ?? { warnings: ['Import analysis notes were not supplied.'] })}`,
      'Code context: these objects and relationships are a bounded static outline, not an executed program or compiler-verified call graph. File paths and source line numbers identify the original input; they may become outdated after edits.',
      'Preserve the supplied relationship kind and confidence. Syntax means a recognized declaration/import/reference; heuristic means a possible connection; unresolved means external or ambiguous context. Ask about uncertain behavior rather than inventing missing implementations.',
      'Original source, comments and string literal values are not included. Names, paths and extracted identifiers remain in this prompt. Dependencies describe code structure, not workflow execution order.',
    );
  }
  return {
    text: lines.filter((line) => line !== '').join('\n\n'),
    nodeCount: included.length,
    edgeCount: internalEdges.length,
    boundaryCount: boundaryEdges.length + parentBoundaries,
  };
}

function relationshipFlow(edge: GraphEdge, source: string, target: string): string {
  if (edge.direction === 'backward') return `${target} -> ${source}`;
  if (edge.direction === 'both') return `${source} <-> ${target}`;
  if (edge.direction === 'none')
    return `${source} -- ${target} (association, no execution direction)`;
  return `${source} -> ${target}`;
}

/** Opens an unsent new-project prompt. Never truncates the original text. */
export function lovableLink(text: string): { url: string | null; reason: string | null } {
  if (!text.trim()) return { url: null, reason: 'Add a prompt before opening Lovable.' };
  if (text.length > LOVABLE_MAX_PROMPT_LENGTH)
    return {
      url: null,
      reason: `Lovable links support at most ${LOVABLE_MAX_PROMPT_LENGTH.toLocaleString('en-US')} prompt characters. Copy or download the complete prompt instead.`,
    };
  let url: string;
  try {
    url = `https://lovable.dev/#prompt=${encodeURIComponent(text)}`;
  } catch {
    return {
      url: null,
      reason:
        'This text cannot be encoded as a link. Copy or download the complete prompt instead.',
    };
  }
  if (url.length > LOVABLE_MAX_URL_LENGTH)
    return {
      url: null,
      reason: `The encoded link exceeds the local ${LOVABLE_MAX_URL_LENGTH.toLocaleString('en-US')}-character URL limit. Copy or download the complete prompt instead.`,
    };
  return { url, reason: null };
}
