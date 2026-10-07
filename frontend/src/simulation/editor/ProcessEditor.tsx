import { EntityCollection } from './EntityCollection';
import { ProcessHierarchy } from '../process-hierarchy';
import { removeSimulationEntity } from '../deletion';
import type { SimulationModel, SimulationProcess } from '../types';
import type { EditorSectionProps } from './types';
import '../process-hierarchy.css';

/** Atomic hierarchy edits preserve the real work graph and each step's assumptions. */
export class ProcessModelEditor {
  constructor(readonly model: SimulationModel) {}
  create(parentId?: string, id: string = crypto.randomUUID()): SimulationModel {
    if (parentId && !this.model.processes?.some((process) => process.id === parentId))
      throw new Error('Choose an existing parent process.');
    return {
      ...this.model,
      processes: [
        ...(this.model.processes ?? []),
        {
          id,
          name: parentId ? 'New subprocess' : 'New main process',
          ...(parentId ? { parentId } : {}),
        },
      ],
    };
  }
  update(id: string, patch: Partial<Omit<SimulationProcess, 'id'>>): SimulationModel {
    const next = {
      ...this.model,
      processes: (this.model.processes ?? []).map((process) =>
        process.id === id ? { ...process, ...patch } : process,
      ),
    };
    if (Object.hasOwn(patch, 'parentId'))
      new ProcessHierarchy({
        ...next,
        processes: next.processes.map((process) => ({
          ...process,
          name: process.name.trim() ? process.name : 'Untitled process',
        })),
      });
    return next;
  }
  assign(nodeId: string, processId?: string): SimulationModel {
    if (processId && !this.model.processes?.some((process) => process.id === processId))
      throw new Error('Choose an existing process.');
    return {
      ...this.model,
      nodes: this.model.nodes.map((node) => (node.id === nodeId ? { ...node, processId } : node)),
    };
  }
  remove(id: string): SimulationModel {
    return removeSimulationEntity(this.model, 'processes', id);
  }
  parentChoices(id: string): SimulationProcess[] {
    const hierarchy = new ProcessHierarchy({
      ...this.model,
      processes: this.model.processes?.map((process) => ({
        ...process,
        name: process.name.trim() ? process.name : 'Untitled process',
      })),
    });
    const excluded = new Set([id, ...hierarchy.descendants(id)]);
    return (this.model.processes ?? []).filter((process) => !excluded.has(process.id));
  }
}
export function ProcessEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const processes = draft.processes ?? [];
  const edit = (action: (editor: ProcessModelEditor) => SimulationModel) =>
    setDraft((model) => action(new ProcessModelEditor(model)));
  return (
    <>
      <p>
        Main processes group real steps. Add subprocesses to reveal more detail. Each Work step
        keeps its own processing time, capacity, cost and shared resources; a group adds no extra
        processing charge.
      </p>
      {!processes.length && (
        <p className="simulation-notice">
          No process groups yet. Add a main process, then assign existing steps below.
        </p>
      )}
      <EntityCollection items={processes} label="Process group to edit">
        {(process) => (
          <fieldset aria-label={process.name}>
            <legend>{process.name}</legend>
            <label>
              Name
              <input
                aria-label={`Process name ${process.id}`}
                value={process.name}
                onChange={(event) =>
                  edit((editor) => editor.update(process.id, { name: event.target.value }))
                }
              />
            </label>
            <label>
              Description
              <textarea
                aria-label={`Process description ${process.id}`}
                value={process.description ?? ''}
                onChange={(event) =>
                  edit((editor) => editor.update(process.id, { description: event.target.value }))
                }
              />
            </label>
            <label>
              Parent process
              <select
                aria-label={`Parent process ${process.id}`}
                value={process.parentId ?? ''}
                onChange={(event) =>
                  edit((editor) =>
                    editor.update(process.id, { parentId: event.target.value || undefined }),
                  )
                }
              >
                <option value="">Main process (top level)</option>
                {new ProcessModelEditor(draft).parentChoices(process.id).map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {draft.nodes.filter((node) => node.processId === process.id).length} steps assigned
              directly. Child steps also contribute to the parent’s observed metrics.
            </p>
            {!scenarioId && (
              <div className="simulation-row">
                <button onClick={() => edit((editor) => editor.create(process.id))}>
                  Add subprocess to {process.name}
                </button>
                <button
                  className="danger"
                  onClick={() => edit((editor) => editor.remove(process.id))}
                >
                  Delete process group {process.name}
                </button>
              </div>
            )}
          </fieldset>
        )}
      </EntityCollection>
      {!scenarioId && (
        <button onClick={() => edit((editor) => editor.create())}>Add main process</button>
      )}
      {processes.length > 0 && (
        <fieldset className="simulation-process-editor-members">
          <legend>Assign steps to a process</legend>
          <p>
            Shared resources keep one global pool even when used by several subprocesses. Deleting a
            group preserves its steps and lifts them and its subprocesses to its parent.
          </p>
          {draft.nodes.map((node) => (
            <label key={node.id}>
              {node.name}
              <select
                aria-label={`Process membership ${node.name}`}
                value={node.processId ?? ''}
                onChange={(event) =>
                  edit((editor) => editor.assign(node.id, event.target.value || undefined))
                }
              >
                <option value="">Outside process groups</option>
                {processes.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
