import type { Graph, Owner } from '../model/types';

const bookkeeping = new Set(['version', 'createdAt', 'updatedAt']);
const content = (value: object) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !bookkeeping.has(key)));
/** Saves acknowledge new versions; remote edits must still cancel a frozen movie. */
export function videoGraphFingerprint(graph: Graph | null, owners?: Owner[]) {
  if (!graph) return '';
  const settings = Object.fromEntries(
    Object.entries(graph.diagram.settings).filter(([key]) => key !== 'viewport'),
  );
  const usedOwners = new Set(
    graph.nodes.flatMap((node) => [...node.ownerIds, ...(node.ownerId ? [node.ownerId] : [])]),
  );
  return JSON.stringify([
    { ...content(graph.diagram), settings },
    graph.nodes.map(content),
    graph.edges.map(content),
    (owners ?? graph.owners).filter((owner) => usedOwners.has(owner.id)).map(content),
  ]);
}
