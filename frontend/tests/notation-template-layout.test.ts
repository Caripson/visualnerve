import { describe, expect, it } from 'vitest';
import { createNotationGraph, notationTemplates } from '../src/notation/templates';
import { notationGeometry } from '../src/notation/geometry';

it('lets every new notation starting set follow Appearance instead of saving a pale custom fill', () => {
  for (const template of notationTemplates) {
    const graph = createNotationGraph(template.key, 'Theme-aware example')!;
    expect(graph.nodes.length).toBeGreaterThan(0);
    for (const node of graph.nodes)
      expect(node.backgroundColor, `${template.key}: ${node.title}`).toBeUndefined();
  }
});

describe('readable BPMN example containment', () => {
  it.each(['bpmn-process', 'bpmn-collaboration'])(
    '%s keeps its contents clear of participant title strips',
    (key) => {
      const graph = createNotationGraph(key, 'Layout acceptance')!;
      const containers = graph.nodes.filter(
        (node) => node.notation?.symbol === 'pool' || node.notation?.symbol === 'lane',
      );
      expect(containers.length).toBeGreaterThan(0);
      let checked = 0;
      for (const container of containers) {
        // The example reserves these published header fractions independently of rendering.
        const headerFraction = container.notation!.symbol === 'pool' ? 0.04 : 0.06;
        const headerEnd = container.x + container.width * headerFraction;
        const title = notationGeometry(container.notation!).contentBox;
        expect(title.x + title.width).toBeLessThanOrEqual(headerFraction);
        for (const child of graph.nodes.filter((node) => node.parentId === container.id)) {
          expect(child.x, `${child.title} overlaps ${container.title}'s header`).toBeGreaterThan(
            headerEnd,
          );
          expect(child.y).toBeGreaterThanOrEqual(container.y);
          expect(child.x + child.width).toBeLessThanOrEqual(container.x + container.width);
          expect(child.y + child.height).toBeLessThanOrEqual(container.y + container.height);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    },
  );
});
