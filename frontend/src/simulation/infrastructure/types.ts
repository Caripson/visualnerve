/** Infrastructure is opt-in and uses canonical dimensions, never free-form unit conversion. */
export interface InfrastructureProfile {
  schemaVersion: 1;
}
export interface GenerationWindow {
  startSeconds: number;
  endSeconds: number;
  powerKW: number;
}
export interface InfrastructureBattery {
  capacityKWh: number;
  initialKWh: number;
  maxChargeKW: number;
  maxDischargeKW: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
}
export type InfrastructureResource =
  | { kind: 'cpu'; unit: 'cores' }
  | { kind: 'memory'; unit: 'MiB' }
  | { kind: 'bandwidth'; unit: 'Mbps' }
  | {
      kind: 'energy';
      unit: 'kW';
      generation: GenerationWindow[];
      gridImportLimitKW?: number;
      pricePerKWh?: number;
      battery?: InfrastructureBattery;
    };
export interface InfrastructureWork {
  cpu?: { resourceId: string; coreSeconds: number; cores: number };
  memory?: { resourceId: string; amountMiB: number; scope: 'stage' | 'case' }[];
  releaseMemoryResourceIds?: string[];
  energy?: { resourceId: string; energyKWh: number; powerKW: number };
}
export interface InfrastructureEdge {
  transfer: { resourceId: string; bytes: number };
}
export interface CpuInfrastructureMetrics {
  reservedCores: number;
  peakReservedCores: number;
  /** Occupied core-time, including any explicit fixed processing overhead. */
  coreSeconds: number;
  /** Completed modeled computational work; distinct from reserved core-time. */
  completedWorkCoreSeconds: number;
}
export interface MemoryInfrastructureMetrics {
  usedMiB: number;
  peakUsedMiB: number;
  caseLeases: number;
  stageLeases: number;
  allocatedMiBSeconds: number;
}
export interface BandwidthInfrastructureMetrics {
  activeTransfers: number;
  peakActiveTransfers: number;
  transferredBytes: number;
  usedMbps: number;
  busySeconds: number;
}
export interface EnergyInfrastructureMetrics {
  generatedKWh: number;
  gridImportedKWh: number;
  deliveredKWh: number;
  storedKWh: number;
  stateOfCharge: number;
  chargeInputKWh: number;
  dischargeOutputKWh: number;
  conversionLossKWh: number;
  curtailedKWh: number;
  /** Demand that could not be delivered at its requested rate, integrated over time. */
  unservedKWh: number;
  activeLoads: number;
  suppliedKW: number;
  unmetKW: number;
  gridCost: number;
}
export interface InfrastructureMetrics {
  schemaVersion: 1;
  cpu: Record<string, CpuInfrastructureMetrics>;
  memory: Record<string, MemoryInfrastructureMetrics>;
  bandwidth: Record<string, BandwidthInfrastructureMetrics>;
  energy: Record<string, EnergyInfrastructureMetrics>;
}
export interface InfrastructureComparison {
  baseline: InfrastructureMetrics;
  scenario: InfrastructureMetrics;
  /** Signed scenario minus baseline only for pool IDs present in the same dimension on both sides. */
  delta: Omit<InfrastructureMetrics, 'schemaVersion'>;
}
export const infrastructureLimits = {
  schemaVersion: 1,
  capacity: 1e12,
  durationSeconds: 315360000,
  amount: 1e15,
  positiveMinimum: 0.000001,
  memoryRequirements: 32,
  generationWindows: 4096,
} as const;

export const infrastructureDisplayConversions = [
  { unit: 'bytes', canonicalUnit: 'bytes', factor: 1 },
  { unit: 'kB', canonicalUnit: 'bytes', factor: 1000 },
  { unit: 'MB', canonicalUnit: 'bytes', factor: 1000000 },
  { unit: 'GB', canonicalUnit: 'bytes', factor: 1000000000 },
  { unit: 'KiB', canonicalUnit: 'bytes', factor: 1024 },
  { unit: 'MiB', canonicalUnit: 'bytes', factor: 1048576 },
  { unit: 'GiB', canonicalUnit: 'bytes', factor: 1073741824 },
  { unit: 'bps', canonicalUnit: 'Mbps', factor: 0.000001 },
  { unit: 'Kbps', canonicalUnit: 'Mbps', factor: 0.001 },
  { unit: 'Mbps', canonicalUnit: 'Mbps', factor: 1 },
  { unit: 'Gbps', canonicalUnit: 'Mbps', factor: 1000 },
  { unit: 'W', canonicalUnit: 'kW', factor: 0.001 },
  { unit: 'kW', canonicalUnit: 'kW', factor: 1 },
  { unit: 'Wh', canonicalUnit: 'kWh', factor: 0.001 },
  { unit: 'kWh', canonicalUnit: 'kWh', factor: 1 },
  { unit: 'cores', canonicalUnit: 'cores', factor: 1 },
  { unit: 'core-seconds', canonicalUnit: 'core-seconds', factor: 1 },
] as const;
export type InfrastructureDisplayUnit = (typeof infrastructureDisplayConversions)[number]['unit'];
/** Explicit UI conversion; returned dimension prevents accidental cross-unit use. */
export function canonicalInfrastructureValue(value: number, unit: InfrastructureDisplayUnit) {
  const entry = infrastructureDisplayConversions.find((item) => item.unit === unit);
  if (!entry || !Number.isFinite(value) || value < 0 || !Number.isFinite(value * entry.factor))
    throw new Error('Invalid infrastructure quantity.');
  return { unit: entry.canonicalUnit, value: value * entry.factor };
}
