export interface FluidJob {
  id: number;
  remaining: number;
  maximumRate: number;
  delivered: number;
}

/** Deterministic max-min sharing. All rates and demand limits use the same dimension. */
export function fairRates(jobs: readonly Pick<FluidJob, 'id' | 'maximumRate'>[], capacity: number) {
  const rates = new Map<number, number>();
  const ordered = [...jobs].sort((a, b) => a.maximumRate - b.maximumRate || a.id - b.id);
  let remaining = Math.max(0, capacity);
  for (let i = 0; i < ordered.length; i++) {
    const rate = Math.min(ordered[i].maximumRate, remaining / (ordered.length - i));
    rates.set(ordered[i].id, rate);
    remaining = Math.max(0, remaining - rate);
  }
  return rates;
}

/** Byte-conserving, event-driven serialization; propagation belongs to the engine edge. */
export class BandwidthPool {
  readonly jobs = new Map<number, FluidJob>();
  clock = 0;
  transferredBytes = 0;
  busySeconds = 0;
  peakActiveTransfers = 0;
  constructor(public rateBytesPerSecond: number) {}
  add(id: number, bytes: number, now: number) {
    this.advance(now);
    this.jobs.set(id, { id, remaining: bytes, maximumRate: Infinity, delivered: 0 });
    this.peakActiveTransfers = Math.max(this.peakActiveTransfers, this.active().length);
  }
  remove(id: number, now: number) {
    this.advance(now);
    this.jobs.delete(id);
  }
  active() {
    return [...this.jobs.values()].filter((j) => j.remaining > 0);
  }
  /** Account every byte of a tail whose duration is below this clock's floating precision. */
  private settleRoundoff() {
    const jobs = this.active();
    if (!jobs.length || this.rateBytesPerSecond <= 0) return;
    const share = this.rateBytesPerSecond / jobs.length;
    for (const j of jobs)
      if (this.clock + j.remaining / share <= this.clock) {
        this.transferredBytes += j.remaining;
        j.delivered += j.remaining;
        j.remaining = 0;
      }
  }
  next() {
    const jobs = this.active();
    return jobs.length && this.rateBytesPerSecond > 0
      ? this.clock +
          Math.min(...jobs.map((j) => (j.remaining * jobs.length) / this.rateBytesPerSecond))
      : undefined;
  }
  advance(now: number) {
    this.settleRoundoff();
    while (this.clock < now) {
      const jobs = this.active(),
        next = this.next();
      const end = Math.min(now, next ?? now),
        dt = end - this.clock;
      if (jobs.length && this.rateBytesPerSecond > 0) {
        this.busySeconds += dt;
        const share = this.rateBytesPerSecond / jobs.length;
        for (const j of jobs) {
          const served = Math.min(j.remaining, share * dt);
          j.remaining = Math.max(0, j.remaining - served);
          j.delivered += served;
          this.transferredBytes += served;
        }
      }
      if (end <= this.clock) break;
      this.clock = end;
      this.settleRoundoff();
    }
    this.clock = now;
  }
  completed() {
    return [...this.jobs.values()]
      .filter((j) => j.remaining === 0)
      .map((j) => j.id)
      .sort((a, b) => a - b);
  }
  metrics() {
    const activeTransfers = this.active().length;
    return {
      activeTransfers,
      peakActiveTransfers: this.peakActiveTransfers,
      transferredBytes: this.transferredBytes,
      usedMbps: activeTransfers ? this.rateBytesPerSecond / 125000 : 0,
      busySeconds: this.busySeconds,
    };
  }
}
