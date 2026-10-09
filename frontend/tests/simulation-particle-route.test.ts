import { describe, expect, it } from 'vitest';
import { ParticleRoute } from '../src/simulation/particle-route';

describe('bounded composable business route summaries', () => {
  it('preserves exact short route labels and unique Work attribution', () => {
    const parent = new ParticleRoute();
    parent.appendEdge('start');
    const child = new ParticleRoute();
    child.appendEdge('task', 'work');
    child.appendEdge('return', 'work');
    parent.append(child);
    parent.appendEdge('finish');
    expect(parent.label()).toBe('start → task → return → finish');
    expect(parent.edgeCount).toBe(4);
    expect([...parent.workNodeIds]).toEqual(['work']);
    expect(child.label()).toBe('task → return');
  });
  it('composes the same ordered digest and Unicode prefix as an ungrouped long route', () => {
    const flat = new ParticleRoute();
    const grouped = new ParticleRoute();
    grouped.append(new ParticleRoute());
    for (let group = 0; group < 8; group++) {
      const segment = new ParticleRoute();
      for (let step = 0; step < 40; step++) {
        const id = `delivery-${group}-${step}-åäö-🚛-long-route`;
        flat.appendEdge(id, `work-${step % 3}`);
        segment.appendEdge(id, `work-${step % 3}`);
      }
      grouped.append(segment);
    }
    expect(grouped.label()).toBe(flat.label());
    expect(grouped.label()).toContain('[route:');
    expect(grouped.edgeCount).toBe(320);
    expect([...grouped.workNodeIds]).toEqual([...flat.workNodeIds]);
    expect(grouped.retainedCharacters).toBe(ParticleRoute.labelLimit);
  });
  it('retains bounded text when nested shared paths represent over sixteen million edges', () => {
    const leaf = new ParticleRoute();
    for (let index = 0; index < 4000; index++) leaf.appendEdge(`edge-${index}`, 'shared-work');
    const inner = new ParticleRoute();
    for (let branch = 0; branch < 64; branch++) inner.append(leaf);
    const outer = new ParticleRoute();
    for (let branch = 0; branch < 64; branch++) outer.append(inner);
    expect(outer.edgeCount).toBe(16384000);
    expect(outer.retainedCharacters).toBe(2000);
    expect(outer.label().length).toBeLessThan(300);
    expect(outer.label()).toContain('edges=16384000');
    expect([...outer.workNodeIds]).toEqual(['shared-work']);
  });
  it('distinguishes ordered differences beyond the retained prefix', () => {
    const left = new ParticleRoute();
    const right = new ParticleRoute();
    for (let index = 0; index < 400; index++) {
      left.appendEdge(`shared-prefix-${index}`);
      right.appendEdge(`shared-prefix-${index}`);
    }
    left.appendEdge('left');
    right.appendEdge('right');
    expect(left.label().slice(0, 200)).toBe(right.label().slice(0, 200));
    expect(left.label()).not.toBe(right.label());
  });
});
