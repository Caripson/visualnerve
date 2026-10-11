import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useEffect, useMemo, useState } from 'react';
import type {
  AnalyticsScenario,
  AnalyticsSignal,
  GrowthAssumptions,
  ScenarioResult,
} from '../types';
import { ChartView, type DisplaySeries } from './ChartView';
import {
  dateLabel,
  downloadText,
  errorMessage,
  isCancelled,
  inputDate,
  seriesColors,
  valueLabel,
} from './display';
import type { PanelProps } from './types';
import { reconcileAnalytics } from '../reconcile';
import { usePreview } from './use-preview';
import { UtcTimestamp } from './UtcTimestamp';
import { ProcessLinkFields } from './ProcessLinkFields';

export function ScenariosPanel(props: PanelProps & { sourceSignal?: AnalyticsSignal }) {
  const latest = (pattern: RegExp, fallback: number) => {
    const series = props.model.series.find((series) => pattern.test(series.name));
    const dataset = props.model.datasets.find((dataset) => dataset.id === series?.datasetId);
    return (
      dataset?.observations
        .filter((point) => point.seriesId === series?.id && point.value !== null)
        .at(-1)?.value ?? fallback
    );
  };
  const times = useMemo(
    () =>
      props.model.datasets
        .flatMap((dataset) => dataset.observations.map((point) => point.time))
        .sort(),
    [props.model.datasets],
  );
  const last = new Date(times.at(-1) ?? new Date().toISOString());
  const start = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1)).toISOString();
  const initial = (): AnalyticsScenario => ({
    id: crypto.randomUUID(),
    name: 'Baseline',
    version: 1,
    model: 'growth-churn',
    start,
    periods: 12,
    resolution: 'month',
    reviewed: false,
    assumptions: {
      openingCustomers: latest(/closing.*customer|customer base/i, 1000),
      newCustomers: latest(/new.*customer/i, 30),
      reactivatedCustomers: latest(/reactivat/i, 0),
      churnRate: latest(/customer churn|churn rate/i, 0.02),
      newCustomerGrowth: 0,
      openingMrc: latest(/closing mrc|mrc balance/i, 100000),
      newMrc: latest(/^new mrc/i, 5000),
      expansionMrc: latest(/expansion mrc/i, 1000),
      contractionMrc: latest(/contraction mrc/i, 2000),
      churnedMrc: latest(/churned mrc/i, 3000),
      currency:
        props.model.series.find((series) => series.unit.kind === 'currency')?.unit.currency ??
        'SEK',
    },
  });
  const [draft, setDraft] = useState<AnalyticsScenario>(initial);
  const [selected, setSelected] = useState('');
  const revision = useDefinitionRevision(
    selected,
    draft,
    props.model.scenarios.find((item) => item.id === selected),
    setDraft,
  );
  const preview = usePreview<ScenarioResult, AnalyticsScenario>(draft, props.model);
  const result = preview.value;
  const setResult = preview.setValue;
  const comparisonPreview = usePreview<ScenarioResult[], { scenarios: AnalyticsScenario[] }>(
    { scenarios: props.model.scenarios },
    props.model,
  );
  const comparison = comparisonPreview.value ?? [];
  const [error, setError] = useState('');
  const set = (patch: Partial<AnalyticsScenario>) => {
    setDraft({ ...draft, ...patch });
    setResult(undefined);
  };
  const assumption = (patch: Partial<GrowthAssumptions>) =>
    set({ assumptions: { ...draft.assumptions, ...patch }, reviewed: false });
  useEffect(() => {
    if (props.sourceSignal) {
      const signal = props.sourceSignal;
      const next = initial();
      const isChurn = /churn/i.test(
        props.model.series.find((series) => series.id === signal.seriesId)?.name ?? '',
      );
      next.name = `Scenario: ${props.model.rules.find((rule) => rule.id === signal.ruleId)?.name ?? 'signal'}`;
      next.sourceSignalId = signal.id;
      if (isChurn && signal.unit.kind === 'ratio' && signal.value !== null)
        next.assumptions.churnRate = signal.value;
      setDraft(next);
      setSelected('');
      setResult(undefined);
    }
  }, [props.sourceSignal]);
  const run = async (save: boolean) => {
    setError('');
    try {
      if (save) revision.assertCurrent();
      if (draft.processLink && !draft.processLink.reviewed)
        throw new Error('Review the process link before saving or running this scenario.');
      if (!draft.reviewed)
        throw new Error(
          'Review and confirm the assumptions before running or saving this scenario.',
        );
      const old = props.model.scenarios.find((entry) => entry.id === draft.id);
      const candidate = { ...draft, version: old?.version ?? 1 };
      const updated = save
        ? reconcileAnalytics(props.model, {
            ...props.model,
            scenarios: [
              ...props.model.scenarios.filter((entry) => entry.id !== draft.id),
              candidate,
            ],
          })
        : props.model;
      const scenario = save ? updated.scenarios.find((entry) => entry.id === draft.id)! : draft;
      const content = await props.run({ kind: 'scenario', scenario });
      if (!('kind' in content) || content.kind !== 'scenario')
        throw new Error('Unexpected scenario result.');
      setResult(content, scenario);
      if (save) {
        await props.save(await props.archive(content, { scenario }, updated));
        setSelected(scenario.id);
        setDraft(scenario);
      }
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  const compare = async () => {
    setError('');
    try {
      const configured = props.model.scenarios;
      if (!configured.length) return;
      if (
        configured.some(
          (scenario) =>
            scenario.start !== configured[0].start ||
            scenario.periods !== configured[0].periods ||
            scenario.assumptions.currency !== configured[0].assumptions.currency,
        )
      )
        throw new Error(
          'Comparison requires the same future start, horizon and currency. Review the scenario definitions.',
        );
      const results: ScenarioResult[] = [];
      for (const scenario of configured) {
        const content = await props.run({ kind: 'scenario', scenario });
        if ('kind' in content && content.kind === 'scenario') results.push(content);
      }
      comparisonPreview.setValue(results, { scenarios: configured });
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  const numberField = (label: string, key: keyof GrowthAssumptions, min = 0, max = 1e15) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={(draft.assumptions[key] as number) ?? ''}
        onChange={(event) => assumption({ [key]: Number(event.target.value) })}
      />
    </label>
  );
  const display: DisplaySeries[] = comparison.map((result, index) => ({
    id: result.scenarioId,
    name:
      props.model.scenarios.find((scenario) => scenario.id === result.scenarioId)?.name ??
      result.scenarioId,
    unit: { kind: 'count', label: 'customers' },
    color: seriesColors[index % seriesColors.length],
    provenance: 'scenario',
    points: result.points.map((point) => ({
      time: new Date(point.time).getTime(),
      value: point.closingCustomers,
      quality: 'Expected count',
    })),
  }));
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-header">
        <div>
          <h2>What-if scenarios</h2>
          <span className="muted">
            Explicit Growth & Churn assumptions, separate from observations.
          </span>
        </div>
        <a
          href="https://www.visualnerve.com/help/time-series-analysis/#simulate"
          target="_blank"
          rel="noreferrer"
        >
          Scenario guide
        </a>
      </div>
      {props.sourceSignal && (
        <p className="analytics-note">
          <strong>Review a signal-based proposal.</strong> {props.sourceSignal.explanation} Observed{' '}
          <UtcTimestamp value={props.sourceSignal.observationTime} />; first possible detection{' '}
          <UtcTimestamp value={props.sourceSignal.detectedAt} />. Values below are editable
          assumptions. Creating this scenario never changes historical data or a process model.
        </p>
      )}
      <DefinitionRevisionNotice revision={revision} label="scenario" />
      <div className="analytics-fields">
        <label>
          Saved scenario
          <select
            aria-label="Saved scenario"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const scenario = props.model.scenarios.find(
                (entry) => entry.id === event.target.value,
              );
              setDraft(scenario ? structuredClone(scenario) : initial());
              const archived = [...props.model.results]
                .reverse()
                .find(
                  (entry) =>
                    entry.content.kind === 'scenario' && entry.content.scenarioId === scenario?.id,
                );
              setResult(
                archived?.content.kind === 'scenario' ? archived.content : undefined,
                scenario ?? initial(),
                archived,
              );
            }}
          >
            <option value="">New scenario</option>
            {props.model.scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scenario name
          <input
            aria-label="Scenario name"
            value={draft.name}
            maxLength={500}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label>
          Future starts
          <input
            aria-label="Scenario starts"
            type="date"
            value={inputDate(draft.start)}
            onChange={(event) =>
              event.target.value &&
              set({ start: `${event.target.value}T00:00:00.000Z`, reviewed: false })
            }
          />
        </label>
        <label>
          Future months
          <input
            aria-label="Scenario months"
            type="number"
            min={1}
            max={120}
            step={1}
            value={draft.periods}
            onChange={(event) => set({ periods: Number(event.target.value), reviewed: false })}
          />
        </label>
      </div>
      <fieldset>
        <legend>Customer balance per month</legend>
        <div className="analytics-fields">
          {numberField('Opening customers', 'openingCustomers')}
          {numberField('New customers / month', 'newCustomers')}
          {numberField('Reactivated customers / month', 'reactivatedCustomers')}
          {numberField('Customer churn (fraction of opening base)', 'churnRate', 0, 1)}
          {numberField('New-customer growth / month (fraction)', 'newCustomerGrowth', -1, 100)}
          <label>
            Churn adjustment
            <select
              value={draft.assumptions.churnAdjustment?.kind ?? 'none'}
              onChange={(event) =>
                assumption({
                  churnAdjustment:
                    event.target.value === 'none'
                      ? undefined
                      : { kind: event.target.value as 'relative' | 'percentage-points', value: 0 },
                })
              }
            >
              <option value="none">No adjustment</option>
              <option value="relative">Relative change</option>
              <option value="percentage-points">Percentage points</option>
            </select>
          </label>
          {draft.assumptions.churnAdjustment && (
            <label>
              {draft.assumptions.churnAdjustment.kind === 'relative'
                ? 'Relative adjustment (0.20 means +20%)'
                : 'Percentage-point adjustment (0.002 means +0.2 pp)'}
              <input
                type="number"
                step="any"
                value={draft.assumptions.churnAdjustment.value}
                onChange={(event) =>
                  assumption({
                    churnAdjustment: {
                      ...draft.assumptions.churnAdjustment!,
                      value: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          )}
        </div>
        <p className="muted">
          Closing = opening + new + reactivated − opening × churn. The next month opens with the
          preceding closing balance. Decimals are expected counts; they are not rounded each period.
        </p>
      </fieldset>
      <fieldset>
        <legend>MRC balance per month</legend>
        <div className="analytics-fields">
          <label>
            Currency
            <input
              aria-label="Scenario currency"
              maxLength={3}
              value={draft.assumptions.currency}
              onChange={(event) => assumption({ currency: event.target.value.toUpperCase() })}
            />
          </label>
          {numberField('Opening MRC', 'openingMrc')}
          {numberField('New MRC / month', 'newMrc')}
          {numberField('Expansion MRC / month', 'expansionMrc')}
          {numberField('Contraction MRC / month', 'contractionMrc')}
          {numberField('Churned MRC / month', 'churnedMrc')}
          <label>
            Revenue churn model
            <select
              value={draft.assumptions.revenuePerCustomer !== undefined ? 'customer' : 'explicit'}
              onChange={(event) =>
                assumption({
                  revenuePerCustomer: event.target.value === 'customer' ? 100 : undefined,
                })
              }
            >
              <option value="explicit">Use explicit churned MRC</option>
              <option value="customer">Explicit revenue-per-lost-customer assumption</option>
            </select>
          </label>
          {draft.assumptions.revenuePerCustomer !== undefined &&
            numberField('MRC per lost customer', 'revenuePerCustomer')}
        </div>
        <p className="muted">
          Closing MRC = opening MRC + new + expansion − contraction − churned MRC. This recurring
          balance is separate from recognized period revenue and cash flow. Customer churn affects
          MRC only with the explicit revenue-per-customer assumption.
        </p>
      </fieldset>
      {props.nodes?.length ? (
        <label>
          Link to diagram node
          <select
            value={draft.nodeId ?? ''}
            onChange={(event) => set({ nodeId: event.target.value || undefined })}
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
      <ProcessLinkFields
        model={props.model}
        value={draft.processLink}
        processTargets={props.processTargets}
        loadProcessTarget={props.loadProcessTarget}
        disabled={props.busy}
        onChange={(processLink) => set({ processLink, reviewed: false })}
      />
      <div className="analytics-series-options">
        <label>
          <input
            type="checkbox"
            aria-label="Reviewed scenario assumptions"
            checked={draft.reviewed}
            onChange={(event) => setDraft({ ...draft, reviewed: event.target.checked })}
          />
          I have reviewed these assumptions. This is a projection, not a guaranteed forecast.
        </label>
      </div>
      <div className="analytics-actions">
        <button
          className="primary"
          disabled={props.busy || !draft.reviewed || !draft.name.trim()}
          onClick={() => void run(false)}
        >
          Preview scenario
        </button>
        <button
          disabled={props.busy || revision.blocked || !draft.reviewed || !draft.name.trim()}
          onClick={() => void run(true)}
        >
          Save scenario and result
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
                  reviewed: false,
                });
                setResult(undefined);
              }}
            >
              Duplicate scenario
            </button>
            <button
              className="danger"
              disabled={props.busy || revision.blocked}
              onClick={() =>
                void props
                  .save({
                    ...props.model,
                    scenarios: props.model.scenarios.filter((scenario) => scenario.id !== selected),
                  })
                  .then(() => {
                    setSelected('');
                    setDraft(initial());
                    setResult(undefined);
                  })
                  .catch((error) => setError(errorMessage(error)))
              }
            >
              Delete scenario
            </button>
          </>
        )}
        <button
          disabled={props.busy || props.model.scenarios.length < 2}
          onClick={() => void compare()}
        >
          Compare saved scenarios
        </button>
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {result && (
        <div className="analytics-results">
          <h3 style={{ marginTop: 24 }}>Scenario preview · expected counts</h3>
          <ScenarioTable results={[result]} names={new Map([[result.scenarioId, draft.name]])} />
          {result.notes.map((note, index) => (
            <p key={index} className="analytics-note">
              {note}
            </p>
          ))}
          <button
            onClick={() =>
              downloadText(
                JSON.stringify({ scenario: draft, result }, null, 2),
                'visual-nerve-scenario.json',
              )
            }
          >
            Export scenario JSON
          </button>
        </div>
      )}
      {comparison.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Same-horizon scenario comparison</h3>
          <ChartView
            chart={{
              id: 'scenario-comparison',
              name: 'Projected closing customer base',
              kind: 'line',
              seriesIds: display.map((entry) => entry.id),
              resolution: 'month',
              normalized: false,
            }}
            series={display}
            note="Dashed series are assumptions-based scenarios. The spread between scenarios is not a statistical confidence interval."
          />
          <ScenarioTable
            results={comparison}
            names={new Map(props.model.scenarios.map((scenario) => [scenario.id, scenario.name]))}
          />
        </div>
      )}
    </section>
  );
}

function ScenarioTable({
  results,
  names,
}: {
  results: ScenarioResult[];
  names: Map<string, string>;
}) {
  return (
    <div className="analytics-table-scroll">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Month</th>
            <th>Opening customers</th>
            <th>New</th>
            <th>Reactivated</th>
            <th>Lost</th>
            <th>Closing customers</th>
            <th>Closing MRC</th>
          </tr>
        </thead>
        <tbody>
          {results.flatMap((result) =>
            result.points.map((point) => (
              <tr key={`${result.scenarioId}-${point.time}`}>
                <td>{names.get(result.scenarioId) ?? result.scenarioId}</td>
                <td>{dateLabel(point.time)}</td>
                <td>{valueLabel(point.openingCustomers)}</td>
                <td>{valueLabel(point.newCustomers)}</td>
                <td>{valueLabel(point.reactivatedCustomers)}</td>
                <td>{valueLabel(point.lostCustomers)}</td>
                <td>{valueLabel(point.closingCustomers)}</td>
                <td>{valueLabel(point.closingMrc, result.currency)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
