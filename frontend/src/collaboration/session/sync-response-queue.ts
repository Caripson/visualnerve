/** Remote recovery is bounded separately from user edits and owner admission. */
export const collaborationSyncResponseLimits = Object.freeze({
  peerIntervalMs: 10_000,
  payloadBytesPerMinute: 1024 * 1024,
});
interface Response {
  epoch: number;
  nextAt: number;
  vector?: Uint8Array;
}
interface Options {
  check(): void;
  epoch(): number;
  allowed(recipient: string, epoch: number): boolean;
  send(
    vector: Uint8Array,
    recipient: string,
    charge: (compressedBytes: number) => void,
  ): Promise<void>;
  failure(error: Error): void;
  now?(): number;
}
/**
 * Coalesces one owned vector per approved peer before expensive diff/compression.
 * A full refresh is not truncated: its actual compressed size determines the
 * next global recovery slot. A necessary large refresh uses one ordinary quota
 * window, but repeated requests cannot monopolize successive windows.
 */
export class CollaborationSyncResponseQueue {
  private peers = new Map<string, Response>();
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private active?: Uint8Array;
  private stopped = false;
  private nextAt = 0;
  private now: () => number;
  constructor(private options: Options) {
    this.now = options.now ?? Date.now;
  }
  private prune() {
    for (const [recipient, entry] of this.peers)
      if (!this.options.allowed(recipient, entry.epoch)) {
        entry.vector?.fill(0);
        this.peers.delete(recipient);
      }
  }
  request(vector: Uint8Array, recipient: string) {
    if (this.stopped) return;
    this.options.check();
    this.prune();
    const epoch = this.options.epoch();
    if (!this.options.allowed(recipient, epoch)) return;
    const entry = this.peers.get(recipient) ?? { epoch, nextAt: 0 };
    // A new request joins the back of the pending queue. Updating a request
    // already waiting replaces its vector without stealing another peer's turn.
    if (!entry.vector) this.peers.delete(recipient);
    entry.vector?.fill(0);
    entry.vector = new Uint8Array(vector);
    this.peers.set(recipient, entry);
    this.schedule();
  }
  private schedule() {
    if (this.stopped || this.busy) return;
    this.prune();
    const pending = [...this.peers.values()].filter((entry) => entry.vector);
    if (!pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    const due = Math.max(this.nextAt, Math.min(...pending.map((entry) => entry.nextAt)));
    const delay = Math.max(0, due - this.now());
    if (delay) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.dispatch();
      }, delay);
    } else this.dispatch();
  }
  private dispatch() {
    if (this.stopped || this.busy) return;
    this.prune();
    const now = this.now();
    const selected = [...this.peers].find(([, entry]) => entry.vector && entry.nextAt <= now);
    if (!selected || this.nextAt > now) return this.schedule();
    const [recipient, entry] = selected;
    const owned = entry.vector!;
    entry.vector = undefined;
    entry.nextAt = now + collaborationSyncResponseLimits.peerIntervalMs;
    this.nextAt = entry.nextAt;
    // Round-robin peers; a repeated requester cannot always win the next slot.
    this.peers.delete(recipient);
    this.peers.set(recipient, entry);
    this.busy = true;
    this.active = owned;
    void Promise.resolve()
      .then(async () => {
        if (this.stopped || !this.options.allowed(recipient, entry.epoch)) return;
        this.options.check();
        await this.options.send(owned, recipient, (compressedBytes) => {
          this.nextAt = Math.max(
            this.nextAt,
            this.now() +
              Math.ceil(
                (compressedBytes * 60_000) / collaborationSyncResponseLimits.payloadBytesPerMinute,
              ),
          );
        });
      })
      .catch((error: Error) => {
        if (!this.stopped && this.options.allowed(recipient, entry.epoch))
          this.options.failure(error);
      })
      .finally(() => {
        owned.fill(0);
        if (this.active === owned) this.active = undefined;
        this.busy = false;
        this.schedule();
      });
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.active?.fill(0);
    this.active = undefined;
    for (const entry of this.peers.values()) entry.vector?.fill(0);
    this.peers.clear();
  }
}
