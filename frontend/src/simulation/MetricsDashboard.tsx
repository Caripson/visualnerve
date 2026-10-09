import type { MessageId } from '../i18n';
import { simulationDiagnosticLabel } from './display';
import { useI18n } from '../i18n';
import type { SimulationState } from './types';
import { simulationTrafficColors } from './traffic';
import './simulation-shell.css';

// Canonical identities never depend on the selected interface language.
const metricMessages: Record<string, MessageId> = {
  Created: 'simulator.common.created',
  Completed: 'simulator.common.completed',
  'In system': 'simulator.metrics.inSystem',
  Abandoned: 'simulator.common.abandoned',
  Failed: 'simulator.metrics.failed',
  'Current queue': 'simulator.metrics.currentQueue',
  'Average queue': 'simulator.metrics.averageQueue',
  'Maximum queue': 'simulator.results.maximumQueue',
  'Throughput / hour': 'simulator.metrics.throughputHour',
  Revenue: 'simulator.common.revenue',
  'Expected revenue': 'simulator.metrics.expectedRevenue',
  Cost: 'simulator.common.cost',
  Contribution: 'simulator.results.contribution',
  'Lost revenue': 'simulator.metrics.lostRevenue',
  'Average wait': 'simulator.results.averageWait',
  'Median wait': 'simulator.metrics.medianWait',
  'P95 wait': 'simulator.metrics.p95Wait',
  'P99 wait': 'simulator.metrics.p99Wait',
  'Average TTR': 'simulator.results.averageTtr',
  'Median TTR': 'simulator.metrics.medianTtr',
  'P95 TTR': 'simulator.metrics.p95Ttr',
  'P99 TTR': 'simulator.metrics.p99Ttr',
  'Cycle time': 'simulator.metrics.cycleTime',
  Investment: 'simulator.metrics.investment',
  'Cash impact': 'simulator.metrics.cashImpact',
};
const metricGroupMessages: Record<string, MessageId> = {
  'Work & queues': 'simulator.metrics.workQueues',
  Economics: 'simulator.editor.section.economics.mobile',
  'Waiting & time to revenue': 'simulator.metrics.waitingTimeToRevenue',
};

export function MetricsDashboard({
  state,
  currency,
  compact = false,
}: {
  state: SimulationState;
  currency: string;
  compact?: boolean;
}) {
  const { t, number } = useI18n();
  const metrics = state.metrics;
  const money = (value: number) => `${number(value, { maximumFractionDigits: 2 })} ${currency}`;
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
        <dt>{t(metricMessages[String(label)])}</dt>
        <dd data-metric={label}>{value}</dd>
      </div>
    ));
  return (
    <div className="simulation-dashboard" role="region" aria-label={t('simulator.metrics.region')}>
      <div className="simulation-traffic-legend" aria-label={t('simulator.traffic.legend')}>
        {(['clear', 'busy', 'congested'] as const).map((level) => (
          <span key={level}>
            <i style={{ background: simulationTrafficColors[level] }} aria-hidden="true" />
            {level === 'clear'
              ? t('simulator.metrics.clear')
              : level === 'busy'
                ? t('simulator.metrics.busyQueueBuilding')
                : t('simulator.metrics.congested')}
          </span>
        ))}
        <small>
          {t(
            'simulator.metrics.queueAndSharedCapacityDetermineTrafficParticleShapesIdentifyWorkTypes',
          )}
        </small>
      </div>
      {!compact && (
        <div className="simulation-bottleneck" role="status">
          <strong>{t('simulator.metrics.currentBottleneck')}</strong>
          <span
            title={
              state.bottlenecks[0]?.reason
                ? simulationDiagnosticLabel(t, state.bottlenecks[0].reason)
                : undefined
            }
          >
            {state.bottlenecks[0]?.name ?? t('simulator.metrics.noConstraintObserved')}
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
              <h4>{t(metricGroupMessages[title as string])}</h4>
              <dl>
                {entries
                  .filter(([label]) => (labels as string[]).includes(label as string))
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{t(metricMessages[String(label)])}</dt>
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
            <summary>{t('simulator.metrics.moreMetrics')}</summary>
            <dl>{facts(entries.filter(([label]) => !primary.has(label as string)))}</dl>
          </details>
        </>
      )}
      <details>
        <summary>{t('simulator.metrics.bottlenecksSharedResourcesAndParticleTypes')}</summary>
        <p>
          {t('simulator.metrics.currentBottleneck.')}{' '}
          {state.bottlenecks[0]?.name ?? t('simulator.metrics.noneObserved')}.{' '}
          {state.bottlenecks[0]?.reason
            ? simulationDiagnosticLabel(t, state.bottlenecks[0].reason)
            : undefined}
        </p>
        {compact ? (
          <div className="simulation-resource-cards">
            {Object.values(state.resources).map((resource) => (
              <article key={resource.id} className="simulation-metric-card">
                <h4>{resource.name}</h4>
                <dl className="simulation-card-facts">
                  <div>
                    <dt>{t('simulator.metrics.capacityBusy')}</dt>
                    <dd>
                      {resource.capacity} / {resource.busy}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.utilization')}</dt>
                    <dd>{(resource.utilization * 100).toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.waiting')}</dt>
                    <dd>{resource.queue.current}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.cost')}</dt>
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
                  <th>{t('simulator.common.resource')}</th>
                  <th>{t('simulator.metrics.capacityBusy')}</th>
                  <th>{t('simulator.common.utilization')}</th>
                  <th>{t('simulator.common.waiting')}</th>
                  <th>{t('simulator.common.cost')}</th>
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
                    <dt>{t('simulator.common.created')}</dt>
                    <dd>{type.created}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.completed')}</dt>
                    <dd>{type.completed}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.abandoned')}</dt>
                    <dd>{type.abandoned}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.metrics.wait')}</dt>
                    <dd>{minutes(type.wait.average)}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.metrics.ttr')}</dt>
                    <dd>{minutes(type.ttr.average)}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.common.revenue')}</dt>
                    <dd>{money(type.realizedRevenue)}</dd>
                  </div>
                  <div>
                    <dt>{t('simulator.metrics.lostRevenue')}</dt>
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
                  <th>{t('simulator.common.particleType')}</th>
                  <th>{t('simulator.common.created')}</th>
                  <th>{t('simulator.common.completed')}</th>
                  <th>{t('simulator.common.abandoned')}</th>
                  <th>{t('simulator.metrics.wait')}</th>
                  <th>{t('simulator.metrics.ttr')}</th>
                  <th>{t('simulator.common.revenue')}</th>
                  <th>{t('simulator.metrics.lostRevenue')}</th>
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
          {t('simulator.metrics.retention.summary', {
            retainedEvents: state.retained.events,
            discardedEvents: state.retained.droppedEvents,
          })}{' '}
          {metrics.ttr.approximate &&
            t('simulator.metrics.ttr.approximation', {
              bucketSeconds: metrics.ttr.resolutionSeconds ?? 0,
            })}
        </p>
      </details>
    </div>
  );
}
