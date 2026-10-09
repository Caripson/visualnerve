import { useI18n } from '../../i18n';
import { useState } from 'react';
import { EntityCollection } from './EntityCollection';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import { ConnectionForm } from './ConnectionForm';
import { removeSimulationEntity } from '../deletion';
import { ParallelFlowDraft } from './parallel-flow-draft';
export function ConnectionsEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const remove = (id: string) => {
    try {
      const synchronized = new ParallelFlowDraft().synchronize({
        ...draft,
        edges: draft.edges.filter((edge) => edge.id !== id),
      });
      setDraft(removeSimulationEntity(synchronized, 'edges', id));
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <EntityCollection
        items={draft.edges.map((edge) => ({
          ...edge,
          name: `${draft.nodes.find((node) => node.id === edge.sourceNodeId)?.name ?? edge.sourceNodeId} → ${draft.nodes.find((node) => node.id === edge.targetNodeId)?.name ?? edge.targetNodeId}`,
        }))}
        label={t('simulator.editor.connections.connectionToEdit')}
      >
        {(edge) => (
          <fieldset key={edge.id}>
            <legend>
              {draft.nodes.find((node) => node.id === edge.sourceNodeId)?.name} →{' '}
              {draft.nodes.find((node) => node.id === edge.targetNodeId)?.name}
            </legend>
            <NumberField
              label={t('simulator.editor.connections.travelTimeSeconds', { id: String(edge.id) })}
              value={edge.travelSeconds ?? 0}
              change={(value) =>
                setDraft((model) => ({
                  ...model,
                  edges: model.edges.map((entry) =>
                    entry.id === edge.id ? { ...entry, travelSeconds: value } : entry,
                  ),
                }))
              }
            />
            {!scenarioId && (
              <button onClick={() => remove(edge.id)}>
                {t('simulator.editor.connections.removeConnection')}
              </button>
            )}
          </fieldset>
        )}
      </EntityCollection>
      {!scenarioId && (
        <ConnectionForm
          model={draft}
          add={(sourceNodeId, targetNodeId) =>
            setDraft((model) =>
              new ParallelFlowDraft().synchronize({
                ...model,
                edges: [
                  ...model.edges,
                  { id: crypto.randomUUID(), sourceNodeId, targetNodeId, travelSeconds: 0 },
                ],
              }),
            )
          }
        />
      )}
    </>
  );
}
