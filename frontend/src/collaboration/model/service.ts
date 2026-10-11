import { StorageError } from '../../model/errors';
import { defaultParticipantColor } from './color';
import {
  activitySources,
  collaborationLimits,
  type ActivityEvent,
  type ActivityKind,
  type CollaborationAction,
  type CollaborationActionContext,
  type CollaborationDocument,
  type CollaborationGraph,
  type CollaborationTask,
  type CommentThread,
} from './types';
import {
  collaborationFor,
  exactCollaborationFields,
  requireCollaboration,
  validateCollaboration,
  validCollaborationId,
  validCollaborationTimestamp,
} from './validation';

const forbidden = (message: string): never => {
  throw new StorageError(403, message);
};
const missing = (label: string): never => {
  throw new StorageError(404, `${label} was not found.`);
};
export function collaborationWriterTime(context: CollaborationActionContext): string {
  const now = context.now ?? new Date().toISOString();
  requireCollaboration(validCollaborationTimestamp(now), 'Invalid collaboration writer timestamp.');
  return now;
}
export function collaborationNewId(context: CollaborationActionContext): string {
  const id = context.createId?.() ?? crypto.randomUUID();
  requireCollaboration(
    validCollaborationId(id),
    'Collaboration identifier generator must return a UUID.',
  );
  return id;
}
export function assertCollaborationContext(
  context: CollaborationActionContext,
  document: CollaborationDocument,
): void {
  requireCollaboration(
    context &&
      ['owner', 'editor', 'viewer'].includes(context.role) &&
      activitySources.includes(context.source),
    'Invalid collaboration action context.',
  );
  if (context.profileId !== undefined)
    requireCollaboration(
      document.profiles.some((profile) => profile.id === context.profileId),
      'Unknown acting participant profile.',
    );
}
/** Retention follows logical sequence with UUID ties, independent of writer clock or input order. */
export function appendCollaborationActivity(
  document: CollaborationDocument,
  entries: readonly ActivityEvent[],
): void {
  let sequence = Math.max(0, ...document.activity.map((event) => event.sequence));
  const appended = entries.map((event) => {
    sequence++;
    requireCollaboration(
      Number.isSafeInteger(sequence),
      'Collaboration activity sequence is exhausted.',
    );
    return { ...event, sequence };
  });
  document.activity = [...document.activity, ...appended]
    .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(-collaborationLimits.activity);
}
export function collaborationActivityEvent(
  context: CollaborationActionContext,
  kind: ActivityKind,
  summary: string,
  details: Pick<ActivityEvent, 'entityId' | 'nodeIds'> = {},
): ActivityEvent {
  return {
    id: collaborationNewId(context),
    sequence: 0,
    kind,
    source: context.source,
    ...(context.profileId ? { authorId: context.profileId } : {}),
    timestamp: collaborationWriterTime(context),
    summary,
    ...(details.entityId ? { entityId: details.entityId } : {}),
    ...(details.nodeIds?.length
      ? { nodeIds: [...new Set(details.nodeIds)].slice(0, collaborationLimits.activityNodeIds) }
      : {}),
  };
}
const fields = {
  'profile.create': ['type', 'profile'],
  'profile.update': ['type', 'id', 'patch'],
  'profile.remove': ['type', 'id'],
  'comment.create': ['type', 'nodeId', 'text'],
  'comment.reply': ['type', 'id', 'text'],
  'comment.edit': ['type', 'id', 'messageId', 'text'],
  'comment.remove': ['type', 'id', 'messageId'],
  'comment.resolve': ['type', 'id', 'resolved'],
  'task.create': ['type', 'task'],
  'task.update': ['type', 'id', 'patch'],
  'task.remove': ['type', 'id'],
} satisfies Record<CollaborationAction['type'], string[]>;
const profileFields = ['name', 'color', 'avatarDataUrl'];
const taskFields = ['nodeId', 'title', 'description', 'assigneeId', 'status', 'dueDate'];
function patchFields<T extends object>(
  target: T,
  patch: Record<string, unknown>,
  allowed: string[],
): void {
  const object = target as Record<string, unknown>;
  for (const field of allowed) {
    if (!Object.hasOwn(patch, field)) continue;
    if (patch[field] === null || patch[field] === undefined) delete object[field];
    else object[field] = patch[field];
  }
}
function isReferenced(document: CollaborationDocument, id: string): boolean {
  return (
    document.comments.some(
      (thread) =>
        thread.authorId === id ||
        thread.resolvedBy === id ||
        thread.messages.some((message) => message.authorId === id),
    ) ||
    document.tasks.some((task) => task.authorId === id || task.assigneeId === id) ||
    document.activity.some((event) => event.authorId === id)
  );
}

