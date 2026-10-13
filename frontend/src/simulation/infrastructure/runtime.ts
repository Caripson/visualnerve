import type { SimulationModel, WorkConfiguration, Resource } from '../types';
import type { InfrastructureMetrics, CpuInfrastructureMetrics } from './types';
import { BandwidthPool } from './fluid';
import { EnergyPool } from './energy';
import { MemoryLeases } from './memory';

interface PoolState {
  capacity: number;
  busy: number;
  scheduled: boolean;
}
/** Owns domain state only. The one SimulationEngine owns routing, admissions and its event clock. */
export class InfrastructureRuntime {
  readonly memory: MemoryLeases;
  private links = new Map<string, BandwidthPool>();
  private energy = new Map<string, EnergyPool>();
  private cpu = new Map<string, CpuInfrastructureMetrics>();
  private transferPools = new Map<number, string>();
  private energyPools = new Map<number, string>();
  private cpuJobs = new Map<number, { resourceId: string; cores: number; work: number }>();
  private clock = 0;
  constructor(
    model: SimulationModel,
    private pool: (id: string) => PoolState,
    private change: (resourceId: string, nodeId: string, delta: number) => void,
  ) {
    this.memory = new MemoryLeases(
      model.resources.filter((r) => r.infrastructure?.kind === 'memory').map((r) => r.id),
      change,
    );
    for (const r of model.resources) {
      if (r.infrastructure?.kind === 'bandwidth')
        this.links.set(r.id, new BandwidthPool(this.linkRate(r)));
      else if (r.infrastructure?.kind === 'energy')
        this.energy.set(r.id, new EnergyPool(r.infrastructure, pool(r.id).capacity));
      else if (r.infrastructure?.kind === 'cpu')
        this.cpu.set(r.id, {
          reservedCores: 0,
          peakReservedCores: 0,
          coreSeconds: 0,
          completedWorkCoreSeconds: 0,
        });
    }
  }
  private linkRate(r: Resource | string) {
    const p = this.pool(typeof r === 'string' ? r : r.id);
    return p.scheduled ? p.capacity * 125000 : 0;
  }
  advance(now: number) {
    for (const c of this.cpu.values()) c.coreSeconds += c.reservedCores * (now - this.clock);
    this.memory.advance(now);
    for (const [id, l] of this.links) {
      l.advance(now);
      l.rateBytesPerSecond = this.linkRate(id);
    }
    for (const e of this.energy.values()) e.advance(now);
    this.clock = now;
    this.refreshRates();
  }
  refreshRates() {
    for (const [id, l] of this.links) {
      l.rateBytesPerSecond = this.linkRate(id);
      this.setBusy(id, l.active().length ? this.pool(id).capacity : 0);
    }
    for (const [id, e] of this.energy) this.setBusy(id, e.metrics().suppliedKW);
  }
  private setBusy(id: string, value: number) {
    const delta = value - this.pool(id).busy;
    if (Math.abs(delta) > 1e-10) this.change(id, '', delta);
  }
  blockedMemoryPools(work: WorkConfiguration, rootId: number, particleId: number) {
    const extra = new Map<string, number>();
    for (const d of work.infrastructure?.memory ?? [])
      extra.set(
        d.resourceId,
        (extra.get(d.resourceId) ?? 0) + this.memory.needed(d, rootId, particleId),
      );
    return [...extra]
      .filter(([id, amount]) => {
        const p = this.pool(id);
        return amount > 1e-10 && (!p.scheduled || p.busy + amount > p.capacity + 1e-9);
      })
      .map(([id]) => id);
  }
  canAcquire(work: WorkConfiguration, rootId: number, particleId: number) {
    return this.blockedMemoryPools(work, rootId, particleId).length === 0;
  }
  startMemory(
    work: WorkConfiguration,
    rootId: number,
    particleId: number,
    nodeId: string,
    now: number,
  ) {
    this.memory.acquire(work.infrastructure?.memory ?? [], rootId, particleId, nodeId, now);
  }
  startCpu(particleId: number, resourceId: string, cores: number, work: number, now: number) {
    this.advance(now);
    this.cpuJobs.set(particleId, { resourceId, cores, work });
    const c = this.cpu.get(resourceId)!;
    c.reservedCores += cores;
    c.peakReservedCores = Math.max(c.peakReservedCores, c.reservedCores);
  }
  finishCpu(particleId: number, now: number, cancelled = false) {
    this.advance(now);
    const j = this.cpuJobs.get(particleId);
    if (!j) return;
    this.cpuJobs.delete(particleId);
    const c = this.cpu.get(j.resourceId)!;
    c.reservedCores = Math.max(0, c.reservedCores - j.cores);
    if (!cancelled) c.completedWorkCoreSeconds += j.work;
  }
  transfer(particleId: number, resourceId: string, bytes: number, now: number) {
    this.advance(now);
    this.transferPools.set(particleId, resourceId);
    this.links.get(resourceId)!.add(particleId, bytes, now);
    this.refreshRates();
  }
  energyWork(particleId: number, resourceId: string, kWh: number, kW: number, now: number) {
    this.advance(now);
    this.energyPools.set(particleId, resourceId);
    this.energy.get(resourceId)!.add(particleId, kWh, kW, now);
    this.refreshRates();
  }
  nextTime() {
    if (this.completedTransfers().length || this.completedEnergy().length) return this.clock;
    const times = [...this.links.values()]
      .map((l) => l.next())
      .concat([...this.energy.values()].map((e) => e.next()))
      .filter((v): v is number => v !== undefined);
    return times.length ? Math.min(...times) : undefined;
  }
  completedTransfers() {
    return [...this.links.values()].flatMap((l) => l.completed()).sort((a, b) => a - b);
  }
  transferProgress(id: number) {
    const pool = this.transferPools.get(id),
      job = pool ? this.links.get(pool)?.jobs.get(id) : undefined;
    if (!job) return undefined;
    const total = job.remaining + job.delivered;
    return total > 0 ? Math.max(0, Math.min(1, job.delivered / total)) : 1;
  }
  completedEnergy() {
    return [...this.energy.values()].flatMap((e) => e.completed()).sort((a, b) => a - b);
  }
  removeTransfer(id: number, now: number) {
    const pool = this.transferPools.get(id);
    if (pool) {
      this.links.get(pool)!.remove(id, now);
      this.transferPools.delete(id);
      this.refreshRates();
    }
  }
  removeEnergy(id: number, now: number) {
    const pool = this.energyPools.get(id);
    if (pool) {
      this.energy.get(pool)!.remove(id, now);
      this.energyPools.delete(id);
      this.refreshRates();
    }
  }
  cancel(id: number, rootId: number, now: number, root = false) {
    this.finishCpu(id, now, true);
    this.removeTransfer(id, now);
    this.removeEnergy(id, now);
    this.memory.releaseStage(id, now);
    if (root) this.memory.releaseCase(rootId, now);
  }
  clear(now: number) {
    this.advance(now);
    for (const id of [...this.cpuJobs.keys()]) this.finishCpu(id, now, true);
    for (const id of [...this.transferPools.keys()]) this.removeTransfer(id, now);
    for (const id of [...this.energyPools.keys()]) this.removeEnergy(id, now);
    this.memory.clear(now);
  }
  snapshot(): InfrastructureMetrics {
    return {
      schemaVersion: 1,
      cpu: Object.fromEntries([...this.cpu].map(([id, c]) => [id, { ...c }])),
      memory: this.memory.metrics(),
      bandwidth: Object.fromEntries([...this.links].map(([id, l]) => [id, l.metrics()])),
      energy: Object.fromEntries([...this.energy].map(([id, e]) => [id, e.metrics()])),
    };
  }
  /** Scope attribution uses actual active consumers, never every resource reference. */
  constraintConsumers(nodeFor: (particleId: number) => string | undefined) {
    const result = new Map<string, ReadonlySet<string>>();
    const nodes = (ids: readonly number[]) =>
      new Set(
        ids.flatMap((id) => {
          const node = nodeFor(id);
          return node === undefined ? [] : [node];
        }),
      );
    for (const [id, link] of this.links) result.set(id, nodes(link.active().map((job) => job.id)));
    for (const [id, energy] of this.energy) result.set(id, nodes(energy.constrainedJobs()));
    return result;
  }
  gridCost() {
    return [...this.energy.values()].reduce((sum, e) => sum + e.metrics().gridCost, 0);
  }
  gridCostPerHour() {
    return [...this.energy.values()].reduce(
      (sum, e) => sum + e.gridPowerKW() * (e.configuration.pricePerKWh ?? 0),
      0,
    );
  }
}

export function infrastructureResourceIds(work: WorkConfiguration) {
  const d = work.infrastructure;
  return [
    ...(work.resourceRequirements ?? []).map((r) => r.resourceId),
    ...(d?.memory ?? []).map((m) => m.resourceId),
    ...(d?.cpu ? [d.cpu.resourceId] : []),
    ...(d?.energy ? [d.energy.resourceId] : []),
  ];
}
