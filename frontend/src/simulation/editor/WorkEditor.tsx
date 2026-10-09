import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
  return (
    <>
      <div className="simulation-grid">
        <NumberField
          label={t('simulator.editor.work.capacity')}
          value={node.work.capacity}
          step={1}
          change={(value) => patchNode({ work: { ...node.work, capacity: value ?? 0 } })}
        />
        <NumberField
          label={t('simulator.editor.work.processingTimeMinutes')}
          value={node.work.processingSeconds / 60}
          change={(value) =>
            patchNode({ work: { ...node.work, processingSeconds: (value ?? 0) * 60 } })
          }
        />
        <NumberField
          label={t('simulator.editor.work.workCostHour')}
          help={t('simulator.editor.work.perAvailableCapacityUnitIncludingIdleTime')}
          value={node.work.costPerHour ?? 0}
          change={(value) => patchNode({ work: { ...node.work, costPerHour: value } })}
        />
        <NumberField
          label={t('simulator.editor.work.costProcessedItem')}
          value={node.work.costPerParticle ?? 0}
          change={(value) => patchNode({ work: { ...node.work, costPerParticle: value } })}
        />
        <NumberField
          label={t('simulator.results.maximumQueue')}
          value={node.work.queueLimit}
          step={1}
          change={(value) => patchNode({ work: { ...node.work, queueLimit: value } })}
        />
        <NumberField
          label={t('simulator.editor.work.complexityMultiplier')}
          value={node.work.complexityMultiplier ?? 1}
          change={(value) => patchNode({ work: { ...node.work, complexityMultiplier: value } })}
        />
        <label>
          {t('simulator.editor.work.queueOrder')}{' '}
          <select
            aria-label={t('simulator.editor.work.queueOrder')}
            value={node.work.queueDiscipline ?? 'fifo'}
            onChange={(event) =>
              patchNode({
                work: { ...node.work, queueDiscipline: event.target.value as 'fifo' | 'priority' },
              })
            }
          >
            <option value="fifo">{t('simulator.editor.work.firstInFirstOut')}</option>
            <option value="priority">{t('simulator.editor.work.particlePriority')}</option>
          </select>
        </label>
        <label>
          {t('simulator.editor.work.overflowRoute')}{' '}
          <select
            aria-label={t('simulator.editor.work.queueOverflowRoute')}
            value={node.work.overflowNodeId ?? ''}
            onChange={(event) =>
              patchNode({ work: { ...node.work, overflowNodeId: event.target.value || undefined } })
            }
          >
            <option value="">{t('simulator.editor.work.abandonWhenFull')}</option>
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
        <legend>{t('simulator.editor.work.sharedResourcesRequiredTogether')}</legend>
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
                  label={t('simulator.editor.work.unitsRequired', { name: String(resource.name) })}
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
        <legend>{t('simulator.editor.work.acceptedParticleTypesAllWhenEmpty')}</legend>
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
        label={t('simulator.editor.work.workAvailability')}
        value={node.work.schedule}
        change={(value) => patchNode({ work: { ...node.work, schedule: value } })}
      />
      <JsonField
        fieldId={`work-schedule:${node.id}`}
        label={t('simulator.editor.work.workAvailabilitySchedule')}
        value={node.work.schedule}
        change={(value) =>
          patchNode({ work: { ...node.work, schedule: value as typeof node.work.schedule } })
        }
      />
    </>
  );
}