/** One mutation boundary for the panel and API. Context must be supplied by the session adapter. */
export function mutateCollaboration<G extends CollaborationGraph>(
  graph: G,
  action: CollaborationAction,
  context: CollaborationActionContext,
): G {
  const original = collaborationFor(graph);
  assertCollaborationContext(context, original);
  if (context.role === 'viewer') forbidden('Viewers cannot change document collaboration.');
  requireCollaboration(
    action && typeof action.type === 'string' && Object.hasOwn(fields, action.type),
    'Unsupported collaboration action.',
  );
  exactCollaborationFields(action, fields[action.type], 'collaboration action');
  const input = action as unknown as Record<string, unknown>;
  if (fields[action.type].includes('id'))
    requireCollaboration(validCollaborationId(input.id), 'Action target must be a UUID.');
  if (action.type === 'comment.edit' || input.messageId !== undefined)
    requireCollaboration(
      validCollaborationId(input.messageId),
      'Comment message target must be a UUID.',
    );
  if (input.nodeId !== undefined)
    requireCollaboration(validCollaborationId(input.nodeId), 'Comment node target must be a UUID.');
  const document = structuredClone(original);
  const now = collaborationWriterTime(context);
  const owner = () => {
    if (context.role !== 'owner')
      forbidden('Only the document owner can manage participant profiles.');
  };
  const actor = (): string => {
    requireCollaboration(
      context.profileId && document.profiles.some((profile) => profile.id === context.profileId),
      'Choose an acting participant profile first.',
    );
    return context.profileId!;
  };
  const node = (id: string) => {
    requireCollaboration(validCollaborationId(id), 'Task node target must be a UUID.');
    return graph.nodes.find((candidate) => candidate.id === id) ?? missing('Target node');
  };
  const thread = (id: string): CommentThread =>
    document.comments.find((candidate) => candidate.id === id) ?? missing('Comment thread');
  const task = (id: string): CollaborationTask =>
    document.tasks.find((candidate) => candidate.id === id) ?? missing('Task');
  const messageOwnership = (authorId: string) => {
    if (actor() !== authorId) forbidden('Only the comment author can edit its text.');
  };
  let kind: ActivityKind;
  let summary: string;
  let entityId: string;
  let nodeIds: string[] | undefined;
  let changed = true;
  switch (action.type) {
    case 'profile.create': {
      owner();
      exactCollaborationFields(action.profile, profileFields, 'participant profile input');
      entityId = collaborationNewId(context);
      const profile = { id: entityId, name: action.profile.name, createdAt: now, updatedAt: now };
      patchFields(profile, action.profile, profileFields);
      if (action.profile.color === undefined || action.profile.color === null)
        Object.assign(profile, { color: defaultParticipantColor(document.profiles) });
      document.profiles.push(profile);
      kind = 'profile.created';
      summary = 'Participant profile created.';
      break;
    }
    case 'profile.update': {
      const profile =
        document.profiles.find((candidate) => candidate.id === action.id) ??
        missing('Participant profile');
      if (context.role !== 'owner' && actor() !== profile.id)
        forbidden('Editors can update only their own participant profile.');
      exactCollaborationFields(action.patch, profileFields, 'participant profile patch');
      const before = JSON.stringify(profile);
      patchFields(profile, action.patch, profileFields);
      changed = before !== JSON.stringify(profile);
      if (changed) profile.updatedAt = now;
      entityId = profile.id;
      kind = 'profile.updated';
      summary = 'Participant profile updated.';
      break;
    }
    case 'profile.remove': {
      owner();
      const profile =
        document.profiles.find((candidate) => candidate.id === action.id) ??
        missing('Participant profile');
      requireCollaboration(
        !isReferenced(document, profile.id) && context.profileId !== profile.id,
        'This participant is referenced by collaboration work or activity and cannot be removed.',
      );
      document.profiles = document.profiles.filter((candidate) => candidate.id !== profile.id);
      entityId = profile.id;
      kind = 'profile.removed';
      summary = 'Participant profile removed.';
      break;
    }
    case 'comment.create': {
      const authorId = actor();
      const target = action.nodeId === undefined ? undefined : node(action.nodeId);
      entityId = collaborationNewId(context);
      document.comments.push({
        id: entityId,
        ...(target ? { nodeId: target.id, nodeTitle: target.title } : {}),
        authorId,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: collaborationNewId(context),
            sequence: 1,
            authorId,
            text: action.text,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      kind = 'comment.created';
      summary = 'Comment thread created.';
      nodeIds = target ? [target.id] : undefined;
      break;
    }
    case 'comment.reply': {
      const target = thread(action.id);
      requireCollaboration(!target.resolved, 'Reopen this comment thread before replying.');
      target.messages.push({
        id: collaborationNewId(context),
        sequence: Math.max(0, ...target.messages.map((message) => message.sequence)) + 1,
        authorId: actor(),
        text: action.text,
        createdAt: now,
        updatedAt: now,
      });
      target.updatedAt = now;
      entityId = target.id;
      kind = 'comment.replied';
      summary = 'Comment reply added.';
      nodeIds = target.nodeId ? [target.nodeId] : undefined;
      break;
    }
    case 'comment.edit': {
      const target = thread(action.id);
      const message =
        target.messages.find((candidate) => candidate.id === action.messageId) ??
        missing('Comment message');
      messageOwnership(message.authorId);
      changed = message.text !== action.text;
      if (changed) {
        message.text = action.text;
        message.updatedAt = now;
        target.updatedAt = now;
      }
      entityId = target.id;
      kind = 'comment.edited';
      summary = 'Comment text updated.';
      nodeIds = target.nodeId ? [target.nodeId] : undefined;
      break;
    }
    case 'comment.remove': {
      const target = thread(action.id);
      if (action.messageId !== undefined) {
        const message =
          target.messages.find((candidate) => candidate.id === action.messageId) ??
          missing('Comment message');
        if (context.role !== 'owner') messageOwnership(message.authorId);
        target.messages = target.messages.filter((candidate) => candidate.id !== message.id);
        target.updatedAt = now;
        if (!target.messages.length)
          document.comments = document.comments.filter((candidate) => candidate.id !== target.id);
      } else {
        if (
          context.role !== 'owner' &&
          (actor() !== target.authorId ||
            target.messages.some((message) => message.authorId !== context.profileId))
        )
          forbidden('Only the owner can delete a thread containing other participants’ comments.');
        document.comments = document.comments.filter((candidate) => candidate.id !== target.id);
      }
      entityId = target.id;
      kind = 'comment.removed';
      summary = 'Comment removed.';
      nodeIds = target.nodeId ? [target.nodeId] : undefined;
      break;
    }
    case 'comment.resolve': {
      const target = thread(action.id);
      if (context.role !== 'owner' && actor() !== target.authorId)
        forbidden('Only the thread author or owner can change its resolution.');
      requireCollaboration(
        typeof action.resolved === 'boolean',
        'Comment resolution must be a boolean.',
      );
      changed = target.resolved !== action.resolved;
      if (changed) {
        target.resolved = action.resolved;
        target.updatedAt = now;
        if (target.resolved) {
          target.resolvedBy = actor();
          target.resolvedAt = now;
        } else {
          delete target.resolvedBy;
          delete target.resolvedAt;
        }
      }
      entityId = target.id;
      kind = action.resolved ? 'comment.resolved' : 'comment.reopened';
      summary = action.resolved ? 'Comment thread resolved.' : 'Comment thread reopened.';
      nodeIds = target.nodeId ? [target.nodeId] : undefined;
      break;
    }
    case 'task.create': {
      exactCollaborationFields(action.task, taskFields, 'task input');
      const target = node(action.task.nodeId);
      entityId = collaborationNewId(context);
      const created: CollaborationTask = {
        id: entityId,
        nodeId: target.id,
        nodeTitle: target.title,
        title: action.task.title,
        authorId: actor(),
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      };
      patchFields(created, action.task, taskFields);
      document.tasks.push(created);
      kind = 'task.created';
      summary = 'Node task created.';
      nodeIds = [target.id];
      break;
    }
    case 'task.update': {
      actor();
      exactCollaborationFields(action.patch, taskFields, 'task patch');
      const target = task(action.id);
      const before = JSON.stringify(target);
      if (Object.hasOwn(action.patch, 'nodeId')) {
        requireCollaboration(
          typeof action.patch.nodeId === 'string',
          'Task node target must be a UUID.',
        );
        const newTarget = node(action.patch.nodeId as string);
        target.nodeId = newTarget.id;
        target.nodeTitle = newTarget.title;
      }
      patchFields(target, action.patch, taskFields);
      changed = before !== JSON.stringify(target);
      if (changed) target.updatedAt = now;
      entityId = target.id;
      kind = 'task.updated';
      summary = 'Node task updated.';
      nodeIds = [target.nodeId];
      break;
    }
    case 'task.remove': {
      actor();
      const target = task(action.id);
      document.tasks = document.tasks.filter((candidate) => candidate.id !== target.id);
      entityId = target.id;
      kind = 'task.removed';
      summary = 'Node task removed.';
      nodeIds = [target.nodeId];
      break;
    }
  }
  if (!changed) return graph;
  appendCollaborationActivity(document, [
    collaborationActivityEvent({ ...context, now }, kind, summary, { entityId, nodeIds }),
  ]);
  validateCollaboration(document);
  return { ...graph, diagram: { ...graph.diagram, collaboration: document } };
}

export const applyCollaborationAction = mutateCollaboration;
