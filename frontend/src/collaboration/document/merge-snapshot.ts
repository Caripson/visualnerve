import type { Graph } from '../../model/types';
import { CollaborativeDocument, CollaborationDocumentError } from './document';
import { type CollaborationShareScope } from './scope';

/**
 * The caller must first authenticate a fresh device and verify the exact prior
 * room, diagram and scope association. No MLS state or credentials are restored.
 * This returns a validated candidate; the caller persists it with the graph in
 * its original vault journal before publishing or sending any shared changes.
 */
export function mergeCollaborationSnapshot(
  ownerGraph: Graph,
  ownerNative: Uint8Array,
  localSaved: Graph,
  priorNative: Uint8Array,
  scope: CollaborationShareScope,
  rebaseLocalChanges = true,
): { graph: Graph; state: Uint8Array } {
  if (ownerGraph.diagram.id !== localSaved.diagram.id)
    throw new CollaborationDocumentError(
      'COLLABORATION_DOCUMENT_MISMATCH',
      'The owner snapshot belongs to another document or sharing scope.',
    );
  const owner = new CollaborativeDocument(ownerGraph, scope, ownerNative);
  let prior: CollaborativeDocument | undefined;
  let merged: CollaborativeDocument | undefined;
  try {
    // A former Editor may have unpublished changes in the prior CRDT itself.
    // A newly approved Viewer cannot merge those changes into the shared state.
    if (!rebaseLocalChanges) return { graph: owner.graph(localSaved), state: owner.encodedState() };
    prior = new CollaborativeDocument(localSaved, scope, priorNative);
    const previous = prior.graph(localSaved);
    const accepted = prior.mergeNativeSnapshot(owner.encodedState(), localSaved);
    if (!prior.hasSharedChanges(previous, localSaved)) return accepted;
    merged = new CollaborativeDocument(accepted.graph, scope, accepted.state);
    const rebased = merged.prepareLocal(previous, localSaved, {
      canWrite: true,
      assertActive() {},
    });
    return { graph: rebased.graph, state: rebased.state };
  } finally {
    merged?.destroy();
    prior?.destroy();
    owner.destroy();
  }
}
