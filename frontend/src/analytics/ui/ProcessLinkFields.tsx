import { useEffect, useState } from 'react';
import type { AnalyticsExtension, AnalyticsScenario, AnalyticsSeries } from '../types';
import type { ProcessTargetDetails, ProcessTargetProps } from './types';
import { errorMessage } from './display';

interface Parameter {
  value: string;
  name: string;
  compatible: boolean;
  reason: string;
}
function parameters(type: string | undefined, series?: AnalyticsSeries): Parameter[] {
  const count = series?.unit.kind === 'count';
  const seconds = series?.unit.kind === 'number' && /^(seconds?|s)$/i.test(series.unit.label);
  const currency = series?.unit.kind === 'currency';
  if (type === 'source')
    return [
      {
        value: 'source.maxCount',
        name: 'Maximum arrivals for the declared period',
        compatible: count,
        reason:
          'Requires an explicit count series. The saved time resolution identifies its period.',
      },
      {
        value: 'source.burst',
        name: 'Arrival burst',
        compatible: count && series?.semantics === 'flow',
        reason: 'Requires a period-flow count. Timing remains a separate process assumption.',
      },
      {
        value: 'source.ratePerHour',
        name: 'Arrival rate / hour',
        compatible: series?.semantics === 'rate' && /hour|\/h\b/i.test(series.unit.label),
        reason:
          'Requires an explicitly labelled hourly arrival rate. Monthly totals are not converted automatically.',
      },
    ];
  if (type === 'work')
    return [
      {
        value: 'work.capacity',
        name: 'Parallel capacity',
        compatible:
          count &&
          series?.semantics === 'snapshot' &&
          /capacity|slots|workers|servers|counters/i.test(series.unit.label),
        reason: 'Requires a snapshot count of capacity units, such as workers or counters.',
      },
      {
        value: 'work.processingSeconds',
        name: 'Processing seconds',
        compatible: seconds,
        reason: 'Requires seconds; no conversion or change to processing is performed here.',
      },
      {
        value: 'work.costPerParticle',
        name: 'Cost per work item',
        compatible: currency && /per.*item|\/item|per.*particle/i.test(series.unit.label),
        reason:
          'Requires currency explicitly labelled per item, and a separate check of the process currency.',
      },
      {
        value: 'work.costPerHour',
        name: 'Operating cost / hour',
        compatible: currency && /hour|\/h\b/i.test(series.unit.label),
        reason:
          'Requires currency explicitly labelled per hour, and a separate check of the process currency.',
      },
    ];
  if (type === 'outcome')
    return [
      {
        value: 'outcome.revenueOverride',
        name: 'Revenue per completed item',
        compatible: currency && /per.*item|\/item|per.*customer/i.test(series.unit.label),
        reason:
          'Requires currency explicitly labelled per completed item and matching process currency.',
      },
    ];
  return [];
}

