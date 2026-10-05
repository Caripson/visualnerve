import { expect, it } from 'vitest';
import { parseImport, markdown } from '../src/export/semantic';
import { blankGraph, newNode, newEdge, base } from '../src/model/types';
it('imports nested headings and lists as hierarchy', () => {
  const g = parseImport('markdown', '# Root\n## A\n### A1\n## B\n- One\n  - Two');
  expect(g.nodes).toHaveLength(6);
  expect(g.nodes[2].parentId).toBe(g.nodes[1].id);
  expect(g.nodes[5].parentId).toBe(g.nodes[4].id);
  expect(g.edges).toHaveLength(5);
});
it('parses quoted multiline CSV and normalized owners', () => {
  const g = parseImport(
    'csv',
    'title,description,owner,tags\n"Review, legal","First\nSecond",Johan,legal;launch\nLaunch,Ready,Johan,launch',
  );
  expect(g.nodes[0].title).toBe('Review, legal');
  expect(g.nodes[0].description).toContain('\n');
  expect(g.owners).toHaveLength(1);
  expect(g.nodes[0].ownerId).toBe(g.nodes[1].ownerId);
});
it('exports semantic dependency order and complete JSON roundtrip', () => {
  const g = blankGraph('Launch', 'process');
  const owner = {
    ...base(),
    name: 'Johan',
    kind: 'person' as const,
    color: '#31766c',
    metadata: {},
  };
  g.owners = [owner];
  const a = newNode(g.diagram.id, {
    title: 'Research',
    ownerIds: [owner.id],
    x: 999,
    metadata: { x: { y: 3 } },
  });
  const b = newNode(g.diagram.id, { title: 'Build', x: 0 });
  g.nodes = [b, a];
  g.edges = [newEdge(g.diagram.id, a.id, b.id)];
  const text = markdown(g);
  expect(text.indexOf('Research')).toBeLessThan(text.indexOf('Build'));
  expect(text).toContain('Owner: Johan');
  expect(parseImport('json', JSON.stringify(g))).toEqual(g);
});
it('uses the root heading once and preserves cross-branch relationships in a mind map', () => {
  const g = parseImport('markdown', '# Product launch\n## Research\n### Competitors\n## Build');
  g.edges.push(newEdge(g.diagram.id, g.nodes[2].id, g.nodes[3].id, { label: 'informs' }));
  g.edges.push(newEdge(g.diagram.id, g.nodes[0].id, g.nodes[2].id, { label: 'prioritizes' }));
  const text = markdown(g);
  expect(text.match(/^# Product launch$/gm)).toHaveLength(1);
  expect(text).not.toMatch(/^## Product launch$/m);
  expect(text).toMatch(/^## Research$/m);
  expect(text).toMatch(/^### Competitors$/m);
  expect(text).toContain('Next:\n- Build');
  expect(text).toContain('Next:\n- Competitors');
});
