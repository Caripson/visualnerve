import type { CollaborationRole } from '../../../collaboration-worker/src/protocol';
import type { CollaborationShareScope } from './document/scope';
import type { CollaborationAction, CollaborationActionContext } from './model/types';

export type CollaborationStatus =
  | 'idle'
  | 'connecting'
  | 'awaiting-approval'
  | 'syncing'
  | 'live'
  | 'offline'
  | 'conflict'
  | 'error';
export interface CollaborationParticipant {
  deviceId: string;
  name: string;
  role: CollaborationRole;
  credentialId: string;
  connected: boolean;
  selectedNodeIds: string[];
  pointer?: { x: number; y: number };
  actor?: 'human' | 'mcp';
  lastSeen: number;
  profileId?: string;
  color?: string;
  avatarDataUrl?: string;
  syncWarning?: string;
}
export interface CollaborationJoinRequest {
  deviceId: string;
  credentialId: string;
  expiresAt: number;
}
export interface CollaborationSnapshot {
  configured: boolean;
  status: CollaborationStatus;
  roomId?: string;
  diagramId?: string;
  selfDeviceId?: string;
  selfProfileId?: string;
  /** UI-only public device fingerprint for trusted-channel verification. */
  selfCredentialId?: string;
  recoveryCopy?: { diagramId: string; title: string };
  ownerCredentialId?: string;
  role?: CollaborationRole;
  participants: readonly CollaborationParticipant[];
  pendingJoins: readonly CollaborationJoinRequest[];
  displayName: string;
  scope: Readonly<CollaborationShareScope>;
  syncProgress?: { completed: number; total: number };
  error?: string;
  /** UI-only one-use admission link. Never included by semantic API serializers. */
  invitation?: { url: string; expiresAt: number };
}
export interface CollaborationUiController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Readonly<CollaborationSnapshot>;
  create(
    diagramId: string,
    displayName: string,
    scope: CollaborationShareScope,
    profileId?: string,
  ): Promise<void>;
  join(invitationUrl: string, displayName: string): Promise<void>;
  createInvitation(): Promise<void>;
  approve(
    deviceId: string,
    role: 'editor' | 'viewer',
    profileId?: string,
    profileName?: string,
  ): Promise<void>;
  reject(deviceId: string): Promise<void>;
  changeRole(deviceId: string, role: 'editor' | 'viewer'): Promise<void>;
  remove(deviceId: string): Promise<void>;
  reconnect(): Promise<void>;
  leave(): Promise<void>;
  closeRoom(): Promise<void>;
  documentContext?(
    diagramId: string,
    source?: CollaborationActionContext['source'],
  ): CollaborationActionContext;
  applyDocumentAction?(
    diagramId: string,
    action: CollaborationAction,
    baseVersion: number,
  ): Promise<unknown>;
  selectDocumentProfile?(diagramId: string, profileId: string): Promise<void>;
  setPointer?(pointer?: { x: number; y: number }): void;
}
