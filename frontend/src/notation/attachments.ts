import type { GraphNode } from '../model/types';

function addOwned(map: Map<string, string[]>, host: string, id: string) {
  const children = map.get(host);
  if (children) children.push(id);
  else map.set(host, [id]);
}
/** Ownership follows native group contents and attached glyphs; ordinary hierarchy links stay independent. */
export function notationOwnedIds(
  nodes: readonly GraphNode[],
  selected: Iterable<string>,
  includeHosts = false,
): Set<string> {
  const result = new Set(selected),
    byId = new Map(nodes.map((node) => [node.id, node])),
    children = new Map<string, string[]>(),
    attached = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId) addOwned(children, node.parentId, node.id);
    if (node.notation?.attachmentId) addOwned(attached, node.notation.attachmentId, node.id);
  }
  const queue = [...result].map((id) => ({ id, descendants: byId.get(id)?.nodeType === 'group' })),
    visited = new Map<string, number>();
  for (let index = 0; index < queue.length; index++) {
    const { id, descendants } = queue[index],
      mask = descendants ? 3 : 1,
      prior = visited.get(id) ?? 0;
    if ((prior & mask) === mask) continue;
    visited.set(id, prior | mask);
    const enqueue = (child: string, native = false) => {
      result.add(child);
      queue.push({ id: child, descendants: native || byId.get(child)?.nodeType === 'group' });
    };
    if (descendants) for (const child of children.get(id) ?? []) enqueue(child, true);
    for (const child of attached.get(id) ?? []) enqueue(child);
    const host = includeHosts && byId.get(id)?.notation?.attachmentId;
    if (host) enqueue(host);
  }
  return result;
}
/** Add host-relative canonical translations, retaining explicit moves and never translating a member twice. */
export function notationAttachmentMoves(
  nodes: readonly GraphNode[],
  moves: ReadonlyMap<string, Partial<GraphNode>>,
  skipped: ReadonlySet<string> = new Set(),
): Map<string, Partial<GraphNode>> {
  const result = new Map(moves),
    byId = new Map(nodes.map((node) => [node.id, node])),
    children = new Map<string, string[]>(),
    attached = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId) addOwned(children, node.parentId, node.id);
    if (node.notation?.attachmentId) addOwned(attached, node.notation.attachmentId, node.id);
  }
  const queue = [...result.keys()].map((id) => ({
      id,
      descendants: byId.get(id)?.nodeType === 'group',
    })),
    visited = new Map<string, number>();
  for (let index = 0; index < queue.length; index++) {
    const { id, descendants } = queue[index],
      node = byId.get(id),
      patch = result.get(id),
      mask = descendants ? 3 : 1,
      prior = visited.get(id) ?? 0;
    if (!node || !patch || skipped.has(id) || (prior & mask) === mask) continue;
    visited.set(id, prior | mask);
    const dx = (patch.x ?? node.x) - node.x,
      dy = (patch.y ?? node.y) - node.y;
    if (!dx && !dy) continue;
    const translate = (child: string, native = false) => {
      const original = byId.get(child),
        existing = result.get(child);
      if (!original || skipped.has(child)) return;
      if (existing?.x === undefined && existing?.y === undefined)
        result.set(child, { ...existing, x: original.x + dx, y: original.y + dy });
      queue.push({ id: child, descendants: native || original.nodeType === 'group' });
    };
    if (descendants) for (const child of children.get(id) ?? []) translate(child, true);
    for (const child of attached.get(id) ?? []) translate(child);
  }
  return result;
}
