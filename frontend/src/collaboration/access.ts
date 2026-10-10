import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';

export type SharedRole = 'owner' | 'editor' | 'viewer';
export interface SharedAccess {
  readonly role: SharedRole;
  /** Revocable vault lease and live session generation, checked at each write. */
  check(): void;
  hasSharedChanges(before: Graph, after: Graph): boolean;
  undo?(): boolean;
  redo?(): boolean;
}
export class CollaborationAccessError extends StorageError {
  readonly code = 'COLLABORATION_READ_ONLY';
  constructor() {
    super(403, 'This shared diagram is read only. Ask its owner for editing permission.');
  }
}

/** Internal projection capability. A JSON/API caller cannot manufacture one. */
export interface SharedProjectionAuthority {
  readonly diagramId: string;
}
const projections = new WeakMap<SharedProjectionAuthority, () => void>();

export class CollaborationPermissions {
  private bindings = new Map<string, SharedAccess>();

  bind(diagramId: string, access: SharedAccess): () => void {
    if (this.bindings.has(diagramId))
      throw new StorageError(409, 'This diagram already has an active collaboration session.');
    this.bindings.set(diagramId, access);
    return () => {
      if (this.bindings.get(diagramId) === access) this.bindings.delete(diagramId);
    };
  }

  role(diagramId: string): SharedRole | undefined {
    return this.bindings.get(diagramId)?.role;
  }

  assertDetached(diagramId?: string): void {
    if (diagramId ? this.bindings.has(diagramId) : this.bindings.size > 0)
      throw new StorageError(
        409,
        'Leave the active collaboration room before deleting its diagram, changing a referenced owner profile, or replacing the workspace.',
      );
  }

  assertWrite(
    diagramId: string,
    before?: Graph,
    after?: Graph,
    projection?: SharedProjectionAuthority,
  ): void {
    const access = this.bindings.get(diagramId);
    if (!access) return;
    access.check();
    if (projection?.diagramId === diagramId && projections.has(projection)) {
      projections.get(projection)!();
      return;
    }
    if (access.role === 'viewer' && (!before || !after || access.hasSharedChanges(before, after)))
      throw new CollaborationAccessError();
  }

  /** Called only by the session controller after authenticated MLS/ACL validation. */
  projection(diagramId: string, check: () => void): SharedProjectionAuthority {
    const authority = Object.freeze({ diagramId });
    projections.set(authority, check);
    return authority;
  }

  undo(diagramId: string): boolean | undefined {
    const access = this.bindings.get(diagramId);
    if (!access) return undefined;
    this.assertWrite(diagramId);
    return access.undo?.() ?? false;
  }

  redo(diagramId: string): boolean | undefined {
    const access = this.bindings.get(diagramId);
    if (!access) return undefined;
    this.assertWrite(diagramId);
    return access.redo?.() ?? false;
  }
}

/** Tiny shared boundary; loading the normal editor does not load Yjs or MLS/WASM. */
export const collaborationPermissions = new CollaborationPermissions();
