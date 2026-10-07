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
  const edges = model.edges.filter((edge) => edge.sourceNodeId === nodeId);
  const patch = (index: number, partial: Partial<RoutingRule>) =>
    change(rules.map((rule, i) => (i === index ? { ...rule, ...partial } : rule)));
  return (
    <fieldset>
      <legend>Routing rules</legend>
      <p>
        Rules select a valid outgoing connection. Weighted routing uses the relative weights of
        matching rules.
      </p>
      {rules.map((rule, index) => (
        <fieldset key={index}>
          <legend>Rule {index + 1}</legend>
          <div className="simulation-grid">
            <label>
              Destination
              <select
                aria-label={`Rule ${index + 1} destination`}
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
              label={`Rule ${index + 1} weight`}
              value={rule.weight ?? 1}
              change={(weight) => patch(index, { weight })}
            />
            <label>
              Condition
              <select
                aria-label={`Rule ${index + 1} condition`}
                value={rule.condition?.field ?? ''}
                onChange={(event) =>
                  patch(index, { condition: newCondition(event.target.value, model) })
                }
              >
                <option value="">Always matches</option>
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
                  <option key={field}>{field}</option>
                ))}
              </select>
            </label>
            {rule.condition && (
              <ConditionFields
                model={model}
                value={rule.condition}
                label={`Rule ${index + 1}`}
                change={(condition) => patch(index, { condition })}
              />
            )}
            <button onClick={() => change(rules.filter((_, i) => i !== index))}>
              Remove rule {index + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        disabled={!edges.length}
        onClick={() => change([...rules, { edgeId: edges[0].id, weight: 1 }])}
      >
        Add routing rule
      </button>
      {!edges.length && <p>Add an outgoing connection before configuring routing rules.</p>}
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
  const patch = (partial: Record<string, unknown>) =>
    change({ ...value, ...partial } as RoutingCondition);
  return (
    <>
      <label>
        Comparison
        <select
          aria-label={`${label} comparison`}
          value={value.operator}
          onChange={(event) => patch({ operator: event.target.value })}
        >
          {(value.field === 'particleTypeId'
            ? ['eq', 'neq']
            : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
          ).map((operator) => (
            <option key={operator}>{operator}</option>
          ))}
        </select>
      </label>
      {value.field === 'attribute' && (
        <label>
          Attribute name
          <input
            aria-label={`${label} attribute`}
            value={value.key}
            onChange={(event) => patch({ key: event.target.value })}
          />
        </label>
      )}
      {(value.field === 'queue' ||
        value.field === 'availableCapacity' ||
        value.field === 'utilization') && (
        <label>
          Inspect node / resource
          <select
            aria-label={`${label} state target`}
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
          Particle type
          <select
            aria-label={`${label} particle type`}
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
            Value type
            <select
              aria-label={`${label} value type`}
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
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Yes/no</option>
            </select>
          </label>
          <label>
            Value
            {typeof value.value === 'boolean' ? (
              <select
                aria-label={`${label} value`}
                value={String(value.value)}
                onChange={(event) => patch({ value: event.target.value === 'true' })}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                aria-label={`${label} value`}
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
          label={`${label} threshold`}
          value={value.value}
          change={(number) => patch({ value: number ?? 0 })}
        />
      )}
    </>
  );
}
