import type { Graph, GraphNode } from '../model/types';
import { getCodeObject } from '../code/schema';
import { getCsvNode } from '../data/csv';
import { getSqlTable } from '../sql/schema';
import { getSqlQuerySource } from '../sql/query-schema';
import type { OverviewGrouping, OverviewGroup } from './types';

export interface GroupPart {
  key: string;
  label: string;
  reason: OverviewGroup['reason'];
}
const part = (key: string, label: string, reason: GroupPart['reason']): GroupPart => ({
  key,
  label: label.slice(0, 160),
  reason,
});

/** Prefer declared relationships and source boundaries; spatial partitions are explicit fallbacks. */
export function overviewGrouping(graph: Graph, grouping: OverviewGrouping) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const parents = new Set(graph.nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])));
  const sourceNames = new Map(
    [graph.dataset, ...(graph.datasets ?? [])].flatMap((source) =>
      source ? [[source.id, source.name] as const] : [],
    ),
  );
  const hierarchy = (node: GraphNode) => {
    const result: GraphNode[] = [],
      visited = new Set<string>();
    let current: GraphNode | undefined = parents.has(node.id)
      ? node
      : node.parentId
        ? byId.get(node.parentId)
        : undefined;
    while (current && !visited.has(current.id) && result.length < 8) {
      visited.add(current.id);
      result.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return result.length
      ? [
          part('hierarchy', 'Diagram hierarchy', 'hierarchy'),
          ...result.map((entry) => part(`node:${entry.id}`, entry.title, 'hierarchy')),
        ]
      : undefined;
  };
  const tags = (node: GraphNode) => {
    const tag = [...node.tags].sort()[0];
    return tag ? [part('tags', 'Tags', 'tag'), part(`tag:${tag}`, tag, 'tag')] : undefined;
  };
  const source = (node: GraphNode) => {
    const code = getCodeObject(node);
    if (code) {
      const segments = code.path.replaceAll('\\', '/').split('/').filter(Boolean);
      const folders = segments.slice(0, -1).slice(0, 3);
      return [
        part('code', 'Code sources', 'source'),
        ...folders.map((folder, index) =>
          part(`folder:${segments.slice(0, index + 1).join('/')}`, folder, 'source'),
        ),
        part(`file:${code.path}`, segments.at(-1) ?? code.path, 'source'),
      ];
    }
    const csv = getCsvNode(node);
    if (csv)
      return [
        part('data', 'Data sources', 'source'),
        part(`dataset:${csv.datasetId}`, sourceNames.get(csv.datasetId) ?? 'CSV source', 'source'),
        ...csv.path
          .slice(0, 4)
          .map((entry) =>
            part(`column:${entry.columnId}:${entry.value}`, entry.value || '(empty)', 'source'),
          ),
      ];
    const table = getSqlTable(node);
    const query = getSqlQuerySource(node);
    const qualified = table?.qualifiedName ?? query?.qualifiedName;
    if (qualified?.length)
      return [
        part('sql', 'SQL sources', 'source'),
        ...qualified
          .slice(0, -1)
          .slice(0, 3)
          .map((name, index) =>
            part(`schema:${qualified.slice(0, index + 1).join('.')}`, name, 'source'),
          ),
      ];
  };
  return (node: GraphNode): GroupPart[] => {
    const specified =
      grouping === 'groups'
        ? hierarchy(node)
        : grouping === 'tags'
          ? tags(node)
          : grouping === 'source'
            ? source(node)
            : (hierarchy(node) ?? tags(node) ?? source(node));
    if (specified) return specified;
    return [
      part(
        `kind:${node.nodeType}`,
        `${node.nodeType[0].toUpperCase()}${node.nodeType.slice(1)} objects`,
        'kind',
      ),
      part(
        `area:${Math.floor(node.x / 1600)}:${Math.floor(node.y / 1000)}`,
        `Area ${Math.floor(node.x / 1600) + 1}, ${Math.floor(node.y / 1000) + 1}`,
        'area',
      ),
    ];
  };
}
