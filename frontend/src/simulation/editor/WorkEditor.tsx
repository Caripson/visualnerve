import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import { ScheduleFields } from './ScheduleFields';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';
export function WorkEditor({
  draft,
  node,
  patchNode,
}: NodeSectionProps & { node: Extract<SimulationNode, { type: 'work' }> }) {
  return (
    <>
      <div className="simulation-grid">
        <NumberField
          label="Work capacity"
          value={node.work.capacity}
          step={1}
          change={(value) => patchNode({ work: { ...node.work, capacity: value ?? 0 } })}
        />
        <NumberField
          label="Processing time (minutes)"
          value={node.work.processingSeconds / 60}
          change={(value) =>
            patchNode({ work: { ...node.work, processingSeconds: (value ?? 0) * 60 } })
          }
        />
        <NumberField
          label="Work cost / hour"
          help="Per available capacity unit, including idle time."
          value={node.work.costPerHour ?? 0}
          change={(value) => patchNode({ work: { ...node.work, costPerHour: value } })}
        />
        <NumberField
          label="Cost / processed item"
          value={node.work.costPerParticle ?? 0}
          change={(value) => patchNode({ work: { ...node.work, costPerParticle: value } })}
        />
        <NumberField
          label="Maximum queue"
          value={node.work.queueLimit}
          step={1}
          change={(value) => patchNode({ work: { ...node.work, queueLimit: value } })}
        />
        <NumberField
          label="Complexity multiplier"
          value={node.work.complexityMultiplier ?? 1}
          change={(value) => patchNode({ work: { ...node.work, complexityMultiplier: value } })}
        />
        <label>
          Queue order
          <select
            aria-label="Queue order"
            value={node.work.queueDiscipline ?? 'fifo'}
            onChange={(event) =>
              patchNode({
                work: { ...node.work, queueDiscipline: event.target.value as 'fifo' | 'priority' },
              })
            }
          >
            <option value="fifo">First in, first out</option>
            <option value="priority">Particle priority</option>
          </select>
        </label>
        <label>
          Overflow route
          <select
            aria-label="Queue overflow route"
            value={node.work.overflowNodeId ?? ''}
            onChange={(event) =>
              patchNode({ work: { ...node.work, overflowNodeId: event.target.value || undefined } })
            }
          >
            <option value="">Abandon when full</option>
            {draft.nodes
              .filter((target) =>
                draft.edges.some(
                  (edge) => edge.sourceNodeId === node.id && edge.targetNodeId === target.id,
                ),
              )
              .map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Shared resources required together</legend>
        {draft.resources.map((resource) => {
          const requirement = node.work.resourceRequirements?.find(
            (entry) => entry.resourceId === resource.id,
          );
          return (
            <div className="simulation-resource-binding" key={resource.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!!requirement}
                  onChange={(event) =>
                    patchNode({
                      work: {
                        ...node.work,
                        resourceRequirements: event.target.checked
                          ? [
                              ...(node.work.resourceRequirements ?? []),
                              { resourceId: resource.id, units: 1 },
                            ]
                          : node.work.resourceRequirements?.filter(
                              (entry) => entry.resourceId !== resource.id,
                            ),
                      },
                    })
                  }
                />
                {resource.name}
              </label>
              {requirement && (
                <NumberField
                  label={`${resource.name} units required`}
                  value={requirement.units}
                  min={0.001}
                  change={(value) =>
                    patchNode({
                      work: {
                        ...node.work,
                        resourceRequirements: node.work.resourceRequirements?.map((entry) =>
                          entry.resourceId === resource.id
                            ? { ...entry, units: value ?? 1 }
                            : entry,
                        ),
                      },
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>Accepted particle types (all when empty)</legend>
        {draft.particleTypes.map((type) => (
          <label key={type.id}>
            <input
              type="checkbox"
              checked={node.work.acceptedParticleTypeIds?.includes(type.id) ?? false}
              onChange={(event) =>
                patchNode({
                  work: {
                    ...node.work,
                    acceptedParticleTypeIds: event.target.checked
                      ? [...(node.work.acceptedParticleTypeIds ?? []), type.id]
                      : node.work.acceptedParticleTypeIds?.filter((id) => id !== type.id),
                  },
                })
              }
            />
            {type.name}
          </label>
        ))}
      </fieldset>
      <ScalingFields
        capacity={node.work.capacity}
        value={node.work.scaling}
        change={(value) => patchNode({ work: { ...node.work, scaling: value } })}
      />
      <ScheduleFields
        label="Work availability"
        value={node.work.schedule}
        change={(value) => patchNode({ work: { ...node.work, schedule: value } })}
      />
      <JsonField
        label="Work availability schedule"
        value={node.work.schedule}
        change={(value) =>
          patchNode({ work: { ...node.work, schedule: value as typeof node.work.schedule } })
        }
      />
    </>
  );
}
