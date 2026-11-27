import { useId, useMemo, useState } from 'react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import {
  behaviorDocumentLimits,
  getBehaviorLibrary,
  isBehaviorCompatible,
  removeBehaviorBinding,
  updateBehaviorBinding,
  validateBehaviorConfiguration,
  type BehaviorBinding,
  type BehaviorDefinition,
} from './document';
import { compilePreviewBehavior, type BehaviorProgram } from './language';
import {
  attachBehavior,
  behaviorEditAllowed,
  canAttachBehavior,
  editBehaviors,
} from './interaction';
import { BehaviorDiagnosticMessage } from './BehaviorDiagnosticMessage';
import './behaviors.css';

export function BehaviorBindings({ nodeId }: { nodeId: string }) {
  const graph = useEditor((state) => state.graph);
  const [choice, setChoice] = useState('');
  if (!graph || !behaviorEditAllowed(graph.diagram.id)) return null;
  const { bindings, definitions } = getBehaviorLibrary(graph);
  const attached = bindings.filter((binding) => binding.nodeId === nodeId);
  const available = definitions.filter((definition) =>
    canAttachBehavior(graph, nodeId, definition),
  );
  if (!attached.length && !available.length) return null;
  const definitionId = available.some((definition) => definition.id === choice) ? choice : '';
  return (
    <section className="behavior-bindings" aria-label="Behaviors">
      <div className="property-section">Behaviors</div>
      {attached.map((binding) => {
        const definition = definitions.find((item) => item.id === binding.definitionId);
        return (
          definition && (
            <BehaviorBindingFields
              key={binding.id}
              graph={graph}
              binding={binding}
              definition={definition}
            />
          )
        );
      })}
      {available.length > 0 && (
        <div className="behavior-actions">
          <select
            aria-label="Behavior to add"
            value={definitionId}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose behavior</option>
            {available.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!definitionId}
            onClick={() => {
              attachBehavior(graph.diagram.id, nodeId, definitionId);
              setChoice('');
            }}
          >
            Add behavior
          </button>
        </div>
      )}
    </section>
  );
}

function BehaviorBindingFields({
  graph,
  binding,
  definition,
}: {
  graph: Graph;
  binding: BehaviorBinding;
  definition: BehaviorDefinition;
}) {
  const diagnosticId = useId();
  const compiled = useMemo(
    () => compilePreviewBehavior(definition.source, definition.version),
    [definition.source, definition.version],
  );
  const validation = validateBehaviorConfiguration(graph, definition, binding.parameters);
  const compatible = isBehaviorCompatible(graph, binding.nodeId, definition);
  const setParameter = (name: string, value: string | number | boolean | undefined) => {
    editBehaviors(graph.diagram.id, 'Update behavior parameter', (current) => {
      const latest = getBehaviorLibrary(current).bindings.find((item) => item.id === binding.id);
      if (!latest) return current;
      const parameters = { ...latest.parameters };
      if (value === undefined) delete parameters[name];
      else
        Object.defineProperty(parameters, name, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      return updateBehaviorBinding(current, binding.id, { parameters });
    });
  };
  return (
    <div className="behavior-binding" role="group" aria-label={definition.name}>
      <strong>{definition.name}</strong>
      <label className="behavior-checkbox">
        <input
          type="checkbox"
          checked={binding.enabled}
          disabled={!binding.enabled && (!compatible || !validation.ok)}
          aria-describedby={compatible && validation.ok ? undefined : diagnosticId}
          onChange={(event) => {
            const enabled = event.target.checked;
            editBehaviors(graph.diagram.id, 'Toggle behavior binding', (current) =>
              updateBehaviorBinding(current, binding.id, { enabled }),
            );
          }}
        />
        Enabled
      </label>
      {compiled.ok &&
        compiled.program.parameters.map((parameter) => (
          <BehaviorParameter
            key={parameter.name}
            parameter={parameter}
            graph={graph}
            simulation={!!graph.simulation && compiled.program.contexts.includes('simulation')}
            value={
              Object.hasOwn(binding.parameters, parameter.name)
                ? binding.parameters[parameter.name]
                : parameter.defaultValue
            }
            onChange={(value) => setParameter(parameter.name, value)}
          />
        ))}
      {(!compatible || !validation.ok) && (
        <div id={diagnosticId}>
          {!compatible && (
            <p className="behavior-diagnostic">This behavior cannot run on this card.</p>
          )}
          {!validation.ok && <BehaviorDiagnosticMessage diagnostic={validation.error} />}
        </div>
      )}
      <button
        type="button"
        onClick={() =>
          editBehaviors(graph.diagram.id, 'Remove behavior binding', (current) =>
            removeBehaviorBinding(current, binding.id),
          )
        }
      >
        Remove binding
      </button>
    </div>
  );
}

function BehaviorParameter({
  graph,
  simulation,
  parameter,
  value,
  onChange,
}: {
  graph: Graph;
  simulation: boolean;
  parameter: BehaviorProgram['parameters'][number];
  value?: string | number | boolean;
  onChange: (value: string | number | boolean | undefined) => void;
}) {
  const { name, type } = parameter;
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      return (
        <label className="behavior-field">
          {name}
          <select value="" onChange={(event) => onChange(event.target.value === 'true')}>
            <option value="" disabled>
              Choose true or false
            </option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      );
    }
    return (
      <label className="behavior-checkbox">
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => onChange(event.target.checked)}
        />
        {name}
      </label>
    );
  }
  if (type === 'node' || type === 'resource') {
    const options =
      type === 'resource'
        ? (graph.simulation?.resources ?? []).map(({ id, name }) => ({ id, label: name }))
        : simulation
          ? (graph.simulation?.nodes ?? [])
              .filter((node) => node.type === 'work')
              .map(({ id, name }) => ({ id, label: name }))
          : graph.nodes.map(({ id, title }) => ({ id, label: title }));
    const currentValue = typeof value === 'string' ? value : '';
    return (
      <label className="behavior-field">
        {name}
        <select
          value={currentValue}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Choose {type === 'node' ? 'a node' : 'a resource'}</option>
          {currentValue && !options.some((item) => item.id === currentValue) && (
            <option value={currentValue}>Unavailable reference</option>
          )}
          {options.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const currentValue =
    typeof value === (type === 'text' ? 'string' : 'number') ? String(value) : '';
  return (
    <label className="behavior-field">
      {name}
      <input
        key={currentValue}
        type={type === 'number' ? 'number' : 'text'}
        step={type === 'number' ? 1 : undefined}
        maxLength={type === 'text' ? behaviorDocumentLimits.parameterText : undefined}
        defaultValue={currentValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.value === currentValue && input.validity.valid) return;
          if (type === 'text') onChange(input.value);
          else if (input.value === '' && !input.validity.badInput) {
            onChange(undefined);
            input.value =
              parameter.defaultValue === undefined ? '' : String(parameter.defaultValue);
          } else if (Number.isSafeInteger(input.valueAsNumber)) onChange(input.valueAsNumber);
          else input.value = currentValue;
        }}
      />
    </label>
  );
}
