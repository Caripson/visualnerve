import type { InfrastructureWork, MemoryInfrastructureMetrics } from './types';
type Demand = NonNullable<InfrastructureWork['memory']>[number];
interface Lease {
  key: string;
  resourceId: string;
  rootId: number;
  particleId: number;
  nodeId: string;
  scope: 'case' | 'stage';
  amount: number;
}

/** A case lease follows its root through transit/forks. Branch stage leases are independent. */
export class MemoryLeases {
  private leases = new Map<string, Lease>();
  private totals = new Map<string, { used: number; peak: number; area: number }>();
  private clock = 0;
  constructor(
    ids: readonly string[],
    private change: (resourceId: string, nodeId: string, delta: number) => void,
  ) {
    for (const id of ids) this.totals.set(id, { used: 0, peak: 0, area: 0 });
  }
  private key(d: Demand, rootId: number, particleId: number) {
    return `${d.scope}:${d.scope === 'case' ? rootId : particleId}:${d.resourceId}`;
  }
  advance(now: number) {
    for (const t of this.totals.values()) t.area += t.used * (now - this.clock);
    this.clock = now;
  }
  needed(d: Demand, rootId: number, particleId: number) {
    return Math.max(
      0,
      d.amountMiB - (this.leases.get(this.key(d, rootId, particleId))?.amount ?? 0),
    );
  }
  acquire(
    demands: readonly Demand[],
    rootId: number,
    particleId: number,
    nodeId: string,
    now: number,
  ) {
    this.advance(now);
    for (const d of demands) {
      const key = this.key(d, rootId, particleId),
        previous = this.leases.get(key),
        delta = this.needed(d, rootId, particleId);
      if (delta <= 0) continue;
      this.leases.set(key, {
        key,
        resourceId: d.resourceId,
        rootId,
        particleId,
        nodeId: previous?.nodeId ?? nodeId,
        scope: d.scope,
        amount: (previous?.amount ?? 0) + delta,
      });
      const t = this.totals.get(d.resourceId)!;
      t.used += delta;
      t.peak = Math.max(t.peak, t.used);
      this.change(d.resourceId, previous?.nodeId ?? nodeId, delta);
    }
  }
  private release(predicate: (lease: Lease) => boolean, now: number) {
    this.advance(now);
    for (const [key, l] of this.leases)
      if (predicate(l)) {
        this.leases.delete(key);
        this.totals.get(l.resourceId)!.used = Math.max(
          0,
          this.totals.get(l.resourceId)!.used - l.amount,
        );
        this.change(l.resourceId, l.nodeId, -l.amount);
      }
  }
  releaseStage(particleId: number, now: number) {
    this.release((l) => l.scope === 'stage' && l.particleId === particleId, now);
  }
  releaseCase(rootId: number, now: number, ids?: readonly string[]) {
    this.release(
      (l) => l.rootId === rootId && (!ids || (l.scope === 'case' && ids.includes(l.resourceId))),
      now,
    );
  }
  clear(now: number) {
    this.release(() => true, now);
  }
  metrics(): Record<string, MemoryInfrastructureMetrics> {
    return Object.fromEntries(
      [...this.totals].map(([id, t]) => [
        id,
        {
          usedMiB: t.used,
          peakUsedMiB: t.peak,
          allocatedMiBSeconds: t.area,
          caseLeases: [...this.leases.values()].filter(
            (l) => l.resourceId === id && l.scope === 'case',
          ).length,
          stageLeases: [...this.leases.values()].filter(
            (l) => l.resourceId === id && l.scope === 'stage',
          ).length,
        },
      ]),
    );
  }
  nodeUsage(nodeId: string) {
    const out: Record<string, number> = {};
    for (const l of this.leases.values())
      if (l.nodeId === nodeId) out[l.resourceId] = (out[l.resourceId] ?? 0) + l.amount;
    return out;
  }
}
