import type { CSSProperties } from 'react';
import type { SimulationState } from '../types';
import { simulationTrafficColors } from '../traffic';
import { infrastructureMetricIds, infrastructureReading } from './metrics';
import './infrastructure-ui.css';
import { formatInfrastructureQuantity } from './format';
export function InfrastructureMetricsPanel({
  state,
  currency,
}: {
  state: SimulationState;
  currency: string;
}) {
  const ids = infrastructureMetricIds(state);
  if (!ids.length) return null;
  return (
    <section aria-label="Infrastructure capacity metrics" className="infrastructure-metrics">
      <h4>Infrastructure capacity</h4>
      <p>
        Current allocation and integrated totals from this run. Red identifies queued capacity,
        shared or unavailable bandwidth, or unmet power; the reason is shown with each pool.
      </p>
      <div className="infrastructure-grid">
        {ids.map((id) => {
          const value = infrastructureReading(state, id)!;
          return (
            <article key={id} className="infrastructure-pool-metrics">
              <h5>
                {state.resources[id]?.name ?? id} · {value.kind}
              </h5>
              <span
                className="infrastructure-pressure"
                data-infrastructure-pressure={value.pressure}
                style={
                  { '--pressure-color': simulationTrafficColors[value.pressure] } as CSSProperties
                }
              >
                <i aria-hidden="true" />
                {value.pressure === 'clear'
                  ? 'Clear'
                  : value.pressure === 'busy'
                    ? 'Busy'
                    : 'Constrained'}{' '}
                · {value.reason}
              </span>
              <dl className="simulation-card-facts">
                {value.facts.map(([label, amount, unit]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd data-infrastructure-metric={`${id}:${label}`}>
                      {formatInfrastructureQuantity(amount)} {unit === 'currency' ? currency : unit}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
