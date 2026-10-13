import type { Resource, SimulationModel, InfrastructureResource } from '../types';
import { QuantityField } from './QuantityField';
import { quantityUnits as units } from './quantity';
import { infrastructureLimits as limits } from './types';
import { infrastructureWorkResources } from './references';

export const infrastructureKinds = ['cpu', 'memory', 'bandwidth', 'energy'] as const;
export const domainNames = {
  cpu: 'CPU',
  memory: 'RAM',
  bandwidth: 'Bandwidth',
  energy: 'Energy & power',
};
export function ResourceDomainFields({
  resource,
  model,
  change,
  allowDimensionChange = true,
  showGeneralCapacity = false,
}: {
  resource: Resource;
  model: SimulationModel;
  change: (patch: Partial<Resource>) => void;
  allowDimensionChange?: boolean;
  showGeneralCapacity?: boolean;
}) {
  const infra = resource.infrastructure;
  const used =
    model.nodes.some(
      (node) =>
        node.type === 'work' &&
        (infrastructureWorkResources(node.work.infrastructure).includes(resource.id) ||
          node.work.resourceRequirements?.some((entry) => entry.resourceId === resource.id)),
    ) || model.edges.some((edge) => edge.infrastructure?.transfer.resourceId === resource.id);
  const quantities =
    infra?.kind === 'cpu'
      ? units.cores
      : infra?.kind === 'memory'
        ? units.memory
        : infra?.kind === 'bandwidth'
          ? units.bandwidth
          : units.power;
  const patchEnergy = (patch: Partial<Extract<InfrastructureResource, { kind: 'energy' }>>) => {
    if (infra?.kind === 'energy') change({ infrastructure: { ...infra, ...patch } });
  };
  return (
    <fieldset className="infrastructure-domain-fields">
      <legend>Capacity domain</legend>
      <label>
        Resource dimension{' '}
        <select
          aria-label={`Resource dimension ${resource.name}`}
          value={infra?.kind ?? ''}
          disabled={used || !allowDimensionChange}
          onChange={(event) => {
            const kind = event.target.value as InfrastructureResource['kind'] | '';
            if (!kind) {
              change({ infrastructure: undefined, unit: 'units' });
              return;
            }
            const value: InfrastructureResource =
              kind === 'energy'
                ? { kind, unit: 'kW', generation: [] }
                : kind === 'cpu'
                  ? { kind, unit: 'cores' }
                  : kind === 'memory'
                    ? { kind, unit: 'MiB' }
                    : { kind, unit: 'Mbps' };
            change({ infrastructure: value, unit: value.unit });
          }}
        >
          <option value="">General shared resource</option>
          {infrastructureKinds.map((kind) => (
            <option
              key={kind}
              value={kind}
              disabled={
                (kind === 'energy' && (!!resource.schedule?.length || !!resource.scaling)) ||
                (kind === 'bandwidth' && !!resource.scaling)
              }
            >
              {domainNames[kind]}
            </option>
          ))}
        </select>
      </label>
      {!allowDimensionChange && (
        <small>
          Introduce infrastructure dimensions in the baseline before configuring their scenarios.
        </small>
      )}
      {used && (
        <small>
          Remove this pool's work requirements and transfers before changing its dimension.
        </small>
      )}
      <p>
        Canonical units describe modeled allocation. CPU cores, RAM, fluid links and DC energy
        balance are abstractions, not hardware benchmarks or TCP/AC grid studies.
      </p>
      {!infra && showGeneralCapacity && (
        <div className="infrastructure-grid">
          <QuantityField
            label={`${resource.name} capacity`}
            value={resource.capacity}
            units={[{ label: resource.unit, factor: 1 }]}
            maximum={Number.MAX_SAFE_INTEGER}
            integer
            change={(capacity) => change({ capacity: capacity ?? 0 })}
          />
          <QuantityField
            label={`${resource.name} cost per unit/hour`}
            value={resource.costPerHour ?? 0}
            units={[{ label: `${model.currency}/${resource.unit}/hour`, factor: 1 }]}
            change={(costPerHour) => change({ costPerHour })}
          />
          <p>
            Common pool allocations use the existing shared-resource rules; no physical database I/O
            is inferred.
          </p>
        </div>
      )}
      {infra && (
        <>
          <QuantityField
            label={`${resource.name} capacity`}
            value={resource.capacity}
            units={quantities}
            maximum={limits.capacity}
            change={(capacity) => change({ capacity: capacity ?? 0 })}
            help={
              infra.kind === 'energy'
                ? 'Maximum output power. Generation, grid import and battery determine the available supply.'
                : 'Available shared capacity; fractional quantities are supported.'
            }
          />
          {(infra.kind === 'cpu' || infra.kind === 'memory') && (
            <div className="infrastructure-grid">
              <QuantityField
                label={`${resource.name} minimum capacity`}
                value={resource.minCapacity}
                optional
                units={quantities}
                maximum={limits.capacity}
                change={(minCapacity) => change({ minCapacity })}
              />
              <QuantityField
                label={`${resource.name} maximum capacity`}
                value={resource.maxCapacity}
                optional
                units={quantities}
                maximum={limits.capacity}
                change={(maxCapacity) => change({ maxCapacity })}
              />
            </div>
          )}
        </>
      )}
      {infra?.kind === 'energy' && (
        <>
          <div className="infrastructure-grid">
            <QuantityField
              label={`${resource.name} grid import limit`}
              value={infra.gridImportLimitKW}
              optional
              units={units.power}
              maximum={limits.capacity}
              change={(gridImportLimitKW) => patchEnergy({ gridImportLimitKW })}
            />
            <QuantityField
              label={`${resource.name} price per kWh`}
              value={infra.pricePerKWh}
              optional
              units={[{ label: `${model.currency}/kWh`, factor: 1 }]}
              maximum={limits.amount}
              change={(pricePerKWh) => patchEnergy({ pricePerKWh })}
            />
          </div>
          <fieldset>
            <legend>Generation windows</legend>
            <p>
              Seconds from the run start. Windows must not overlap. Outside them generation is zero.
            </p>
            {infra.generation.map((window, index) => (
              <fieldset key={index}>
                <legend>Generation window {index + 1}</legend>
                <div className="infrastructure-grid">
                  <QuantityField
                    label={`Generation ${index + 1} start`}
                    value={window.startSeconds}
                    units={units.time}
                    maximum={limits.durationSeconds}
                    change={(value) =>
                      patchEnergy({
                        generation: infra.generation.map((entry, i) =>
                          i === index ? { ...entry, startSeconds: value ?? 0 } : entry,
                        ),
                      })
                    }
                  />
                  <QuantityField
                    label={`Generation ${index + 1} end`}
                    value={window.endSeconds}
                    units={units.time}
                    minimum={limits.positiveMinimum}
                    maximum={limits.durationSeconds}
                    change={(value) =>
                      patchEnergy({
                        generation: infra.generation.map((entry, i) =>
                          i === index ? { ...entry, endSeconds: value ?? 1 } : entry,
                        ),
                      })
                    }
                  />
                  <QuantityField
                    label={`Generation ${index + 1} power`}
                    value={window.powerKW}
                    units={units.power}
                    maximum={limits.capacity}
                    change={(value) =>
                      patchEnergy({
                        generation: infra.generation.map((entry, i) =>
                          i === index ? { ...entry, powerKW: value ?? 0 } : entry,
                        ),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patchEnergy({ generation: infra.generation.filter((_, i) => i !== index) })
                  }
                >
                  Remove generation window {index + 1}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={infra.generation.length >= limits.generationWindows}
              onClick={() => {
                const start = infra.generation.at(-1)?.endSeconds ?? 0;
                patchEnergy({
                  generation: [
                    ...infra.generation,
                    { startSeconds: start, endSeconds: start + 3600, powerKW: 1 },
                  ],
                });
              }}
            >
              Add generation window
            </button>
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={!!infra.battery}
              onChange={(event) =>
                patchEnergy({
                  battery: event.target.checked
                    ? {
                        capacityKWh: 10,
                        initialKWh: 5,
                        maxChargeKW: 5,
                        maxDischargeKW: 5,
                        chargeEfficiency: 0.9,
                        dischargeEfficiency: 0.9,
                      }
                    : undefined,
                })
              }
            />
            Battery storage
          </label>
          {infra.battery && (
            <div className="infrastructure-grid">
              {(
                [
                  ['capacityKWh', 'Battery capacity', units.energy, limits.amount],
                  ['initialKWh', 'Initial stored energy', units.energy, infra.battery.capacityKWh],
                  ['maxChargeKW', 'Maximum charge power', units.power, limits.capacity],
                  ['maxDischargeKW', 'Maximum discharge power', units.power, limits.capacity],
                  ['chargeEfficiency', 'Charge efficiency', units.ratio, 1],
                  ['dischargeEfficiency', 'Discharge efficiency', units.ratio, 1],
                ] as const
              ).map(([field, label, choices, maximum]) => (
                <QuantityField
                  key={field}
                  label={`${resource.name} ${label}`}
                  value={infra.battery![field]}
                  units={[...choices]}
                  maximum={maximum}
                  minimum={field.includes('Efficiency') ? limits.positiveMinimum : 0}
                  change={(value) =>
                    patchEnergy({ battery: { ...infra.battery!, [field]: value ?? 0 } })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
