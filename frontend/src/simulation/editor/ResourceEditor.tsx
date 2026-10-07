import { EntityCollection } from './EntityCollection';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import { ScheduleFields } from './ScheduleFields';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import { removeSimulationEntity } from '../deletion';
export function ResourceEditor({
  draft,
  setDraft,
  scenarioId,
  addNode,
  setTab,
}: EditorSectionProps & {
  addNode: (type: SimulationNode['type']) => void;
  setTab: (tab: string) => void;
}) {
  const patchResource = (id: string, partial: Partial<Resource>) =>
    setDraft((model) => ({
      ...model,
      resources: model.resources.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  return (
    <>
      <EntityCollection items={draft.resources} label="Resource to edit">
        {(resource) => (
          <fieldset key={resource.id}>
            <legend>{resource.name}</legend>
            <label>
              Name
              <input
                aria-label={`Resource name ${resource.id}`}
                value={resource.name}
                onChange={(event) => patchResource(resource.id, { name: event.target.value })}
              />
            </label>
            <label>
              Unit
              <input
                aria-label={`Resource unit ${resource.id}`}
                value={resource.unit}
                onChange={(event) => patchResource(resource.id, { unit: event.target.value })}
              />
            </label>
            <div className="simulation-grid">
              <NumberField
                label={`Resource capacity ${resource.name}`}
                value={resource.capacity}
                step={1}
                change={(value) => patchResource(resource.id, { capacity: value ?? 0 })}
              />
              <NumberField
                label={`Resource minimum ${resource.name}`}
                value={resource.minCapacity}
                step={1}
                change={(value) => patchResource(resource.id, { minCapacity: value })}
              />
              <NumberField
                label={`Resource maximum ${resource.name}`}
                value={resource.maxCapacity}
                step={1}
                change={(value) => patchResource(resource.id, { maxCapacity: value })}
              />
              <NumberField
                label={`Resource cost ${resource.name} / hour`}
                help="Per available resource unit, including idle time."
                value={resource.costPerHour ?? 0}
                change={(value) => patchResource(resource.id, { costPerHour: value })}
              />
            </div>
            <ScalingFields
              capacity={resource.capacity}
              value={resource.scaling}
              change={(value) => patchResource(resource.id, { scaling: value })}
            />
            <ScheduleFields
              label={`${resource.name} availability`}
              value={resource.schedule}
              change={(schedule) => patchResource(resource.id, { schedule })}
            />
            <JsonField
              label={`Availability ${resource.name}`}
              value={resource.schedule}
              change={(value) =>
                patchResource(resource.id, { schedule: value as typeof resource.schedule })
              }
            />
            {!scenarioId && (
              <>
                <p>
                  Deleting also disconnects Work nodes and removes this resource's displays and
                  investments.
                </p>
                <button
                  onClick={() =>
                    setDraft((model) => removeSimulationEntity(model, 'resources', resource.id))
                  }
                >
                  Delete resource
                </button>
              </>
            )}
          </fieldset>
        )}
      </EntityCollection>
      {!scenarioId && (
        <button
          onClick={() => {
            addNode('resource');
            setTab('resources');
          }}
        >
          Add shared resource
        </button>
      )}
    </>
  );
}
