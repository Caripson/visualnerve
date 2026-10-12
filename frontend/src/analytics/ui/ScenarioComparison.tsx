import { useEffect, useMemo, useState } from 'react';
import type { AnalyticsScenarioView, ScenarioResult } from '../types';
import { prepareScenarioHistory } from '../scenario-history';
import { validateScenarioHistorySource } from '../validation';
import { ChartView, type DisplaySeries } from './ChartView';
import { DefinitionRevisionNotice, useDefinitionRevision } from './use-definition-revision';
import { errorMessage, isCancelled, seriesColors } from './display';
import type { PanelProps } from './types';

const emptyView: AnalyticsScenarioView = {};

/** Observations and reviewed projections remain independent, explicitly selected layers. */
export function ScenarioComparison(props: PanelProps & { results: ScenarioResult[] }) {
  const canonical = props.model.scenarioView ?? emptyView;
  const [view, setView] = useState<AnalyticsScenarioView>(() => ({ ...canonical }));
  const revision = useDefinitionRevision('scenario-comparison', view, canonical, setView);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareScenarioHistory>>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scenarios = useMemo(
    () =>
      props.results
        .map((result) =>
          props.model.scenarios.find((scenario) => scenario.id === result.scenarioId),
        )
        .filter((scenario) => scenario !== undefined),
    [props.results, props.model.scenarios],
  );
  const candidates = (kind: 'customer' | 'mrc') =>
    props.model.series.filter((series) => {
      try {
        validateScenarioHistorySource(
          series,
          kind === 'customer' ? 'count' : 'currency',
          'historical source',
          scenarios[0]?.assumptions.currency,
        );
        return true;
      } catch {
        return false;
      }
    });
  useEffect(() => {
    const controller = new AbortController();
    setPrepared(undefined);
    setError('');
    if (!scenarios.length) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void prepareScenarioHistory(
      props.model,
      scenarios,
      view,
      { signal: controller.signal },
      props.run,
    )
      .then((next) => {
        if (!controller.signal.aborted) setPrepared(next);
      })
      .catch((issue) => {
        if (!controller.signal.aborted && !isCancelled(issue)) setError(errorMessage(issue));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [props.model, scenarios, view]);
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      revision.assertCurrent();
      await props.save({ ...props.model, scenarioView: view });
    } catch (issue) {
      if (!isCancelled(issue)) setError(errorMessage(issue));
    } finally {
      setSaving(false);
    }
  };
  const historical = (kind: 'customer' | 'mrc') => {
    const key = kind === 'customer' ? 'customerHistorySeriesId' : 'mrcHistorySeriesId';
    return (
      <label>
        {kind === 'customer' ? 'Historical customer balance' : 'Historical MRC balance'}
        <select
          aria-label={
            kind === 'customer' ? 'Historical customer balance' : 'Historical MRC balance'
          }
          value={view[key] ?? ''}
          disabled={saving || props.busy}
          onChange={(event) => {
            const next = { ...view };
            if (event.target.value) next[key] = event.target.value;
            else delete next[key];
            setView(next);
          }}
        >
          <option value="">No historical series selected</option>
          {candidates(kind).map((series) => (
            <option key={series.id} value={series.id}>
              {series.name} · {series.unit.currency ?? series.unit.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const history = (kind: 'customer' | 'mrc'): DisplaySeries[] =>
    (prepared?.history ?? [])
      .filter(
        (series) =>
          series.id ===
          view[kind === 'customer' ? 'customerHistorySeriesId' : 'mrcHistorySeriesId'],
      )
      .map((series) => ({ ...series, color: series.color ?? 'var(--text)' }));
  const panel = (kind: 'customer' | 'mrc') => {
    if (!prepared || !scenarios.length) return null;
    const unit = kind === 'customer' ? prepared.customerUnit : prepared.mrcUnit;
    const display: DisplaySeries[] = [
      ...history(kind),
      ...props.results.map((result, index) => ({
        id: `${result.scenarioId}-${kind}`,
        name: `${scenarios.find((scenario) => scenario.id === result.scenarioId)?.name ?? result.scenarioId} · projection`,
        unit,
        color: seriesColors[index % seriesColors.length],
        provenance: 'scenario' as const,
        points: result.points.map((point) => ({
          time: Date.parse(point.time),
          value: kind === 'customer' ? point.closingCustomers : point.closingMrc,
          quality: kind === 'customer' ? 'Expected count · scenario' : 'Assumed MRC · scenario',
        })),
      })),
    ];
    return (
      <ChartView
        key={kind}
        chart={{
          id: `scenario-comparison-${kind}`,
          name:
            kind === 'customer'
              ? 'Customer balance: history and scenarios'
              : 'MRC balance: history and scenarios',
          kind: 'line',
          seriesIds: display.map((series) => series.id),
          resolution: 'month',
          normalized: false,
        }}
        series={display}
        projectionStart={scenarios[0].start}
        note="Monthly historical snapshots use their selected first/last aggregation. Projected closing balances use scenario-period timestamps. No line connects observations to assumptions; the scenario spread is not a confidence interval."
      />
    );
  };
  return (
    <section
      className="analytics-scenario-comparison"
      aria-label="Historical and scenario comparison"
      style={{ marginTop: 24 }}
    >
      <h3>Same-horizon scenario comparison</h3>
      <p className="analytics-note">
        Explicitly choose the observed balances that describe the same customer population and MRC
        currency as your assumptions. History stays separate and ends before the projection starts.
        Different units have separate panels. This view never changes observations or scenario
        assumptions.
      </p>
      <p className="muted">
        Compatible sources are observed count or currency snapshots with a UTC calendar, native
        resolution no coarser than a month, and explicit first/last aggregation. Choose a single
        saved segment; MRC must match the compared scenario currency.
      </p>
      <DefinitionRevisionNotice revision={revision} label="comparison view" />
      <div className="analytics-fields">
        {historical('customer')}
        {historical('mrc')}
      </div>
      <div className="analytics-actions">
        <button disabled={saving || props.busy || revision.blocked} onClick={() => void save()}>
          {saving ? 'Saving comparison view…' : 'Save comparison view'}
        </button>
      </div>
      {!props.results.length && <p>Compare saved scenarios above to draw their future balances.</p>}
      {loading && <p role="status">Preparing historical observations locally…</p>}
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {prepared && (
        <div className="analytics-scenario-panels">
          {panel('customer')}
          {panel('mrc')}
        </div>
      )}
    </section>
  );
}
