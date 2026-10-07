import { expect, it } from 'vitest';
import { instantiate, templates } from '../src/templates/templates';
import { nodeTypes } from '../src/nodes/registry';
import { nodeKinds } from '../src/model/types';
it('provides all canonical templates, a guided empty simulator and fresh identities', () => {
  expect(templates).toHaveLength(12);
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
it('separates guided simulation setup from the existing bundled kiosk example', () => {
  const blank = instantiate('process-simulator-blank', 'My own process');
  const example = instantiate('process-simulator', 'Kiosk');
  expect(blank.diagram.type).toBe('process-simulator');
  expect(blank.simulation).toMatchObject({
    type: 'process-simulator',
    schemaVersion: 1,
    nodes: [],
    edges: [],
  });
  expect(example.simulation!.resources.length).toBeGreaterThan(1);
  expect(example.simulation!.scenarios.length).toBeGreaterThan(0);
});
it('registers every canonical node kind through the reusable renderer registry', () => {
  expect(Object.keys(nodeTypes)).toEqual(expect.arrayContaining([...nodeKinds]));
  expect(nodeTypes['mindmap-topic']).toBeDefined();
});
