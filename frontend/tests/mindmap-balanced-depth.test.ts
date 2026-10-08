import { describe, expect, it } from 'vitest';
import { balancedMindmap } from '../src/mindmap/tree';
import { layoutGraph } from '../src/layouts/layout';
import { blankGraph, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';

describe('balanced mind-map layout preserves order and handles deep valid trees', () => {
  it('retains exact sibling spacing, DFS insertion order, multiple roots and grouped contents', () => {
    const graph = blankGraph('Balanced geometry', 'mindmap');
    const topic = (title: string, width: number, height: number, parentId?: string) =>
      newNode(graph.diagram.id, { title, width, height, parentId });
    const root = newNode(graph.diagram.id, {
      title: 'First root',
      x: 100,
      y: 200,
      width: 200,
      height: 80,
    });
    const right = topic('Right branch', 110, 50, root.id);
    const left = topic('Left branch', 160, 120, root.id);
    const nextRight = topic('Next right branch', 140, 40, root.id);
    const firstLeaf = topic('First leaf', 90, 90, right.id);
    const nextLeaf = topic('Next leaf', 80, 60, right.id);
    const rightLeaf = topic('Right leaf', 100, 100, nextRight.id);
    const leftLeaf = topic('Left leaf', 80, 80, left.id);
    const otherRoot = newNode(graph.diagram.id, {
      title: 'Second root',
      x: -400,
      y: -200,
      width: 180,
      height: 100,
    });
    const otherRight = topic('Second root right', 120, 80, otherRoot.id);
    const otherLeft = topic('Second root left', 100, 40, otherRoot.id);
    const group = newNode(graph.diagram.id, { title: 'Manual group', nodeType: 'group' });
    const grouped = topic('Manual topic', 150, 80, group.id);
    const groupedChild = topic('Manual child', 100, 60, grouped.id);
    graph.nodes = [
      root,
      right,
      left,
      nextRight,
      firstLeaf,
      nextLeaf,
      rightLeaf,
      leftLeaf,
      otherRoot,
      otherRight,
      otherLeft,
      group,
      grouped,
      groupedChild,
    ];
    validateGraph(graph);
    const before = structuredClone(graph);
    expect([...balancedMindmap(graph.nodes)]).toEqual([
      [root.id, { x: 100, y: 200 }],
      [right.id, { x: 396, y: 153 }],
      [firstLeaf.id, { x: 602, y: 91 }],
      [nextLeaf.id, { x: 602, y: 205 }],
      [nextRight.id, { x: 396, y: 319 }],
      [rightLeaf.id, { x: 632, y: 289 }],
      [left.id, { x: -156, y: 180 }],
      [leftLeaf.id, { x: -332, y: 200 }],
      [otherRoot.id, { x: -400, y: 509 }],
      [otherRight.id, { x: -124, y: 519 }],
      [otherLeft.id, { x: -596, y: 539 }],
    ]);
    expect(graph).toEqual(before);
  });

  it.each([false, true])('lays out a valid 6,000-level map (reversed: %s)', async (reversed) => {
    const graph = blankGraph('Deep balanced map', 'mindmap');
    for (let depth = 0; depth < 6000; depth++)
      graph.nodes.push(
        newNode(graph.diagram.id, {
          title: `Topic ${depth}`,
          parentId: graph.nodes.at(-1)?.id,
          x: 40,
          y: 100,
          width: 180,
          height: 60,
        }),
      );
    const chain = [...graph.nodes];
    if (reversed) graph.nodes.reverse();
    validateGraph(graph);
    const before = structuredClone(graph);
    const positions = await layoutGraph(graph, 'BALANCED');
    expect(positions.size).toBe(chain.length);
    expect([...positions.keys()]).toEqual(chain.map((node) => node.id));
    for (let depth = 0; depth < chain.length; depth++)
      expect(positions.get(chain[depth].id)).toEqual({ x: 40 + depth * 276, y: 100 });
    expect(graph).toEqual(before);
  });
});
