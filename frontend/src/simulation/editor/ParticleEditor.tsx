import { EntityCollection } from './EntityCollection';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import { removeSimulationEntity } from '../deletion';
export function ParticleEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const patchType = (id: string, partial: Partial<ParticleType>) =>
    setDraft((model) => ({
      ...model,
      particleTypes: model.particleTypes.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  return (
    <>
      <EntityCollection items={draft.particleTypes} label="Particle type to edit">
        {(type) => (
          <fieldset key={type.id}>
            <legend>{type.name}</legend>
            <label>
              Name
              <input
                aria-label={`Particle name ${type.id}`}
                value={type.name}
                onChange={(event) => patchType(type.id, { name: event.target.value })}
              />
            </label>
            <div className="simulation-grid">
              <label>
                Color
                <input
                  aria-label={`Particle color ${type.id}`}
                  type="color"
                  value={type.color}
                  onChange={(event) => patchType(type.id, { color: event.target.value })}
                />
              </label>
              <label>
                Shape
                <select
                  aria-label={`Particle shape ${type.id}`}
                  value={type.shape ?? 'circle'}
                  onChange={(event) =>
                    patchType(type.id, { shape: event.target.value as typeof type.shape })
                  }
                >
                  {['circle', 'square', 'triangle'].map((shape) => (
                    <option key={shape}>{shape}</option>
                  ))}
                </select>
              </label>
              <NumberField
                label={`Revenue ${type.name}`}
                value={type.revenue}
                change={(value) => patchType(type.id, { revenue: value ?? 0 })}
              />
              <NumberField
                label={`Minimum complexity ${type.name}`}
                value={type.complexity.min}
                change={(value) =>
                  patchType(type.id, { complexity: { ...type.complexity, min: value ?? 1 } })
                }
              />
              <NumberField
                label={`Maximum complexity ${type.name}`}
                value={type.complexity.max}
                change={(value) =>
                  patchType(type.id, { complexity: { ...type.complexity, max: value ?? 1 } })
                }
              />
              <NumberField
                label={`Priority ${type.name}`}
                value={type.priority}
                change={(value) => patchType(type.id, { priority: value ?? 0 })}
              />
              <NumberField
                label={`Patience ${type.name} (minutes)`}
                value={type.patienceSeconds === undefined ? undefined : type.patienceSeconds / 60}
                change={(value) =>
                  patchType(type.id, {
                    patienceSeconds: value === undefined ? undefined : value * 60,
                  })
                }
              />
            </div>
            <JsonField
              label={`Attributes ${type.name}`}
              value={type.attributes}
              change={(value) =>
                patchType(type.id, { attributes: value as typeof type.attributes })
              }
            />
            {!scenarioId && (
              <>
                <p>Deleting also removes sources that generate this particle type.</p>
                <button
                  onClick={() =>
                    setDraft((model) => removeSimulationEntity(model, 'particleTypes', type.id))
                  }
                >
                  Delete particle type
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
          Add particle type
        </button>
      )}
    </>
  );
}
