import { useState, type FormEvent } from 'react';
import { Field } from '../../../components/Field';
import { useI18n } from '../../../i18n';
import {
  collaborationLimits,
  taskStatuses,
  type CollaborationTask,
  type TaskStatus,
} from '../../model';
import { ConfirmRemoval, NodeTarget, ProfileName, TargetLabel, WorkPages } from './Shared';
import type { DocumentWorkProps } from './types';

function TaskForm({
  task,
  work,
  close,
}: {
  task?: CollaborationTask;
  work: DocumentWorkProps;
  close(): void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [nodeId, setNodeId] = useState(
    task?.nodeId ?? work.selectedNodeId ?? work.graph.nodes[0]?.id ?? '',
  );
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [baseVersion] = useState(work.graph.diagram.version);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = {
      title: title.trim(),
      description: description.trim() || null,
      assigneeId: assigneeId || null,
      status,
      dueDate: dueDate || null,
    };
    if (
      await work.run(
        task
          ? {
              type: 'task.update',
              id: task.id,
              patch: { ...values, ...(nodeId !== task.nodeId ? { nodeId } : {}) },
            }
          : { type: 'task.create', task: { ...values, nodeId } },
        task ? baseVersion : undefined,
      )
    )
      close();
  };
  return (
    <form className="document-work-form" onSubmit={(event) => void submit(event)}>
      <Field title={t('collaboration.document.taskTitle')}>
        <input
          value={title}
          maxLength={collaborationLimits.taskTitle}
          disabled={work.busy}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <NodeTarget
        graph={work.graph}
        value={nodeId}
        change={setNodeId}
        disabled={work.busy}
        missingTitle={task?.nodeTitle}
      />
      <Field title={t('editor.properties.description')}>
        <textarea
          value={description}
          maxLength={collaborationLimits.text}
          disabled={work.busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="document-work-fields">
        <Field title={t('collaboration.document.assignee')}>
          <select
            aria-label={t('collaboration.document.assignee')}
            value={assigneeId}
            disabled={work.busy}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">{t('collaboration.document.unassigned')}</option>
            {work.document.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </Field>
        <Field title={t('editor.properties.status')}>
          <select
            aria-label={t('editor.properties.status')}
            value={status}
            disabled={work.busy}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          >
            {taskStatuses.map((value) => (
              <option value={value} key={value}>
                {t(`collaboration.document.taskStatus.${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field title={t('editor.properties.dueDate')}>
          <input
            type="date"
            value={dueDate}
            disabled={work.busy}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
      </div>
      <div className="document-work-actions">
        <button
          className="primary"
          disabled={
            work.busy ||
            !title.trim() ||
            (!work.graph.nodes.some((node) => node.id === nodeId) && task?.nodeId !== nodeId)
          }
        >
          {t('common.save')}
        </button>
        <button type="button" disabled={work.busy} onClick={close}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
export function Tasks(work: DocumentWorkProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<CollaborationTask | 'new'>();
  return (
    <section>
      {work.writable && work.profileId && (
        <button
          disabled={work.busy || !!editing || !work.graph.nodes.length}
          onClick={() => setEditing('new')}
        >
          {t('collaboration.document.createTask')}
        </button>
      )}
      {work.writable && work.profileId && editing === 'new' && (
        <TaskForm work={work} close={() => setEditing(undefined)} />
      )}
      {!work.document.tasks.length && <p className="muted">{t('collaboration.document.empty')}</p>}
      <WorkPages
        items={[...work.document.tasks].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        )}
      >
        {(task) => (
          <article className="document-work-card" key={task.id}>
            <strong>{task.title}</strong>
            <div className="document-work-meta">
              <TargetLabel graph={work.graph} nodeId={task.nodeId} title={task.nodeTitle} />
              <span>{t(`collaboration.document.taskStatus.${task.status}`)}</span>
              <ProfileName document={work.document} id={task.assigneeId} />
              {task.dueDate && <time dateTime={task.dueDate}>{task.dueDate}</time>}
            </div>
            {task.description && <p className="document-work-text">{task.description}</p>}
            {work.writable && work.profileId && editing !== 'new' && editing?.id === task.id ? (
              <TaskForm key={task.id} task={task} work={work} close={() => setEditing(undefined)} />
            ) : (
              work.writable &&
              work.profileId && (
                <button disabled={work.busy || !!editing} onClick={() => setEditing(task)}>
                  {t('collaboration.document.edit')}
                </button>
              )
            )}
            {work.writable && work.profileId && (
              <ConfirmRemoval
                disabled={work.busy}
                remove={() => work.run({ type: 'task.remove', id: task.id })}
              />
            )}
          </article>
        )}
      </WorkPages>
    </section>
  );
}
