import type { VaultJournalScope } from './vault-journal';
import type { WorkspaceStorage } from '../storage/contracts';
/** Internal nonserializable capability; it does not add a logical table/API route. */
const bindings = new WeakMap<
  WorkspaceStorage,
  <T>(work: (scope: VaultJournalScope) => Promise<T>) => Promise<T>
>();
export function bindCollaborationJournal(
  storage: WorkspaceStorage,
  run: <T>(work: (scope: VaultJournalScope) => Promise<T>) => Promise<T>,
) {
  bindings.set(storage, run);
}
export function withCollaborationJournal<T>(
  storage: WorkspaceStorage,
  work: (scope: VaultJournalScope) => Promise<T>,
): Promise<T> {
  const bound = bindings.get(storage);
  if (!bound || !storage.inTransaction)
    throw new Error('A shared document must commit through its encrypted workspace transaction.');
  return bound(work);
}
