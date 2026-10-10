import * as Y from 'yjs';
import type { Graph } from '../../model/types';
import { validateGraph } from '../../model/validation';
import { StorageError } from '../../model/errors';
import { expandShared, flattenShared } from './path-state';
import {
  decodeCollaborationUpdate,
  encodeCollaborationUpdate,
  validateCollaborationStateVector,
  isCollaborationFullStateVector,
} from './update-envelope';
import { isCollaborationBytes } from './bytes';
import {
  collaborationDocumentLimits,
  assertCollaborationFieldScope,
  defaultCollaborationShareScope,
  localGraph,
  sharedGraph,
  type CollaborationShareScope,
} from './scope';

export class CollaborationDocumentError extends StorageError {
  constructor(
    public code: string,
    message: string,
    status = 422,
  ) {
    super(status, message);
    this.name = 'CollaborationDocumentError';
  }
}
export interface CollaborationWriteGuard {
  canWrite: boolean;
  assertActive(): void;
}
export interface PreparedCollaborationChange {
  readonly graph: Graph;
  readonly update: Uint8Array;
  readonly state: Uint8Array;
  /** Call only after the private state/outbox has committed under the original vault lease. */
  commit(): void;
}
const initialOrigin = Symbol('initial shared state');
const remoteOrigin = Symbol('authenticated remote state');
const fail = (code: string, message: string, status = 422): never => {
  throw new CollaborationDocumentError(code, message, status);
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** UI, API and transport all bind to one per-field CRDT; it never owns renderer state. */
export class CollaborativeDocument {
  private doc = new Y.Doc();
  private localOrigin = {};
  private undoManager: Y.UndoManager;
  private generation = 0;
  private localClientId?: number;
  private disposed = false;
  readonly scope: Readonly<CollaborationShareScope>;
  readonly diagramId: string;

  constructor(
    graph: Graph,
    scope: CollaborationShareScope = defaultCollaborationShareScope,
    state?: Uint8Array,
  ) {
    validateGraph(graph);
    this.diagramId = graph.diagram.id;
    if (
      !scope ||
      ['shareMetadata', 'shareOwners', 'shareDatasets'].some(
        (key) => typeof scope[key as keyof CollaborationShareScope] !== 'boolean',
      )
    )
      fail('COLLABORATION_INVALID_SCOPE', 'Choose an explicit document sharing scope.');
    this.scope = Object.freeze({
      shareMetadata: scope.shareMetadata,
      shareOwners: scope.shareOwners,
      shareDatasets: scope.shareDatasets,
    });
    if (state) {
      this.checkBytes(state, collaborationDocumentLimits.stateBytes);
      try {
        Y.applyUpdate(this.doc, state, initialOrigin);
      } catch {
        fail('COLLABORATION_INVALID_UPDATE', 'The saved shared document is invalid.');
      }
    } else {
      this.doc.transact(() => {
        const contract = this.doc.getMap('contract');
        contract.set('version', 1);
        contract.set('diagramId', this.diagramId);
        contract.set('scope', this.scope);
        const fields = this.doc.getMap('fields');
        for (const [key, value] of flattenShared(sharedGraph(graph, this.scope)))
          fields.set(key, value);
      }, initialOrigin);
    }
    this.project(this.doc, graph);
    this.undoManager = new Y.UndoManager(this.doc.getMap('fields'), {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 0,
    });
  }

  private active() {
    if (this.disposed) fail('COLLABORATION_CLOSED', 'The shared document has closed.', 423);
  }
  private checkBytes(bytes: Uint8Array, maximum: number) {
    if (!isCollaborationBytes(bytes) || bytes.byteLength > maximum)
      fail('COLLABORATION_LIMIT', 'The shared document/update exceeds its size limit.');
  }
  private project(doc: Y.Doc, local: Graph): Graph {
    const contract = doc.getMap('contract');
    const fields = doc.getMap('fields');
    // A Y.Map must not carry an invisible text/list sequence. Extra root types
    // would otherwise be persisted/rebroadcast despite never being projected.
    if (
      doc.share.size !== 2 ||
      [...doc.share.keys()].some((key) => key !== 'contract' && key !== 'fields') ||
      contract._start !== null ||
      fields._start !== null
    )
      fail(
        'COLLABORATION_PRIVATE_FIELD',
        'This update includes a hidden root or non-map payload outside the sharing scope.',
      );
    // A compact malicious delta can add thousands of actor clocks while only
    // one visible field survives. Never accept a state that cannot produce the
    // bounded causal vector required by the next local edit or synchronization.
    validateCollaborationStateVector(Y.encodeStateVector(doc));
    if (
      contract.size !== 3 ||
      contract.get('version') !== 1 ||
      contract.get('diagramId') !== this.diagramId ||
      !equal(contract.get('scope'), this.scope) ||
      local.diagram.id !== this.diagramId
    )
      fail(
        'COLLABORATION_DOCUMENT_MISMATCH',
        'This update belongs to another document or sharing scope.',
      );
    assertCollaborationFieldScope(fields, this.scope);
    const value = expandShared(fields);
    const graph = localGraph(value, local, this.scope);
    if (
      graph.diagram.id !== this.diagramId ||
      graph.nodes.length > collaborationDocumentLimits.nodes ||
      graph.edges.length > collaborationDocumentLimits.edges ||
      graph.owners.length > collaborationDocumentLimits.owners
    )
      fail('COLLABORATION_LIMIT', 'The shared document exceeds its object limits.');
    validateGraph(graph);
    const allowed = flattenShared(sharedGraph(graph, this.scope));
    const received = flattenShared(value);
    if (
      allowed.size !== received.size ||
      [...received].some(([key, value]) => !equal(allowed.get(key), value))
    )
      fail(
        'COLLABORATION_PRIVATE_FIELD',
        'This update includes a private field outside the agreed sharing scope.',
      );
    return graph;
  }
  private clone(local = false) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, this.encodedState(), initialOrigin);
    if (local) {
      this.localClientId ??= doc.clientID;
      doc.clientID = this.localClientId;
    }
    return doc;
  }
  graph(local: Graph) {
    this.active();
    return this.project(this.doc, local);
  }
  hasSharedChanges(before: Graph, after: Graph): boolean {
    this.active();
    const previous = flattenShared(sharedGraph(before, this.scope));
    const next = flattenShared(sharedGraph(after, this.scope));
    return (
      previous.size !== next.size ||
      [...next].some(([key, value]) => !equal(previous.get(key), value))
    );
  }
  encodedState() {
    this.active();
    const state = Y.encodeStateAsUpdate(this.doc);
    this.checkBytes(state, collaborationDocumentLimits.stateBytes);
    return state;
  }
  stateVector() {
    this.active();
    return Y.encodeStateVector(this.doc);
  }
  diff(stateVector: Uint8Array) {
    this.active();
    validateCollaborationStateVector(stateVector);
    const update = Y.encodeStateAsUpdate(this.doc, stateVector);
    this.checkBytes(
      update,
      isCollaborationFullStateVector(stateVector)
        ? collaborationDocumentLimits.stateBytes
        : collaborationDocumentLimits.updateBytes,
    );
    return encodeCollaborationUpdate(stateVector, update);
  }
  /** Validate a complete native snapshot separately from the smaller incremental-update budget. */
  mergeNativeSnapshot(state: Uint8Array, local: Graph): { graph: Graph; state: Uint8Array } {
    this.active();
    this.checkBytes(state, collaborationDocumentLimits.stateBytes);
    const staged = this.clone();
    try {
      Y.applyUpdate(staged, state, remoteOrigin);
      const graph = this.project(staged, local);
      const merged = Y.encodeStateAsUpdate(staged);
      this.checkBytes(merged, collaborationDocumentLimits.stateBytes);
      return { graph, state: merged };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      return fail('COLLABORATION_INVALID_UPDATE', 'The shared snapshot is invalid.');
    } finally {
      staged.destroy();
    }
  }
  private prepared(
    doc: Y.Doc,
    graph: Graph,
    origin: unknown,
    guard?: CollaborationWriteGuard,
    fullState = false,
  ): PreparedCollaborationChange {
    const generation = this.generation;
    const baseVector = this.stateVector();
    const delta = Y.encodeStateAsUpdate(doc, baseVector);
    const state = Y.encodeStateAsUpdate(doc);
    this.checkBytes(
      delta,
      fullState ? collaborationDocumentLimits.stateBytes : collaborationDocumentLimits.updateBytes,
    );
    this.checkBytes(state, collaborationDocumentLimits.stateBytes);
    // A received full refresh can exceed the incremental delta budget. Preserve
    // its canonical full-state form in the staged result, while committing only
    // the validated differences to the existing local Yjs document.
    const update = encodeCollaborationUpdate(
      fullState ? new Uint8Array([0]) : baseVector,
      fullState ? state : delta,
    );
    let committed = false;
    return {
      graph,
      update,
      state,
      commit: () => {
        this.active();
        guard?.assertActive();
        if (committed)
          fail('COLLABORATION_ALREADY_COMMITTED', 'This update was already committed.', 409);
        if (this.generation !== generation)
          fail('COLLABORATION_CONFLICT', 'The shared document changed while saving.', 409);
        Y.applyUpdate(this.doc, delta, origin);
        this.generation++;
        committed = true;
      },
    };
  }
  prepareLocal(
    before: Graph,
    after: Graph,
    guard: CollaborationWriteGuard,
  ): PreparedCollaborationChange {
    this.active();
    guard.assertActive();
    if (!guard.canWrite)
      fail('COLLABORATION_READ_ONLY', 'This room grants viewing access only.', 403);
    if (before.diagram.id !== this.diagramId || after.diagram.id !== this.diagramId)
      fail('COLLABORATION_DOCUMENT_MISMATCH', 'The edit belongs to another document.');
    validateGraph(after);
    const previous = flattenShared(sharedGraph(before, this.scope));
    const next = flattenShared(sharedGraph(after, this.scope));
    const staged = this.clone(true);
    try {
      staged.transact(() => {
        const fields = staged.getMap('fields');
        for (const key of previous.keys()) if (!next.has(key)) fields.delete(key);
        for (const [key, value] of next)
          if (!equal(previous.get(key), value)) fields.set(key, value);
      }, this.localOrigin);
      guard.assertActive();
      return this.prepared(staged, this.project(staged, after), this.localOrigin, guard);
    } finally {
      staged.destroy();
    }
  }
  prepareRemote(update: Uint8Array, local: Graph): PreparedCollaborationChange {
    this.active();
    const envelope = decodeCollaborationUpdate(update);
    const current = Y.decodeStateVector(this.stateVector());
    if ([...envelope.dependencies].some(([actor, clock]) => (current.get(actor) ?? 0) < clock))
      fail(
        'COLLABORATION_DEPENDENCY_MISSING',
        'An earlier shared update is missing. Request state synchronization before applying this update.',
        409,
      );
    const staged = this.clone();
    try {
      Y.applyUpdate(staged, envelope.delta, remoteOrigin);
      return this.prepared(
        staged,
        this.project(staged, local),
        remoteOrigin,
        undefined,
        isCollaborationFullStateVector(envelope.baseVector),
      );
    } catch (error) {
      if (error instanceof CollaborationDocumentError) throw error;
      return fail(
        'COLLABORATION_INVALID_UPDATE',
        error instanceof Error ? error.message : 'Invalid shared update.',
      );
    } finally {
      staged.destroy();
    }
  }
  applyLocal(before: Graph, after: Graph, guard: CollaborationWriteGuard) {
    const change = this.prepareLocal(before, after, guard);
    change.commit();
    return change;
  }
  applyRemote(update: Uint8Array, local: Graph) {
    const change = this.prepareRemote(update, local);
    change.commit();
    return change;
  }
  get canUndo() {
    return !this.disposed && this.undoManager.undoStack.length > 0;
  }
  get canRedo() {
    return !this.disposed && this.undoManager.redoStack.length > 0;
  }
  undo(local: Graph, guard: CollaborationWriteGuard) {
    return this.history('undo', local, guard);
  }
  redo(local: Graph, guard: CollaborationWriteGuard) {
    return this.history('redo', local, guard);
  }
  private history(action: 'undo' | 'redo', local: Graph, guard: CollaborationWriteGuard) {
    this.active();
    guard.assertActive();
    if (!guard.canWrite)
      fail('COLLABORATION_READ_ONLY', 'This room grants viewing access only.', 403);
    const vector = this.stateVector();
    const changed = this.undoManager[action]();
    if (!changed) return undefined;
    let graph: Graph;
    try {
      graph = this.project(this.doc, local);
    } catch (error) {
      // Never publish an invalid undo (e.g. a newly referenced resource). Restore locally.
      this.undoManager[action === 'undo' ? 'redo' : 'undo']();
      this.generation++;
      throw error;
    }
    this.generation++;
    return {
      graph,
      update: encodeCollaborationUpdate(vector, Y.encodeStateAsUpdate(this.doc, vector)),
      state: this.encodedState(),
    };
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    // Stop retaining undo items before deleting live shared values, so Yjs can
    // garbage-collect plaintext content instead of keeping it as undo history.
    this.undoManager.clear();
    this.undoManager.destroy();
    this.doc.getMap('fields').clear();
    this.doc.getMap('contract').clear();
    this.doc.destroy();
  }
}
