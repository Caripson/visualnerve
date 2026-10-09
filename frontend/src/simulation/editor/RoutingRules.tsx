import { routingFieldLabel, routingOperatorLabel } from '../display';
import { useI18n } from '../../i18n';
import { NumberField } from '../fields';
import type { RoutingCondition, RoutingRule, SimulationModel } from '../types';

function newCondition(field: string, model: SimulationModel): RoutingCondition | undefined {
  if (field === 'particleTypeId')
    return { field, operator: 'eq', value: model.particleTypes[0]?.id ?? '' };
  if (field === 'complexity' || field === 'priority' || field === 'revenue')
    return { field, operator: 'gt', value: 1 };
  if (field === 'attribute') return { field, key: 'category', operator: 'eq', value: '' };
  if (field === 'queue' || field === 'availableCapacity' || field === 'utilization')
    return {
      field,
      nodeId: model.nodes.find((node) => node.type === 'work')?.id,
      operator: 'gt',
      value: field === 'utilization' ? 0.85 : 1,
    };
}
export function RoutingRules({
  model,
  nodeId,
  rules,
  change,
}: {
  model: SimulationModel;
  nodeId: string;
  rules: RoutingRule[];
  change: (rules: RoutingRule[]) => void;
}) {
  const { t } = useI18n();
  const edges = model.edges.filter((edge) => edge.sourceNodeId === nodeId);
  const patch = (index: number, partial: Partial<RoutingRule>) =>
    change(rules.map((rule, i) => (i === index ? { ...rule, ...partial } : rule)));
  return (
    <fieldset>
      <legend>{t('simulator.editor.router.routingRules')}</legend>
      <p>
        {t(
          'simulator.editor.routingRules.rulesSelectAValidOutgoingConnectionWeightedRoutingUsesTheRelativeWeights',
        )}
      </p>
      {rules.map((rule, index) => (
        <fieldset key={index}>
          <legend>
            {t('simulator.editor.routingRules.rule.value1', { ruleNumber: index + 1 })}
          </legend>
          <div className="simulation-grid">
            <label>
              {t('simulator.editor.routingRules.destination')}{' '}
              <select
                aria-label={t('simulator.editor.routingRules.ruleDestination', {
                  ruleNumber: String(index + 1),
                })}
                value={rule.edgeId}
                onChange={(event) => patch(index, { edgeId: event.target.value })}
              >
                {edges.map((edge) => (
                  <option key={edge.id} value={edge.id}>
                    {model.nodes.find((node) => node.id === edge.targetNodeId)?.name}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label={t('simulator.editor.routingRules.ruleWeight', {
                ruleNumber: String(index + 1),
              })}
              value={rule.weight ?? 1}
              change={(weight) => patch(index, { weight })}
            />
            <label>
              {t('simulator.editor.routingRules.condition')}{' '}
              <select
                aria-label={t('simulator.editor.routingRules.ruleCondition', {
                  ruleNumber: String(index + 1),
                })}
                value={rule.condition?.field ?? ''}
                onChange={(event) =>
                  patch(index, { condition: newCondition(event.target.value, model) })
                }
              >
                <option value="">{t('simulator.editor.routingRules.alwaysMatches')}</option>
                {[
                  'particleTypeId',
                  'complexity',
                  'priority',
                  'revenue',
                  'attribute',
                  'queue',
                  'availableCapacity',
                  'utilization',
                ].map((field) => (
                  <option key={field} value={field}>
                    {routingFieldLabel(t, field)}
                  </option>
                ))}
              </select>
            </label>
            {rule.condition && (
              <ConditionFields
                model={model}
                value={rule.condition}
                label={t('simulator.editor.routingRules.rule.value1', {
                  ruleNumber: String(index + 1),
                })}
                change={(condition) => patch(index, { condition })}
              />
            )}
            <button onClick={() => change(rules.filter((_, i) => i !== index))}>
              {t('simulator.editor.router.removeRule', { ruleNumber: index + 1 })}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        disabled={!edges.length}
        onClick={() => change([...rules, { edgeId: edges[0].id, weight: 1 }])}
      >
        {t('simulator.editor.routingRules.addRoutingRule')}
      </button>
      {!edges.length && (
        <p>
          {t('simulator.editor.routingRules.addAnOutgoingConnectionBeforeConfiguringRoutingRules')}
        </p>
      )}
    </fieldset>
  );
}
function ConditionFields({
  model,
  value,
  label,
  change,
}: {
  model: SimulationModel;
  value: RoutingCondition;
  label: string;
  change: (condition: RoutingCondition) => void;
}) {
  const { t } = useI18n();
  const patch = (partial: Record<string, unknown>) =>
    change({ ...value, ...partial } as RoutingCondition);
  return (
    <>
      <label>
        {t('simulator.editor.routingRules.comparison')}{' '}
        <select
          aria-label={t('simulator.editor.routingRules.comparison.label', { label: String(label) })}
          value={value.operator}
          onChange={(event) => patch({ operator: event.target.value })}
        >
          {(value.field === 'particleTypeId'
            ? ['eq', 'neq']
            : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
          ).map((operator) => (
            <option key={operator} value={operator}>
              {routingOperatorLabel(t, operator)}
            </option>
          ))}
        </select>
      </label>
      {value.field === 'attribute' && (
        <label>
          {t('simulator.editor.routingRules.attributeName')}{' '}
          <input
            aria-label={t('simulator.editor.routingRules.attribute', { label: String(label) })}
            value={value.key}
            onChange={(event) => patch({ key: event.target.value })}
          />
        </label>
      )}
      {(value.field === 'queue' ||
        value.field === 'availableCapacity' ||
        value.field === 'utilization') && (
        <label>
          {t('simulator.editor.routingRules.inspectNodeResource')}{' '}
          <select
            aria-label={t('simulator.editor.routingRules.stateTarget', { label: String(label) })}
            value={value.resourceId ? `res:${value.resourceId}` : `node:${value.nodeId ?? ''}`}
            onChange={(event) =>
              patch(
                event.target.value.startsWith('res:')
                  ? { resourceId: event.target.value.slice(4), nodeId: undefined }
                  : { nodeId: event.target.value.slice(5), resourceId: undefined },
              )
            }
          >
            {model.nodes
              .filter((node) => node.type === 'work')
              .map((node) => (
                <option key={node.id} value={`node:${node.id}`}>
                  {node.name}
                </option>
              ))}
            {model.resources.map((resource) => (
              <option key={resource.id} value={`res:${resource.id}`}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.field === 'particleTypeId' ? (
        <label>
          {t('simulator.common.particleType')}{' '}
          <select
            aria-label={t('simulator.editor.routingRules.particleType', { label: String(label) })}
            value={value.value}
            onChange={(event) => patch({ value: event.target.value })}
          >
            {model.particleTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      ) : value.field === 'attribute' ? (
        <>
          <label>
            {t('simulator.editor.routingRules.valueType')}{' '}
            <select
              aria-label={t('simulator.editor.routingRules.valueType.label', {
                label: String(label),
              })}
              value={typeof value.value}
              onChange={(event) =>
                patch({
                  value:
                    event.target.value === 'number'
                      ? 0
                      : event.target.value === 'boolean'
                        ? true
                        : '',
                })
              }
            >
              <option value="string">{t('simulator.editor.routingRules.text')}</option>
              <option value="number">{t('simulator.editor.routingRules.number')}</option>
              <option value="boolean">{t('simulator.editor.routingRules.yesNo')}</option>
            </select>
          </label>
          <label>
            {t('simulator.editor.routingRules.value')}{' '}
            {typeof value.value === 'boolean' ? (
              <select
                aria-label={t('simulator.editor.routingRules.value.label', {
                  label: String(label),
                })}
                value={String(value.value)}
                onChange={(event) => patch({ value: event.target.value === 'true' })}
              >
                <option value="true">{t('simulator.common.yes')}</option>
                <option value="false">{t('simulator.common.no')}</option>
              </select>
            ) : (
              <input
                aria-label={t('simulator.editor.routingRules.value.label', {
                  label: String(label),
                })}
                type={typeof value.value === 'number' ? 'number' : 'text'}
                value={value.value}
                onChange={(event) =>
                  patch({
                    value:
                      typeof value.value === 'number'
                        ? Number(event.target.value)
                        : event.target.value,
                  })
                }
              />
            )}
          </label>
        </>
      ) : (
        <NumberField
          label={t('simulator.editor.routingRules.threshold', { label: String(label) })}
          value={value.value}
          change={(number) => patch({ value: number ?? 0 })}
        />
      )}
    </>
  );
}
