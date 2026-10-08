import { expect, it } from 'vitest';
import { markdown } from '../src/export/semantic';
import { blankGraph, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';

it('exports every level of a valid deeply nested mind map without exhausting the JavaScript stack', () => {
  const graph = blankGraph('Deep imported hierarchy', 'mindmap');
  let parentId: string | undefined;
  for (let index = 0; index < 6_000; index++) {
    const node = newNode(graph.diagram.id, {
      title: `Step ${index}`,
      description: `Description ${index}`,
      parentId,
    });
    graph.nodes.push(node);
    parentId = node.id;
  }
  expect(() => validateGraph(graph)).not.toThrow();
  const before = JSON.stringify(graph);
  const output = markdown(graph);
  expect(output.match(/^#{2,6} Step \d+$/gm)).toHaveLength(6_000);
  expect(output).toContain('Description 5999');
  expect(output.indexOf('Step 5998\n')).toBeLessThan(output.indexOf('Step 5999\n'));
  expect(JSON.stringify(graph)).toBe(before);
});
