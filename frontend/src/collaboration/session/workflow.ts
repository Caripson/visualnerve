import type { Graph } from '../../model/types';
import { StorageError } from '../../model/errors';
import { validateGraph } from '../../model/validation';
import {
  collaborationFor,
  mutateCollaboration,
  validateCollaboration,
  type CollaborationAction,
  type CollaborationActionContext,
  type CollaborationDocument,
} from '../model';
import { CollaborationPeerMessageError } from '../transport/room-transport';
import type { RoomMember } from '../../../../collaboration-worker/src/protocol';

export interface WorkflowCheckpoint {
  revision: number;
  document: CollaborationDocument;
}
interface Response extends WorkflowCheckpoint {
  version: 1;
  requestId?: string;
  error?: { status: number; message: string };
}
interface WorkflowPort {
  diagramId: string;
  check(): void;
  owner(): boolean;
  context(sender?: RoomMember): CollaborationActionContext;
  activeProfileIds(): readonly string[];
  read(): Promise<Graph>;
  commit(change: (current: Graph) => Graph, authorize?: () => void): Promise<Graph>;
  send(
    kind: 'workflow-request' | 'workflow-state',
    bytes: Uint8Array,
    recipient?: string,
  ): Promise<void>;
  failure(error: Error): void;
}
const encoder = new TextEncoder();
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function parse(bytes: Uint8Array, fields: string[]): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !value ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((key) => !fields.includes(key))
    )
      throw new Error();
    return value;
  } catch {
    throw new CollaborationPeerMessageError('Invalid protected collaboration message.');
  }
}
/** Protected authorship is owner-mediated; concurrent diagram geometry remains a CRDT. */
export class CollaborationWorkflow {
  private revision = 0;
  private accepted?: CollaborationDocument;
  private queue = Promise.resolve();
  private outgoing = Promise.resolve();
  private queuedStates = 0;
  private latest?: Graph;
  private requestRates = new Map<string, { start: number; count: number }>();
  private pending = new Map<
    string,
    {
      resolve(graph: Graph): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      check(): Promise<void>;
    }
  >();
  private completed = new Map<string, { status: number; message: string } | undefined>();
  private stopped = false;
  constructor(
    private port: WorkflowPort,
    revision = 0,
    initial?: CollaborationDocument,
  ) {
    this.revision = revision;
    this.accepted = initial ? structuredClone(initial) : undefined;
  }
  private check() {
    this.port.check();
    if (this.stopped) throw new StorageError(423, 'The collaboration workflow has closed.');
  }
  checkpoint(graph: Graph): WorkflowCheckpoint {
    this.check();
    return {
      revision: this.revision,
      document: structuredClone(
        this.port.owner() && this.accepted ? this.accepted : collaborationFor(graph),
      ),
    };
  }
  private publish(graph: Graph, requestId?: string, error?: Response['error'], recipient?: string) {
    if (this.queuedStates >= 8) {
      this.latest = structuredClone(graph);
      // The final checkpoint is still sent. A dropped action acknowledgement
      // is reported as an unknown outcome, never retried automatically.
      return;
    }
    this.queuedStates++;
    const bytes = encoder.encode(
      JSON.stringify({
        version: 1,
        ...this.checkpoint(graph),
        ...(requestId ? { requestId } : {}),
        ...(error ? { error } : {}),
      } satisfies Response),
    );
    // Never block the authenticated receive loop behind transport backpressure.
    const sent = this.outgoing.then(async () => {
      this.check();
      await this.port.send('workflow-state', bytes, recipient);
    });
    this.outgoing = sent
      .catch((error) => {
        if (!this.stopped) this.port.failure(error);
      })
      .finally(() => {
        bytes.fill(0);
        this.queuedStates--;
        const latest = this.latest;
        this.latest = undefined;
        if (latest && !this.stopped) this.publish(latest);
      });
  }
  changed(before: Graph, after: Graph) {
    if (
      JSON.stringify(before.diagram.collaboration) === JSON.stringify(after.diagram.collaboration)
    )
      return;
    if (!this.port.owner())
      throw new StorageError(403, 'Protected collaboration changes require owner approval.');
    this.revision++;
    this.accepted = structuredClone(collaborationFor(after));
    this.publish(after);
  }
  broadcast(graph: Graph) {
    if (this.port.owner()) this.publish(graph);
  }
  async action(
    action: CollaborationAction,
    context: CollaborationActionContext,
    check: () => Promise<void>,
  ): Promise<Graph> {
    this.check();
    await check();
    this.check();
    if (this.port.owner()) return this.execute(action, context, check);
    if (context.role !== 'editor') throw new StorageError(403, 'This shared diagram is read only.');
    if (this.pending.size >= 8)
      throw new StorageError(429, 'Wait for pending collaboration actions before sending more.');
    const id = crypto.randomUUID();
    const bytes = encoder.encode(
      JSON.stringify({ version: 1, id, revision: this.revision, action }),
    );
    if (bytes.length > 128 * 1024) {
      bytes.fill(0);
      throw new StorageError(413, 'This collaboration action is too large.');
    }
    return new Promise<Graph>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new StorageError(
            504,
            'The owner did not acknowledge this action. Its outcome is unknown; read the current document before retrying.',
          ),
        );
      }, 25_000);
      this.pending.set(id, { resolve, reject, timer, check });
      void this.port
        .send('workflow-request', bytes)
        .catch((error) => {
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        })
        .finally(() => bytes.fill(0));
    });
  }
  private execute(
    action: CollaborationAction,
    context: CollaborationActionContext,
    guard: () => Promise<void> = async () => {},
    expectedRevision?: number,
    sender?: RoomMember,
  ): Promise<Graph> {
    let result!: Graph;
    const authorize = () => {
      this.check();
      if (sender && this.port.context(sender).role === 'viewer')
        throw new StorageError(403, 'This device no longer has editing permission.');
    };
    const next = this.queue.then(async () => {
      authorize();
      await guard();
      authorize();
      result = await this.port.commit((current) => {
        this.check();
        if (action?.type === 'profile.remove' && this.port.activeProfileIds().includes(action.id))
          throw new StorageError(409, 'Remove the approved device before deleting its profile.');
        if (expectedRevision !== undefined && expectedRevision !== this.revision)
          throw new StorageError(
            409,
            'Collaboration changed. Read the current document and review the action again.',
          );
        const changed = mutateCollaboration(
          current,
          action,
          sender ? this.port.context(sender) : context,
        );
        validateGraph(changed);
        return changed;
      }, authorize);
      this.check();
      return result;
    });
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async receiveRequest(bytes: Uint8Array, sender: RoomMember) {
    this.check();
    if (!this.port.owner())
      throw new CollaborationPeerMessageError(
        'Only the owner accepts protected workflow requests.',
      );
    const now = Date.now();
    const rate = this.requestRates.get(sender.deviceId);
    if (rate && now - rate.start < 60_000 && rate.count >= 24)
      throw new CollaborationPeerMessageError(
        'This participant exceeded the protected action rate limit.',
      );
    this.requestRates.set(
      sender.deviceId,
      rate && now - rate.start < 60_000
        ? { ...rate, count: rate.count + 1 }
        : { start: now, count: 1 },
    );
    while (this.requestRates.size > 64)
      this.requestRates.delete(this.requestRates.keys().next().value!);
    const input = parse(bytes, ['version', 'id', 'revision', 'action']);
    if (
      input.version !== 1 ||
      typeof input.id !== 'string' ||
      !uuid.test(input.id) ||
      !Number.isSafeInteger(input.revision) ||
      bytes.length > 128 * 1024
    )
      throw new CollaborationPeerMessageError('Invalid collaboration action request.');
    const id = input.id;
    const key = `${sender.deviceId}:${id}`;
    const duplicate = this.completed.has(key);
    let error = this.completed.get(key);
    if (!duplicate) {
      try {
        if (input.revision !== this.revision)
          throw new StorageError(
            409,
            'Collaboration changed. Read the current document and review the action again.',
          );
        await this.execute(
          input.action as CollaborationAction,
          this.port.context(sender),
          async () => {},
          input.revision as number,
          sender,
        );
      } catch (failure) {
        if (!(failure instanceof StorageError)) throw failure;
        error = { status: failure.status, message: failure.message };
      }
      this.completed.set(key, error);
      while (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value!);
    }
    this.publish(await this.port.read(), id, error, sender.deviceId);
  }
  async receiveState(bytes: Uint8Array, sender: RoomMember) {
    this.check();
    if (sender.role !== 'owner')
      throw new CollaborationPeerMessageError(
        'Only the authenticated owner can publish protected collaboration.',
      );
    const input = parse(bytes, ['version', 'revision', 'document', 'requestId', 'error']);
    try {
      if (
        input.version !== 1 ||
        !Number.isSafeInteger(input.revision) ||
        (input.revision as number) < 0 ||
        (input.requestId !== undefined &&
          (typeof input.requestId !== 'string' || !uuid.test(input.requestId)))
      )
        throw new Error();
      validateCollaboration(input.document);
      if (input.error !== undefined) {
        const error = input.error as Response['error'];
        if (
          !error ||
          Object.keys(error).some((key) => !['status', 'message'].includes(key)) ||
          !Number.isSafeInteger(error.status) ||
          error.status < 400 ||
          error.status > 599 ||
          typeof error.message !== 'string' ||
          error.message.length > 500
        )
          throw new Error();
      }
    } catch {
      throw new CollaborationPeerMessageError('Invalid owner collaboration checkpoint.');
    }
    let graph = await this.port.read();
    if ((input.revision as number) > this.revision) {
      graph = await this.port.commit((current) => ({
        ...current,
        diagram: {
          ...current.diagram,
          collaboration: structuredClone(input.document as CollaborationDocument),
        },
      }));
      this.check();
      this.revision = input.revision as number;
    } else if (
      input.revision === this.revision &&
      JSON.stringify(collaborationFor(graph)) !== JSON.stringify(input.document)
    )
      throw new CollaborationPeerMessageError(
        'The owner checkpoint conflicts with the accepted revision.',
      );
    const pending =
      typeof input.requestId === 'string' ? this.pending.get(input.requestId) : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(input.requestId as string);
      try {
        await pending.check();
        this.check();
        const error = input.error as Response['error'];
        if (error) pending.reject(new StorageError(error.status, error.message));
        else pending.resolve(graph);
      } catch (error) {
        pending.reject(error as Error);
      }
    }
  }
  dispose() {
    this.stopped = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        new StorageError(
          423,
          'Sharing ended before the owner acknowledged the action. Read the saved document before retrying.',
        ),
      );
    }
    this.pending.clear();
    this.completed.clear();
    this.requestRates.clear();
    this.latest = undefined;
    this.accepted = undefined;
  }
}
