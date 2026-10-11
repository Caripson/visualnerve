import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useMemo, useState } from 'react';
import type { BacktestConfig, BacktestResult, Comparator } from '../types';
import { downloadText, errorMessage, isCancelled, valueLabel } from './display';
import type { PanelProps } from './types';
import { usePreview } from './use-preview';
import { UtcDateTimeFields } from './UtcDateTimeFields';
import { UtcTimestamp } from './UtcTimestamp';

export function SignalLabPanel(props: PanelProps) {
  const times = useMemo(
    () =>
      [
        ...new Set(
          props.model.datasets.flatMap((dataset) =>
            dataset.observations.map((point) => point.time),
          ),
        ),
      ].sort(),
    [props.model.datasets],
  );
  const initial = (): BacktestConfig => ({
    id: crypto.randomUUID(),
    name: 'Historical rule validation',
    ruleIds: props.model.rules.filter((rule) => rule.enabled).map((rule) => rule.id),
    from: times[0] ?? new Date().toISOString(),
    to: times.at(-1) ?? new Date().toISOString(),
    trainEnd: times[Math.floor(times.length / 3)] ?? times[0] ?? new Date().toISOString(),
    validationEnd:
      times[Math.floor((times.length * 2) / 3)] ?? times[0] ?? new Date().toISOString(),
    holdoutStart:
      times[Math.min(times.length - 1, Math.floor((times.length * 2) / 3) + 1)] ??
      new Date().toISOString(),
    walkForwardPeriods: 12,
    trials: Math.max(1, props.model.rules.filter((rule) => rule.enabled).length),
  });
  const [draft, setDraft] = useState<BacktestConfig>(initial);
  const [selected, setSelected] = useState('');
  const revision = useDefinitionRevision(
    selected,
    draft,
    props.model.backtests.find((item) => item.id === selected),
    setDraft,
  );
  const preview = usePreview<BacktestResult, BacktestConfig>(draft, props.model);
  const result = preview.value;
  const setResult = preview.setValue;
  const [error, setError] = useState('');
  const set = (patch: Partial<BacktestConfig>) => setDraft({ ...draft, ...patch });
  const run = async (save: boolean) => {
    setError('');
    try {
      if (save) revision.assertCurrent();
      const content = await props.run({ kind: 'backtest', model: props.model, config: draft });
      if (!('kind' in content) || content.kind !== 'backtest')
        throw new Error('Unexpected validation result.');
      setResult(content);
      if (save) {
        await props.save(
          await props.archive(
            content,
            { config: draft },
            {
              ...props.model,
              backtests: [...props.model.backtests.filter((entry) => entry.id !== draft.id), draft],
            },
          ),
        );
        setSelected(draft.id);
      }
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  const dateField = (
    label: string,
    key: 'from' | 'to' | 'trainEnd' | 'validationEnd' | 'holdoutStart',
  ) => (
    <UtcDateTimeFields
      label={label}
      value={draft[key]}
      onChange={(next) => next && set({ [key]: next })}
    />
  );
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-header">
        <div>
          <h2>Signal Lab</h2>
          <span className="muted">
            Reproduce historical detections, then evaluate a defined outcome if available.
          </span>
        </div>
        <a
          href="https://www.visualnerve.com/help/time-series-analysis/#validate"
          target="_blank"
          rel="noreferrer"
        >
          Validation guide
        </a>
      </div>
      <p className="analytics-note">
        Signal history answers when a rule would have triggered. Predictive precision and recall
        require a separate outcome, horizon and matching policy. Incomplete future windows are
        excluded. Historical data without publication revisions is retrospective.
      </p>
      <DefinitionRevisionNotice revision={revision} label="validation" />
      <div className="analytics-fields">
        <label>
          Saved validation
          <select
            aria-label="Saved validation"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const configuration = props.model.backtests.find(
                (entry) => entry.id === event.target.value,
              );
              setDraft(configuration ? structuredClone(configuration) : initial());
              const archived = [...props.model.results]
                .reverse()
                .find(
                  (entry) =>
                    entry.content.kind === 'backtest' &&
                    entry.content.configId === configuration?.id,
                );
              setResult(
                archived?.content.kind === 'backtest' ? archived.content : undefined,
                configuration ?? initial(),
                archived,
              );
            }}
          >
            <option value="">New validation</option>
            {props.model.backtests.map((configuration) => (
              <option value={configuration.id} key={configuration.id}>
                {configuration.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Validation name
          <input
            aria-label="Validation name"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            maxLength={500}
          />
        </label>
        {dateField('Analysis from', 'from')}
        {dateField('Analysis to', 'to')}
        {dateField('Train ends', 'trainEnd')}
        {dateField('Validation ends', 'validationEnd')}
        {dateField('Untouched holdout starts', 'holdoutStart')}
        <label>
          Walk-forward block (periods, maximum 1,000)
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={draft.walkForwardPeriods}
            onChange={(event) => set({ walkForwardPeriods: Number(event.target.value) })}
          />
        </label>
        <label>
          Declared search attempts
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={draft.trials}
            onChange={(event) => set({ trials: Number(event.target.value) })}
          />
        </label>
        <label>
          Simple baseline rule
          <select
            value={draft.baselineRuleId ?? ''}
            onChange={(event) => set({ baselineRuleId: event.target.value || undefined })}
          >
            <option value="">No separate baseline</option>
            {props.model.rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Rules to evaluate</legend>
        <div className="analytics-series-options">
          {props.model.rules.map((rule) => (
            <label key={rule.id}>
              <input
                type="checkbox"
                checked={draft.ruleIds.includes(rule.id)}
                onChange={(event) =>
                  set({
                    ruleIds: event.target.checked
                      ? [...draft.ruleIds, rule.id]
                      : draft.ruleIds.filter((id) => id !== rule.id),
                    trials: Math.max(
                      draft.trials,
                      event.target.checked ? draft.ruleIds.length + 1 : 1,
                    ),
                  })
                }
              />
              {rule.name}
            </label>
          ))}
        </div>
        {!props.model.rules.length && <p>No rules yet. Create one in Detect first.</p>}
      </fieldset>
      <fieldset>
        <legend>Optional predictive outcome</legend>
        <label>
          Evaluation task
          <select
            aria-label="Evaluation task"
            value={draft.outcome ? 'outcome' : 'history'}
            onChange={(event) =>
              set({
                outcome:
                  event.target.value === 'outcome'
                    ? {
                        seriesId: props.model.series[0]?.id ?? '',
                        comparator: '>',
                        threshold: 0,
                        horizon: 3,
                        matching: 'first-unmatched',
                      }
                    : undefined,
              })
            }
          >
            <option value="history">Historical signal reproduction only</option>
            <option value="outcome">Evaluate whether signals preceded an outcome</option>
          </select>
        </label>
        {draft.outcome && (
          <div className="analytics-fields" style={{ marginTop: 15 }}>
            <label>
              Outcome series
              <select
                value={draft.outcome.seriesId}
                onChange={(event) =>
                  set({ outcome: { ...draft.outcome!, seriesId: event.target.value } })
                }
              >
                {props.model.series.map((series) => (
                  <option key={series.id} value={series.id}>
                    {series.name} · {series.unit.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Outcome comparison
              <select
                value={draft.outcome.comparator}
                onChange={(event) =>
                  set({
                    outcome: { ...draft.outcome!, comparator: event.target.value as Comparator },
                  })
                }
              >
                {['>', '>=', '<', '<=', '==', '!='].map((operator) => (
                  <option key={operator}>{operator}</option>
                ))}
              </select>
            </label>
            <label>
              Outcome threshold (source units)
              <input
                type="number"
                step="any"
                value={draft.outcome.threshold}
                onChange={(event) =>
                  set({ outcome: { ...draft.outcome!, threshold: Number(event.target.value) } })
                }
              />
            </label>
            <label>
              Future horizon (observations)
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={draft.outcome.horizon}
                onChange={(event) =>
                  set({ outcome: { ...draft.outcome!, horizon: Number(event.target.value) } })
                }
              />
            </label>
          </div>
        )}
        <p className="muted">
          Matching: first unmatched outcome per episode. One outcome is not counted twice. Search
          results and holdout results remain separate.
        </p>
      </fieldset>
      <div className="analytics-actions">
        <button
          className="primary"
          disabled={props.busy || !draft.ruleIds.length || !draft.name.trim()}
          onClick={() => void run(false)}
        >
          Run historical validation
        </button>
        <button
          disabled={props.busy || revision.blocked || !draft.ruleIds.length || !draft.name.trim()}
          onClick={() => void run(true)}
        >
          Run and save validation
        </button>
        {selected && (
          <button
            className="danger"
            disabled={props.busy || revision.blocked}
            onClick={() =>
              void props
                .save({
                  ...props.model,
                  backtests: props.model.backtests.filter((entry) => entry.id !== selected),
                })
                .then(() => {
                  setSelected('');
                  setDraft(initial());
                  setResult(undefined);
                })
                .catch((error) => setError(errorMessage(error)))
            }
          >
            Delete validation definition
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {result && (
        <div className="analytics-results">
          <h3 style={{ marginTop: 24 }}>Historical validation results</h3>
          <p>
            {result.retrospective
              ? 'Retrospective analysis on currently available data.'
              : 'Point-in-time observation availability respected.'}{' '}
            {result.trials} declared search {result.trials === 1 ? 'attempt' : 'attempts'}.
          </p>
          <div className="analytics-table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Split</th>
                  <th>Events</th>
                  <th>Episodes</th>
                  <th>Active periods</th>
                  <th>Exposed periods</th>
                  <th>{draft.outcome ? 'Eligible signal episodes' : 'Evaluable observations'}</th>
                  {draft.outcome && (
                    <>
                      <th>Precision</th>
                      <th>Recall</th>
                      <th>False alarms</th>
                      <th>Matched signals / eligible</th>
                      <th>Matched outcomes / outcomes</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.results.map((entry, index) => (
                  <tr key={`${entry.ruleId}-${entry.split}-${index}`}>
                    <td>
                      {props.model.rules.find((rule) => rule.id === entry.ruleId)?.name ??
                        entry.ruleId}
                    </td>
                    <td>{entry.split}</td>
                    <td>{entry.signals}</td>
                    <td>{entry.episodes}</td>
                    <td>{entry.activePeriods}</td>
                    <td>{entry.exposedPeriods}</td>
                    <td>{entry.evaluablePeriods}</td>
                    {draft.outcome && (
                      <>
                        <td>{valueLabel(entry.precision?.value, 'ratio')}</td>
                        <td>{valueLabel(entry.recall?.value, 'ratio')}</td>
                        <td>{entry.falseAlarms ?? 'Not available'}</td>
                        <td>
                          {entry.matchedSignals ?? '—'} / {entry.evaluablePeriods}
                        </td>
                        <td>
                          {entry.matchedOutcomes ?? '—'} / {entry.outcomeCount ?? '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.notes.map((note, index) => (
            <p key={index} className="analytics-note">
              {note}
            </p>
          ))}
          <p className="muted">
            <UtcTimestamp value={draft.from} /> – <UtcTimestamp value={draft.to} />. Parameter
            selection must be completed before the untouched holdout is inspected. A search winner
            is not automatically a generally best rule.
          </p>
          <button
            onClick={() =>
              downloadText(
                JSON.stringify({ config: draft, result }, null, 2),
                'visual-nerve-signal-validation.json',
              )
            }
          >
            Export validation JSON
          </button>
        </div>
      )}
    </section>
  );
}
