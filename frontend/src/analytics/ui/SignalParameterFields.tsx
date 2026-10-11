import type { AnalyticsExtension, AnalyticsRule, Comparator } from '../types';

export function SignalParameterFields({
  draft,
  model,
  patch,
  parameters,
}: {
  draft: AnalyticsRule;
  model: AnalyticsExtension;
  patch: (value: Partial<AnalyticsRule>) => void;
  parameters: (value: Partial<AnalyticsRule['parameters']>) => void;
}) {
  const numeric = (
    label: string,
    key: keyof AnalyticsRule['parameters'],
    fallback: number,
    min = 0,
    max = 10000,
    step = 'any',
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={(draft.parameters[key] as number | undefined) ?? fallback}
        onChange={(event) => parameters({ [key]: Number(event.target.value) })}
      />
    </label>
  );
  return (
    <div className="analytics-fields">
      {['threshold', 'sustained'].includes(draft.family) && (
        <>
          <label>
            Comparison
            <select
              aria-label="Rule comparison"
              value={draft.parameters.comparator ?? '>'}
              onChange={(event) => parameters({ comparator: event.target.value as Comparator })}
            >
              {['>', '>=', '<', '<=', '==', '!='].map((operator) => (
                <option key={operator}>{operator}</option>
              ))}
            </select>
          </label>
          {numeric('Threshold', 'threshold', 0, -1e12, 1e12)}
        </>
      )}
      {draft.family === 'momentum' &&
        numeric('Relative-change magnitude (0.10 means 10%)', 'threshold', 0.1, 0, 1e12)}
      {draft.family === 'variation-spike' &&
        numeric('Variation multiple (strictly above)', 'threshold', 2, 0, 1e12)}
      {['momentum', 'anomaly', 'variation-spike', 'kpi-divergence'].includes(draft.family) &&
        numeric('Historical window (observations)', 'window', 12, 2, 10000, '1')}
      {draft.family === 'moving-average-crossover' && (
        <>
          <label>
            Average method
            <select
              value={draft.parameters.average ?? 'sma'}
              onChange={(event) => parameters({ average: event.target.value as 'sma' | 'ema' })}
            >
              <option value="sma">SMA</option>
              <option value="ema">EMA</option>
            </select>
          </label>
          {numeric('Short window', 'shortWindow', 3, 1, 10000, '1')}
          {numeric('Long window', 'longWindow', 12, 2, 10000, '1')}
        </>
      )}
      {draft.family === 'anomaly' && (
        <>
          <label>
            Baseline method
            <select
              value={draft.parameters.method ?? 'zscore'}
              onChange={(event) => parameters({ method: event.target.value as 'zscore' | 'mad' })}
            >
              <option value="zscore">Sample z-score</option>
              <option value="mad">Median / MAD</option>
            </select>
          </label>
          {numeric('Deviation threshold', 'threshold', 3, 0, 10000)}
        </>
      )}
      {draft.family === 'structural-change' && (
        <>
          {numeric('Baseline mean (mu0)', 'mu0', 0, -1e12, 1e12)}
          {numeric('Allowance (k)', 'k', 1)}
          {numeric('Decision boundary (h)', 'h', 3)}
          <label>
            CUSUM reset
            <select
              value={draft.parameters.reset ?? 'on-resolve'}
              onChange={(event) =>
                parameters({ reset: event.target.value as 'on-resolve' | 'on-detect' })
              }
            >
              <option value="on-resolve">When the episode resolves</option>
              <option value="on-detect">After each detection</option>
            </select>
          </label>
        </>
      )}
      {draft.family === 'seasonality-deviation' && (
        <>
          {numeric('Season length (periods)', 'seasonLength', 12, 2, 10000, '1')}
          {numeric('Seasonal tolerance (source units)', 'tolerance', 0.2, 0, 10000)}
        </>
      )}
      {draft.family === 'kpi-divergence' && (
        <label>
          Second KPI
          <select
            value={draft.secondSeriesId ?? ''}
            onChange={(event) => patch({ secondSeriesId: event.target.value })}
          >
            <option value="">Choose a second KPI</option>
            {model.series
              .filter((series) => series.id !== draft.seriesId)
              .map((series) => (
                <option key={series.id} value={series.id}>
                  {series.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {[
        'moving-average-crossover',
        'momentum',
        'anomaly',
        'structural-change',
        'seasonality-deviation',
      ].includes(draft.family) && (
        <label>
          Direction
          <select
            value={
              draft.family === 'moving-average-crossover' && draft.parameters.direction === 'both'
                ? 'up'
                : (draft.parameters.direction ??
                  (draft.family === 'moving-average-crossover' ? 'up' : 'both'))
            }
            onChange={(event) =>
              parameters({ direction: event.target.value as 'up' | 'down' | 'both' })
            }
          >
            <option value="up">Numerical increase</option>
            <option value="down">Numerical decrease</option>
            {draft.family !== 'moving-average-crossover' && (
              <option value="both">Either direction</option>
            )}
          </select>
        </label>
      )}
      {numeric('Consecutive complete periods', 'consecutive', 1, 1, 10000, '1')}
      {numeric('Cooldown (periods)', 'cooldown', 0, 0, 10000, '1')}
      {['threshold', 'sustained'].includes(draft.family) &&
        numeric('Hysteresis (source units)', 'hysteresis', 0, 0, 1e12)}
    </div>
  );
}
