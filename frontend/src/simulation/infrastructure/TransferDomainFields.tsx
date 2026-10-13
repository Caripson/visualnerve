import type { SimulationEdge, SimulationModel } from '../types';
import { QuantityField } from './QuantityField';
import { quantityUnits as units } from './quantity';
import { infrastructureLimits as limits } from './types';
export function TransferDomainFields({
  model,
  edge,
  change,
}: {
  model: SimulationModel;
  edge: SimulationEdge;
  change: (patch: Partial<SimulationEdge>) => void;
}) {
  const pools = model.resources.filter((pool) => pool.infrastructure?.kind === 'bandwidth');
  const transfer = edge.infrastructure?.transfer;
  return (
    <fieldset>
      <legend>Network transfer</legend>
      <label>
        <input
          type="checkbox"
          checked={!!transfer}
          disabled={!transfer && !pools.length}
          onChange={(event) =>
            change({
              infrastructure: event.target.checked
                ? { transfer: { resourceId: pools[0].id, bytes: 1048576 } }
                : undefined,
            })
          }
        />
        Serialize payload on a shared link
      </label>
      {!pools.length && <small>Add a Bandwidth pool in Resources to configure a transfer.</small>}
      {transfer && (
        <>
          <label>
            Bandwidth pool{' '}
            <select
              aria-label={`Bandwidth pool ${edge.id}`}
              value={transfer.resourceId}
              onChange={(event) =>
                change({
                  infrastructure: { transfer: { ...transfer, resourceId: event.target.value } },
                })
              }
            >
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
          <QuantityField
            label={`Payload ${edge.id}`}
            value={transfer.bytes}
            units={units.payload}
            minimum={limits.positiveMinimum}
            maximum={limits.amount}
            change={(bytes) =>
              change({ infrastructure: { transfer: { ...transfer, bytes: bytes ?? 1 } } })
            }
          />
          <QuantityField
            label={`Propagation delay ${edge.id}`}
            value={edge.travelSeconds ?? 0}
            units={units.time}
            maximum={limits.durationSeconds}
            change={(travelSeconds) => change({ travelSeconds })}
          />
          <p>
            Concurrent transfers fairly share this pool's Mbps. Propagation begins after
            serialization. This is a fluid capacity model, not TCP packet simulation; site positions
            do not imply distance or latency.
          </p>
        </>
      )}
    </fieldset>
  );
}
