import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useEffect, useState } from 'react';
import type { AnalyticsRule, AnalyticsSignal, Comparator, SignalFamily } from '../types';
import { errorMessage, isCancelled } from './display';
import { SignalHistory } from './SignalHistory';
import { SignalParameterFields } from './SignalParameterFields';
import { defaultExpression, RuleExpressionEditor } from './RuleExpressionEditor';
import type { PanelProps } from './types';
import { reconcileAnalytics } from '../reconcile';
import { reconcileSignalHistory } from '../signal-history';

const families: { id: SignalFamily; name: string; explanation: string }[] = [
  {
    id: 'threshold',
    name: 'Threshold',
    explanation:
      'Compare against an explicit boundary. Strict and inclusive comparisons are distinct.',
  },
  {
    id: 'sustained',
    name: 'Sustained condition',
    explanation: 'Require consecutive complete observations. Missing periods break confirmation.',
  },
  {
    id: 'moving-average-crossover',
    name: 'Moving-average crossover',
    explanation:
      'Detect a short average crossing a long average after both windows have warmed up.',
  },
  {
    id: 'momentum',
    name: 'Trend / momentum change',
    explanation:
      'Measure rate of change over the selected lookback window. A change is not a forecast.',
  },
  {
    id: 'anomaly',
    name: 'Anomaly',
    explanation:
      'Compare with prior observations only, using sample z-score or robust median / MAD.',
  },
  {
    id: 'variation-spike',
    name: 'Variation spike',
    explanation: 'Compare recent observed variation with a preceding historical baseline.',
  },
  {
    id: 'structural-change',
    name: 'Structural change — CUSUM',
    explanation: 'Two-sided cumulative deviations from a fixed, user-reviewed baseline.',
  },
  {
    id: 'seasonality-deviation',
    name: 'Seasonality deviation',
    explanation:
      'Compare the corresponding seasonal position. At least two complete cycles are required.',
  },
  {
    id: 'kpi-divergence',
    name: 'KPI divergence',
    explanation: 'Detect opposite directions in two named KPIs, using the same explicit lookback.',
  },
  {
    id: 'custom',
    name: 'Custom rule',
    explanation:
      'Combine validated comparisons and crossings using AND / OR / NOT. No executable code.',
  },
];

