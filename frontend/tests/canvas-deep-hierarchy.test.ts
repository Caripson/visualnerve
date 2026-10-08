import { describe, expect, it } from 'vitest';
import { projectGraph } from '../src/canvas/projection';
import { blankGraph, emptyFilters, newNode, type DiagramType } from '../src/model/types';

function chain(type: DiagramType, count = 6000) {
  const graph = blankGraph('Deep hierarchy', type);
  for (let index = 0; index < count; index++)
    graph.nodes.push(
      newNode(graph.diagram.id, {
        title: `Topic ${index}`,
        parentId: graph.nodes[index - 1]?.id,
        x: index * 2,
        y: index,
      }),
    );
  graph.nodes.reverse();
  return graph;
}

describe('deep valid native hierarchies', () => {
  it.each(['flowchart', 'mindmap'] as const)(
    'projects a reversed 6000-level %s without overflowing',
    (type) => {
      const graph = chain(type);
      const projected = projectGraph(graph, []);
      expect(projected.nodes).toHaveLength(6000);
      expect(projected.nodes.every((node) => !node.hidden)).toBe(true);
      if (type === 'mindmap') expect(projected.nodes[0].data.mindmap?.depth).toBe(5999);
    },
  );

  it('respects collapsed branches while export and exploration expose their unchanged contents', () => {
    const graph = chain('flowchart');
    const collapsed = graph.nodes[graph.nodes.length - 2];
    collapsed.collapsed = true;
    const original = structuredClone(graph);
    const projected = projectGraph(graph, []);
    expect(projected.nodes.filter((node) => node.hidden)).toHaveLength(5998);
    expect(projected.nodes.find((node) => node.id === collapsed.id)!.hidden).toBe(false);
    expect(
      projectGraph(graph, [], [], [], emptyFilters, true).nodes.every((node) => !node.hidden),
    ).toBe(true);
    expect(
      projectGraph(
        graph,
        [],
        [],
        [],
        emptyFilters,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          nodeIds: graph.nodes.map((node) => node.id),
          edgeIds: [],
          totalNodes: graph.nodes.length,
          truncated: false,
          found: true,
          outsideViewIds: [],
          outsideViewEdgeIds: [],
        },
      ).nodes.every((node) => !node.hidden),
    ).toBe(true);
    expect(graph).toEqual(original);
  });
});
