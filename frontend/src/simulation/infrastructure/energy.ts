import type { InfrastructureResource, EnergyInfrastructureMetrics } from './types';
import { fairRates, type FluidJob } from './fluid';

type Energy = Extract<InfrastructureResource, { kind: 'energy' }>;
/** Aggregate DC-side conservation with explicit generation, grid and battery boundaries. */
export class EnergyPool {
  readonly jobs = new Map<number, FluidJob>();
  clock = 0;
  private energy: number;
  private totals = {
    generatedKWh: 0,
    gridImportedKWh: 0,
    deliveredKWh: 0,
    chargeInputKWh: 0,
    dischargeOutputKWh: 0,
    conversionLossKWh: 0,
    curtailedKWh: 0,
    unservedKWh: 0,
    gridCost: 0,
  };
  constructor(
    readonly configuration: Energy,
    readonly maximumKW: number,
  ) {
    this.energy = configuration.battery?.initialKWh ?? 0;
  }
  add(id: number, energyKWh: number, powerKW: number, now: number) {
    this.advance(now);
    this.jobs.set(id, { id, remaining: energyKWh, maximumRate: powerKW, delivered: 0 });
  }
  remove(id: number, now: number) {
    this.advance(now);
    this.jobs.delete(id);
  }
  private flows() {
    const c = this.configuration,
      b = c.battery;
    const jobs = [...this.jobs.values()].filter((j) => j.remaining > 0);
    const requested = jobs.reduce((sum, j) => sum + j.maximumRate, 0);
    const generated =
      c.generation.find((w) => this.clock >= w.startSeconds && this.clock < w.endSeconds)
        ?.powerKW ?? 0;
    const demand = Math.min(requested, this.maximumKW),
      direct = Math.min(generated, demand);
    const discharge =
      b && this.energy > 0 ? Math.min(Math.max(0, demand - direct), b.maxDischargeKW) : 0;
    const grid = Math.min(Math.max(0, demand - direct - discharge), c.gridImportLimitKW ?? 0);
    const charge =
      b && this.energy < b.capacityKWh
        ? Math.min(Math.max(0, generated - direct), b.maxChargeKW)
        : 0;
    const supply = direct + discharge + grid;
    return {
      jobs,
      requested,
      generated,
      direct,
      discharge,
      grid,
      charge,
      supply,
      rates: fairRates(jobs, supply),
      storageRate: b ? charge * b.chargeEfficiency - discharge / b.dischargeEfficiency : 0,
    };
  }
  private interval() {
    const f = this.flows(),
      b = this.configuration.battery;
    let next = Infinity;
    for (const w of this.configuration.generation) {
      if (w.startSeconds > this.clock) next = Math.min(next, w.startSeconds - this.clock);
      if (w.endSeconds > this.clock) next = Math.min(next, w.endSeconds - this.clock);
    }
    if (b && f.storageRate > 0)
      next = Math.min(next, ((b.capacityKWh - this.energy) * 3600) / f.storageRate);
    if (b && f.storageRate < 0) next = Math.min(next, (this.energy * 3600) / -f.storageRate);
    for (const j of f.jobs) {
      const rate = f.rates.get(j.id) ?? 0;
      if (rate > 0) next = Math.min(next, (j.remaining * 3600) / rate);
    }
    return Number.isFinite(next) ? next : undefined;
  }
  next() {
    const interval = this.interval();
    return interval === undefined ? undefined : this.clock + interval;
  }
  /** Use an exact energy/time segment even when its timestamp cannot be represented at a large clock. */
  private integrate(f: ReturnType<EnergyPool['flows']>, hours: number) {
    const b = this.configuration.battery;
    let delivered = 0;
    for (const j of f.jobs) {
      const amount = Math.min(j.remaining, (f.rates.get(j.id) ?? 0) * hours);
      j.remaining = Math.max(0, j.remaining - amount);
      j.delivered += amount;
      delivered += amount;
    }
    this.totals.generatedKWh += f.generated * hours;
    this.totals.gridImportedKWh += f.grid * hours;
    this.totals.gridCost += f.grid * hours * (this.configuration.pricePerKWh ?? 0);
    this.totals.deliveredKWh += delivered;
    this.totals.chargeInputKWh += f.charge * hours;
    this.totals.dischargeOutputKWh += f.discharge * hours;
    this.totals.curtailedKWh += Math.max(0, f.generated - f.direct - f.charge) * hours;
    this.totals.unservedKWh += Math.max(0, f.requested - f.supply) * hours;
    if (b) {
      this.totals.conversionLossKWh +=
        (f.charge * (1 - b.chargeEfficiency) + f.discharge * (1 / b.dischargeEfficiency - 1)) *
        hours;
      this.energy = Math.max(0, Math.min(b.capacityKWh, this.energy + f.storageRate * hours));
    }
  }
  private settleRoundoff() {
    for (let i = 0; i < 100000; i++) {
      const interval = this.interval();
      if (interval === undefined || this.clock + interval > this.clock) return;
      if (interval <= 0) throw new Error('Energy interval did not progress.');
      this.integrate(this.flows(), interval / 3600);
    }
    throw new Error('Energy rounding transition limit reached.');
  }
  advance(now: number) {
    this.settleRoundoff();
    let transitions = 0;
    while (this.clock < now && ++transitions < 100000) {
      const f = this.flows(),
        next = this.next();
      const end = Math.min(now, next ?? now),
        hours = (end - this.clock) / 3600;
      if (end <= this.clock) break;
      this.integrate(f, hours);
      this.clock = end;
      this.settleRoundoff();
    }
    if (this.clock < now) throw new Error('Energy integration failed to progress.');
  }
  completed() {
    return [...this.jobs.values()]
      .filter((j) => j.remaining === 0)
      .map((j) => j.id)
      .sort((a, b) => a - b);
  }
  gridPowerKW() {
    return this.flows().grid;
  }
  /** Active loads whose requested rate is actually limited by the present supply. */
  constrainedJobs() {
    const f = this.flows();
    return f.jobs.filter((job) => job.maximumRate > (f.rates.get(job.id) ?? 0)).map((j) => j.id);
  }
  metrics(): EnergyInfrastructureMetrics {
    const f = this.flows();
    return {
      ...this.totals,
      storedKWh: this.energy,
      stateOfCharge: this.configuration.battery
        ? this.energy / this.configuration.battery.capacityKWh
        : 0,
      activeLoads: f.jobs.length,
      suppliedKW: f.supply,
      unmetKW: Math.max(0, f.requested - f.supply),
    };
  }
}
