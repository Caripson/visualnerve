import { expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { layoutGraph, timelineGeometry } from '../src/layouts/layout';
it('ELK supports four explicit directions without changing relationships', async () => {
  const g = blankGraph('Flow');
  const a = newNode(g.diagram.id);
  const b = newNode(g.diagram.id);
  g.nodes = [a, b];
  g.edges = [newEdge(g.diagram.id, a.id, b.id)];
  for (const direction of ['RIGHT', 'LEFT', 'UP', 'DOWN'] as const) {
    const positions = await layoutGraph(g, direction);
    const p = positions.get(a.id)!;
    const q = positions.get(b.id)!;
    expect(
      direction === 'RIGHT'
        ? p.x < q.x
        : direction === 'LEFT'
          ? p.x > q.x
          : direction === 'UP'
            ? p.y > q.y
            : p.y < q.y,
    ).toBe(true);
  }
  expect(g.nodes[0].x).toBe(0);
});
it('radial hierarchy and timeline use semantic data', async () => {
  const g = blankGraph('Map', 'mindmap');
  const root = newNode(g.diagram.id);
  const child = newNode(g.diagram.id, { parentId: root.id });
  g.nodes = [root, child];
  const positions = await layoutGraph(g, 'RADIAL');
  expect(positions.get(root.id)).not.toEqual(positions.get(child.id));
  const dates = [
    newNode(g.diagram.id, { startDate: '2026-01-01', endDate: '2026-01-08' }),
    newNode(g.diagram.id, { startDate: '2026-01-15' }),
  ];
  const timeline = timelineGeometry(dates, 'week');
  expect(timeline.positions.get(dates[0].id)!.x).toBeLessThan(
    timeline.positions.get(dates[1].id)!.x,
  );
  expect(timeline.positions.get(dates[0].id)!.width).toBeGreaterThan(0);
  expect(timeline.positions.get(dates[1].id)!.y).toBe(0);
});
