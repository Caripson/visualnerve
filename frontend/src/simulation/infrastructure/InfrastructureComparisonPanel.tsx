import { formatInfrastructureQuantity } from './format';
import type { InfrastructureComparison, InfrastructureMetrics } from '../types';
const fields = {
  cpu: [
    ['reservedCores', 'Reserved cores', 'cores', 1],
    ['peakReservedCores', 'Peak reserved cores', 'cores', 1],
    ['coreSeconds', 'Occupied core-time', 'core-seconds', 1],
    ['completedWorkCoreSeconds', 'Completed CPU work', 'core-seconds', 1],
  ],
  memory: [
    ['usedMiB', 'Used RAM', 'MiB', 1],
    ['peakUsedMiB', 'Peak RAM', 'MiB', 1],
    ['caseLeases', 'Retained case leases', 'leases', 1],
    ['stageLeases', 'Stage leases', 'leases', 1],
    ['allocatedMiBSeconds', 'Allocated memory-time', 'MiB-seconds', 1],
  ],
  bandwidth: [
    ['activeTransfers', 'Active transfers', 'transfers', 1],
    ['peakActiveTransfers', 'Peak concurrent transfers', 'transfers', 1],
    ['transferredBytes', 'Transferred payload', 'MiB', 1 / 1048576],
    ['usedMbps', 'Used bandwidth', 'Mbps', 1],
    ['busySeconds', 'Link busy time', 'seconds', 1],
  ],
  energy: [
    ['generatedKWh', 'Generated', 'kWh', 1],
    ['gridImportedKWh', 'Grid imported', 'kWh', 1],
    ['deliveredKWh', 'Delivered', 'kWh', 1],
    ['storedKWh', 'Stored energy', 'kWh', 1],
    ['stateOfCharge', 'State of charge', 'percentage points', 100],
    ['conversionLossKWh', 'Conversion losses', 'kWh', 1],
    ['curtailedKWh', 'Curtailed', 'kWh', 1],
    ['unservedKWh', 'Unserved rate demand', 'kWh', 1],
    ['suppliedKW', 'Supplied power', 'kW', 1],
    ['unmetKW', 'Unmet power', 'kW', 1],
    ['gridCost', 'Grid cost', 'currency', 1],
  ],
} as const;
export function InfrastructureComparisonPanel({
  comparison,
  currency,
}: {
  comparison: InfrastructureComparison;
  currency: string;
}) {
  return (
    <details className="infrastructure-comparison">
      <summary>Infrastructure comparison</summary>
      <p>
        Snapshot values and cumulative totals for saved runs. Signed changes compare the same pool
        ID and dimension; new or removed pools have no inferred zero baseline.
      </p>
      {Object.keys(fields).map((key) => {
        const family = key as keyof typeof fields;
        const baseline = comparison.baseline[family],
          scenario = comparison.scenario[family],
          delta = comparison.delta[family];
        const ids = [...new Set([...Object.keys(baseline), ...Object.keys(scenario)])];
        return ids.map((id) => (
          <details key={`${family}:${id}`}>
            <summary>
              {family} · {id}
            </summary>
            <div className="simulation-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Measurement</th>
                    <th>Baseline</th>
                    <th>Scenario</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {fields[family].map(([field, label, unit, factor]) => {
                    const value = (
                      record: InfrastructureMetrics[typeof family] | typeof delta,
                      change = false,
                    ) => {
                      const raw = (record[id] as unknown as Record<string, number> | undefined)?.[
                        field
                      ];
                      return raw === undefined
                        ? '—'
                        : `${formatInfrastructureQuantity(raw * factor)} ${unit === 'currency' ? currency : unit === 'percentage points' && !change ? '%' : unit}`;
                    };
                    return (
                      <tr key={field}>
                        <th>{label}</th>
                        <td>{value(baseline)}</td>
                        <td>{value(scenario)}</td>
                        <td>{value(delta, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ));
      })}
    </details>
  );
}
