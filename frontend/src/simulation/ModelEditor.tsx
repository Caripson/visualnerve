import { useCallback, useState } from 'react';
import { Modal } from '../components/Modal';
import { useCompactLayout } from '../hooks/useCompactLayout';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { setSimulationModel } from './document';
import { assertSimulationModel, resolveScenario } from './schema';
import { NodeEditor } from './editor/NodeEditor';
import { ProcessEditor } from './editor/ProcessEditor';
import { ConnectionsEditor } from './editor/ConnectionsEditor';
import { ParticleEditor } from './editor/ParticleEditor';
import { ResourceEditor } from './editor/ResourceEditor';
import { ImprovementEditor } from './editor/ImprovementEditor';
import { EconomicsEditor } from './editor/EconomicsEditor';
import { EditorValidationProvider } from './editor/JsonField';
import { addDraftNode, applyScenarioDraft } from './editor/draft';
import type { SimulationModel, SimulationNode } from './types';

const clone = <T,>(value: T): T => structuredClone(value);
const sections = [
  'nodes',
  'processes',
  'connections',
  'particles',
  'resources',
  'improvements',
  'economics',
  'complete model',
];

export function ModelEditor({
  graph,
  scenarioId,
  close,
}: {
  graph: Graph;
  scenarioId?: string;
  close: () => void;
}) {
  const compact = useCompactLayout();
  const base = graph.simulation!;
  const [draft, setDraft] = useState<SimulationModel>(() =>
    clone(resolveScenario(base, scenarioId, 1)),
  );
  const [tab, setTab] = useState('nodes');
  const [selected, setSelected] = useState<string | undefined>(
    graph.simulation!.nodes.find((node) => useEditor.getState().selectedNodes.includes(node.id))
      ?.id ?? draft.nodes[0]?.id,
  );
  const [error, setError] = useState('');
  const [jsonError, setJsonError] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  const fieldValidity = useCallback(
    (field: string, invalid: boolean) =>
      setInvalidFields((previous) => {
        if (previous.has(field) === invalid) return previous;
        const next = new Set(previous);
        if (invalid) next.add(field);
        else next.delete(field);
        return next;
      }),
    [],
  );

  function addNode(type: SimulationNode['type']) {
    const added = addDraftNode(
      draft,
      type,
      draft.nodes.find((node) => node.id === selected)?.processId,
    );
    setDraft(added.model);
    setSelected(added.id);
  }
  function apply() {
    try {
      if (jsonError || invalidFields.size) throw new Error('Fix the JSON error before applying.');
      const model = scenarioId ? applyScenarioDraft(base, draft, scenarioId) : draft;
      assertSimulationModel(model);
      const current = useEditor.getState().graph;
      if (
        !current ||
        current.diagram.id !== graph.diagram.id ||
        JSON.stringify(current.simulation) !== JSON.stringify(base)
      )
        throw new Error(
          'The model changed while settings were open. Reopen settings to edit the current model.',
        );
      useEditor
        .getState()
        .command(scenarioId ? 'Update simulation scenario' : 'Update simulation model', (value) =>
          setSimulationModel(value, model),
        );
      close();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <Modal
      title="Process Simulator settings"
      close={close}
      wide
      className="simulation-settings-dialog"
    >
      <EditorValidationProvider change={fieldValidity}>
        <section className="simulation-modal">
          <p className="simulation-edit-context">
            {scenarioId
              ? `Editing ${base.scenarios.find((entry) => entry.id === scenarioId)?.name}. Baseline stays unchanged.`
              : 'Editing the baseline. Existing run results keep their original assumptions.'}
          </p>
          {compact ? (
            <label className="simulation-panel-choice">
              Settings section
              <select
                aria-label="Settings section"
                value={tab}
                onChange={(event) => setTab(event.target.value)}
              >
                {sections.map((section) => (
                  <option key={section} value={section}>
                    {section.charAt(0).toUpperCase() + section.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <nav aria-label="Simulation settings sections">
              {sections.map((section) => (
                <button
                  key={section}
                  aria-pressed={tab === section}
                  onClick={() => setTab(section)}
                >
                  {section}
                </button>
              ))}
            </nav>
          )}
          <div className="simulation-editor-body">
            {tab === 'nodes' && (
              <NodeEditor
                draft={draft}
                setDraft={setDraft}
                scenarioId={scenarioId}
                selected={selected}
                setSelected={setSelected}
                addNode={addNode}
              />
            )}
            {tab === 'processes' && (
              <ProcessEditor draft={draft} setDraft={setDraft} scenarioId={scenarioId} />
            )}
            {tab === 'connections' && (
              <ConnectionsEditor draft={draft} setDraft={setDraft} scenarioId={scenarioId} />
            )}
            {tab === 'particles' && (
              <ParticleEditor draft={draft} setDraft={setDraft} scenarioId={scenarioId} />
            )}
            {tab === 'resources' && (
              <ResourceEditor
                draft={draft}
                setDraft={setDraft}
                scenarioId={scenarioId}
                addNode={addNode}
                setTab={setTab}
              />
            )}
            {tab === 'improvements' && (
              <ImprovementEditor draft={draft} setDraft={setDraft} scenarioId={scenarioId} />
            )}
            {tab === 'economics' && (
              <EconomicsEditor draft={draft} setDraft={setDraft} scenarioId={scenarioId} />
            )}
            {tab === 'complete model' && (
              <>
                <p>
                  All semantic properties are available here and through the local API/MCP.
                  Structured editors cover the common assumptions.
                </p>
                <textarea
                  aria-label="Complete simulation model"
                  rows={24}
                  defaultValue={JSON.stringify(draft, null, 2)}
                  onChange={(event) => {
                    try {
                      const model = JSON.parse(event.target.value);
                      assertSimulationModel(model);
                      setDraft(model);
                      setJsonError(false);
                      setError('');
                    } catch (failure) {
                      setJsonError(true);
                      setError((failure as Error).message);
                    }
                  }}
                />
              </>
            )}
          </div>
          {error && (
            <p role="alert" className="error-notice">
              {error}
            </p>
          )}
          {invalidFields.size > 0 && (
            <p role="alert" className="error-notice">
              Fix invalid JSON in: {[...invalidFields].join(', ')}.
            </p>
          )}
          <footer className="simulation-sheet-actions">
            <button onClick={close}>Cancel</button>
            <button
              className="primary"
              onClick={apply}
              disabled={jsonError || invalidFields.size > 0}
            >
              Apply assumptions
            </button>
          </footer>
        </section>
      </EditorValidationProvider>
    </Modal>
  );
}
