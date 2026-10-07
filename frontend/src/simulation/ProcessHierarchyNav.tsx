import { useMemo } from 'react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { setSimulationModel } from './document';
import { addDraftNode } from './editor/draft';
import { ProcessHierarchy } from './process-hierarchy';
import { openSimulationProcess, processOverview, useProcessNavigation } from './process-navigation';
import './process-hierarchy.css';

export function ProcessHierarchyNav({
  graph,
  spatial = false,
}: {
  graph: Graph;
  spatial?: boolean;
}) {
  const model = graph.simulation;
  const hierarchy = useMemo(() => model && new ProcessHierarchy(model), [model]);
  const view = useProcessNavigation((state) => state.views[graph.diagram.id] ?? processOverview);
  if (!hierarchy?.processes.size) return null;
  const id = view.processId && hierarchy.processes.has(view.processId) ? view.processId : undefined;
  const path = id ? [...hierarchy.ancestry(id)].reverse() : [];
  return (
    <nav className="simulation-process-navigation" aria-label="Process navigation">
      <div className="simulation-process-breadcrumbs">
        <button
          aria-current={view.mode === 'hierarchy' && !id ? 'page' : undefined}
          onClick={() => openSimulationProcess(graph.diagram.id)}
        >
          Process overview
        </button>
        {view.mode === 'hierarchy' &&
          path.map((processId) => (
            <span key={processId}>
              <span aria-hidden="true">/</span>
              <button
                aria-current={id === processId ? 'page' : undefined}
                onClick={() => openSimulationProcess(graph.diagram.id, processId)}
              >
                {hierarchy.processes.get(processId)?.name}
              </button>
            </span>
          ))}
      </div>
      {!spatial && hierarchy.children(id).length > 0 && (
        <label className="simulation-process-choice">
          <span>{id ? 'Open subprocess' : 'Open main process'}</span>
          <select
            aria-label={id ? 'Open subprocess' : 'Open main process'}
            value=""
            onChange={(event) => {
              if (event.target.value) openSimulationProcess(graph.diagram.id, event.target.value);
            }}
          >
            <option value="">Choose a process…</option>
            {hierarchy.children(id).map((processId) => (
              <option key={processId} value={processId}>
                {hierarchy.processes.get(processId)?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!spatial && view.mode === 'hierarchy' && id && (
        <button
          aria-label={`Add step to ${hierarchy.processes.get(id)?.name}`}
          onClick={() => {
            const current = useEditor.getState().graph;
            if (!current?.simulation?.processes?.some((process) => process.id === id)) return;
            const added = addDraftNode(current.simulation, 'work', id);
            useEditor
              .getState()
              .command('Add process step', (value) => setSimulationModel(value, added.model));
            useEditor.setState({
              selectedNodes: [added.id],
              selectedEdges: [],
              focusNode: added.id,
            });
          }}
        >
          Add step
        </button>
      )}
      <button
        className="simulation-process-all"
        aria-pressed={view.mode === 'all'}
        onClick={() =>
          useProcessNavigation.getState().navigate(graph.diagram.id, {
            mode: view.mode === 'all' ? 'hierarchy' : 'all',
            processId: id,
          })
        }
      >
        {view.mode === 'all' ? 'Return to process view' : 'Show all steps'}
      </button>
      {spatial && view.mode !== 'all' && (
        <span className="simulation-process-spatial-note">
          3D displays all steps. Return to 2D to open a process.
        </span>
      )}
    </nav>
  );
}
