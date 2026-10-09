import { runStatusLabel, simulationDiagnosticLabel } from './display';
import { useI18n } from '../i18n';
import { useState } from 'react';
import type { SimulationModel, SimulationComparison } from './types';
import type { SimulationView } from './service';
import { simulationService } from './service';
import { simulationTime } from './SimulationControls';
import type { SimulationUIAction } from './ui-action';

type SavedRuns = Awaited<ReturnType<typeof simulationService.list>>;
export function SimulationResults({
  view,
  runs,
  busy,
  perform,
  compact = false,
}: {
  model: SimulationModel;
  view?: SimulationView;
  runs: SavedRuns;
  busy: boolean;
  perform: (action: (job: SimulationUIAction) => Promise<unknown>) => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const [comparisons, setComparisons] = useState<(SimulationComparison & { currency: string })[]>(
    [],
  );
  const [replayTime, setReplayTime] = useState(0);
  const replayMaximum = view?.run.result?.timeSeconds ?? view?.run.options.durationSeconds ?? 0;
  const replayMoment = Math.max(0, Math.min(replayTime, replayMaximum));
  const content = (
    <>
      <div className="simulation-row">
        <label>
          {t('simulator.results.savedRun')}{' '}
          <select
            aria-label={t('simulator.results.replayRun')}
            value={view?.run.id ?? ''}
            onChange={(event) => {
              const runId = event.target.value;
              void perform(() => simulationService.selectRun(runId));
            }}
          >
            <option value="">{t('simulator.results.chooseARun')}</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.scenarioName} · {run.createdAt.slice(11, 19)} · {runStatusLabel(t, run.status)}
              </option>
            ))}
          </select>
        </label>
        {view && (
          <>
            <label>
              {t('simulator.results.replayTime')}{' '}
              <input
                aria-label={t('simulator.results.replayTimeAccessible')}
                type="range"
                min={0}
                max={replayMaximum}
                step="any"
                value={replayMoment}
                onChange={(event) => setReplayTime(Number(event.target.value))}
              />
            </label>
            <span>{simulationTime(replayMoment)}</span>
            <button
              disabled={busy || view.run.status === 'running'}
              onClick={() =>
                perform((job) =>
                  simulationService.seek(view.run.id, replayMoment, { beforeWrite: job.check }),
                )
              }
            >
              {t('simulator.results.inspectThisMoment')}
            </button>
          </>
        )}
        <button
          disabled={busy || selectedRuns.length < 2}
          onClick={() =>
            perform(async (job) => {
              const result = await simulationService.compare(selectedRuns);
              await job.check();
              setComparisons(
                result.comparisons.map((comparison) => ({
                  ...comparison,
                  currency: result.currency,
                })),
              );
            })
          }
        >
          {t('simulator.results.compareSelectedRuns')}
        </button>
      </div>
      {!compact && (
        <div className="simulation-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('simulator.results.compare')}</th>
                <th>{t('simulator.results.runScenario')}</th>
                <th>{t('simulator.common.completed')}</th>
                <th>{t('simulator.common.abandoned')}</th>
                <th>{t('simulator.results.maxQueue')}</th>
                <th>{t('simulator.results.waitMin')}</th>
                <th>{t('simulator.results.ttrMin')}</th>
                <th>{t('simulator.common.revenue')}</th>
                <th>{t('simulator.common.cost')}</th>
                <th>{t('simulator.results.contribution')}</th>
                <th>{t('simulator.metrics.lostRevenue')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <input
                      aria-label={t('simulator.results.compareRun', { id: String(run.id) })}
                      type="checkbox"
                      checked={selectedRuns.includes(run.id)}
                      disabled={!run.metrics}
                      onChange={(event) =>
                        setSelectedRuns(
                          event.target.checked
                            ? [...selectedRuns, run.id]
                            : selectedRuns.filter((id) => id !== run.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    {run.scenarioName} · {run.id.slice(0, 8)} · {run.currency}
                  </td>
                  <td>{run.metrics?.completed ?? '—'}</td>
                  <td>{run.metrics?.abandoned ?? '—'}</td>
                  <td>{run.metrics?.queue.maximum ?? '—'}</td>
                  <td>{run.metrics ? (run.metrics.queue.wait.average / 60).toFixed(2) : '—'}</td>
                  <td>{run.metrics ? (run.metrics.ttr.average / 60).toFixed(2) : '—'}</td>
                  <td>{run.metrics?.realizedRevenue.toFixed(2) ?? '—'}</td>
                  <td>{run.metrics?.cost.toFixed(2) ?? '—'}</td>
                  <td>{run.metrics?.contribution.toFixed(2) ?? '—'}</td>
                  <td>{run.metrics?.lostRevenue.toFixed(2) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {compact && (
        <div className="simulation-run-cards">
          {runs.length === 0 && (
            <p>{t('simulator.results.noSavedRunsYetPlayTheSimulationToCreateOne')}</p>
          )}
          {runs.map((run) => (
            <article key={run.id} className="simulation-run-card">
              <label className="simulation-run-choice">
                <input
                  aria-label={t('simulator.results.compareRun', { id: String(run.id) })}
                  type="checkbox"
                  checked={selectedRuns.includes(run.id)}
                  disabled={!run.metrics}
                  onChange={(event) =>
                    setSelectedRuns(
                      event.target.checked
                        ? [...selectedRuns, run.id]
                        : selectedRuns.filter((id) => id !== run.id),
                    )
                  }
                />
                <span>
                  <strong>{run.scenarioName}</strong>
                  <small>
                    {run.createdAt.slice(0, 10)} · {run.createdAt.slice(11, 19)} ·{' '}
                    {runStatusLabel(t, run.status)}
                  </small>
                </span>
              </label>
              <dl className="simulation-card-facts">
                <div>
                  <dt>{t('simulator.common.completed')}</dt>
                  <dd>{run.metrics?.completed ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('simulator.common.abandoned')}</dt>
                  <dd>{run.metrics?.abandoned ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('simulator.results.maximumQueue')}</dt>
                  <dd>{run.metrics?.queue.maximum ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('simulator.results.averageWait')}</dt>
                  <dd>
                    {run.metrics ? (run.metrics.queue.wait.average / 60).toFixed(2) + ' min' : '—'}
                  </dd>
                </div>
                <div>
                  <dt>{t('simulator.results.averageTtr')}</dt>
                  <dd>{run.metrics ? (run.metrics.ttr.average / 60).toFixed(2) + ' min' : '—'}</dd>
                </div>
                <div>
                  <dt>{t('simulator.results.contribution')}</dt>
                  <dd>
                    {run.metrics?.contribution.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>{t('simulator.common.revenue')}</dt>
                  <dd>
                    {run.metrics?.realizedRevenue.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>{t('simulator.common.cost')}</dt>
                  <dd>
                    {run.metrics?.cost.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>{t('simulator.metrics.lostRevenue')}</dt>
                  <dd>
                    {run.metrics?.lostRevenue.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {comparisons.map((comparison) => (
        <p key={comparison.scenarioRunId}>
          {t(
            comparison.paybackReached
              ? 'simulator.results.comparison.payback'
              : 'simulator.results.comparison.noPayback',
            {
              runLabel: comparison.scenarioRunId.slice(0, 8),
              contributionDelta: comparison.delta.contribution.toFixed(2),
              currency: comparison.currency,
              cashDelta: comparison.incrementalCashImpact.toFixed(2),
              paybackTime:
                comparison.paybackTimeSeconds === null
                  ? ''
                  : simulationTime(comparison.paybackTimeSeconds!),
            },
          )}{' '}
          {comparison.warnings.map((warning) => simulationDiagnosticLabel(t, warning)).join(' ')}
        </p>
      ))}
    </>
  );
  return compact ? (
    <div className="simulation-results simulation-results-compact">{content}</div>
  ) : (
    <details className="simulation-results">
      <summary>{t('simulator.results.summary', { runCount: runs.length })}</summary>
      {content}
    </details>
  );
}
