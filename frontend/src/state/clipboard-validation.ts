import { blankGraph, nodeKinds } from '../model/types';
import { StorageError } from '../model/errors';
import { validateGraphFields } from '../model/validation';
import type { Clip } from './clipboard';

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new StorageError(422, message);
};

/** Validate clipboard topology before UUID remapping or any editor command can change the graph. */
export function validateClipboardTopology(value: unknown): asserts value is Clip {
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid diagram clipboard.',
  );
  const clip = value as Clip;
  requireValue(
    clip.format === 'visual-nerve-clipboard' &&
      Array.isArray(clip.nodes) &&
      Array.isArray(clip.edges),
    'Unsupported diagram clipboard.',
  );
  validateGraphFields({
    ...blankGraph('Clipboard validation'),
    nodes: clip.nodes,
    edges: clip.edges,
  });
  const nodes = new Map(clip.nodes.map((node) => [node.id, node]));
  requireValue(nodes.size === clip.nodes.length, 'Duplicate clipboard node id.');
  for (const node of clip.nodes) {
    requireValue(typeof node.id === 'string' && uuid.test(node.id), 'Invalid clipboard node id.');
    requireValue(nodeKinds.includes(node.nodeType), 'Unsupported clipboard node type.');
    requireValue(
      typeof node.title === 'string' && node.title.trim() && node.title.length <= 1000,
      'Invalid clipboard node title.',
    );
    requireValue(
      [node.x, node.y, node.width, node.height].every(
        (coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= 1e8,
      ) &&
        node.width >= 40 &&
        node.height >= 30,
      'Invalid clipboard node geometry.',
    );
    requireValue(!node.parentId || uuid.test(node.parentId), 'Invalid clipboard parent id.');
  }
  const visited = new Set<string>();
  for (const node of clip.nodes) {
    const path = new Set<string>();
    let current = node;
    while (!visited.has(current.id)) {
      requireValue(!path.has(current.id), 'Clipboard parent hierarchy contains a cycle.');
      path.add(current.id);
      const parent = current.parentId ? nodes.get(current.parentId) : undefined;
      // Older clips of a selected child retain its outside parent. Pasting detaches that reference.
      if (!parent) break;
      current = parent;
    }
    for (const id of path) visited.add(id);
  }
  const edges = new Set<string>();
  for (const edge of clip.edges) {
    requireValue(
      typeof edge.id === 'string' && uuid.test(edge.id),
      'Invalid clipboard connection id.',
    );
    requireValue(!edges.has(edge.id), 'Duplicate clipboard connection id.');
    edges.add(edge.id);
    requireValue(
      typeof edge.sourceNodeId === 'string' &&
        typeof edge.targetNodeId === 'string' &&
        nodes.has(edge.sourceNodeId) &&
        nodes.has(edge.targetNodeId),
      'Clipboard connection refers to a missing node.',
    );
    requireValue(
      ['forward', 'backward', 'both', 'none'].includes(edge.direction) &&
        ['solid', 'dashed', 'dotted'].includes(edge.style) &&
        typeof edge.edgeType === 'string',
      'Invalid clipboard connection style.',
    );
  }
}
