import type { GraphNode } from '../model/types';

/** Attached glyphs belong to their host. Linked classifiers/modules remain independent. */
export class NotationLifecycle {
  static deletionIds(nodes: readonly GraphNode[], selected: ReadonlySet<string>): Set<string> {
    const result = new Set(selected);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes)
        if (
          node.notation?.attachmentId &&
          result.has(node.notation.attachmentId) &&
          !result.has(node.id)
        ) {
          result.add(node.id);
          changed = true;
        }
    }
    return result;
  }
  static remainingNodes(nodes: readonly GraphNode[], removed: ReadonlySet<string>): GraphNode[] {
    return nodes
      .filter((node) => !removed.has(node.id))
      .map((node) => ({
        ...node,
        ...(node.parentId && removed.has(node.parentId) ? { parentId: undefined } : {}),
        ...(node.notation?.relatedNodeId && removed.has(node.notation.relatedNodeId)
          ? { notation: { ...node.notation, relatedNodeId: undefined } }
          : {}),
      }));
  }
}
