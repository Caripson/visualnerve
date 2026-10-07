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
          Process node{' '}
          <select
            aria-label="Simulation node"
            value={selected ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {draft.nodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.type})
              </option>
            ))}
          </select>
        </label>
        {!scenarioId && (
          <label>
            Add node{' '}
            <select
              aria-label="Add simulation node"
              value=""
              onChange={(event) =>
                event.target.value && addNode(event.target.value as SimulationNode['type'])
              }
            >
              <option value="">Choose type…</option>
              {['source', 'work', 'router', 'resource', 'outcome'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {node && (
        <>
          <label className="simulation-field">
            Name
            <input
              aria-label="Simulation node name"
              value={node.name}
              onChange={(event) => patchNode({ name: event.target.value })}
            />
          </label>
          <label className="simulation-field">
            Description
            <textarea
              aria-label="Simulation node description"
              value={node.description ?? ''}
              onChange={(event) => patchNode({ description: event.target.value })}
            />
          </label>
          {node.type === 'source' && (
            <SourceEditor draft={draft} node={node} patchNode={patchNode} />
          )}
          {node.type === 'work' && <WorkEditor draft={draft} node={node} patchNode={patchNode} />}
          {node.type === 'router' && (
            <RouterEditor draft={draft} node={node} patchNode={patchNode} />
          )}
          {node.type === 'resource' && (
            <p>
              Configure this resource in the Resources section. Resource:{' '}
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
              Delete process node
            </button>
          )}
        </>
      )}
    </>
  );
}
