import type { Graph } from '../model/types';
import { exploreRelationships, relationshipGraph } from './relationships';
import type { ExplorationResult, RelationshipExploration } from './types';
let worker: Worker | undefined;
let serial = 0;
const pending = new Map<
  number,
  {
    resolve: (value: ExplorationResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export async function exploreRelationshipsAsync(
  graph: Graph,
  config: RelationshipExploration,
): Promise<ExplorationResult> {
  const input = relationshipGraph(graph);
  if (typeof Worker === 'undefined') return exploreRelationships(input, config);
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(event.data.id);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.result);
    };
    worker.onerror = () => stop(new Error('Relationship analysis could not finish. Try again.'));
  }
  const id = ++serial;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      timer: setTimeout(
        () => stop(new Error('Relationship analysis timed out. Try a smaller exploration.')),
        10_000,
      ),
    });
    try {
      worker!.postMessage({ id, graph: input, config });
    } catch (error) {
      stop(error as Error);
    }
  });
}
function stop(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}
