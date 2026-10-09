import { particleShapeLabel } from '../display';
import { useI18n } from '../../i18n';
import { EntityCollection } from './EntityCollection';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import { removeSimulationEntity } from '../deletion';
export function ParticleEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const { t } = useI18n();
  const patchType = (id: string, partial: Partial<ParticleType>) =>
    setDraft((model) => ({
      ...model,
      particleTypes: model.particleTypes.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  return (
    <>
      <EntityCollection
        items={draft.particleTypes}
        label={t('simulator.editor.particle.particleTypeToEdit')}
      >
        {(type) => (
          <fieldset key={type.id}>
            <legend>{type.name}</legend>
            <label>
              {t('simulator.common.name')}{' '}
              <input
                aria-label={t('simulator.editor.particle.particleName', { id: String(type.id) })}
                value={type.name}
                onChange={(event) => patchType(type.id, { name: event.target.value })}
              />
            </label>
            <div className="simulation-grid">
              <label>
                {t('simulator.editor.particle.color')}{' '}
                <input
                  aria-label={t('simulator.editor.particle.particleColor', { id: String(type.id) })}
                  type="color"
                  value={type.color}
                  onChange={(event) => patchType(type.id, { color: event.target.value })}
                />
              </label>
              <label>
                {t('simulator.editor.particle.shape')}{' '}
                <select
                  aria-label={t('simulator.editor.particle.particleShape', { id: String(type.id) })}
                  value={type.shape ?? 'circle'}
                  onChange={(event) =>
                    patchType(type.id, { shape: event.target.value as typeof type.shape })
                  }
                >
                  {['circle', 'square', 'triangle'].map((shape) => (
                    <option key={shape} value={shape}>
                      {particleShapeLabel(t, shape)}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label={t('simulator.editor.particle.revenue', { name: String(type.name) })}
                value={type.revenue}
                change={(value) => patchType(type.id, { revenue: value ?? 0 })}
              />
              <NumberField
                label={t('simulator.editor.particle.minimumComplexity', {
                  name: String(type.name),
                })}
                value={type.complexity.min}
                change={(value) =>
                  patchType(type.id, { complexity: { ...type.complexity, min: value ?? 1 } })
                }
              />
              <NumberField
                label={t('simulator.editor.particle.maximumComplexity', {
                  name: String(type.name),
                })}
                value={type.complexity.max}
                change={(value) =>
                  patchType(type.id, { complexity: { ...type.complexity, max: value ?? 1 } })
                }
              />
              <NumberField
                label={t('simulator.editor.particle.priority', { name: String(type.name) })}
                value={type.priority}
                change={(value) => patchType(type.id, { priority: value ?? 0 })}
              />
              <NumberField
                label={t('simulator.editor.particle.patienceMinutes', { name: String(type.name) })}
                value={type.patienceSeconds === undefined ? undefined : type.patienceSeconds / 60}
                change={(value) =>
                  patchType(type.id, {
                    patienceSeconds: value === undefined ? undefined : value * 60,
                  })
                }
              />
            </div>
            <JsonField
              fieldId={`particle-attributes:${type.id}`}
              label={t('simulator.editor.particle.attributes', { name: String(type.name) })}
              value={type.attributes}
              change={(value) =>
                patchType(type.id, { attributes: value as typeof type.attributes })
              }
            />
            {!scenarioId && (
              <>
                <p>
                  {t(
                    'simulator.editor.particle.deletingAlsoRemovesSourcesThatGenerateThisParticleType',
                  )}
                </p>
                <button
                  onClick={() =>
                    setDraft((model) => removeSimulationEntity(model, 'particleTypes', type.id))
                  }
                >
                  {t('simulator.editor.particle.deleteParticleType')}
                </button>
              </>
            )}
          </fieldset>
        )}
      </EntityCollection>
      {!scenarioId && (
        <button
          onClick={() =>
            setDraft((model) => ({
              ...model,
              particleTypes: [
                ...model.particleTypes,
                {
                  id: crypto.randomUUID(),
                  name: 'New work item',
                  color: '#647be7',
                  revenue: 0,
                  complexity: { min: 1, max: 1 },
                  priority: 0,
                },
              ],
            }))
          }
        >
          {t('simulator.editor.particle.addParticleType')}
        </button>
      )}
    </>
  );
}
