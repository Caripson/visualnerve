export interface OperationReply {
  status: number;
  body: unknown;
}
export interface OperationCommand {
  operationId: string;
  operationNew?: boolean;
  operationAction: 'reserve' | 'execute' | 'status';
  path: string;
  method: string;
  data?: unknown;
}
interface Entry {
  created: number;
  finished?: number;
  state: 'reserved' | 'running' | 'succeeded' | 'failed' | 'unknown';
  fingerprint?: Promise<string>;
  pending?: Promise<OperationReply>;
  status?: number;
  result?: string;
}
const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
async function fingerprint(command: OperationCommand) {
  const value = canonical([command.method, command.path, command.data]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}
const error = (status: number, code: string, message: string): OperationReply => ({
  status,
  body: { code, error: message },
});

/** Transient transport results belong to one page/access grant, never IndexedDB or the bridge. */
export class BridgeOperations {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly now = () => Date.now(),
    private readonly limits = { entries: 256, bytes: 8 * 1024 * 1024, retentionMs: 15 * 60_000 },
  ) {}
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
  private prune() {
    const now = this.now();
    for (const [id, entry] of this.entries)
      if (
        entry.state !== 'running' &&
        now - (entry.finished ?? entry.created) >= this.limits.retentionMs
      ) {
        this.bytes -= (entry.result?.length ?? 0) * 2;
        this.entries.delete(id);
      }
  }
  private summary(id: string, entry: Entry) {
    return {
      operationId: id,
      state: entry.state,
      ...(entry.status === undefined ? {} : { status: entry.status }),
      resultAvailable: entry.result !== undefined,
      ...(entry.result === undefined ? {} : { result: JSON.parse(entry.result) }),
    };
  }
  /** Register an initial dispatch before capturing its asynchronous storage lease. */
  prepare(command: OperationCommand): OperationReply | undefined {
    this.prune();
    if (
      !this.entries.has(command.operationId) &&
      command.operationNew &&
      command.operationAction !== 'status'
    ) {
      if (this.entries.size >= this.limits.entries)
        return error(
          503,
          'OPERATION_LIMIT',
          'Too many retained operations. Wait for expiry before issuing new work.',
        );
      this.entries.set(command.operationId, { created: this.now(), state: 'reserved' });
    }
  }
  async request(
    command: OperationCommand,
    authorize: () => Promise<void>,
    execute: () => Promise<OperationReply>,
  ): Promise<OperationReply> {
    // Reserve synchronously before any await. Concurrent retries cannot both start work.
    const preparation = this.prepare(command);
    if (preparation) return preparation;
    const entry = this.entries.get(command.operationId);
    if (!entry) {
      await authorize();
      return error(
        410,
        'OPERATION_EXPIRED',
        'This page no longer retains the operation. Read saved state before issuing new work.',
      );
    }
    const current = entry;
    if (command.operationAction !== 'execute') {
      await authorize();
      return {
        status: command.operationAction === 'reserve' ? 201 : 200,
        body: this.summary(command.operationId, current),
      };
    }
    const proposed = fingerprint(command);
    let execution = current.pending;
    if (!current.fingerprint) {
      current.fingerprint = proposed;
      current.state = 'running';
      current.pending = (async () => {
        await proposed;
        await authorize();
        const reply = await execute();
        await authorize();
        // Revocation has cleared the map; an old promise must never restore private results.
        if (this.entries.get(command.operationId) === current) {
          current.state = reply.status >= 400 ? 'failed' : 'succeeded';
          current.status = reply.status;
          current.finished = this.now();
          const result = JSON.stringify(reply.body ?? null);
          // Count UTF-16 storage conservatively; large results remain inspectable by status.
          const size = result.length * 2;
          if (size <= this.limits.bytes) {
            for (const other of this.entries.values()) {
              if (this.bytes + size <= this.limits.bytes) break;
              if (other !== current && other.result !== undefined) {
                this.bytes -= other.result.length * 2;
                other.result = undefined;
              }
            }
            if (this.bytes + size <= this.limits.bytes) {
              current.result = result;
              this.bytes += size;
            }
          }
        }
        return reply;
      })();
      // A caller may disconnect before awaiting. Retain a terminal unknown state,
      // never re-execute an authorization/transport failure with the same ID.
      void current.pending.catch(() => {
        if (this.entries.get(command.operationId) === current) {
          current.state = 'unknown';
          current.finished = this.now();
        }
      });
      void current.pending.then(
        () => {
          current.pending = undefined;
        },
        () => {
          current.pending = undefined;
        },
      );
      execution = current.pending;
    } else if ((await proposed) !== (await current.fingerprint)) {
      await authorize();
      return error(
        409,
        'OPERATION_CONFLICT',
        'This operation ID belongs to a different method, path or body.',
      );
    }
    await authorize();
    if (execution) {
      const reply = await execution;
      await authorize();
      return reply;
    }
    await authorize();
    return current.result === undefined
      ? {
          status: 409,
          body: {
            ...this.summary(command.operationId, current),
            code: 'OPERATION_RESULT_UNAVAILABLE',
            error:
              'The operation was already handled; its response is no longer retained. Read saved state before issuing new work.',
          },
        }
      : { status: current.status!, body: JSON.parse(current.result) };
  }
}
