import type { Graph, GraphNode, GraphEdge } from '../src/model/types';

export const overviewFixtureId = (kind: number, index: number) =>
  `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
/** Fixed IDs, dates, sources and relationships make the 10,000-object benchmark reproducible. */
export function overviewFixture(size = 10000): Graph {
  const date = '2026-10-06T12:00:00.000Z';
  const base = (kind: number, index: number) => ({
    id: overviewFixtureId(kind, index),
    version: 1,
    createdAt: date,
    updatedAt: date,
  });
  const diagramId = overviewFixtureId(0, 1);
  const nodes: GraphNode[] = Array.from({ length: size }, (_, index) => ({
    ...base(1, index),
    diagramId,
    nodeType: 'generic',
    title: `Object ${index}`,
    description: `Module ${Math.floor(index / 100)} object ${index}`,
    x: (index % 100) * 330,
    y: Math.floor(index / 100) * 145,
    width: 250,
    height: 100,
    ownerIds: [],
    tags: [],
    collapsed: false,
    status: index % 5 === 0 ? 'done' : index % 7 === 0 ? 'blocked' : 'todo',
    color: index % 2 ? '#4260ad' : '#28775e',
    metadata: {
      codeObject: {
        version: 1,
        language: 'typescript',
        path: `src/module-${Math.floor(index / 100)}/logic.ts`,
        kind: 'function',
        name: `fn${index}`,
        line: (index % 100) + 1,
      },
    },
  }));
  const edges: GraphEdge[] = nodes.flatMap((node, index) =>
    [1, 17, 103].map((step, lane) => ({
      ...base(2, index * 3 + lane),
      diagramId,
      sourceNodeId: node.id,
      targetNodeId: nodes[(index + step) % size].id,
      label: lane === 0 ? 'Next stage' : lane === 1 ? 'Calls service' : 'Reads records',
      edgeType: lane === 0 ? 'workflow' : lane === 1 ? 'code-calls' : 'reads',
      direction: lane === 2 ? 'both' : 'forward',
      style: lane === 2 ? 'dashed' : 'solid',
      metadata: {},
    })),
  );
  return {
    format: 'visual-nerve',
    formatVersion: 1,
    diagram: {
      ...base(0, 1),
      name: 'Reproducible large overview',
      type: 'process',
      favorite: false,
      tags: [],
      metadata: {},
      settings: {
        grid: true,
        snap: false,
        overview: { version: 1, enabled: true, grouping: 'auto', expanded: [] },
      },
    },
    nodes,
    edges,
    owners: [],
  };
}
