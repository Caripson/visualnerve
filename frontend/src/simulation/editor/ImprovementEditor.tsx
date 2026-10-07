import { EntityCollection } from './EntityCollection';
import { NumberField } from '../fields';
import { removeSimulationEntity } from '../deletion';
import type { Improvement } from '../types';
import type { EditorSectionProps } from './types';
export function ImprovementEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const patchImprovement = (id: string, partial: Partial<Improvement>) =>
    setDraft((model) => ({
      ...model,
      improvements: model.improvements.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  return (
    <>
      <EntityCollection items={draft.improvements} label="Improvement to edit">
        {(feature) => {
          const outcome =
            draft.nodes.find((node) => node.id === feature.nodeId)?.type === 'outcome';
          const hosts = draft.nodes.filter(
            (node) =>
              node.type === 'work' &&
              (node.id === feature.nodeId ||
                (!!feature.resourceId &&
                  node.work.resourceRequirements?.some(
                    (requirement) => requirement.resourceId === feature.resourceId,
                  ))),
          );
          const failureTargets = draft.nodes.filter(
            (target) =>
              hosts.length > 0 &&
              hosts.every((host) =>
                draft.edges.some(
                  (edge) => edge.sourceNodeId === host.id && edge.targetNodeId === target.id,
                ),
              ),
          );
          return (
            <fieldset key={feature.id}>
              <legend>{feature.name}</legend>
              <label>
                Name
                <input
                  aria-label={`Improvement name ${feature.id}`}
                  value={feature.name}
                  onChange={(event) => patchImprovement(feature.id, { name: event.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={feature.enabled}
                  onChange={(event) =>
                    patchImprovement(feature.id, { enabled: event.target.checked })
                  }
                />{' '}
                Activate improvement
              </label>
              <label>
                Process node
                <select
                  aria-label={`Improvement node ${feature.id}`}
                  value={feature.nodeId ?? ''}
                  onChange={(event) =>
                    patchImprovement(feature.id, {
                      nodeId: event.target.value || undefined,
                      resourceId: undefined,
                      ...(draft.nodes.find((node) => node.id === event.target.value)?.type ===
                      'outcome'
                        ? {
                            processingTimeMultiplier: undefined,
                            resourceUnitsMultiplier: undefined,
                            capacityIncrease: undefined,
                            costMultiplier: undefined,
                            failureProbability: undefined,
                            failureNodeId: undefined,
                          }
                        : { failureNodeId: undefined }),
                    })
                  }
                >
                  <option value="">None</option>
                  {draft.nodes
                    .filter((node) => node.type === 'work' || node.type === 'outcome')
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Resource
                <select
                  aria-label={`Improvement resource ${feature.id}`}
                  value={feature.resourceId ?? ''}
                  onChange={(event) =>
                    patchImprovement(feature.id, {
                      resourceId: event.target.value || undefined,
                      nodeId: undefined,
                      failureNodeId: undefined,
                    })
                  }
                >
                  <option value="">None</option>
                  {draft.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="simulation-grid">
                <NumberField
                  label={`Investment ${feature.name}`}
                  value={feature.investmentCost}
                  change={(value) => patchImprovement(feature.id, { investmentCost: value ?? 0 })}
                />
                <NumberField
                  label={`Operating cost ${feature.name} / hour`}
                  value={feature.operatingCostPerHour ?? 0}
                  change={(value) => patchImprovement(feature.id, { operatingCostPerHour: value })}
                />
                {!outcome && (
                  <NumberField
                    label={`Processing multiplier ${feature.name}`}
                    value={feature.processingTimeMultiplier ?? 1}
                    change={(value) =>
                      patchImprovement(feature.id, { processingTimeMultiplier: value })
                    }
                  />
                )}
                {!outcome && (
                  <NumberField
                    label={`Required resource multiplier ${feature.name}`}
                    value={feature.resourceUnitsMultiplier ?? 1}
                    change={(value) =>
                      patchImprovement(feature.id, { resourceUnitsMultiplier: value })
                    }
                  />
                )}
                {!outcome && (
                  <NumberField
                    label={`Capacity increase ${feature.name}`}
                    value={feature.capacityIncrease ?? 0}
                    step={1}
                    change={(value) => patchImprovement(feature.id, { capacityIncrease: value })}
                  />
                )}
                {!outcome && (
                  <NumberField
                    label={`Cost multiplier ${feature.name}`}
                    value={feature.costMultiplier ?? 1}
                    change={(value) => patchImprovement(feature.id, { costMultiplier: value })}
                  />
                )}
                <NumberField
                  label={`Revenue multiplier ${feature.name}`}
                  value={feature.revenueMultiplier ?? 1}
                  change={(value) => patchImprovement(feature.id, { revenueMultiplier: value })}
                />
                {!outcome && (
                  <NumberField
                    label={`Failure probability ${feature.name}`}
                    value={feature.failureProbability ?? 0}
                    change={(value) => patchImprovement(feature.id, { failureProbability: value })}
                  />
                )}
              </div>
              {!outcome && (
                <label>
                  Failure route
                  <select
                    aria-label={`Failure route ${feature.name}`}
                    value={feature.failureNodeId ?? ''}
                    onChange={(event) =>
                      patchImprovement(feature.id, {
                        failureNodeId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Record failed work</option>
                    {failureTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!scenarioId && (
                <button
                  onClick={() =>
                    setDraft((model) => removeSimulationEntity(model, 'improvements', feature.id))
                  }
                >
                  Delete improvement
                </button>
              )}
            </fieldset>
          );
        }}
      </EntityCollection>
      {!scenarioId && (
        <button
          onClick={() =>
            setDraft((model) => ({
              ...model,
              improvements: [
                ...model.improvements,
                {
                  id: crypto.randomUUID(),
                  name: 'Automation',
                  enabled: false,
                  nodeId: model.nodes.find((node) => node.type === 'work')?.id,
                  investmentCost: 100000,
                  processingTimeMultiplier: 0.65,
                },
              ],
            }))
          }
        >
          Add improvement / investment
        </button>
      )}
    </>
  );
}
