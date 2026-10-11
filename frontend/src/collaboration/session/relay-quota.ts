interface Reservation {
  at: number;
  messages: number;
  bytes: number;
}
const minute = 60_000;
/** Reserve a complete chunked message before its first frame; queues never expire mid-quota wait. */
export class CollaborationRelayQuota {
  private reservations: Reservation[] = [];
  constructor(
    private now = Date.now,
    private maxMessages = 500,
    private maxBytes = 6 * 1024 * 1024,
  ) {}
  async reserve(messages: number, bytes: number, signal: AbortSignal) {
    if (
      !Number.isSafeInteger(messages) ||
      messages < 1 ||
      messages > this.maxMessages ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.maxBytes
    )
      throw new Error(
        'The collaboration message exceeds its relay quota. Reduce the shared data scope.',
      );
    while (true) {
      if (signal.aborted)
        throw new DOMException('The outgoing membership epoch changed.', 'AbortError');
      const now = this.now();
      this.reservations = this.reservations.filter((value) => value.at + minute > now);
      const used = this.reservations.reduce(
        (sum, value) => ({
          messages: sum.messages + value.messages,
          bytes: sum.bytes + value.bytes,
        }),
        { messages: 0, bytes: 0 },
      );
      if (used.messages + messages <= this.maxMessages && used.bytes + bytes <= this.maxBytes) {
        this.reservations.push({ at: now, messages, bytes });
        return;
      }
      const delay = Math.max(1, this.reservations[0].at + minute - now);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, delay);
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(new DOMException('The outgoing membership epoch changed.', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
  clear() {
    this.reservations = [];
  }
}
