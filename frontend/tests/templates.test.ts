import { expect, it } from 'vitest';
import { instantiate, templates } from '../src/templates/templates';
import { nodeTypes } from '../src/nodes/registry';
import { nodeKinds } from '../src/model/types';
it('provides all ten normal canonical templates and fresh identities', () => {
  expect(templates).toHaveLength(10);
  for (const template of templates) {
    const first = instantiate(template.key, 'A'),
      second = instantiate(template.key, 'B');
    expect(first.format).toBe('visual-nerve');
    expect(first.diagram.id).not.toBe(second.diagram.id);
    const ids = new Set(first.nodes.map((n) => n.id));
    for (const e of first.edges) {
      expect(ids.has(e.sourceNodeId)).toBe(true);
      expect(ids.has(e.targetNodeId)).toBe(true);
    }
    for (const n of first.nodes) {
      expect(n.diagramId).toBe(first.diagram.id);
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
      for (const id of n.ownerIds) expect(first.owners.some((o) => o.id === id)).toBe(true);
    }
  }
});
it('registers every canonical node kind through the reusable renderer registry', () => {
  expect(Object.keys(nodeTypes)).toEqual(expect.arrayContaining([...nodeKinds]));
  expect(nodeTypes['mindmap-topic']).toBeDefined();
});
