import type { Graph } from '../model/types';

interface BackupGraphIdentity {
  nodes: Map<string, string>;
  edges: Map<string, string>;
}

export interface BackupGraphMapping {
  sourceGraph: Graph;
  importedGraph: Graph;
  identity?: BackupGraphIdentity;
}

/** Seed a restore's identity maps with its live graph. Archive importers add missing IDs. */
export function backupGraphIdentity(source: Graph, imported: Graph): BackupGraphIdentity {
  const pair = (before: readonly { id: string }[], after: readonly { id: string }[]) =>
    new Map(
      before.flatMap(({ id }, index) => (after[index] ? [[id, after[index].id] as const] : [])),
    );
  return { nodes: pair(source.nodes, imported.nodes), edges: pair(source.edges, imported.edges) };
}
