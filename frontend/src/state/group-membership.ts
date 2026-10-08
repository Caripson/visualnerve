import type { GraphNode } from '../model/types';

/** Removing nested containers promotes members to the nearest surviving parent. */
export class GroupMembership {
  private nodes: Map<string, GraphNode>;
  private parents = new Map<string, string | undefined>();

  constructor(
    nodes: GraphNode[],
    private removed: Set<string>,
  ) {
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
  }

  survivingParent(id?: string): string | undefined {
    const path: string[] = [];
    while (id && this.removed.has(id)) {
      if (this.parents.has(id)) {
        id = this.parents.get(id);
        break;
      }
      path.push(id);
      id = this.nodes.get(id)?.parentId;
    }
    for (const ancestor of path) this.parents.set(ancestor, id);
    return id;
  }

  ungroup(): GraphNode[] {
    return [...this.nodes.values()]
      .filter((node) => !this.removed.has(node.id))
      .map((node) =>
        node.parentId && this.removed.has(node.parentId)
          ? { ...node, parentId: this.survivingParent(node.parentId) }
          : node,
      );
  }
}