/** A reviewed semantic reference; saving never modifies a different process document. */
export function ProcessLinkFields(
  props: ProcessTargetProps & {
    model: AnalyticsExtension;
    value?: AnalyticsScenario['processLink'];
    onChange: (value: AnalyticsScenario['processLink']) => void;
    disabled?: boolean;
  },
) {
  const [target, setTarget] = useState<ProcessTargetDetails>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const value = props.value;
  const series = props.model.series.find((item) => item.id === value?.sourceSeriesId);
  const node = target?.nodes.find((item) => item.id === value?.nodeId);
  const choices = parameters(node?.type, series);
  const chosen = choices.find((item) => item.value === value?.parameter);
  useEffect(() => {
    let active = true;
    setTarget(undefined);
    setError('');
    if (!value?.diagramId || !props.loadProcessTarget) return;
    setLoading(true);
    void props
      .loadProcessTarget(value.diagramId)
      .then((result) => {
        if (active) setTarget(result);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [value?.diagramId, props.loadProcessTarget]);
  const set = (patch: Partial<NonNullable<AnalyticsScenario['processLink']>>) => {
    props.onChange({
      diagramId: '',
      scenarioId: '',
      parameter: '',
      unit: series?.unit.label ?? '',
      resolution: series?.resolution ?? 'month',
      ...value,
      ...patch,
      reviewed: false,
    });
  };
  return (
    <details className="analytics-process-link">
      <summary>Link to a Process Simulator scenario</summary>
      <p className="analytics-note">
        Record a reviewed source, target and parameter. The process document is not changed or run.
        Applying values requires a separate reviewed process-scenario edit; no automatic rate or
        currency conversion is performed.
      </p>
      {!props.processTargets?.length ? (
        <p className="muted">Create a Process Simulator diagram first to choose a local target.</p>
      ) : (
        <div className="analytics-fields">
          <label>
            Process diagram
            <select
              aria-label="Linked process diagram"
              disabled={props.disabled}
              value={value?.diagramId ?? ''}
              onChange={(event) =>
                event.target.value
                  ? set({
                      diagramId: event.target.value,
                      nodeId: undefined,
                      scenarioId: '',
                      parameter: '',
                    })
                  : props.onChange(undefined)
              }
            >
              <option value="">No process link</option>
              {props.processTargets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {value && (
            <>
              <label>
                Analysis source series
                <select
                  aria-label="Process link source series"
                  disabled={props.disabled}
                  value={value.sourceSeriesId ?? ''}
                  onChange={(event) => {
                    const source = props.model.series.find(
                      (item) => item.id === event.target.value,
                    );
                    set({
                      sourceSeriesId: source?.id,
                      unit: source?.unit.label ?? '',
                      resolution: source?.resolution ?? 'month',
                      parameter: '',
                    });
                  }}
                >
                  <option value="">Choose source</option>
                  {props.model.series.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.unit.label} · {item.resolution}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Process node
                <select
                  aria-label="Process link node"
                  disabled={props.disabled || loading}
                  value={value.nodeId ?? ''}
                  onChange={(event) => set({ nodeId: event.target.value, parameter: '' })}
                >
                  <option value="">Choose target node</option>
                  {target?.nodes
                    .filter((item) => ['source', 'work', 'outcome'].includes(item.type))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.type}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Process scenario
                <select
                  aria-label="Process link target scenario"
                  disabled={props.disabled || loading}
                  value={value.scenarioId}
                  onChange={(event) => set({ scenarioId: event.target.value })}
                >
                  <option value="">Choose target scenario</option>
                  {target?.scenarios.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target parameter
                <select
                  aria-label="Process link parameter"
                  disabled={props.disabled || loading || !series || !node}
                  value={value.parameter}
                  onChange={(event) => set({ parameter: event.target.value })}
                >
                  <option value="">Choose compatible parameter</option>
                  {choices.map((item) => (
                    <option key={item.value} value={item.value} disabled={!item.compatible}>
                      {item.name}
                      {item.compatible ? '' : ' — incompatible units'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Source: {series?.unit.label ?? 'not selected'} · {series?.resolution ?? 'no period'}
                .{' '}
                {chosen?.reason ??
                  'Choose a compatible source and parameter. Incompatible options remain unavailable.'}
              </p>
            </>
          )}
        </div>
      )}
      {loading && <p role="status">Reading local process configuration…</p>}
      {error && (
        <p role="alert" className="analytics-error">
          {error}
        </p>
      )}
      {value && (
        <label className="analytics-series-options">
          <input
            type="checkbox"
            aria-label="Reviewed process link"
            disabled={
              props.disabled || !chosen?.compatible || !value.scenarioId || !value.nodeId || !series
            }
            checked={value.reviewed}
            onChange={(event) => props.onChange({ ...value, reviewed: event.target.checked })}
          />
          I reviewed the source unit, period, target and process currency where relevant. This saves
          a reference, without changing the process.
        </label>
      )}
    </details>
  );
}
