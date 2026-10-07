import type { SimulationState } from './types';
import { simulationTrafficColors } from './traffic';
import './simulation-shell.css';

export function MetricsDashboard({
  state,
  currency,
  compact = false,
}: {
  state: SimulationState;
  currency: string;
  compact?: boolean;
}) {
  const metrics = state.metrics;
  const money = (value: number) =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
  const minutes = (value: number | null) =>
    value === null ? '—' : `${(value / 60).toFixed(2)} min`;
  const entries = [
    ['Created', metrics.created],
    ['Completed', metrics.completed],
    ['In system', metrics.inSystem],
    ['Abandoned', metrics.abandoned],
    ['Failed', metrics.failed],
    ['Current queue', metrics.queue.current],
    ['Average queue', metrics.queue.average.toFixed(2)],
    ['Maximum queue', metrics.queue.maximum],
    ['Throughput / hour', metrics.throughputPerHour.toFixed(2)],
    ['Revenue', money(metrics.realizedRevenue)],
    ['Expected revenue', money(metrics.expectedRevenue)],
    ['Cost', money(metrics.cost)],
    ['Contribution', money(metrics.contribution)],
    ['Lost revenue', money(metrics.lostRevenue)],
    ['Average wait', minutes(metrics.queue.wait.average)],
    ['Median wait', minutes(metrics.queue.wait.median)],
    ['P95 wait', minutes(metrics.queue.wait.p95)],
    ['P99 wait', minutes(metrics.queue.wait.p99)],
    ['Average TTR', minutes(metrics.ttr.average)],
    ['Median TTR', minutes(metrics.ttr.median)],
    ['P95 TTR', minutes(metrics.ttr.p95)],
    ['P99 TTR', minutes(metrics.ttr.p99)],
    ['Cycle time', minutes(metrics.cycleTime.average)],
    ['Investment', money(metrics.investmentCost)],
    ['Cash impact', money(metrics.cumulativeCashImpact)],
  ];
  const primary = new Set([
    'Created',
    'Completed',
    'Current queue',
    'Average wait',
    'Throughput / hour',
    'Revenue',
    'Cost',
    'Contribution',
    'Lost revenue',
    'Average TTR',
  ]);
  const facts = (items: typeof entries) =>
    items.map(([label, value]) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd data-metric={label}>{value}</dd>
      </div>
    ));
  return (
    <div className="simulation-dashboard" role="region" aria-label="Simulation metrics">
      <div className="simulation-traffic-legend" aria-label="Process traffic legend">
        {(['clear', 'busy', 'congested'] as const).map((level) => (
          <span key={level}>
            <i style={{ background: simulationTrafficColors[level] }} aria-hidden="true" />
            {level === 'clear' ? 'Clear' : level === 'busy' ? 'Busy / queue building' : 'Congested'}
          </span>
        ))}
        <small>
          Queue and shared capacity determine traffic. Particle shapes identify work types.
        </small>
      </div>
      {!compact && (
        <div className="simulation-bottleneck" role="status">
          <strong>Current bottleneck</strong>
          <span title={state.bottlenecks[0]?.reason}>
            {state.bottlenecks[0]?.name ?? 'No constraint observed'}
          </span>
        </div>
      )}
      {compact ? (
        <div className="simulation-metric-groups">
          {[
            [
              'Work & queues',
              [
                'Created',
                'Completed',
                'In system',
                'Abandoned',
                'Failed',
                'Current queue',
                'Average queue',
                'Maximum queue',
                'Throughput / hour',
              ],
            ],
            [
              'Economics',
              [
                'Revenue',
                'Expected revenue',
                'Cost',
                'Contribution',
                'Lost revenue',
                'Investment',
                'Cash impact',
              ],
            ],
            [
              'Waiting & time to revenue',
              [
                'Average wait',
                'Median wait',
                'P95 wait',
                'P99 wait',
                'Average TTR',
                'Median TTR',
                'P95 TTR',
                'P99 TTR',
                'Cycle time',
              ],
            ],
          ].map(([title, labels]) => (
            <section key={title as string} className="simulation-metric-group">
              <h4>{title}</h4>
              <dl>
                {entries
                  .filter(([label]) => (labels as string[]).includes(label as string))
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd data-metric={label}>{value}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      ) : (
        <>
          <dl className="simulation-primary-metrics">
            {facts(entries.filter(([label]) => primary.has(label as string)))}
          </dl>
          <details className="simulation-extra-metrics">
            <summary>More metrics</summary>
            <dl>{facts(entries.filter(([label]) => !primary.has(label as string)))}</dl>
          </details>
        </>
      )}
      <details>
        <summary>Bottlenecks, shared resources and particle types</summary>
        <p>
          Current bottleneck: {state.bottlenecks[0]?.name ?? 'None observed'}.{' '}
          {state.bottlenecks[0]?.reason}
        </p>
        {compact ? (
          <div className="simulation-resource-cards">
            {Object.values(state.resources).map((resource) => (
              <article key={resource.id} className="simulation-metric-card">
                <h4>{resource.name}</h4>
                <dl className="simulation-card-facts">
                  <div>
                    <dt>Capacity / busy</dt>
                    <dd>
                      {resource.capacity} / {resource.busy}
                    </dd>
                  </div>
                  <div>
                    <dt>Utilization</dt>
                    <dd>{(resource.utilization * 100).toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>Waiting</dt>
                    <dd>{resource.queue.current}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{money(resource.cost)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="simulation-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Capacity / busy</th>
                  <th>Utilization</th>
                  <th>Waiting</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(state.resources).map((resource) => (
                  <tr key={resource.id}>
                    <td>{resource.name}</td>
                    <td>
                      {resource.capacity} / {resource.busy}
                    </td>
                    <td>{(resource.utilization * 100).toFixed(1)}%</td>
                    <td>{resource.queue.current}</td>
                    <td>{money(resource.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {compact ? (
          <div className="simulation-type-cards">
            {Object.values(state.particleTypes).map((type) => (
              <article key={type.id} className="simulation-metric-card">
                <h4>{type.name}</h4>
                <dl className="simulation-card-facts">
                  <div>
                    <dt>Created</dt>
                    <dd>{type.created}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{type.completed}</dd>
                  </div>
                  <div>
                    <dt>Abandoned</dt>
                    <dd>{type.abandoned}</dd>
                  </div>
                  <div>
                    <dt>Wait</dt>
                    <dd>{minutes(type.wait.average)}</dd>
                  </div>
                  <div>
                    <dt>TTR</dt>
                    <dd>{minutes(type.ttr.average)}</dd>
                  </div>
                  <div>
                    <dt>Revenue</dt>
                    <dd>{money(type.realizedRevenue)}</dd>
                  </div>
                  <div>
                    <dt>Lost revenue</dt>
                    <dd>{money(type.lostRevenue)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="simulation-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Particle type</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Abandoned</th>
                  <th>Wait</th>
                  <th>TTR</th>
                  <th>Revenue</th>
                  <th>Lost revenue</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(state.particleTypes).map((type) => (
                  <tr key={type.id}>
                    <td>{type.name}</td>
                    <td>{type.created}</td>
                    <td>{type.completed}</td>
                    <td>{type.abandoned}</td>
                    <td>{minutes(type.wait.average)}</td>
                    <td>{minutes(type.ttr.average)}</td>
                    <td>{money(type.realizedRevenue)}</td>
                    <td>{money(type.lostRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          Showing a bounded particle sample; metrics include every simulated item. Retained events:{' '}
          {state.retained.events}, earlier events discarded: {state.retained.droppedEvents}.{' '}
          {metrics.ttr.approximate &&
            `TTR percentiles use a deterministic histogram (${metrics.ttr.resolutionSeconds}s buckets).`}
        </p>
      </details>
    </div>
  );
}
