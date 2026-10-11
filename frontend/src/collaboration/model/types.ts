import type { Graph } from '../../model/types';

/** Public document identities are unrelated to room admission credentials or live devices. */
export interface ParticipantProfile {
  id: string;
  name: string;
  color?: string;
  avatarDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export interface CommentMessage {
  id: string;
  /** Logical thread append counter. Concurrent equal values use the UUID as a tie-break. */
  sequence: number;
  authorId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
export interface CommentThread {
  id: string;
  nodeId?: string;
  /** Last known title, retained when the node is removed. */
  nodeTitle?: string;
  authorId: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  messages: CommentMessage[];
}
export const taskStatuses = ['todo', 'in-progress', 'done'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export interface CollaborationTask {
  id: string;
  nodeId: string;
  /** Last known title, retained when the node is removed. */
  nodeTitle?: string;
  title: string;
  description?: string;
  authorId: string;
  assigneeId?: string;
  status: TaskStatus;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}
export const activitySources = ['ui', 'api', 'mcp', 'import', 'collaboration'] as const;
export type ActivitySource = (typeof activitySources)[number];
export const activityKinds = [
  'profile.created',
  'profile.updated',
  'profile.removed',
  'comment.created',
  'comment.replied',
  'comment.edited',
  'comment.removed',
  'comment.resolved',
  'comment.reopened',
  'task.created',
  'task.updated',
  'task.removed',
  'diagram.updated',
  'nodes.created',
  'nodes.updated',
  'nodes.removed',
  'connections.created',
  'connections.updated',
  'connections.removed',
  'owners.updated',
  'simulation.updated',
  'data.updated',
] as const;
export type ActivityKind = (typeof activityKinds)[number];
/** A bounded editable history, using the writer's clock; this is not an immutable audit log. */
export interface ActivityEvent {
  id: string;
  /** Logical document append counter, independent of the writer clock. */
  sequence: number;
  kind: ActivityKind;
  source: ActivitySource;
  authorId?: string;
  timestamp: string;
  summary: string;
  nodeIds?: string[];
  entityId?: string;
}
export interface CollaborationDocument {
  schemaVersion: 1;
  profiles: ParticipantProfile[];
  comments: CommentThread[];
  tasks: CollaborationTask[];
  activity: ActivityEvent[];
}
export type CollaborationGraph = Graph & {
  diagram: Graph['diagram'] & { collaboration?: CollaborationDocument };
};
export const collaborationLimits = {
  profiles: 128,
  comments: 2_000,
  tasks: 1_000,
  activity: 500,
  name: 80,
  text: 4_000,
  taskTitle: 300,
  summary: 300,
  activityNodeIds: 32,
  avatarBytes: 64 * 1024,
  avatarTotalBytes: 2 * 1024 * 1024,
  avatarDimension: 256,
  commentCharacters: 4_000_000,
  documentBytes: 16 * 1024 * 1024,
} as const;

/** The adapter supplies this context from its authenticated session, never from action JSON. */
export interface CollaborationActionContext {
  role: 'owner' | 'editor' | 'viewer';
  profileId?: string;
  source: ActivitySource;
  /** Local/remote writer time. An adapter may inject this for deterministic tests. */
  now?: string;
  /** Adapter-owned UUID generation. */
  createId?: () => string;
}
export interface ProfilePatch {
  name: string;
  color?: string | null;
  avatarDataUrl?: string | null;
}
export interface TaskPatch {
  nodeId?: string;
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  status?: TaskStatus;
  dueDate?: string | null;
}
export type CollaborationAction =
  | { type: 'profile.create'; profile: ProfilePatch }
  | { type: 'profile.update'; id: string; patch: Partial<ProfilePatch> }
  | { type: 'profile.remove'; id: string }
  | { type: 'comment.create'; nodeId?: string; text: string }
  | { type: 'comment.reply'; id: string; text: string }
  | { type: 'comment.edit'; id: string; messageId: string; text: string }
  | { type: 'comment.remove'; id: string; messageId?: string }
  | { type: 'comment.resolve'; id: string; resolved: boolean }
  | { type: 'task.create'; task: Pick<CollaborationTask, 'nodeId' | 'title'> & TaskPatch }
  | { type: 'task.update'; id: string; patch: TaskPatch }
  | { type: 'task.remove'; id: string };

export interface CollaborationRemap {
  nodeIds: ReadonlyMap<string, string>;
  /** Absent maps preserve document identities; provided maps must cover every entity. */
  profileIds?: ReadonlyMap<string, string>;
  commentIds?: ReadonlyMap<string, string>;
  messageIds?: ReadonlyMap<string, string>;
  taskIds?: ReadonlyMap<string, string>;
  activityIds?: ReadonlyMap<string, string>;
  edgeIds?: ReadonlyMap<string, string>;
}
