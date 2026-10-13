import { useI18n } from '../../i18n';
import { EntityCollection } from './EntityCollection';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import { ScheduleFields } from './ScheduleFields';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import { removeSimulationEntity } from '../deletion';
import { ResourceDomainFields } from '../infrastructure/ResourceDomainFields';
import { infrastructureWorkResources } from '../infrastructure/references';
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
  const { t } = useI18n();
  const patchResource = (id: string, partial: Partial<Resource>) =>
    setDraft((model) => ({
      ...model,
      ...(partial.infrastructure
        ? { schemaVersion: 2 as const, infrastructure: { schemaVersion: 1 as const } }
        : {}),
      resources: model.resources.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry,
      ),
    }));
  const typedInUse = (resource: Resource) =>
    !!resource.infrastructure &&
    (draft.nodes.some(
      (node) =>
        node.type === 'work' &&
        infrastructureWorkResources(node.work.infrastructure).includes(resource.id),
    ) ||
      draft.edges.some((edge) => edge.infrastructure?.transfer.resourceId === resource.id));
  return (
    <>
      <EntityCollection
        items={draft.resources}
        label={t('simulator.editor.resource.resourceToEdit')}
      >
        {(resource) => (
          <fieldset key={resource.id}>
            <legend>{resource.name}</legend>
            <label>
              {t('simulator.common.name')}{' '}
              <input
                aria-label={t('simulator.editor.resource.resourceName', {
                  id: String(resource.id),
                })}
                value={resource.name}
                onChange={(event) => patchResource(resource.id, { name: event.target.value })}
              />
            </label>
            <ResourceDomainFields
              resource={resource}
              model={draft}
              allowDimensionChange={!scenarioId || !!draft.infrastructure}
              change={(partial) => patchResource(resource.id, partial)}
            />
            {!resource.infrastructure && (
              <>
                <label>
                  {t('simulator.editor.resource.unit')}{' '}
                  <input
                    aria-label={t('simulator.editor.resource.resourceUnit', {
                      id: String(resource.id),
                    })}
                    value={resource.unit}
                    onChange={(event) => patchResource(resource.id, { unit: event.target.value })}
                  />
                </label>
                <div className="simulation-grid">
                  <NumberField
                    label={t('simulator.editor.resource.resourceCapacity', {
                      name: String(resource.name),
                    })}
                    value={resource.capacity}
                    step={1}
                    change={(value) => patchResource(resource.id, { capacity: value ?? 0 })}
                  />
                  <NumberField
                    label={t('simulator.editor.resource.resourceMinimum', {
                      name: String(resource.name),
                    })}
                    value={resource.minCapacity}
                    step={1}
                    change={(value) => patchResource(resource.id, { minCapacity: value })}
                  />
                  <NumberField
                    label={t('simulator.editor.resource.resourceMaximum', {
                      name: String(resource.name),
                    })}
                    value={resource.maxCapacity}
                    step={1}
                    change={(value) => patchResource(resource.id, { maxCapacity: value })}
                  />
                </div>
              </>
            )}
            <div className="simulation-grid">
              <NumberField
                label={t('simulator.editor.resource.resourceCostHour', {
                  name: String(resource.name),
                })}
                help={t('simulator.editor.resource.perAvailableResourceUnitIncludingIdleTime')}
                value={resource.costPerHour ?? 0}
                change={(value) => patchResource(resource.id, { costPerHour: value })}
              />
            </div>
            {(!resource.infrastructure ||
              resource.infrastructure.kind === 'cpu' ||
              resource.infrastructure.kind === 'memory') && (
              <ScalingFields
                capacity={resource.capacity}
                value={resource.scaling}
                change={(value) => patchResource(resource.id, { scaling: value })}
              />
            )}

            {resource.infrastructure?.kind !== 'energy' && (
              <>
                <ScheduleFields
                  label={t('simulator.editor.resource.availability', {
                    name: String(resource.name),
                  })}
                  value={resource.schedule}
                  change={(schedule) => patchResource(resource.id, { schedule })}
                />
                <JsonField
                  fieldId={`resource-schedule:${resource.id}`}
                  label={t('simulator.editor.resource.availability.name', {
                    name: String(resource.name),
                  })}
                  value={resource.schedule}
                  change={(value) =>
                    patchResource(resource.id, { schedule: value as typeof resource.schedule })
                  }
                />
              </>
            )}
            {!scenarioId && (
              <>
                <p>
                  {typedInUse(resource)
                    ? 'Remove typed work requirements and network transfers before deleting this pool.'
                    : t(
                        'simulator.editor.resource.deletingAlsoDisconnectsWorkNodesAndRemovesThisResourceSDisplaysAnd',
                      )}
                </p>
                <button
                  disabled={typedInUse(resource)}
                  onClick={() =>
                    setDraft((model) => removeSimulationEntity(model, 'resources', resource.id))
                  }
                >
                  {t('simulator.editor.resource.deleteResource')}
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
          {t('simulator.editor.resource.addSharedResource')}
        </button>
      )}
    </>
  );
}
