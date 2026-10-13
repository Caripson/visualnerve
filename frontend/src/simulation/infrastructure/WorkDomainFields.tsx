import type { SimulationModel, WorkConfiguration, InfrastructureWork } from '../types';
import { QuantityField } from './QuantityField';
import { quantityUnits as units } from './quantity';
import { infrastructureLimits as limits } from './types';
export function WorkDomainFields({
  model,
  work,
  change,
  showGeneralRequirements = false,
}: {
  model: SimulationModel;
  work: WorkConfiguration;
  change: (work: WorkConfiguration) => void;
  showGeneralRequirements?: boolean;
}) {
  const value = work.infrastructure ?? {};
  const patch = (partial: Partial<InfrastructureWork>) =>
    change({ ...work, infrastructure: { ...value, ...partial } });
  const pools = (kind: string) =>
    model.resources.filter((pool) => pool.infrastructure?.kind === kind);
  const activity = value.cpu ? 'cpu' : value.energy ? 'energy' : '';
  return (
    <fieldset className="infrastructure-domain-fields">
      <legend>Infrastructure requirements</legend>
      <p>
        Configure shared requirements here. Canvas dependency links display these assumptions; they
        do not create computational work.
      </p>
      <label>
        Activity dimension{' '}
        <select
          aria-label="Activity dimension"
          value={activity}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === 'cpu')
              change({
                ...work,
                infrastructure: {
                  ...value,
                  energy: undefined,
                  cpu: { resourceId: pools('cpu')[0].id, coreSeconds: 1, cores: 1 },
                },
              });
            else if (kind === 'energy')
              change({
                ...work,
                processingSeconds: 0,
                infrastructure: {
                  ...value,
                  cpu: undefined,
                  energy: { resourceId: pools('energy')[0].id, energyKWh: 1, powerKW: 1 },
                },
              });
            else patch({ cpu: undefined, energy: undefined });
          }}
        >
          <option value="">Fixed processing time</option>
          <option value="cpu" disabled={!pools('cpu').length}>
            CPU work
          </option>
          <option value="energy" disabled={!pools('energy').length}>
            Energy-delivered work
          </option>
        </select>
      </label>
      {!pools('cpu').length && !pools('energy').length && (
        <small>Add a CPU or energy pool in Resources to enable these activities.</small>
      )}
      {value.cpu && (
        <>
          <label>
            CPU pool{' '}
            <select
              aria-label="CPU pool"
              value={value.cpu.resourceId}
              onChange={(event) =>
                patch({ cpu: { ...value.cpu!, resourceId: event.target.value } })
              }
            >
              {pools('cpu').map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
          <div className="infrastructure-grid">
            <QuantityField
              label="Computational work"
              value={value.cpu.coreSeconds}
              units={units.cpuWork}
              minimum={limits.positiveMinimum}
              maximum={limits.amount}
              change={(coreSeconds) =>
                patch({ cpu: { ...value.cpu!, coreSeconds: coreSeconds ?? 1 } })
              }
            />
            <QuantityField
              label="Cores per active request"
              value={value.cpu.cores}
              units={units.cores}
              minimum={limits.positiveMinimum}
              maximum={limits.capacity}
              change={(cores) => patch({ cpu: { ...value.cpu!, cores: cores ?? 1 } })}
            />
            <QuantityField
              label="Fixed processing overhead"
              value={work.processingSeconds}
              units={units.time}
              maximum={limits.durationSeconds}
              change={(processingSeconds) =>
                change({ ...work, processingSeconds: processingSeconds ?? 0 })
              }
            />
          </div>
          <p>
            Service time includes fixed overhead + core-seconds / allocated cores, adjusted by the
            existing complexity and improvement assumptions.
          </p>
        </>
      )}
      {value.energy && (
        <>
          <label>
            Energy pool{' '}
            <select
              aria-label="Energy pool"
              value={value.energy.resourceId}
              onChange={(event) =>
                patch({ energy: { ...value.energy!, resourceId: event.target.value } })
              }
            >
              {pools('energy').map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
          <div className="infrastructure-grid">
            <QuantityField
              label="Energy per item"
              value={value.energy.energyKWh}
              units={units.energy}
              minimum={limits.positiveMinimum}
              maximum={limits.amount}
              change={(energyKWh) =>
                patch({ energy: { ...value.energy!, energyKWh: energyKWh ?? 1 } })
              }
            />
            <QuantityField
              label="Requested load power"
              value={value.energy.powerKW}
              units={units.power}
              minimum={limits.positiveMinimum}
              maximum={limits.capacity}
              change={(powerKW) => patch({ energy: { ...value.energy!, powerKW: powerKW ?? 1 } })}
            />
          </div>
          <p>
            Completes when the requested energy has actually been delivered. Fixed processing time
            is zero. Insufficient power slows delivery.
          </p>
        </>
      )}
      {showGeneralRequirements && model.resources.some((pool) => !pool.infrastructure) && (
        <fieldset>
          <legend>Common pool allocations</legend>
          <p>
            Acquired atomically with this activity and released when this stage ends. These use the
            existing shared-resource allocation rules.
          </p>
          {model.resources
            .filter((pool) => !pool.infrastructure)
            .map((pool) => {
              const requirement = work.resourceRequirements?.find(
                (entry) => entry.resourceId === pool.id,
              );
              return (
                <div key={pool.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!requirement}
                      onChange={(event) =>
                        change({
                          ...work,
                          resourceRequirements: event.target.checked
                            ? [
                                ...(work.resourceRequirements ?? []),
                                { resourceId: pool.id, units: 1 },
                              ]
                            : work.resourceRequirements?.filter(
                                (entry) => entry.resourceId !== pool.id,
                              ),
                        })
                      }
                    />
                    {pool.name}
                  </label>
                  {requirement && (
                    <QuantityField
                      label={`${pool.name} units required`}
                      value={requirement.units}
                      units={[{ label: pool.unit, factor: 1 }]}
                      minimum={0.001}
                      change={(quantity) =>
                        change({
                          ...work,
                          resourceRequirements: work.resourceRequirements?.map((entry) =>
                            entry.resourceId === pool.id
                              ? { ...entry, units: quantity ?? 1 }
                              : entry,
                          ),
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
        </fieldset>
      )}
      <fieldset>
        <legend>RAM leases</legend>
        <p>
          Stage leases release after this stage. Case leases persist through transit and forks until
          explicit release or the root case ends; a later stage tops up the same pool rather than
          duplicating its case lease.
        </p>
        {(value.memory ?? []).map((lease, index) => (
          <fieldset key={`${index}:${lease.resourceId}`}>
            <legend>RAM lease {index + 1}</legend>
            <label>
              RAM pool{' '}
              <select
                aria-label={`RAM pool ${index + 1}`}
                value={lease.resourceId}
                onChange={(event) =>
                  patch({
                    memory: value.memory!.map((entry, i) =>
                      i === index ? { ...entry, resourceId: event.target.value } : entry,
                    ),
                  })
                }
              >
                {pools('memory').map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name}
                  </option>
                ))}
              </select>
            </label>
            <QuantityField
              label={`RAM amount ${index + 1}`}
              value={lease.amountMiB}
              units={units.memory}
              minimum={limits.positiveMinimum}
              maximum={limits.amount}
              change={(amountMiB) =>
                patch({
                  memory: value.memory!.map((entry, i) =>
                    i === index ? { ...entry, amountMiB: amountMiB ?? 1 } : entry,
                  ),
                })
              }
            />
            <label>
              Lease scope{' '}
              <select
                aria-label={`RAM scope ${index + 1}`}
                value={lease.scope}
                onChange={(event) =>
                  patch({
                    memory: value.memory!.map((entry, i) =>
                      i === index
                        ? { ...entry, scope: event.target.value as 'stage' | 'case' }
                        : entry,
                    ),
                  })
                }
              >
                <option value="stage">Stage</option>
                <option value="case">Root case</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => patch({ memory: value.memory!.filter((_, i) => i !== index) })}
            >
              Remove RAM lease {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={
            !pools('memory').length || (value.memory?.length ?? 0) >= limits.memoryRequirements
          }
          onClick={() => {
            const pool =
              pools('memory').find(
                (pool) =>
                  !(value.memory ?? []).some(
                    (entry) => entry.resourceId === pool.id && entry.scope === 'stage',
                  ),
              ) ?? pools('memory')[0];
            patch({
              memory: [
                ...(value.memory ?? []),
                { resourceId: pool.id, amountMiB: 64, scope: 'stage' },
              ],
            });
          }}
        >
          Add RAM lease
        </button>
      </fieldset>
      {pools('memory').length > 0 && (
        <fieldset>
          <legend>Release retained case RAM</legend>
          <p>
            Only outside parallel fork regions. Terminal completion and cancellation release
            retained case RAM automatically.
          </p>
          {pools('memory').map((pool) => (
            <label key={pool.id}>
              <input
                type="checkbox"
                checked={value.releaseMemoryResourceIds?.includes(pool.id) ?? false}
                onChange={(event) =>
                  patch({
                    releaseMemoryResourceIds: event.target.checked
                      ? [...(value.releaseMemoryResourceIds ?? []), pool.id]
                      : value.releaseMemoryResourceIds?.filter((id) => id !== pool.id),
                  })
                }
              />
              {pool.name}
            </label>
          ))}
        </fieldset>
      )}
    </fieldset>
  );
}
