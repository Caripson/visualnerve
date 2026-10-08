import { useState } from 'react';
import type { SimulationModel, SimulationComparison } from './types';
import type { SimulationView } from './service';
import { simulationService } from './service';
import { simulationTime } from './SimulationControls';

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
  perform: (action: () => Promise<unknown>) => Promise<void>;
  compact?: boolean;
}) {
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
          Saved run
          <select
            aria-label="Replay run"
            value={view?.run.id ?? ''}
            onChange={(event) => perform(() => simulationService.selectRun(event.target.value))}
          >
            <option value="">Choose a run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.scenarioName} · {run.createdAt.slice(11, 19)} · {run.status}
              </option>
            ))}
          </select>
        </label>
        {view && (
          <>
            <label>
              Replay time
              <input
                aria-label="Replay simulated time"
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
              onClick={() => perform(() => simulationService.seek(view.run.id, replayMoment))}
            >
              Inspect this moment
            </button>
          </>
        )}
        <button
          disabled={busy || selectedRuns.length < 2}
          onClick={() =>
            perform(async () => {
              const result = await simulationService.compare(selectedRuns);
              setComparisons(
                result.comparisons.map((comparison) => ({
                  ...comparison,
                  currency: result.currency,
                })),
              );
            })
          }
        >
          Compare selected runs
        </button>
      </div>
      {!compact && (
        <div className="simulation-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Compare</th>
                <th>Run / scenario</th>
                <th>Completed</th>
                <th>Abandoned</th>
                <th>Max queue</th>
                <th>Wait (min)</th>
                <th>TTR (min)</th>
                <th>Revenue</th>
                <th>Cost</th>
                <th>Contribution</th>
                <th>Lost revenue</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <input
                      aria-label={`Compare run ${run.id}`}
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
          {runs.length === 0 && <p>No saved runs yet. Play the simulation to create one.</p>}
          {runs.map((run) => (
            <article key={run.id} className="simulation-run-card">
              <label className="simulation-run-choice">
                <input
                  aria-label={`Compare run ${run.id}`}
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
                    {run.createdAt.slice(0, 10)} · {run.createdAt.slice(11, 19)} · {run.status}
                  </small>
                </span>
              </label>
              <dl className="simulation-card-facts">
                <div>
                  <dt>Completed</dt>
                  <dd>{run.metrics?.completed ?? '—'}</dd>
                </div>
                <div>
                  <dt>Abandoned</dt>
                  <dd>{run.metrics?.abandoned ?? '—'}</dd>
                </div>
                <div>
                  <dt>Maximum queue</dt>
                  <dd>{run.metrics?.queue.maximum ?? '—'}</dd>
                </div>
                <div>
                  <dt>Average wait</dt>
                  <dd>
                    {run.metrics ? (run.metrics.queue.wait.average / 60).toFixed(2) + ' min' : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Average TTR</dt>
                  <dd>{run.metrics ? (run.metrics.ttr.average / 60).toFixed(2) + ' min' : '—'}</dd>
                </div>
                <div>
                  <dt>Contribution</dt>
                  <dd>
                    {run.metrics?.contribution.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>Revenue</dt>
                  <dd>
                    {run.metrics?.realizedRevenue.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>
                    {run.metrics?.cost.toFixed(2) ?? '—'} {run.currency}
                  </dd>
                </div>
                <div>
                  <dt>Lost revenue</dt>
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
          Scenario {comparison.scenarioRunId.slice(0, 8)}: contribution change{' '}
          {comparison.delta.contribution.toFixed(2)} {comparison.currency}; incremental cash{' '}
          {comparison.incrementalCashImpact.toFixed(2)} {comparison.currency};{' '}
          {comparison.paybackReached
            ? `payback at ${simulationTime(comparison.paybackTimeSeconds!)}`
            : 'investment has not paid back within this run'}
          . {comparison.warnings.join(' ')}
        </p>
      ))}
    </>
  );
  return compact ? (
    <div className="simulation-results simulation-results-compact">{content}</div>
  ) : (
    <details className="simulation-results">
      <summary>Replay and compare runs ({runs.length})</summary>
      {content}
    </details>
  );
}
