import type { WorkspaceStorage } from '../storage/contracts';
import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';

export interface PreparedSharedSave {
  readonly graph: Graph;
  /** Called only after the authoritative local graph transaction succeeds. */
  committed(saved: Graph): void;
  cancelled?(): void;
}
export interface SharedDocumentPort {
  prepareLocal(
    before: Graph,
    requested: Graph,
    storage: WorkspaceStorage,
  ): Promise<PreparedSharedSave>;
}

/** Optional ports, not a second repository. All UI/API/MCP graph writes pass here. */
export class CollaborationDocumentHooks {
  private documents = new Map<string, SharedDocumentPort>();

  bind(diagramId: string, port: SharedDocumentPort): () => void {
    if (this.documents.has(diagramId))
      throw new StorageError(409, 'The shared document already has a mutation controller.');
    this.documents.set(diagramId, port);
    return () => {
      if (this.documents.get(diagramId) === port) this.documents.delete(diagramId);
    };
  }

  get(diagramId: string): SharedDocumentPort | undefined {
    return this.documents.get(diagramId);
  }
}

export const collaborationDocumentHooks = new CollaborationDocumentHooks();