export function SignalsPanel(
  props: PanelProps & {
    pendingThreshold?: { seriesId: string; value: number };
    onFocus: (signal: AnalyticsSignal) => void;
    onScenario: (signal: AnalyticsSignal) => void;
  },
) {
  const initial = (): AnalyticsRule => ({
    id: crypto.randomUUID(),
    version: 1,
    name: 'Threshold exceeded',
    enabled: true,
    family: 'threshold',
    seriesId: props.model.series[0]?.id ?? '',
    severity: 'warning',
    parameters: {
      comparator: '>',
      threshold: props.model.series[0]?.unit.kind === 'ratio' ? 0.02 : 100,
      consecutive: 1,
      cooldown: 0,
      hysteresis: 0,
      window: 12,
      shortWindow: 3,
      longWindow: 12,
      direction: 'up',
    },
  });
  const [draft, setDraft] = useState<AnalyticsRule>(initial);
  const [selected, setSelected] = useState('');
  const revision = useDefinitionRevision(
    selected,
    draft,
    props.model.rules.find((item) => item.id === selected),
    setDraft,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (props.pendingThreshold) {
      setSelected('');
      setDraft({
        ...initial(),
        seriesId: props.pendingThreshold.seriesId,
        parameters: { ...initial().parameters, threshold: props.pendingThreshold.value },
      });
    }
  }, [props.pendingThreshold]);
  const patch = (update: Partial<AnalyticsRule>) => setDraft({ ...draft, ...update });
  const parameters = (update: Partial<AnalyticsRule['parameters']>) =>
    patch({ parameters: { ...draft.parameters, ...update } });
  const saveRule = async () => {
    setError('');
    try {
      revision.assertCurrent();
      const old = props.model.rules.find((rule) => rule.id === draft.id);
      const next = { ...draft, version: old?.version ?? 1 };
      const updated = reconcileAnalytics(props.model, {
        ...props.model,
        rules: [...props.model.rules.filter((rule) => rule.id !== draft.id), next],
      });
      await props.save(updated);
      setDraft(updated.rules.find((rule) => rule.id === next.id)!);
      setSelected(next.id);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const detect = async () => {
    setError('');
    try {
      const content = await props.run({ kind: 'signals', model: props.model });
      if (!('kind' in content) || content.kind !== 'signals')
        throw new Error('Unexpected signal result.');
      const history = reconcileSignalHistory(props.model, content.signals);
      await props.save(
        await props.archive(
          { ...content, notes: [...content.notes, ...history.notes] },
          { ruleIds: props.model.rules.filter((rule) => rule.enabled).map((rule) => rule.id) },
          { ...props.model, signals: history.signals },
        ),
      );
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  const selectedSeries = props.model.series.find((series) => series.id === draft.seriesId);
  const family = families.find((family) => family.id === draft.family)!;
  return (
    <div className="analytics-signal-layout">
      <section className="analytics-panel">
        <div className="analytics-panel-header">
          <div>
            <h2>Signal tools</h2>
            <span className="muted">Deterministic monitoring rules, independent of AI.</span>
          </div>
          <a
            href="https://www.visualnerve.com/help/time-series-analysis/#detect"
            target="_blank"
            rel="noreferrer"
          >
            Signal guide
          </a>
        </div>
        <div className="analytics-actions" style={{ marginTop: 0, marginBottom: 18 }}>
          {[
            {
              name: 'Rising churn',
              family: 'sustained',
              direction: 'up',
              comparator: '>',
              threshold: 0.02,
            },
            {
              name: 'Falling net growth',
              family: 'sustained',
              direction: 'down',
              comparator: '<',
              threshold: 0,
            },
            {
              name: 'Sales slowdown',
              family: 'momentum',
              direction: 'down',
              comparator: '<',
              threshold: 0.1,
            },
            {
              name: 'Unusual variation',
              family: 'variation-spike',
              direction: 'up',
              comparator: '>',
              threshold: 2,
            },
            {
              name: 'Threshold exceeded',
              family: 'threshold',
              direction: 'up',
              comparator: '>',
              threshold: 100,
            },
          ].map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                setSelected('');
                const preferred = props.model.series.find((series) =>
                  preset.name === 'Rising churn'
                    ? series.unit.kind === 'ratio' && /churn/i.test(series.name)
                    : preset.name === 'Falling net growth'
                      ? /net.*growth/i.test(series.name)
                      : preset.name === 'Sales slowdown'
                        ? /sales|new mrc/i.test(series.name)
                        : false,
                );
                setDraft({
                  ...initial(),
                  name: preset.name,
                  seriesId: preferred?.id ?? draft.seriesId,
                  family: preset.family as SignalFamily,
                  parameters: {
                    ...initial().parameters,
                    direction: preset.direction as 'up' | 'down',
                    comparator: preset.comparator as Comparator,
                    threshold: preset.threshold,
                    consecutive: preset.family === 'sustained' ? 3 : 1,
                  },
                });
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <DefinitionRevisionNotice revision={revision} label="rule" />
        <div className="analytics-fields">
          <label>
            Saved rule
            <select
              aria-label="Saved rule"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setDraft(
                  structuredClone(
                    props.model.rules.find((rule) => rule.id === event.target.value) ?? initial(),
                  ),
                );
              }}
            >
              <option value="">New rule</option>
              {props.model.rules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name} · v{rule.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rule name
            <input
              aria-label="Rule name"
              value={draft.name}
              maxLength={500}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label>
            Signal family
            <select
              aria-label="Signal family"
              value={draft.family}
              onChange={(event) => {
                const family = event.target.value as SignalFamily;
                const defaults: Partial<AnalyticsRule['parameters']> =
                  family === 'momentum'
                    ? { threshold: 0.1, direction: 'down' }
                    : family === 'variation-spike'
                      ? { threshold: 2 }
                      : family === 'anomaly'
                        ? { threshold: 3, method: 'zscore', direction: 'both' }
                        : family === 'structural-change'
                          ? { mu0: 0, k: 1, h: 3, reset: 'on-resolve', direction: 'both' }
                          : family === 'seasonality-deviation'
                            ? {
                                seasonLength: 12,
                                tolerance: selectedSeries?.unit.kind === 'ratio' ? 0.002 : 10,
                                direction: 'both',
                              }
                            : family === 'moving-average-crossover'
                              ? { direction: 'up', shortWindow: 3, longWindow: 12, average: 'sma' }
                              : {};
                patch({
                  family,
                  secondSeriesId: family === 'kpi-divergence' ? draft.secondSeriesId : undefined,
                  parameters: { ...draft.parameters, ...defaults },
                  expression: family === 'custom' ? defaultExpression(draft.seriesId) : undefined,
                });
              }}
            >
              {families.map((family) => (
                <option value={family.id} key={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Signal series
            <select
              aria-label="Signal series"
              value={draft.seriesId}
              onChange={(event) => patch({ seriesId: event.target.value })}
            >
              {props.model.series.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.name} · {series.unit.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Configured severity
            <select
              value={draft.severity}
              onChange={(event) =>
                patch({ severity: event.target.value as AnalyticsRule['severity'] })
              }
            >
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Enabled
            <select
              value={draft.enabled ? 'yes' : 'no'}
              onChange={(event) => patch({ enabled: event.target.value === 'yes' })}
            >
              <option value="yes">Evaluate this rule</option>
              <option value="no">Disabled</option>
            </select>
          </label>
        </div>
        <p className="analytics-note">
          {family.explanation}{' '}
          {draft.family === 'momentum'
            ? 'Threshold is a nonnegative relative-change magnitude. Down compares change < −threshold; up compares change > threshold.'
            : draft.family === 'variation-spike'
              ? 'Threshold is a multiple of prior sample standard deviation; a value of 2 means strictly more than twice the variation.'
              : draft.family === 'anomaly'
                ? 'Threshold is a nonnegative standardized deviation, separate from the observed source value.'
                : selectedSeries?.unit.kind === 'ratio'
                  ? 'Ratio thresholds use fractional source units: 0.02 means 2%.'
                  : `Thresholds use ${selectedSeries?.unit.label ?? 'the original source unit'}.`}
        </p>
        <SignalParameterFields
          draft={draft}
          model={props.model}
          patch={patch}
          parameters={parameters}
        />
        {draft.family === 'custom' && (
          <RuleExpressionEditor
            expression={draft.expression ?? defaultExpression(draft.seriesId)}
            model={props.model}
            onChange={(expression) => patch({ expression })}
          />
        )}
        <div className="analytics-actions">
          <button
            className="primary"
            disabled={props.busy || revision.blocked || !draft.name.trim()}
            onClick={() => void saveRule()}
          >
            Save signal rule
          </button>
          <button
            disabled={props.busy || !props.model.rules.some((rule) => rule.enabled)}
            onClick={() => void detect()}
          >
            Evaluate saved rules
          </button>
          {selected && (
            <>
              <button
                onClick={() => {
                  setSelected('');
                  setDraft({
                    ...structuredClone(draft),
                    id: crypto.randomUUID(),
                    version: 1,
                    name: `${draft.name} copy`,
                  });
                }}
              >
                Duplicate rule
              </button>
              <button
                className="danger"
                disabled={props.busy || revision.blocked}
                onClick={() => {
                  void props
                    .save({
                      ...props.model,
                      rules: props.model.rules.filter((rule) => rule.id !== selected),
                    })
                    .then(() => {
                      setSelected('');
                      setDraft(initial());
                    })
                    .catch((error) => setError(errorMessage(error)));
                }}
              >
                Delete rule
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="analytics-note analytics-error">
            {error}
          </p>
        )}
      </section>
      <SignalHistory {...props} />
    </div>
  );
}
