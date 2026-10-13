import { formatInfrastructureQuantity } from './format';
import type { SimulationState } from '../types';
export interface InfrastructureReading {
  kind: string;
  usage: number;
  unit: string;
  facts: [string, number, string][];
  pressure: 'clear' | 'busy' | 'congested';
  reason: string;
}

/** Queue pressure belongs only to stages whose current atomic admission is blocked by this pool. */
export function infrastructurePoolQueue(state: SimulationState | undefined, id: string): number {
  if (!state) return 0;
  const blocked =
    state.resources[id]?.blockedNodeIds ??
    Object.values(state.nodes)
      .filter((node) => node.blockedResourceIds?.includes(id))
      .map((node) => node.id);
  return [...new Set(blocked)].reduce(
    (total, nodeId) => total + (state.nodes[nodeId]?.queue.current ?? 0),
    0,
  );
}

/** Reads engine snapshots only. Never derives delivered work from requested configuration. */
export function infrastructureReading(
  state: SimulationState | undefined,
  id: string,
): InfrastructureReading | undefined {
  const data = state?.infrastructure;
  if (!data) return;
  const capacity = state.resources[id]?.capacity ?? 0;
  const queued = infrastructurePoolQueue(state, id);
  const blocked = state.resources[id]?.blockedNodeIds?.length ?? 0;
  const pressure = (used: number, blocked = false) =>
    blocked
      ? ('congested' as const)
      : (capacity > 0 && used / capacity >= 0.85) || queued > 0
        ? ('busy' as const)
        : ('clear' as const);
  const cpu = data.cpu[id];
  if (cpu)
    return {
      kind: 'CPU',
      usage: cpu.reservedCores,
      unit: 'cores',
      pressure: pressure(cpu.reservedCores, blocked > 0),
      reason: `${blocked} blocked work nodes · ${queued} queued requests`,
      facts: [
        ['Reserved now', cpu.reservedCores, 'cores'],
        ['Peak reserved', cpu.peakReservedCores, 'cores'],
        ['Occupied core-time', cpu.coreSeconds, 'core-seconds'],
        ['Completed CPU work', cpu.completedWorkCoreSeconds, 'core-seconds'],
      ],
    };
  const memory = data.memory[id];
  if (memory)
    return {
      kind: 'RAM',
      usage: memory.usedMiB,
      unit: 'MiB',
      pressure: pressure(memory.usedMiB, blocked > 0),
      reason: `${memory.caseLeases} case leases · ${memory.stageLeases} stage leases · ${blocked} blocked work nodes`,
      facts: [
        ['Used now', memory.usedMiB, 'MiB'],
        ['Peak used', memory.peakUsedMiB, 'MiB'],
        ['Retained case leases', memory.caseLeases, 'leases'],
        ['Stage leases', memory.stageLeases, 'leases'],
        ['Allocated memory-time', memory.allocatedMiBSeconds, 'MiB-seconds'],
      ],
    };
  const bandwidth = data.bandwidth[id];
  if (bandwidth)
    return {
      kind: 'Bandwidth',
      usage: bandwidth.usedMbps,
      unit: 'Mbps',
      pressure: pressure(
        bandwidth.usedMbps,
        bandwidth.activeTransfers > 1 && bandwidth.usedMbps >= capacity,
      ),
      reason: `${bandwidth.activeTransfers} active transfers · fair sharing`,
      facts: [
        ['Used now', bandwidth.usedMbps, 'Mbps'],
        ['Active transfers', bandwidth.activeTransfers, 'transfers'],
        ['Peak concurrent transfers', bandwidth.peakActiveTransfers, 'transfers'],
        ['Transferred payload', bandwidth.transferredBytes / 1048576, 'MiB'],
        ['Link busy time', bandwidth.busySeconds, 'seconds'],
      ],
    };
  const energy = data.energy[id];
  if (energy)
    return {
      kind: 'Energy & power',
      usage: energy.suppliedKW,
      unit: 'kW',
      pressure: pressure(energy.suppliedKW, energy.unmetKW > 1e-9),
      reason: `${formatInfrastructureQuantity(energy.unmetKW)} kW unmet demand · ${energy.activeLoads} active loads`,
      facts: [
        ['Supplied now', energy.suppliedKW, 'kW'],
        ['Unmet power now', energy.unmetKW, 'kW'],
        ['Delivered', energy.deliveredKWh, 'kWh'],
        ['Generated', energy.generatedKWh, 'kWh'],
        ['Grid imported', energy.gridImportedKWh, 'kWh'],
        ['Stored energy', energy.storedKWh, 'kWh'],
        ['State of charge', energy.stateOfCharge * 100, '%'],
        ['Unserved rate demand', energy.unservedKWh, 'kWh'],
        ['Curtailed', energy.curtailedKWh, 'kWh'],
        ['Conversion losses', energy.conversionLossKWh, 'kWh'],
        ['Charge input', energy.chargeInputKWh, 'kWh'],
        ['Discharge output', energy.dischargeOutputKWh, 'kWh'],
        ['Grid cost', energy.gridCost, 'currency'],
      ],
    };
}
export function infrastructureMetricIds(state: SimulationState) {
  const data = state.infrastructure;
  return data
    ? [
        ...new Set([
          ...Object.keys(data.cpu),
          ...Object.keys(data.memory),
          ...Object.keys(data.bandwidth),
          ...Object.keys(data.energy),
        ]),
      ]
    : [];
}
