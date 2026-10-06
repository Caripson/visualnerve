import { exploreRelationships, type RelationshipGraph } from './relationships';
import type { RelationshipExploration } from './types';
self.onmessage = (
  event: MessageEvent<{ id: number; graph: RelationshipGraph; config: RelationshipExploration }>,
) => {
  try {
    self.postMessage({
      id: event.data.id,
      result: exploreRelationships(event.data.graph, event.data.config),
    });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: (error as Error).message });
  }
};
