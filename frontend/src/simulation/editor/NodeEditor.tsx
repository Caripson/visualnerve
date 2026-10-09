import { simulationNodeTypeLabel } from '../display';
import { useI18n } from '../../i18n';
import type { SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
import type { Dispatch, SetStateAction } from 'react';
import { SourceEditor } from './SourceEditor';
import { WorkEditor } from './WorkEditor';
import { RouterEditor } from './RouterEditor';
import { OutcomeEditor } from './OutcomeEditor';
import { removeSimulationEntity } from '../deletion';
export function NodeEditor({
  draft,
  setDraft,
  scenarioId,
  selected,
  setSelected,
  addNode,
}: EditorSectionProps & {
  selected?: string;
  setSelected: Dispatch<SetStateAction<string | undefined>>;
  addNode: (type: SimulationNode['type']) => void;
}) {
  const { t } = useI18n();
  const node = draft.nodes.find((entry) => entry.id === selected);
  const patchNode = (partial: Partial<SimulationNode>) =>
    setDraft((model) => ({
      ...model,
      nodes: model.nodes.map((entry) =>
        entry.id === selected ? ({ ...entry, ...partial } as SimulationNode) : entry,
      ),
    }));
  return (
    <>
      <div className="simulation-row">
        <label>
          {t('simulator.editor.improvement.processNode')}{' '}
          <select
            aria-label={t('simulator.editor.node.simulationNode')}
            value={selected ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {draft.nodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({simulationNodeTypeLabel(t, entry.type)})
              </option>
            ))}
          </select>
        </label>
        {!scenarioId && (
          <label>
            {t('simulator.editor.node.addNode')}{' '}
            <select
              aria-label={t('simulator.editor.node.addSimulationNode')}
              value=""
              onChange={(event) =>
                event.target.value && addNode(event.target.value as SimulationNode['type'])
              }
            >
              <option value="">{t('simulator.editor.node.chooseType')}</option>
              {['source', 'work', 'router', 'resource', 'outcome'].map((type) => (
                <option key={type} value={type}>
                  {simulationNodeTypeLabel(t, type)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {node && (
        <>
          <label className="simulation-field">
            {t('simulator.common.name')}{' '}
            <input
              aria-label={t('simulator.editor.node.simulationNodeName')}
              value={node.name}
              onChange={(event) => patchNode({ name: event.target.value })}
            />
          </label>
          <label className="simulation-field">
            {t('simulator.common.description')}{' '}
            <textarea
              aria-label={t('simulator.editor.node.simulationNodeDescription')}
              value={node.description ?? ''}
              onChange={(event) => patchNode({ description: event.target.value })}
            />
          </label>
          {(draft.processes?.length ?? 0) > 0 && (
            <label className="simulation-field">
              {t('simulator.common.processGroup')}{' '}
              <select
                aria-label={t('simulator.editor.node.nodeProcessGroup')}
                value={node.processId ?? ''}
                onChange={(event) => patchNode({ processId: event.target.value || undefined })}
              >
                <option value="">{t('simulator.editor.node.outsideProcessGroups')}</option>
                {draft.processes?.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {node.type === 'source' && (
            <SourceEditor draft={draft} node={node} patchNode={patchNode} />
          )}
          {node.type === 'work' && <WorkEditor draft={draft} node={node} patchNode={patchNode} />}
          {node.type === 'router' && (
            <RouterEditor draft={draft} node={node} patchNode={patchNode} />
          )}
          {node.type === 'resource' && (
            <p>
              {t('simulator.editor.node.configureThisResourceInTheResourcesSectionResource')}{' '}
              {draft.resources.find((resource) => resource.id === node.resourceId)?.name}
            </p>
          )}
          {node.type === 'outcome' && (
            <OutcomeEditor draft={draft} node={node} patchNode={patchNode} />
          )}
          {!scenarioId && (
            <button
              className="danger"
              onClick={() => {
                setDraft((model) => removeSimulationEntity(model, 'nodes', node.id));
                setSelected(undefined);
              }}
            >
              {t('simulator.editor.node.deleteProcessNode')}
            </button>
          )}
        </>
      )}
    </>
  );
}
