import { getCodeAnalysis, getCodeObject, getCodeRelation } from '../code/schema';
import { codeAnalysisSummary, codeObjectSummary, codeRelationSummary } from './code';
import Papa from 'papaparse';
import { assertImportBytes, DEFAULT_IMPORT_LIMIT_BYTES, utf8Bytes } from '../imports/limits';
import { getSqlQuerySource, getSqlQueryResult, getSqlQueryRelationship } from '../sql/query-schema';
import {
  sqlQuerySourceSummary,
  sqlQueryResultSummary,
  sqlQueryRelationshipSummary,
} from './sql-query';
import {
  base,
  blankGraph,
  newEdge,
  newNode,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
export function parseImport(
  format: 'json' | 'markdown' | 'csv',
  text: string,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): Graph {
  assertImportBytes(utf8Bytes(text), byteLimit, 'Import file');
  if (format === 'json') {
    const graph = JSON.parse(text) as Graph;
    if (
      graph.format !== 'visual-nerve' ||
      graph.formatVersion !== 1 ||
      !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.edges) ||
      !Array.isArray(graph.owners)
    )
      throw new Error('Choose a Visual Nerve JSON export (formatVersion 1).');
    return graph;
  }
  const graph = blankGraph('Imported diagram', format === 'markdown' ? 'mindmap' : 'process');
  const add = (title: string, parentId?: string, level = 0): GraphNode => {
    const n = newNode(graph.diagram.id, {
      title,
      parentId,
      x: level * 260,
      y: graph.nodes.length * 116,
    });
    graph.nodes.push(n);
    if (parentId)
      graph.edges.push(newEdge(graph.diagram.id, parentId, n.id, { edgeType: 'hierarchy' }));
    return n;
  };
  if (format === 'markdown') {
    const stack: { level: number; node: GraphNode }[] = [];
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const item = line.match(/^(\s*)(?:[-*+] |\d+[.)] )(.+)$/);
      if (heading || item) {
        const level = heading ? heading[1].length : 7 + item![1].replace(/\t/g, '  ').length / 2;
        while (stack.length && stack.at(-1)!.level >= level) stack.pop();
        const n = add(
          (heading?.[2] ?? item![2]).trim(),
          stack.at(-1)?.node.id,
          Math.max(0, stack.length),
        );
        if (graph.nodes.length === 1) graph.diagram.name = n.title;
        stack.push({ level, node: n });
      } else if (line.trim() && graph.nodes.length) {
        const last = graph.nodes.at(-1)!;
        last.description = [last.description, line].filter(Boolean).join('\n');
      }
    }
  } else {
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
    });
    if (result.errors.length) throw new Error(result.errors[0].message);
    if (!result.meta.fields?.includes('title')) throw new Error('CSV needs a title column.');
    const owners = new Map<string, Owner>();
    for (const row of result.data) {
      const n = add(row.title);
      for (const key of [
        'externalId',
        'description',
        'status',
        'startDate',
        'endDate',
        'dueDate',
      ] as const)
        if (row[key]) n[key] = row[key];
      if (row.nodeType) n.nodeType = row.nodeType as GraphNode['nodeType'];
      if (row.tags)
        n.tags = row.tags
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean);
      for (const key of ['x', 'y'] as const)
        if (row[key]) {
          const value = Number(row[key]);
          if (!Number.isFinite(value)) throw new Error(`Invalid ${key} coordinate.`);
          n[key] = value;
        }
      if (row.owner) {
        let owner = owners.get(row.owner);
        if (!owner) {
          owner = { ...base(), name: row.owner, kind: 'person', color: '#31766c', metadata: {} };
          owners.set(row.owner, owner);
          graph.owners.push(owner);
        }
        n.ownerId = owner.id;
        n.ownerIds = [owner.id];
      }
    }
  }
  if (!graph.nodes.length) throw new Error('No headings, lists or rows found.');
  return graph;
}
function ordered(graph: Graph): GraphNode[] {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    indegree.set(e.targetNodeId, (indegree.get(e.targetNodeId) ?? 0) + 1);
    outgoing.set(e.sourceNodeId, [...(outgoing.get(e.sourceNodeId) ?? []), e.targetNodeId]);
  }
  const ids = graph.nodes.filter((n) => !indegree.get(n.id)).map((n) => n.id);
  for (let i = 0; i < ids.length; i++)
    for (const next of outgoing.get(ids[i]) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) ids.push(next);
    }
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...graph.nodes].sort(
    (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
  );
}
function escapeHeading(text: string) {
  return text.replace(/\n/g, ' ').replace(/([\\`*_\[\]])/g, '\\$1');
}
function queryRecord(title: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${title}:\n\n${fence}json\n${text}\n${fence}\n`;
}
export function markdown(graph: Graph): string {
  const chunks = [
    `# ${escapeHeading(graph.diagram.name)}\n`,
    graph.diagram.description ? `${graph.diagram.description}\n` : '',
  ];
  const codeAnalysis = codeAnalysisSummary(getCodeAnalysis(graph));
  if (codeAnalysis) chunks.push(queryRecord('Code analysis notes', codeAnalysis));
  const owners = new Map(graph.owners.map((o) => [o.id, o.name]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const adjacent = outgoing.get(edge.sourceNodeId) ?? [];
    adjacent.push(edge);
    outgoing.set(edge.sourceNodeId, adjacent);
  }
  const relationships = (node: GraphNode, hierarchy = false) => {
    const next = (outgoing.get(node.id) ?? []).filter(
      (edge) =>
        !hierarchy ||
        edge.edgeType !== 'hierarchy' ||
        nodes.get(edge.targetNodeId)?.parentId !== node.id,
    );
    if (next.length)
      chunks.push(
        `Next:\n${next.map((edge) => `- ${escapeHeading(nodes.get(edge.targetNodeId)?.title ?? edge.targetNodeId)}`).join('\n')}\n`,
      );
    for (const edge of next) {
      const code = codeRelationSummary(getCodeRelation(edge));
      if (code)
        chunks.push(
          queryRecord('Code connection', {
            target: nodes.get(edge.targetNodeId)?.title ?? edge.targetNodeId,
            direction: edge.direction,
            ...code,
          }),
        );
      const query = sqlQueryRelationshipSummary(getSqlQueryRelationship(edge));
      if (query)
        chunks.push(
          queryRecord('SQL query connection', {
            target: nodes.get(edge.targetNodeId)?.title ?? edge.targetNodeId,
            direction: edge.direction,
            ...query,
          }),
        );
    }
  };
  const details = (n: GraphNode) => {
    if (n.description) chunks.push(`${n.description}\n`);
    for (const id of n.ownerIds) chunks.push(`Owner: ${owners.get(id) ?? id}\n`);
    if (n.status) chunks.push(`Status: ${n.status}\n`);
    if (n.startDate || n.endDate)
      chunks.push(`Dates: ${n.startDate ?? '—'} → ${n.endDate ?? '—'}\n`);
    if (n.url) chunks.push(`URL: ${n.url}\n`);
    if (n.notes) chunks.push(`${n.notes}\n`);
    const code = codeObjectSummary(getCodeObject(n));
    if (code) chunks.push(queryRecord('Code object', code));
    const source = sqlQuerySourceSummary(getSqlQuerySource(n));
    if (source) chunks.push(queryRecord('SQL query source', source));
    const result = sqlQueryResultSummary(getSqlQueryResult(n));
    if (result) chunks.push(queryRecord('SQL query result', result));
  };
  if (graph.diagram.type === 'mindmap') {
    const children = new Map<string, GraphNode[]>();
    for (const n of graph.nodes)
      children.set(n.parentId ?? '', [...(children.get(n.parentId ?? '') ?? []), n]);
    const visited = new Set<string>();
    const walk = (parent: string, depth: number) => {
      for (const n of children.get(parent) ?? []) {
        if (visited.has(n.id)) continue;
        visited.add(n.id);
        chunks.push(`${'#'.repeat(Math.min(6, depth))} ${escapeHeading(n.title)}\n`);
        details(n);
        relationships(n, true);
        walk(n.id, depth + 1);
      }
    };
    const roots = children.get('') ?? [];
    if (roots.length === 1 && roots[0].title === graph.diagram.name) {
      visited.add(roots[0].id);
      details(roots[0]);
      relationships(roots[0], true);
      walk(roots[0].id, 2);
    } else walk('', 2);
  } else
    ordered(graph).forEach((n, i) => {
      chunks.push(
        graph.diagram.type === 'process' || graph.diagram.type === 'responsibility'
          ? `${i + 1}. ${escapeHeading(n.title)}\n`
          : `## ${escapeHeading(n.title)}\n`,
      );
      details(n);
      relationships(n);
    });
  return chunks.filter(Boolean).join('\n');
}
export function download(name: string, content: string | Blob, mime = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function safeName(name: string) {
  return (
    name
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'diagram'
  );
}
