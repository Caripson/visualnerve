import type { AnalyticsSeries, AnalyticsUnit } from '../types';

export interface ColumnConfiguration {
  selected: boolean;
  id: string;
  name: string;
  unit: AnalyticsUnit;
  semantics: AnalyticsSeries['semantics'];
  aggregation: AnalyticsSeries['aggregation'];
  direction: AnalyticsSeries['direction'];
  riskPopulation?: AnalyticsSeries['riskPopulation'];
}
export function ImportColumnFields({
  config,
  onChange,
}: {
  config: ColumnConfiguration;
  onChange: (update: Partial<ColumnConfiguration>) => void;
}) {
  return (
    <div className="analytics-fields">
      <label>
        Series name
        <input value={config.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label>
        Unit type
        <select
          value={config.unit.kind}
          onChange={(event) =>
            onChange({
              unit: {
                kind: event.target.value as AnalyticsUnit['kind'],
                label:
                  event.target.value === 'ratio'
                    ? '%'
                    : event.target.value === 'count'
                      ? 'count'
                      : 'units',
                ...(event.target.value === 'currency' ? { currency: 'SEK', label: 'SEK' } : {}),
              },
            })
          }
        >
          <option value="number">Number with a unit</option>
          <option value="count">Count</option>
          <option value="currency">Currency</option>
          <option value="ratio">Ratio / percentage</option>
        </select>
      </label>
      <label>
        {config.unit.kind === 'currency' ? 'Currency code' : 'Unit label'}
        <input
          value={config.unit.kind === 'currency' ? config.unit.currency : config.unit.label}
          maxLength={50}
          onChange={(event) =>
            onChange({
              unit: {
                ...config.unit,
                label: event.target.value,
                ...(config.unit.kind === 'currency'
                  ? { currency: event.target.value.toUpperCase() }
                  : {}),
              },
            })
          }
        />
      </label>
      <label>
        Data meaning
        <select
          value={config.semantics}
          onChange={(event) => {
            const semantics = event.target.value as AnalyticsSeries['semantics'];
            onChange({
              semantics,
              aggregation:
                semantics === 'snapshot' ? 'last' : semantics === 'flow' ? 'sum' : 'none',
            });
          }}
        >
          <option value="snapshot">Snapshot / balance</option>
          <option value="flow">Period flow / change</option>
          <option value="rate">Rate / ratio</option>
        </select>
      </label>
      <label>
        Allowed aggregation
        <select
          value={config.aggregation}
          onChange={(event) =>
            onChange({
              aggregation: event.target.value as AnalyticsSeries['aggregation'],
            })
          }
        >
          {(config.semantics === 'snapshot'
            ? ['first', 'last', 'none']
            : config.semantics === 'flow'
              ? ['sum', 'none']
              : ['ratio', 'none']
          ).map((aggregation) => (
            <option key={aggregation}>{aggregation}</option>
          ))}
        </select>
      </label>
      <label>
        Desired direction
        <select
          value={config.direction}
          onChange={(event) =>
            onChange({
              direction: event.target.value as AnalyticsSeries['direction'],
            })
          }
        >
          <option value="neutral">Neutral</option>
          <option value="higher-is-better">Higher is better</option>
          <option value="lower-is-better">Lower is better</option>
        </select>
      </label>
      {config.semantics === 'rate' && (
        <label>
          Rate denominator meaning
          <select
            value={config.riskPopulation ?? 'other'}
            onChange={(event) =>
              onChange({
                riskPopulation: event.target.value as AnalyticsSeries['riskPopulation'],
              })
            }
          >
            <option value="other">Other / explicitly described</option>
            <option value="opening-customers">Customer churn on the opening risk population</option>
          </select>
        </label>
      )}
    </div>
  );
}
