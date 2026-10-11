import type { AnalyticsExtension, Comparator, SignalExpression, SignalOperand } from '../types';

export function defaultExpression(seriesId: string): SignalExpression {
  return {
    kind: 'comparison',
    left: { kind: 'series', seriesId },
    operator: '>',
    right: { kind: 'constant', value: 0.02 },
  };
}

function OperandEditor({
  value,
  model,
  onChange,
  label,
}: {
  value: SignalOperand;
  model: AnalyticsExtension;
  onChange: (next: SignalOperand) => void;
  label: string;
}) {
  const key =
    value.kind === 'series'
      ? `series:${value.seriesId}`
      : value.kind === 'indicator'
        ? `indicator:${value.indicatorId}`
        : 'constant';
  return (
    <>
      <label>
        {label}
        <select
          aria-label={label}
          value={key}
          onChange={(event) => {
            const separator = event.target.value.indexOf(':');
            const kind =
              separator < 0 ? event.target.value : event.target.value.slice(0, separator);
            const id = separator < 0 ? '' : event.target.value.slice(separator + 1);
            onChange(
              kind === 'series'
                ? { kind, seriesId: id }
                : kind === 'indicator'
                  ? { kind, indicatorId: id }
                  : { kind: 'constant', value: 0 },
            );
          }}
        >
          <option value="constant">Constant in source units</option>
          {model.series.map((series) => (
            <option key={series.id} value={`series:${series.id}`}>
              {series.name} · {series.unit.label}
            </option>
          ))}
          {model.indicators.map((indicator) => (
            <option key={indicator.id} value={`indicator:${indicator.id}`}>
              {indicator.name}
            </option>
          ))}
        </select>
      </label>
      {value.kind === 'constant' && (
        <label>
          {label} constant
          <input
            aria-label={`${label} constant`}
            type="number"
            step="any"
            value={value.value}
            onChange={(event) => onChange({ ...value, value: Number(event.target.value) })}
          />
        </label>
      )}
      {value.kind === 'indicator' && (
        <label>
          {label} component
          <select
            value={value.component ?? 'value'}
            onChange={(event) =>
              onChange({
                ...value,
                component: event.target.value as Extract<
                  SignalOperand,
                  { kind: 'indicator' }
                >['component'],
              })
            }
          >
            {[
              'value',
              ...(model.indicators.find((indicator) => indicator.id === value.indicatorId)?.kind ===
              'bollinger'
                ? ['upper', 'lower']
                : model.indicators.find((indicator) => indicator.id === value.indicatorId)?.kind ===
                    'macd'
                  ? ['signal', 'histogram']
                  : []),
            ].map((component) => (
              <option key={component}>{component}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function RuleExpressionEditor({
  expression,
  model,
  onChange,
  depth = 0,
  path = 'Rule',
}: {
  expression: SignalExpression;
  model: AnalyticsExtension;
  onChange: (next: SignalExpression) => void;
  depth?: number;
  path?: string;
}) {
  const initial = () => defaultExpression(model.series[0]?.id ?? '');
  return (
    <div className="analytics-rule-tree">
      <label>
        {path} logic
        <select
          aria-label={`${path} logic`}
          value={expression.kind}
          onChange={(event) => {
            const kind = event.target.value as SignalExpression['kind'];
            onChange(
              kind === 'and' || kind === 'or'
                ? { kind, children: [initial(), initial()] }
                : kind === 'not'
                  ? { kind, child: initial() }
                  : kind === 'sustained'
                    ? { kind, periods: 3, child: initial() }
                    : kind === 'window'
                      ? {
                          kind,
                          operand: { kind: 'series', seriesId: model.series[0]?.id ?? '' },
                          operation: 'mean',
                          periods: 3,
                          operator: '>',
                          threshold: 0,
                        }
                      : kind === 'crossing'
                        ? {
                            kind,
                            direction: 'up',
                            left: { kind: 'series', seriesId: model.series[0]?.id ?? '' },
                            right: { kind: 'constant', value: 0 },
                          }
                        : initial(),
            );
          }}
        >
          <option value="comparison">Compare values</option>
          <option value="crossing">Crossing</option>
          <option value="window">Rolling window condition</option>
          {depth < 6 && (
            <>
              <option value="and">AND — all conditions</option>
              <option value="or">OR — any condition</option>
              <option value="not">NOT — reverse a condition</option>
              <option value="sustained">Sustain this condition</option>
            </>
          )}
        </select>
      </label>
      {(expression.kind === 'comparison' || expression.kind === 'crossing') && (
        <div className="analytics-fields">
          <OperandEditor
            label={`${path} left`}
            model={model}
            value={expression.left}
            onChange={(left) => onChange({ ...expression, left })}
          />
          {expression.kind === 'comparison' ? (
            <label>
              Comparison
              <select
                aria-label={`${path} comparison`}
                value={expression.operator}
                onChange={(event) =>
                  onChange({ ...expression, operator: event.target.value as Comparator })
                }
              >
                {['>', '>=', '<', '<=', '==', '!='].map((operator) => (
                  <option key={operator}>{operator}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Crossing direction
              <select
                value={expression.direction}
                onChange={(event) =>
                  onChange({ ...expression, direction: event.target.value as 'up' | 'down' })
                }
              >
                <option value="up">Crosses up</option>
                <option value="down">Crosses down</option>
              </select>
            </label>
          )}
          <OperandEditor
            label={`${path} right`}
            model={model}
            value={expression.right}
            onChange={(right) => onChange({ ...expression, right })}
          />
        </div>
      )}
      {(expression.kind === 'and' || expression.kind === 'or') && (
        <>
          {expression.children.map((child, index) => (
            <div key={index}>
              <RuleExpressionEditor
                expression={child}
                model={model}
                depth={depth + 1}
                path={`${path} ${index + 1}`}
                onChange={(next) =>
                  onChange({
                    ...expression,
                    children: expression.children.map((entry, i) => (i === index ? next : entry)),
                  })
                }
              />
              {expression.children.length > 2 && (
                <button
                  onClick={() =>
                    onChange({
                      ...expression,
                      children: expression.children.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove condition {index + 1}
                </button>
              )}
            </div>
          ))}
          {expression.children.length < 8 && depth < 6 && (
            <button
              onClick={() =>
                onChange({ ...expression, children: [...expression.children, initial()] })
              }
            >
              Add condition
            </button>
          )}
        </>
      )}
      {expression.kind === 'not' && (
        <RuleExpressionEditor
          expression={expression.child}
          model={model}
          depth={depth + 1}
          path={`${path} not`}
          onChange={(child) => onChange({ ...expression, child })}
        />
      )}
      {expression.kind === 'sustained' && (
        <>
          <label>
            Consecutive complete periods
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={expression.periods}
              onChange={(event) => onChange({ ...expression, periods: Number(event.target.value) })}
            />
          </label>
          <RuleExpressionEditor
            expression={expression.child}
            model={model}
            depth={depth + 1}
            path={`${path} sustained`}
            onChange={(child) => onChange({ ...expression, child })}
          />
        </>
      )}
      {expression.kind === 'window' && (
        <div className="analytics-fields">
          <OperandEditor
            label={`${path} window input`}
            model={model}
            value={expression.operand}
            onChange={(operand) => onChange({ ...expression, operand })}
          />
          <label>
            Window measure
            <select
              value={expression.operation}
              onChange={(event) =>
                onChange({
                  ...expression,
                  operation: event.target.value as Extract<
                    SignalExpression,
                    { kind: 'window' }
                  >['operation'],
                })
              }
            >
              {['mean', 'min', 'max', 'stddev', 'roc'].map((operation) => (
                <option key={operation}>{operation}</option>
              ))}
            </select>
          </label>
          <label>
            Window observations
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={expression.periods}
              onChange={(event) => onChange({ ...expression, periods: Number(event.target.value) })}
            />
          </label>
          <label>
            Window comparison
            <select
              value={expression.operator}
              onChange={(event) =>
                onChange({ ...expression, operator: event.target.value as Comparator })
              }
            >
              {['>', '>=', '<', '<=', '==', '!='].map((operator) => (
                <option key={operator}>{operator}</option>
              ))}
            </select>
          </label>
          <label>
            Window threshold
            <input
              type="number"
              step="any"
              value={expression.threshold}
              onChange={(event) =>
                onChange({ ...expression, threshold: Number(event.target.value) })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
