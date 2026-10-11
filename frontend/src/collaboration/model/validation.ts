import { StorageError } from '../../model/errors';
import { avatarPayloadBytes, validateAvatarDataUrl } from './avatar';
import {
  activityKinds,
  activitySources,
  collaborationLimits,
  taskStatuses,
  type CollaborationDocument,
  type CollaborationGraph,
} from './types';

export const collaborationUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const requireCollaboration = (condition: unknown, message: string): void => {
  if (!condition) throw new StorageError(422, message);
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function exactCollaborationFields(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  requireCollaboration(record(value), `Invalid ${label}.`);
  requireCollaboration(
    Object.keys(value as object).every((key) => fields.includes(key)),
    `Unsupported ${label} field.`,
  );
}
export function validCollaborationId(value: unknown): value is string {
  return typeof value === 'string' && collaborationUuid.test(value);
}
export function validCollaborationTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function validCollaborationDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const text = (value: unknown, maximum: number, optional = false) =>
  (optional && value === undefined) ||
  (typeof value === 'string' && value.trim().length > 0 && value.length <= maximum);
const optionalText = (value: unknown, maximum: number) =>
  value === undefined || (typeof value === 'string' && value.length <= maximum);
const entityFields = ['id', 'createdAt', 'updatedAt'];
const timestamps = (value: Record<string, unknown>) =>
  requireCollaboration(
    validCollaborationTimestamp(value.createdAt) && validCollaborationTimestamp(value.updatedAt),
    'Invalid collaboration timestamps.',
  );
const sequence = (value: unknown) =>
  requireCollaboration(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    'Collaboration sequence must be a nonnegative safe integer.',
  );

export function emptyCollaboration(): CollaborationDocument {
  return { schemaVersion: 1, profiles: [], comments: [], tasks: [], activity: [] };
}

/** Strict public-data schema. Unknown fields reject accidental credentials, keys and session data. */
export function validateCollaboration(value: unknown): asserts value is CollaborationDocument {
  exactCollaborationFields(
    value,
    ['schemaVersion', 'profiles', 'comments', 'tasks', 'activity'],
    'collaboration document',
  );
  requireCollaboration(value.schemaVersion === 1, 'Unsupported collaboration schema version.');
  for (const collection of ['profiles', 'comments', 'tasks', 'activity'] as const)
    requireCollaboration(
      Array.isArray(value[collection]) &&
        value[collection].length <= collaborationLimits[collection],
      `Too many or invalid collaboration ${collection}.`,
    );
  const document = value as unknown as CollaborationDocument;
  const ids = new Set<string>();
  const id = (candidate: unknown) => {
    requireCollaboration(
      validCollaborationId(candidate),
      'Collaboration identifiers must be UUIDs.',
    );
    requireCollaboration(!ids.has(candidate as string), 'Duplicate collaboration identifier.');
    ids.add(candidate as string);
  };
  const profiles = new Set<string>();
  let avatarBytes = 0;
  for (const profile of document.profiles) {
    exactCollaborationFields(
      profile,
      [...entityFields, 'name', 'color', 'avatarDataUrl'],
      'participant profile',
    );
    id(profile.id);
    profiles.add(profile.id);
    timestamps(profile);
    requireCollaboration(
      text(profile.name, collaborationLimits.name),
      'Participant name is required and limited to 80 characters.',
    );
    requireCollaboration(
      profile.color === undefined ||
        (typeof profile.color === 'string' && /^#[\da-f]{6}$/i.test(profile.color)),
      'Participant color must be a six-digit hex color.',
    );
    if (profile.avatarDataUrl !== undefined) {
      validateAvatarDataUrl(profile.avatarDataUrl);
      avatarBytes += avatarPayloadBytes(profile.avatarDataUrl);
      requireCollaboration(
        avatarBytes <= collaborationLimits.avatarTotalBytes,
        'Participant avatars exceed the combined 2 MiB limit.',
      );
    }
  }
  const author = (candidate: unknown) =>
    requireCollaboration(
      typeof candidate === 'string' && profiles.has(candidate),
      'Unknown participant profile.',
    );
  const target = (nodeId: unknown, title: unknown, optional: boolean) => {
    requireCollaboration(
      (optional && nodeId === undefined) || validCollaborationId(nodeId),
      'Collaboration node target must be a UUID.',
    );
    requireCollaboration(
      optionalText(title, 1_000) && (title === undefined || nodeId !== undefined),
      'Invalid collaboration node title snapshot.',
    );
  };
  let messageCount = 0;
  let commentCharacters = 0;
  for (const thread of document.comments) {
    exactCollaborationFields(
      thread,
      [
        ...entityFields,
        'nodeId',
        'nodeTitle',
        'authorId',
        'resolved',
        'resolvedBy',
        'resolvedAt',
        'messages',
      ],
      'comment thread',
    );
    id(thread.id);
    timestamps(thread);
    target(thread.nodeId, thread.nodeTitle, true);
    author(thread.authorId);
    requireCollaboration(
      typeof thread.resolved === 'boolean',
      'Comment resolution must be a boolean.',
    );
    if (thread.resolved) {
      author(thread.resolvedBy);
      requireCollaboration(
        validCollaborationTimestamp(thread.resolvedAt),
        'Resolved comment requires a writer timestamp.',
      );
    } else
      requireCollaboration(
        thread.resolvedBy === undefined && thread.resolvedAt === undefined,
        'Open comment cannot have resolution fields.',
      );
    requireCollaboration(
      Array.isArray(thread.messages) &&
        thread.messages.length > 0 &&
        thread.messages.length <= collaborationLimits.comments,
      'Comment thread requires messages.',
    );
    messageCount += thread.messages.length;
    requireCollaboration(
      messageCount <= collaborationLimits.comments,
      'Too many comment messages.',
    );
    for (const message of thread.messages) {
      exactCollaborationFields(
        message,
        [...entityFields, 'sequence', 'authorId', 'text'],
        'comment message',
      );
      id(message.id);
      sequence(message.sequence);
      timestamps(message);
      author(message.authorId);
      requireCollaboration(
        text(message.text, collaborationLimits.text),
        'Comment text is required and limited to 4000 characters.',
      );
      commentCharacters += message.text.length;
      requireCollaboration(
        commentCharacters <= collaborationLimits.commentCharacters,
        'Comment text exceeds the combined document limit.',
      );
    }
  }
  for (const task of document.tasks) {
    exactCollaborationFields(
      task,
      [
        ...entityFields,
        'nodeId',
        'nodeTitle',
        'title',
        'description',
        'authorId',
        'assigneeId',
        'status',
        'dueDate',
      ],
      'collaboration task',
    );
    id(task.id);
    timestamps(task);
    target(task.nodeId, task.nodeTitle, false);
    author(task.authorId);
    if (task.assigneeId !== undefined) author(task.assigneeId);
    requireCollaboration(
      text(task.title, collaborationLimits.taskTitle),
      'Task title is required and limited to 300 characters.',
    );
    requireCollaboration(
      optionalText(task.description, collaborationLimits.text),
      'Task description is limited to 4000 characters.',
    );
    requireCollaboration(
      taskStatuses.includes(task.status),
      'Unsupported collaboration task status.',
    );
    requireCollaboration(
      task.dueDate === undefined || validCollaborationDate(task.dueDate),
      'Task due date must use a valid YYYY-MM-DD value.',
    );
  }
  for (const event of document.activity) {
    exactCollaborationFields(
      event,
      [
        'id',
        'sequence',
        'kind',
        'source',
        'authorId',
        'timestamp',
        'summary',
        'nodeIds',
        'entityId',
      ],
      'activity event',
    );
    id(event.id);
    sequence(event.sequence);
    if (event.authorId !== undefined) author(event.authorId);
    requireCollaboration(
      activityKinds.includes(event.kind) && activitySources.includes(event.source),
      'Unsupported collaboration activity kind or source.',
    );
    requireCollaboration(
      validCollaborationTimestamp(event.timestamp),
      'Invalid collaboration activity timestamp.',
    );
    requireCollaboration(
      text(event.summary, collaborationLimits.summary),
      'Activity summary is required and limited to 300 characters.',
    );
    requireCollaboration(
      event.entityId === undefined || validCollaborationId(event.entityId),
      'Invalid activity entity identifier.',
    );
    requireCollaboration(
      event.nodeIds === undefined ||
        (Array.isArray(event.nodeIds) &&
          event.nodeIds.length <= collaborationLimits.activityNodeIds &&
          event.nodeIds.every(validCollaborationId) &&
          new Set(event.nodeIds).size === event.nodeIds.length),
      'Invalid activity node identifiers.',
    );
  }
  requireCollaboration(
    new TextEncoder().encode(JSON.stringify(document)).byteLength <=
      collaborationLimits.documentBytes,
    'Collaboration document exceeds the 16 MiB limit.',
  );
}

export function validateCollaborationGraph(graph: CollaborationGraph): void {
  if (graph.diagram.collaboration !== undefined) validateCollaboration(graph.diagram.collaboration);
}

export function collaborationFor(graph: CollaborationGraph): CollaborationDocument {
  validateCollaborationGraph(graph);
  return graph.diagram.collaboration ?? emptyCollaboration();
}
