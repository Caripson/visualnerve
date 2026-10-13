import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useEditor } from '../../state/editor';
import type { Graph } from '../../model/types';
import type { SimulationModel, SimulationNode } from '../types';
import { assertSimulationModel } from '../schema';
import { EditorValidationProvider } from '../editor/JsonField';
import { ResourceDomainFields } from './ResourceDomainFields';
import { WorkDomainFields } from './WorkDomainFields';
import { TransferDomainFields } from './TransferDomainFields';
import { QuantityField } from './QuantityField';
import { formatInfrastructureQuantity } from './format';
import { quantityUnits as units } from './quantity';
import {
  capacityExampleGraph,
  infrastructureExample,
  infrastructureTemplateNames,
  type InfrastructureTemplateKey,
} from './examples';

export function InfrastructureWizard({
  graph,
  domain,
  close,
  back,
  created,
}: {
  graph: Graph;
  domain: InfrastructureTemplateKey;
  close: () => void;
  back: () => void;
  created?: (options: { durationSeconds: number; untilComplete: boolean }) => void;
}) {
  const [model, setModel] = useState(() => {
    const example = infrastructureExample(domain)!.model();
    return {
      ...example,
      currency: graph.simulation?.currency ?? example.currency,
      defaults: {
        ...example.defaults,
        seed: graph.simulation?.defaults.seed ?? example.defaults.seed,
      },
    };
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const stepContent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!step) return;
    const heading = stepContent.current?.querySelector('h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    const dialog = stepContent.current?.closest('.modal');
    if (dialog) dialog.scrollTop = 0;
  }, [step]);
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const validity = useCallback(
    (id: string, bad: boolean, label: string) =>
      setInvalid((previous) => {
        const next = { ...previous };
        if (bad) next[id] = label;
        else delete next[id];
        return next;
      }),
    [],
  );
  const patchNode = (node: SimulationNode, partial: Partial<SimulationNode>) =>
    setModel((current) => ({
      ...current,
      nodes: current.nodes.map((entry) =>
        entry.id === node.id ? ({ ...entry, ...partial } as SimulationNode) : entry,
      ),
    }));
  function proceed() {
    try {
      assertSimulationModel(model);
      if (step < 2) {
        setStep(step + 1);
        setError('');
        return;
      }
      const current = useEditor.getState().graph;
      if (
        !current ||
        current.diagram.id !== graph.diagram.id ||
        current.nodes.length ||
        JSON.stringify(current.simulation) !== JSON.stringify(graph.simulation)
      )
        throw new Error(
          'The model changed while setup was open. Reopen setup on an empty diagram.',
        );
      const next = capacityExampleGraph(current.diagram.name, model, current);
      useEditor.getState().command('Create infrastructure capacity model', () => next);
      if (useEditor.getState().graph?.simulation !== next.simulation)
        throw new Error(useEditor.getState().message || 'The model could not be created.');
      created?.({ durationSeconds: model.defaults.durationSeconds, untilComplete: false });
      close();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <Modal
      title={`Set up ${infrastructureTemplateNames[domain]}`}
      close={close}
      wide
      className="process-wizard-dialog"
    >
      <EditorValidationProvider change={validity}>
        <form
          className="process-wizard"
          onSubmit={(event) => {
            event.preventDefault();
            proceed();
          }}
        >
          <ol className="process-wizard-progress" aria-label="Capacity setup progress">
            {['Demand', 'Capacity & requirements', 'Review'].map((label, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined}>
                <span>{index + 1}</span>
                <b>{label}</b>
              </li>
            ))}
          </ol>
          <div className="process-wizard-step" ref={stepContent}>
            {step === 0 && (
              <>
                <h3>Demand assumptions</h3>
                <p>
                  Start from a synthetic, editable example. These rates count requests or jobs over
                  time; concurrent users require an explicit users-to-request-rate assumption.
                </p>
                <QuantityField
                  label="Run duration"
                  value={model.defaults.durationSeconds}
                  units={units.time}
                  minimum={0.000001}
                  maximum={315360000}
                  change={(durationSeconds) =>
                    setModel((previous) => ({
                      ...previous,
                      defaults: { ...previous.defaults, durationSeconds: durationSeconds ?? 1 },
                    }))
                  }
                />
                {model.nodes
                  .filter((node) => node.type === 'source')
                  .map(
                    (node) =>
                      node.type === 'source' && (
                        <fieldset key={node.id}>
                          <legend>{node.name}</legend>
                          <label>
                            Source name{' '}
                            <input
                              aria-label={`Source name ${node.id}`}
                              value={node.name}
                              onChange={(event) => patchNode(node, { name: event.target.value })}
                            />
                          </label>
                          <QuantityField
                            label={`${node.name} arrivals`}
                            value={node.source.ratePerHour ?? 0}
                            units={units.arrival}
                            maximum={1e12}
                            change={(ratePerHour) =>
                              patchNode(node, { source: { ...node.source, ratePerHour } })
                            }
                          />
                        </fieldset>
                      ),
                  )}
                {model.particleTypes.map((type) => (
                  <fieldset key={type.id}>
                    <legend>{type.name}</legend>
                    <QuantityField
                      label={`${type.name} completed revenue`}
                      value={type.revenue}
                      units={[{ label: model.currency, factor: 1 }]}
                      change={(revenue) =>
                        setModel((previous) => ({
                          ...previous,
                          particleTypes: previous.particleTypes.map((entry) =>
                            entry.id === type.id ? { ...entry, revenue: revenue ?? 0 } : entry,
                          ),
                        }))
                      }
                    />
                  </fieldset>
                ))}
              </>
            )}
            {step === 1 && (
              <>
                <h3>Shared capacity and work</h3>
                <p>
                  Each pool is one shared capacity. Add more dimensions later in Assumptions; these
                  domains can coexist in one model.
                </p>
                {model.resources.map((resource) => (
                  <ResourceDomainFields
                    key={resource.id}
                    model={model}
                    resource={resource}
                    showGeneralCapacity
                    change={(partial) =>
                      setModel((previous) => ({
                        ...previous,
                        resources: previous.resources.map((entry) =>
                          entry.id === resource.id ? { ...entry, ...partial } : entry,
                        ),
                      }))
                    }
                  />
                ))}
                {model.nodes
                  .filter((node) => node.type === 'work')
                  .map(
                    (node) =>
                      node.type === 'work' && (
                        <fieldset key={node.id}>
                          <legend>{node.name}</legend>
                          <QuantityField
                            label={`${node.name} parallel slots`}
                            value={node.work.capacity}
                            units={units.count}
                            integer
                            minimum={1}
                            maximum={100000}
                            change={(capacity) =>
                              patchNode(node, { work: { ...node.work, capacity: capacity ?? 1 } })
                            }
                          />
                          <WorkDomainFields
                            showGeneralRequirements
                            model={model}
                            work={node.work}
                            change={(work) => patchNode(node, { work })}
                          />
                        </fieldset>
                      ),
                  )}
                {model.edges
                  .filter((edge) => edge.infrastructure)
                  .map((edge) => (
                    <TransferDomainFields
                      key={edge.id}
                      model={model}
                      edge={edge}
                      change={(partial) =>
                        setModel((previous) => ({
                          ...previous,
                          edges: previous.edges.map((entry) =>
                            entry.id === edge.id ? { ...entry, ...partial } : entry,
                          ),
                        }))
                      }
                    />
                  ))}
              </>
            )}
            {step === 2 && (
              <>
                <h3>Review capacity model</h3>
                <dl className="simulation-card-facts">
                  {model.nodes
                    .filter((node) => node.type === 'source')
                    .map(
                      (node) =>
                        node.type === 'source' && (
                          <div key={node.id}>
                            <dt>{node.name}</dt>
                            <dd>
                              {formatInfrastructureQuantity(node.source.ratePerHour ?? 0)}{' '}
                              arrivals/hour
                            </dd>
                          </div>
                        ),
                    )}
                  {model.resources.map((pool) => (
                    <div key={pool.id}>
                      <dt>{pool.name}</dt>
                      <dd>
                        {formatInfrastructureQuantity(pool.capacity)} {pool.unit}
                      </dd>
                    </div>
                  ))}
                </dl>
                <label className="simulation-field">
                  <span>Model assumptions text</span>
                  <textarea
                    aria-label="Model assumptions text"
                    rows={5}
                    value={model.description ?? ''}
                    onChange={(event) =>
                      setModel((previous) => ({ ...previous, description: event.target.value }))
                    }
                  />
                </label>
                <small>
                  Descriptions are manual annotations. Update the text after editing values; the
                  structured fields control the simulation.
                </small>
                <p>
                  {model.nodes.length} semantic nodes · {model.resources.length} shared pools ·{' '}
                  {(model.defaults.durationSeconds / 60).toFixed(2)} minutes · seed{' '}
                  {model.defaults.seed}.
                </p>
                <p>
                  After creation, edit Assumptions, Play a baseline, adjust a scenario and rerun,
                  then compare saved runs. Outputs follow these allocation and fluid-transfer
                  assumptions; they are not physical TCP or AC electrical studies.
                </p>
              </>
            )}
          </div>
          {Object.keys(invalid).length > 0 && (
            <p role="alert">Fix invalid fields: {Object.values(invalid).join(', ')}.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <footer className="process-wizard-actions">
            <button
              type="button"
              onClick={
                step
                  ? () => {
                      setStep(step - 1);
                      setError('');
                    }
                  : back
              }
            >
              {step ? 'Back' : 'Choose another domain'}
            </button>
            <span>Step {step + 1} of 3</span>
            <button type="submit" className="primary" disabled={Object.keys(invalid).length > 0}>
              {step === 2 ? 'Create capacity model' : 'Continue'}
            </button>
          </footer>
        </form>
      </EditorValidationProvider>
    </Modal>
  );
}
