import { expect, it } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { videoGraphFingerprint } from '../src/presentation/video-graph';

it('ignores save acknowledgements and 2D viewport bookkeeping while detecting external content edits', () => {
  const graph = blankGraph('Truck');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build truck', description: 'Build it safely.' }),
  ];
  const before = videoGraphFingerprint(graph);
  const saved = structuredClone(graph);
  saved.diagram.version++;
  saved.diagram.updatedAt = 'later';
  saved.nodes[0].version++;
  saved.nodes[0].updatedAt = 'later';
  saved.diagram.settings.viewport = { x: 30, y: 20, zoom: 1 };
  expect(videoGraphFingerprint(saved)).toBe(before);
  for (const patch of [
    { title: 'Deliver truck' },
    { description: 'Remote edit' },
    { x: 999 },
    { color: '#ff0000' },
  ]) {
    const changed = structuredClone(saved);
    Object.assign(changed.nodes[0], patch);
    expect(videoGraphFingerprint(changed)).not.toBe(before);
  }
  saved.diagram.settings.presentation = {
    version: 1,
    nodeIds: [graph.nodes[0].id],
    secondsPerNode: 8,
    transitionMs: 500,
  };
  expect(videoGraphFingerprint(saved)).not.toBe(before);
});
