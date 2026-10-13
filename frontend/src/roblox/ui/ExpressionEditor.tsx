import type { GameCondition, GameDefinition, GameExpression, GameValue } from '../types';
import { NumberField, SelectField, TextField, Toggle } from './fields';

export type LogicContext = Pick<
  GameDefinition,
  'entities' | 'variables' | 'items' | 'quests' | 'timers'
> & { parameters?: { id: string; name: string }[] };
export const literal = (value: GameValue = 1): GameExpression => ({ kind: 'literal', value });
export function defaultExpression(
  kind: GameExpression['kind'],
  context: LogicContext,
): GameExpression {
  switch (kind) {
    case 'variable':
      return { kind, variableId: context.variables[0]?.id ?? '' };
    case 'inventory':
      return { kind, itemId: context.items[0]?.id ?? '' };
    case 'questProgress':
    case 'questState':
      return { kind, questId: context.quests[0]?.id ?? '' };
    case 'parameter':
      return { kind, parameterId: context.parameters?.[0]?.id ?? '' };
    case 'arithmetic':
      return { kind, operator: '+', left: literal(1), right: literal(1) };
    default:
      return literal();
  }
}
export function ValueEditor({
  label,
  value,
  change,
}: {
  label: string;
  value: GameValue;
  change: (value: GameValue) => void;
}) {
  const type = typeof value;
  return (
    <div className="roblox-value">
      <SelectField
        label={`${label} type`}
        value={type}
        options={[
          ['number', 'Number'],
          ['string', 'Text'],
          ['boolean', 'Yes / no'],
        ]}
        change={(next) => change(next === 'number' ? 0 : next === 'boolean' ? false : '')}
      />
      {type === 'number' ? (
        <NumberField label={label} value={value as number} change={change} />
      ) : type === 'boolean' ? (
        <Toggle label={label} value={value as boolean} change={change} />
      ) : (
        <TextField label={label} value={value as string} change={change} />
      )}
    </div>
  );
}
export function ExpressionEditor({
  label,
  value,
  change,
  context,
  depth = 0,
}: {
  label: string;
  value: GameExpression;
  change: (value: GameExpression) => void;
  context: LogicContext;
  depth?: number;
}) {
  const options: (readonly [string, string])[] = [['literal', 'A value']];
  if (context.variables.length) options.push(['variable', 'Variable']);
  if (context.items.length) options.push(['inventory', 'Item count']);
  if (context.quests.length)
    options.push(['questProgress', 'Quest progress'], ['questState', 'Quest state']);
  if (context.parameters?.length) options.push(['parameter', 'Prefab parameter']);
  if (depth < 10) options.push(['arithmetic', 'Math (+ − × ÷)']);
  return (
    <fieldset className="roblox-expression">
      <legend>{label}</legend>
      <SelectField
        label={`${label} source`}
        value={value.kind}
        options={options}
        change={(kind) => change(defaultExpression(kind as GameExpression['kind'], context))}
      />
      {value.kind === 'literal' && (
        <ValueEditor
          label={label.endsWith('value') ? label : `${label} value`}
          value={value.value}
          change={(next) => change({ ...value, value: next })}
        />
      )}
      {value.kind === 'variable' && (
        <SelectField
          label={`${label} variable`}
          value={value.variableId}
          options={context.variables.map((item) => [item.id, item.name])}
          change={(variableId) => change({ ...value, variableId })}
        />
      )}
      {value.kind === 'inventory' && (
        <SelectField
          label={`${label} item`}
          value={value.itemId}
          options={context.items.map((item) => [item.id, item.name])}
          change={(itemId) => change({ ...value, itemId })}
        />
      )}
      {(value.kind === 'questProgress' || value.kind === 'questState') && (
        <>
          <SelectField
            label={`${label} quest`}
            value={value.questId}
            options={context.quests.map((item) => [item.id, item.name])}
            change={(questId) => change({ ...value, questId })}
          />
          {value.kind === 'questState' && (
            <p className="roblox-hint">Quest state is “inactive”, “active”, or “complete”.</p>
          )}
        </>
      )}
      {value.kind === 'parameter' && (
        <SelectField
          label={`${label} parameter`}
          value={value.parameterId}
          options={(context.parameters ?? []).map((item) => [item.id, item.name])}
          change={(parameterId) => change({ ...value, parameterId })}
        />
      )}
      {value.kind === 'arithmetic' && (
        <div className="roblox-nested">
          <ExpressionEditor
            label={`${label} left`}
            value={value.left}
            context={context}
            depth={depth + 1}
            change={(left) => change({ ...value, left })}
          />
          <SelectField
            label={`${label} operation`}
            value={value.operator}
            options={[
              ['+', 'Add (+)'],
              ['-', 'Subtract (−)'],
              ['*', 'Multiply (×)'],
              ['/', 'Divide (÷)'],
            ]}
            change={(operator) => change({ ...value, operator: operator as '+' | '-' | '*' | '/' })}
          />
          <ExpressionEditor
            label={`${label} right`}
            value={value.right}
            context={context}
            depth={depth + 1}
            change={(right) => change({ ...value, right })}
          />
        </div>
      )}
    </fieldset>
  );
}
export const defaultCondition = (): GameCondition => ({
  kind: 'compare',
  operator: '>=',
  left: literal(0),
  right: literal(1),
});
export function ConditionEditor({
  condition,
  change,
  context,
  depth = 0,
  label = 'Condition',
}: {
  condition: GameCondition;
  change: (condition: GameCondition) => void;
  context: LogicContext;
  depth?: number;
  label?: string;
}) {
  const choices: (readonly [string, string])[] = [['compare', 'Compare two values']];
  if (depth < 10)
    choices.push(
      ['all', 'All conditions must pass'],
      ['any', 'Any condition may pass'],
      ['not', 'Reverse a condition'],
    );
  return (
    <fieldset className="roblox-condition">
      <legend>{label}</legend>
      <SelectField
        label={`${label} type`}
        value={condition.kind}
        options={choices}
        change={(kind) =>
          change(
            kind === 'compare'
              ? defaultCondition()
              : kind === 'not'
                ? { kind, condition: defaultCondition() }
                : { kind: kind as 'all' | 'any', conditions: [defaultCondition()] },
          )
        }
      />
      {condition.kind === 'compare' && (
        <>
          <ExpressionEditor
            label={`${label} left`}
            value={condition.left}
            context={context}
            change={(left) => change({ ...condition, left })}
          />
          <SelectField
            label={`${label} comparison`}
            value={condition.operator}
            options={[
              ['==', 'Equals'],
              ['!=', 'Does not equal'],
              ['>', 'Greater than'],
              ['>=', 'At least'],
              ['<', 'Less than'],
              ['<=', 'At most'],
            ]}
            change={(operator) =>
              change({
                ...condition,
                operator: operator as Extract<GameCondition, { kind: 'compare' }>['operator'],
              })
            }
          />
          <ExpressionEditor
            label={`${label} right`}
            value={condition.right}
            context={context}
            change={(right) => change({ ...condition, right })}
          />
        </>
      )}
      {condition.kind === 'not' && (
        <ConditionEditor
          label={`${label} reversed`}
          condition={condition.condition}
          depth={depth + 1}
          context={context}
          change={(next) => change({ ...condition, condition: next })}
        />
      )}
      {(condition.kind === 'all' || condition.kind === 'any') && (
        <>
          <div className="roblox-nested">
            {condition.conditions.map((child, index) => (
              <div key={index}>
                <ConditionEditor
                  label={`${label} ${index + 1}`}
                  condition={child}
                  depth={depth + 1}
                  context={context}
                  change={(next) =>
                    change({
                      ...condition,
                      conditions: condition.conditions.map((item, i) =>
                        i === index ? next : item,
                      ),
                    })
                  }
                />
                <button
                  disabled={condition.conditions.length === 1}
                  onClick={() =>
                    change({
                      ...condition,
                      conditions: condition.conditions.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove condition {index + 1}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() =>
              change({ ...condition, conditions: [...condition.conditions, defaultCondition()] })
            }
          >
            Add condition
          </button>
        </>
      )}
    </fieldset>
  );
}
