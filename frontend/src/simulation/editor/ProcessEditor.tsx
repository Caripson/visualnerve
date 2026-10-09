import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
  const processes = draft.processes ?? [];
  const edit = (action: (editor: ProcessModelEditor) => SimulationModel) =>
    setDraft((model) => action(new ProcessModelEditor(model)));
  return (
    <>
      <p>
        {t(
          'simulator.editor.process.mainProcessesGroupRealStepsAddSubprocessesToRevealMoreDetailEach',
        )}
      </p>
      {!processes.length && (
        <p className="simulation-notice">
          {t('simulator.editor.process.noProcessGroupsYetAddAMainProcessThenAssignExistingSteps')}
        </p>
      )}
      <EntityCollection items={processes} label={t('simulator.editor.process.processGroupToEdit')}>
        {(process) => (
          <fieldset aria-label={process.name}>
            <legend>{process.name}</legend>
            <label>
              {t('simulator.common.name')}{' '}
              <input
                aria-label={t('simulator.editor.process.processName', { id: String(process.id) })}
                value={process.name}
                onChange={(event) =>
                  edit((editor) => editor.update(process.id, { name: event.target.value }))
                }
              />
            </label>
            <label>
              {t('simulator.common.description')}{' '}
              <textarea
                aria-label={t('simulator.editor.process.processDescription', {
                  id: String(process.id),
                })}
                value={process.description ?? ''}
                onChange={(event) =>
                  edit((editor) => editor.update(process.id, { description: event.target.value }))
                }
              />
            </label>
            <label>
              {t('simulator.editor.process.parentProcess')}{' '}
              <select
                aria-label={t('simulator.editor.process.parentProcess.id', {
                  id: String(process.id),
                })}
                value={process.parentId ?? ''}
                onChange={(event) =>
                  edit((editor) =>
                    editor.update(process.id, { parentId: event.target.value || undefined }),
                  )
                }
              >
                <option value="">{t('simulator.editor.process.mainProcessTopLevel')}</option>
                {new ProcessModelEditor(draft).parentChoices(process.id).map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {t('simulator.editor.process.assignedSteps', {
                count: draft.nodes.filter((node) => node.processId === process.id).length,
              })}
            </p>
            {!scenarioId && (
              <div className="simulation-row">
                <button onClick={() => edit((editor) => editor.create(process.id))}>
                  {t('simulator.editor.process.addSubprocess', { processName: process.name })}
                </button>
                <button
                  className="danger"
                  onClick={() => edit((editor) => editor.remove(process.id))}
                >
                  {t('simulator.editor.process.deleteGroup', { processName: process.name })}
                </button>
              </div>
            )}
          </fieldset>
        )}
      </EntityCollection>
      {!scenarioId && (
        <button onClick={() => edit((editor) => editor.create())}>
          {t('simulator.editor.process.addMainProcess')}
        </button>
      )}
      {processes.length > 0 && (
        <fieldset className="simulation-process-editor-members">
          <legend>{t('simulator.editor.process.assignStepsToAProcess')}</legend>
          <p>
            {t(
              'simulator.editor.process.sharedResourcesKeepOneGlobalPoolEvenWhenUsedBySeveralSubprocesses',
            )}
          </p>
          {draft.nodes.map((node) => (
            <label key={node.id}>
              {node.name}
              <select
                aria-label={t('simulator.editor.process.processMembership', {
                  name: String(node.name),
                })}
                value={node.processId ?? ''}
                onChange={(event) =>
                  edit((editor) => editor.assign(node.id, event.target.value || undefined))
                }
              >
                <option value="">{t('simulator.editor.node.outsideProcessGroups')}</option>
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
