import { useState } from 'react';
import type { AnalyticsSeries, DerivedExpression } from '../types';
import { errorMessage } from './display';
import type { PanelProps } from './types';
import { compatibleUnits } from '../engine';

export function DerivedSeriesEditor(props: PanelProps) {
  const first = props.model.series[0];
  const [name, setName] = useState('Derived series');
  const [operation, setOperation] = useState<DerivedExpression['operation']>('difference');
  const [left, setLeft] = useState(first?.id ?? '');
  const [right, setRight] = useState(props.model.series[1]?.id ?? first?.id ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const unary = operation === 'difference' || operation === 'relative-change';
  const create = async () => {
    setError('');
    setNotice('');
    try {
      const source = props.model.series.find((series) => series.id === left);
      if (!source) throw new Error('Choose a source series.');
      const other = props.model.series.find((series) => series.id === right);
      const dimensional =
        operation === 'multiply' && source.unit.kind === 'ratio' && other ? other : source;
      const ratio =
        operation === 'relative-change' ||
        (operation === 'divide' && other && compatibleUnits(source, other));
      const difference = operation === 'difference';
      const series: AnalyticsSeries = {
        ...structuredClone(dimensional),
        id: crypto.randomUUID(),
        version: 1,
        name,
        columnId: undefined,
        provenance: 'derived',
        derived: { operation, seriesIds: unary ? [left] : [left, right] },
        unit: ratio ? { kind: 'ratio', label: '%' } : dimensional.unit,
        semantics: ratio ? 'rate' : difference ? 'flow' : dimensional.semantics,
        aggregation: ratio ? 'none' : difference ? 'sum' : dimensional.aggregation,
        riskPopulation: undefined,
        definition: `${operation} of ${unary ? left : `${left}, ${right}`}. Observations matched by time; unavailable inputs remain missing.`,
      };
      await props.save({
        ...props.model,
        series: [...props.model.series, series],
        results: props.model.results.map((result) => ({ ...result, stale: true })),
      });
      setNotice('Derived series saved. Select it in Explore.');
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  return (
    <details className="analytics-panel">
      <summary>Create a derived series with a validated expression</summary>
      <p>
        Derived values reference original series by stable IDs. No executable formula, JavaScript or
        imported code runs.
      </p>
      <div className="analytics-fields">
        <label>
          Derived-series name
          <input
            aria-label="Derived-series name"
            value={name}
            maxLength={500}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Operation
          <select
            aria-label="Derived operation"
            value={operation}
            onChange={(event) => setOperation(event.target.value as DerivedExpression['operation'])}
          >
            <option value="difference">Difference from previous observation</option>
            <option value="relative-change">Relative change from previous observation</option>
            <option value="sum">Add two series</option>
            <option value="subtract">Subtract second series</option>
            <option value="multiply">Multiply two series</option>
            <option value="divide">Divide by second series</option>
          </select>
        </label>
        <label>
          First source
          <select value={left} onChange={(event) => setLeft(event.target.value)}>
            {props.model.series.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name}
              </option>
            ))}
          </select>
        </label>
        {!unary && (
          <label>
            Second source
            <select value={right} onChange={(event) => setRight(event.target.value)}>
              {props.model.series.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="analytics-actions">
        <button disabled={props.busy || !name.trim()} onClick={() => void create()}>
          Create derived series
        </button>
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="analytics-note analytics-success">
          {notice}
        </p>
      )}
    </details>
  );
}
