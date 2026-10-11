import { StorageError } from '../../model/errors';
import type { CollaborationDocument, CollaborationGraph, CollaborationRemap } from './types';
import { validateCollaboration } from './validation';

/** Re-ID annotations together with native document imports; historical missing nodes stay orphaned. */
export function remapCollaboration(
  document: CollaborationDocument,
  remap: CollaborationRemap,
): CollaborationDocument {
  validateCollaboration(document);
  const result = structuredClone(document);
  const mapped = (id: string, map?: ReadonlyMap<string, string>): string => {
    if (!map) return id;
    const value = map.get(id);
    if (!value) throw new StorageError(422, 'Collaboration import identity map is incomplete.');
    return value;
  };
  const node = (id: string) => remap.nodeIds.get(id) ?? id;
  const profile = (id: string) => mapped(id, remap.profileIds);
  for (const item of result.profiles) item.id = profile(item.id);
  for (const thread of result.comments) {
    thread.id = mapped(thread.id, remap.commentIds);
    thread.authorId = profile(thread.authorId);
    if (thread.nodeId) thread.nodeId = node(thread.nodeId);
    if (thread.resolvedBy) thread.resolvedBy = profile(thread.resolvedBy);
    for (const message of thread.messages) {
      message.id = mapped(message.id, remap.messageIds);
      message.authorId = profile(message.authorId);
    }
  }
  for (const task of result.tasks) {
    task.id = mapped(task.id, remap.taskIds);
    task.authorId = profile(task.authorId);
    task.nodeId = node(task.nodeId);
    if (task.assigneeId) task.assigneeId = profile(task.assigneeId);
  }
  for (const event of result.activity) {
    event.id = mapped(event.id, remap.activityIds);
    if (event.authorId) event.authorId = profile(event.authorId);
    if (event.nodeIds) event.nodeIds = event.nodeIds.map(node);
    if (event.entityId) {
      const maps = [
        remap.nodeIds,
        remap.profileIds,
        remap.commentIds,
        remap.messageIds,
        remap.taskIds,
        remap.edgeIds,
      ];
      event.entityId =
        maps.map((map) => map?.get(event.entityId!)).find((id) => id !== undefined) ??
        event.entityId;
    }
  }
  validateCollaboration(result);
  return result;
}

export function remapGraphCollaboration<G extends CollaborationGraph>(
  graph: G,
  remap: CollaborationRemap,
): G {
  if (!graph.diagram.collaboration) return graph;
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      collaboration: remapCollaboration(graph.diagram.collaboration, remap),
    },
  };
}
