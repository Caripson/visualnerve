import { useI18n } from '../../i18n';
import { EntityCollection } from './EntityCollection';
import { NumberField } from '../fields';
import { removeSimulationEntity } from '../deletion';
import type { Improvement } from '../types';
import type { EditorSectionProps } from './types';
import { infrastructureImprovementPolicy } from '../infrastructure/improvement-policy';
export function ImprovementEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const { t } = useI18n();
  const patchImprovement = (id: string, partial: Partial<Improvement>) =>
    setDraft((model) => ({
      ...model,
      improvements: model.improvements.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  return (
    <>
      <EntityCollection
        items={draft.improvements}
        label={t('simulator.editor.improvement.improvementToEdit')}
      >
        {(feature) => {
          const policy = infrastructureImprovementPolicy(draft, feature.nodeId, feature.resourceId);
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
                {t('simulator.common.name')}{' '}
                <input
                  aria-label={t('simulator.editor.improvement.improvementName', {
                    id: String(feature.id),
                  })}
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
                {t('simulator.editor.improvement.activateImprovement')}{' '}
              </label>
              <label>
                {t('simulator.editor.improvement.processNode')}{' '}
                <select
                  aria-label={t('simulator.editor.improvement.improvementNode', {
                    id: String(feature.id),
                  })}
                  value={feature.nodeId ?? ''}
                  onChange={(event) =>
                    patchImprovement(feature.id, {
                      nodeId: event.target.value || undefined,
                      resourceId: undefined,
                      ...infrastructureImprovementPolicy(draft, event.target.value).clear,
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
                  <option value="">{t('simulator.common.none')}</option>
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
                {t('simulator.common.resource')}{' '}
                <select
                  aria-label={t('simulator.editor.improvement.improvementResource', {
                    id: String(feature.id),
                  })}
                  value={feature.resourceId ?? ''}
                  onChange={(event) =>
                    patchImprovement(feature.id, {
                      resourceId: event.target.value || undefined,
                      nodeId: undefined,
                      ...infrastructureImprovementPolicy(draft, undefined, event.target.value)
                        .clear,
                      failureNodeId: undefined,
                    })
                  }
                >
                  <option value="">{t('simulator.common.none')}</option>
                  {draft.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </label>
              {policy.explicitActivity && (
                <p>
                  {policy.bandwidth
                    ? 'Link improvements support capacity and economic effects. Edit payload and propagation in Connections.'
                    : 'Edit energy and load power directly in the Work requirements. Time and reservation multipliers do not model energy delivery.'}
                </p>
              )}
              <div className="simulation-grid">
                <NumberField
                  label={t('simulator.editor.improvement.investment', {
                    name: String(feature.name),
                  })}
                  value={feature.investmentCost}
                  change={(value) => patchImprovement(feature.id, { investmentCost: value ?? 0 })}
                />
                <NumberField
                  label={t('simulator.editor.improvement.operatingCostHour', {
                    name: String(feature.name),
                  })}
                  value={feature.operatingCostPerHour ?? 0}
                  change={(value) => patchImprovement(feature.id, { operatingCostPerHour: value })}
                />
                {!outcome && !policy.explicitActivity && (
                  <NumberField
                    label={t('simulator.editor.improvement.processingMultiplier', {
                      name: String(feature.name),
                    })}
                    value={feature.processingTimeMultiplier ?? 1}
                    change={(value) =>
                      patchImprovement(feature.id, { processingTimeMultiplier: value })
                    }
                  />
                )}
                {!outcome && !policy.explicitActivity && (
                  <NumberField
                    label={t('simulator.editor.improvement.requiredResourceMultiplier', {
                      name: String(feature.name),
                    })}
                    value={feature.resourceUnitsMultiplier ?? 1}
                    change={(value) =>
                      patchImprovement(feature.id, { resourceUnitsMultiplier: value })
                    }
                  />
                )}
                {!outcome && (
                  <NumberField
                    label={t('simulator.editor.improvement.capacityIncrease', {
                      name: String(feature.name),
                    })}
                    value={feature.capacityIncrease ?? 0}
                    step={1}
                    change={(value) => patchImprovement(feature.id, { capacityIncrease: value })}
                  />
                )}
                {!outcome && (
                  <NumberField
                    label={t('simulator.editor.improvement.costMultiplier', {
                      name: String(feature.name),
                    })}
                    value={feature.costMultiplier ?? 1}
                    change={(value) => patchImprovement(feature.id, { costMultiplier: value })}
                  />
                )}
                {!policy.bandwidth && (
                  <NumberField
                    label={t('simulator.editor.improvement.revenueMultiplier', {
                      name: String(feature.name),
                    })}
                    value={feature.revenueMultiplier ?? 1}
                    change={(value) => patchImprovement(feature.id, { revenueMultiplier: value })}
                  />
                )}
                {!outcome && !policy.bandwidth && (
                  <NumberField
                    label={t('simulator.editor.improvement.failureProbability', {
                      name: String(feature.name),
                    })}
                    value={feature.failureProbability ?? 0}
                    change={(value) => patchImprovement(feature.id, { failureProbability: value })}
                  />
                )}
              </div>
              {!outcome && !policy.bandwidth && (
                <label>
                  {t('simulator.editor.improvement.failureRoute')}{' '}
                  <select
                    aria-label={t('simulator.editor.improvement.failureRoute.name', {
                      name: String(feature.name),
                    })}
                    value={feature.failureNodeId ?? ''}
                    onChange={(event) =>
                      patchImprovement(feature.id, {
                        failureNodeId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">{t('simulator.editor.improvement.recordFailedWork')}</option>
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
                  {t('simulator.editor.improvement.deleteImprovement')}
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
                  ...infrastructureImprovementPolicy(
                    model,
                    model.nodes.find((node) => node.type === 'work')?.id,
                  ).clear,
                },
              ],
            }))
          }
        >
          {t('simulator.editor.improvement.addImprovementInvestment')}
        </button>
      )}
    </>
  );
}
