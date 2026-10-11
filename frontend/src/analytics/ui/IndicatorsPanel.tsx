import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useState } from 'react';
import type { AnalyticsIndicator, IndicatorKind, IndicatorResult } from '../types';
import { downloadText, errorMessage, isCancelled, valueLabel } from './display';
import type { PanelProps } from './types';
import { usePreview } from './use-preview';
import { indicatorUnit } from '../engine';
import { UtcTimestamp } from './UtcTimestamp';
import { analyticsDefinitionsEqual } from '../reconcile';

export function IndicatorsPanel(
  props: PanelProps & {
    onOverlay: (indicator: AnalyticsIndicator, result: IndicatorResult) => void;
  },
) {
  const initial = (): AnalyticsIndicator => ({
    id: crypto.randomUUID(),
    name: 'Moving average',
    seriesId: props.model.series[0]?.id ?? '',
    kind: 'sma',
    window: 3,
  });
  const [draft, setDraft] = useState(initial);
  const [selected, setSelected] = useState('');
  const revision = useDefinitionRevision(
    selected,
    draft,
    props.model.indicators.find((item) => item.id === selected),
    setDraft,
  );
  const preview = usePreview<IndicatorResult, AnalyticsIndicator>(draft, props.model);
  const result = preview.value;
  const setResult = preview.setValue;
  const [error, setError] = useState('');
  const source = (preview.archive?.inputSnapshot.series ?? props.model.series).find(
    (series) => series.id === draft.seriesId,
  );
  const outputUnit = source ? indicatorUnit(source, draft.kind) : undefined;
  const unit =
    outputUnit?.kind === 'ratio'
      ? 'ratio'
      : outputUnit?.kind === 'currency'
        ? outputUnit.currency
        : outputUnit?.label;
  const set = (patch: Partial<AnalyticsIndicator>) => setDraft({ ...draft, ...patch });
  const compute = async (save: boolean) => {
    setError('');
    try {
      if (save) revision.assertCurrent();
      const content = await props.run({ kind: 'indicator', model: props.model, indicator: draft });
      if (!('kind' in content) || content.kind !== 'indicator')
        throw new Error('Unexpected indicator result.');
      setResult(content);
      if (preview.matches(draft)) props.onOverlay(draft, content);
      if (save) {
        await props.save(
          await props.archive(
            content,
            { indicator: draft },
            {
              ...props.model,
              indicators: [
                ...props.model.indicators.filter((entry) => entry.id !== draft.id),
                draft,
              ],
            },
          ),
        );
        setSelected(draft.id);
      }
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  return (
    <details className="analytics-panel">
      <summary>Indicator tools · SMA, EMA, ROC, variation, bands, MACD, RSI</summary>
      <DefinitionRevisionNotice revision={revision} label="indicator" />
      <div className="analytics-fields" style={{ marginTop: 18 }}>
        <label>
          Saved indicator
          <select
            aria-label="Saved indicator"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const indicator = props.model.indicators.find(
                (entry) => entry.id === event.target.value,
              );
              const definition = indicator ? structuredClone(indicator) : initial();
              setDraft(definition);
              const archived =
                indicator &&
                [...props.model.results]
                  .reverse()
                  .find(
                    (entry) =>
                      entry.content.kind === 'indicator' &&
                      entry.content.indicatorId === indicator.id &&
                      analyticsDefinitionsEqual(entry.parameters.indicator, indicator),
                  );
              setResult(
                archived?.content.kind === 'indicator' ? archived.content : undefined,
                definition,
                archived || undefined,
              );
            }}
          >
            <option value="">New indicator</option>
            {props.model.indicators.map((indicator) => (
              <option key={indicator.id} value={indicator.id}>
                {indicator.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Indicator name
          <input
            aria-label="Indicator name"
            value={draft.name}
            maxLength={500}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label>
          Indicator method
          <select
            aria-label="Indicator method"
            value={draft.kind}
            onChange={(event) => set({ kind: event.target.value as IndicatorKind })}
          >
            <option value="sma">Simple moving average</option>
            <option value="ema">Exponential moving average</option>
            <option value="roc">Rate of change</option>
            <option value="rolling-stddev">Rolling sample standard deviation</option>
            <option value="bollinger">Bollinger-style bands</option>
            <option value="macd">MACD — exploratory</option>
            <option value="rsi">RSI — exploratory</option>
          </select>
        </label>
        <label>
          Indicator series
          <select
            aria-label="Indicator series"
            value={draft.seriesId}
            onChange={(event) => set({ seriesId: event.target.value })}
          >
            {props.model.series.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Window (observations)
          <input
            aria-label="Indicator window"
            type="number"
            min={1}
            max={10000}
            step={1}
            value={draft.window}
            onChange={(event) => set({ window: Number(event.target.value) })}
          />
        </label>
        {draft.kind === 'ema' && (
          <label>
            Explicit alpha (optional)
            <input
              type="number"
              min={0.000001}
              max={1}
              step="any"
              value={draft.alpha ?? ''}
              onChange={(event) =>
                set({ alpha: event.target.value === '' ? undefined : Number(event.target.value) })
              }
              placeholder="Default 2 / (window + 1)"
            />
          </label>
        )}
        {draft.kind === 'bollinger' && (
          <label>
            Deviation multiplier
            <input
              type="number"
              min={0}
              max={1000}
              step="any"
              value={draft.multiplier ?? 2}
              onChange={(event) => set({ multiplier: Number(event.target.value) })}
            />
          </label>
        )}
        {draft.kind === 'macd' && (
          <>
            <label>
              Short EMA window
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={draft.shortWindow ?? 12}
                onChange={(event) => set({ shortWindow: Number(event.target.value) })}
              />
            </label>
            <label>
              Long EMA window
              <input
                type="number"
                min={2}
                max={10000}
                step={1}
                value={draft.longWindow ?? 26}
                onChange={(event) => set({ longWindow: Number(event.target.value) })}
              />
            </label>
            <label>
              Signal EMA window
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={draft.signalWindow ?? 9}
                onChange={(event) => set({ signalWindow: Number(event.target.value) })}
              />
            </label>
          </>
        )}
      </div>
      <p className="analytics-note">
        Warm-up and missing-data periods remain unavailable. EMA starts from the first valid value;
        RSI uses Wilder smoothing. Bands, MACD and RSI are exploratory indicators, not buying or
        selling recommendations or automatically valid business thresholds.
      </p>
      <div className="analytics-actions">
        <button disabled={props.busy || !draft.name.trim()} onClick={() => void compute(false)}>
          Calculate indicator
        </button>
        <button
          disabled={props.busy || revision.blocked || !draft.name.trim()}
          onClick={() => void compute(true)}
        >
          Save indicator and result
        </button>
        {selected && (
          <button
            className="danger"
            disabled={props.busy || revision.blocked}
            onClick={() =>
              void props
                .save({
                  ...props.model,
                  indicators: props.model.indicators.filter((entry) => entry.id !== selected),
                  results: props.model.results.map((result) => ({ ...result, stale: true })),
                })
                .then(() => {
                  setSelected('');
                  setResult(undefined);
                })
                .catch((error) => setError(errorMessage(error)))
            }
          >
            Delete indicator
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {result && (
        <div>
          {preview.archive && (
            <p className="analytics-note">
              Locked saved result · original {source?.name} ({unit ?? 'units'}).{' '}
              {preview.archive.stale
                ? 'The source or definition changed; this historical result retains its original inputs. Recalculate for current data.'
                : 'Calculated from retained immutable inputs.'}
            </p>
          )}
          <p>
            Computed {result.points.length} observation positions;{' '}
            {result.points.filter((point) => point.value === null).length} unavailable during
            warm-up, gaps or invalid baselines.
          </p>
          {result.notes.map((note, index) => (
            <p key={index} className="analytics-note">
              {note}
            </p>
          ))}
          <details>
            <summary>Indicator values</summary>
            <div className="analytics-table-scroll">
              <table className="analytics-table">
                <caption>
                  Showing first {valueLabel(Math.min(1000, result.points.length))} of{' '}
                  {valueLabel(result.points.length)} observation positions. Export indicator JSON
                  includes all positions.
                </caption>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Value</th>
                    <th>Upper</th>
                    <th>Lower</th>
                    <th>Signal</th>
                    <th>Histogram</th>
                  </tr>
                </thead>
                <tbody>
                  {result.points.slice(0, 1000).map((point) => (
                    <tr key={point.time}>
                      <td>
                        <UtcTimestamp value={point.time} />
                      </td>
                      <td>{valueLabel(point.value, unit)}</td>
                      <td>{valueLabel(point.upper, unit)}</td>
                      <td>{valueLabel(point.lower, unit)}</td>
                      <td>{valueLabel(point.signal, unit)}</td>
                      <td>{valueLabel(point.histogram, unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button
            onClick={() =>
              downloadText(
                JSON.stringify({ indicator: draft, result }, null, 2),
                'visual-nerve-indicator.json',
              )
            }
          >
            Export indicator JSON
          </button>
        </div>
      )}
    </details>
  );
}
