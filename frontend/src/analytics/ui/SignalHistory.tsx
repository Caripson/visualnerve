import { useState } from 'react';
import { useCurrentSignals } from './use-current-signals';
import type { AnalyticsSignal } from '../types';
import { downloadText, errorMessage, valueLabel } from './display';
import { UtcTimestamp } from './UtcTimestamp';
import type { PanelProps } from './types';

export function SignalHistory(
  props: PanelProps & {
    onFocus: (signal: AnalyticsSignal) => void;
    onScenario: (signal: AnalyticsSignal) => void;
  },
) {
  const [filter, setFilter] = useState('onset');
  const [versions, setVersions] = useState('current');
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState('');
  const latestEvaluation = [...props.model.results]
    .reverse()
    .find((entry) => entry.content.kind === 'signals');
  const evaluation =
    latestEvaluation?.content.kind === 'signals' ? latestEvaluation.content : undefined;
  const { historical } = useCurrentSignals(props.model);
  const filtered = props.model.signals.filter(
    (signal) =>
      (filter === 'all' || signal.state === filter) &&
      (versions === 'all' ||
        (versions === 'historical' ? historical(signal) : !historical(signal))),
  );
  return (
    <>
      {' '}
      <section className="analytics-panel analytics-signal-history">
        <div className="analytics-panel-header">
          <div>
            <h2>Signal history</h2>
            <span className="muted">
              Onset, active and resolved are computed states. Acknowledged and muted are your
              handling choices.
            </span>
          </div>
          <div className="analytics-fields">
            <label>
              History filter
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setLimit(50);
                }}
              >
                <option value="all">All states</option>
                <option value="onset">Onset</option>
                <option value="active">Active</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>
              History versions
              <select
                value={versions}
                onChange={(event) => {
                  setVersions(event.target.value);
                  setLimit(50);
                }}
              >
                <option value="current">Current data and rules</option>
                <option value="historical">Earlier data or rule versions</option>
                <option value="all">All retained versions</option>
              </select>
            </label>
          </div>
        </div>
        {evaluation && (
          <p className="analytics-note">
            {evaluation.totalEvents.toLocaleString('en-US')} total signal events in{' '}
            {evaluation.episodeCount.toLocaleString('en-US')}{' '}
            {evaluation.episodeCount === 1 ? 'episode' : 'episodes'};{' '}
            {evaluation.unknown.toLocaleString('en-US')} unknown assessments.{' '}
            {evaluation.omittedEvents > 0 &&
              `${evaluation.omittedEvents.toLocaleString('en-US')} events were omitted from the bounded history; full-data evaluation counts are retained.`}
          </p>
        )}
        {evaluation?.notes.map((note, index) => (
          <p className="analytics-note" key={index}>
            {note}
          </p>
        ))}
        {error && (
          <p role="alert" className="analytics-note analytics-error">
            {error}
          </p>
        )}
        {!filtered.length && (
          <p className="analytics-note">
            No matching signal events. Save a rule and evaluate it against your history.
          </p>
        )}
        {filtered.slice(0, limit).map((signal) => (
          <article className="analytics-signal-item" key={signal.id}>
            <div className="analytics-panel-header" style={{ marginBottom: 0 }}>
              <strong>
                {props.model.rules.find((rule) => rule.id === signal.ruleId)?.name ?? signal.ruleId}
              </strong>
              <span className="analytics-chip">
                {signal.state} · {signal.severity}
              </span>
            </div>
            {historical(signal) && (
              <p className="analytics-note">
                Historical evidence · data version {signal.dataVersion}, rule version{' '}
                {signal.ruleVersion}, series version {signal.seriesVersion ?? 1}. Its captured
                dependencies differ from the current model or cannot be verified. This retained
                event is not a current assessment.
              </p>
            )}
            <p>{signal.explanation}</p>
            <p className="muted">
              Observed <UtcTimestamp value={signal.observationTime} /> · First possible detection{' '}
              <UtcTimestamp value={signal.detectedAt} /> ·{' '}
              {valueLabel(signal.value, signal.unit.kind === 'ratio' ? 'ratio' : signal.unit.label)}{' '}
              · Method score:{' '}
              {valueLabel(
                signal.deviationMagnitude,
                signal.unit.kind === 'ratio' && signal.deviationUnit === signal.unit.label
                  ? 'ratio'
                  : undefined,
              )}
              {signal.unit.kind === 'ratio' && signal.deviationUnit === '%'
                ? ''
                : ` ${signal.deviationUnit}`}
              ; threshold{' '}
              {valueLabel(
                signal.threshold,
                signal.unit.kind === 'ratio' && signal.thresholdUnit === signal.unit.label
                  ? 'ratio'
                  : undefined,
              )}
              {signal.unit.kind === 'ratio' && signal.thresholdUnit === '%'
                ? ''
                : ` ${signal.thresholdUnit}`}
              . Evidence: {signal.evidence.observations} observations, {signal.evidence.missing}{' '}
              missing
              {signal.evidence.exposure !== undefined
                ? `, exposure ${valueLabel(signal.evidence.exposure)}`
                : ''}
              .
            </p>
            <div className="analytics-actions">
              <button onClick={() => props.onFocus(signal)}>Inspect in chart</button>
              <button onClick={() => props.onScenario(signal)}>Create scenario from signal</button>
              <button
                disabled={props.busy}
                onClick={() =>
                  void props
                    .save({
                      ...props.model,
                      signals: props.model.signals.map((entry) =>
                        entry.id === signal.id
                          ? { ...entry, acknowledged: !entry.acknowledged }
                          : entry,
                      ),
                    })
                    .catch((error) => setError(errorMessage(error)))
                }
              >
                {signal.acknowledged ? 'Remove acknowledgement' : 'Acknowledge'}
              </button>
              <button
                disabled={props.busy}
                onClick={() =>
                  void props
                    .save({
                      ...props.model,
                      signals: props.model.signals.map((entry) =>
                        entry.id === signal.id ? { ...entry, muted: !entry.muted } : entry,
                      ),
                    })
                    .catch((error) => setError(errorMessage(error)))
                }
              >
                {signal.muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
            <details>
              <summary>Evidence and links</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>
                {JSON.stringify(
                  {
                    method: signal.method,
                    parameters: signal.parameters,
                    interval: signal.interval,
                    dataVersion: signal.dataVersion,
                    ruleVersion: signal.ruleVersion,
                    seriesVersion: signal.seriesVersion ?? 1,
                    definitionFingerprint: signal.definitionFingerprint,
                    baseline: signal.baseline,
                    threshold: signal.threshold,
                    quality: signal.quality,
                  },
                  null,
                  2,
                )}
              </pre>
              <div className="analytics-fields">
                {props.nodes?.length ? (
                  <label>
                    Diagram node
                    <select
                      disabled={props.busy}
                      value={signal.nodeId ?? ''}
                      onChange={(event) =>
                        void props
                          .save({
                            ...props.model,
                            signals: props.model.signals.map((entry) =>
                              entry.id === signal.id
                                ? { ...entry, nodeId: event.target.value || undefined }
                                : entry,
                            ),
                          })
                          .catch((error) => setError(errorMessage(error)))
                      }
                    >
                      <option value="">No node link</option>
                      {props.nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  Measurement link
                  <select
                    disabled={props.busy}
                    value={signal.measurementId ?? ''}
                    onChange={(event) =>
                      void props
                        .save({
                          ...props.model,
                          signals: props.model.signals.map((entry) =>
                            entry.id === signal.id
                              ? { ...entry, measurementId: event.target.value || undefined }
                              : entry,
                          ),
                        })
                        .catch((error) => setError(errorMessage(error)))
                    }
                  >
                    <option value="">No measurement link</option>
                    {props.model.measurements.map((measurement) => (
                      <option key={measurement.id} value={measurement.id}>
                        {measurement.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </article>
        ))}
        {filtered.length > limit && (
          <button onClick={() => setLimit(limit + 50)}>Show 50 more events</button>
        )}
        <div className="analytics-actions">
          <button
            disabled={!props.model.signals.length}
            onClick={() =>
              downloadText(
                JSON.stringify(props.model.signals, null, 2),
                'visual-nerve-signals.json',
              )
            }
          >
            Export signal history
          </button>
        </div>
        <p className="analytics-note">
          Severity is configured by you. Deviation size is numerical evidence; it is separate from
          predictive accuracy. No automatic confidence score or causation claim is assigned.
        </p>
      </section>
    </>
  );
}
