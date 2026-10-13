export type RobloxPublishAction =
  | 'capabilities'
  | 'begin'
  | 'chunk'
  | 'finalize'
  | 'cancel'
  | 'status'
  | 'acknowledge-unknown';
export interface RobloxPublishCapabilities {
  configured: boolean;
  terminalApprovalRequired: true;
  target?: { universeId: string; placeId: string };
  limits: {
    chunkBytes: number;
    artifactBytes: number;
    pendingPerPeer: number;
    retainedOwners: number;
    pendingBytes: number;
    preparationMs: number;
    networkMs: number;
    approvalMs: number;
  };
}
export interface RobloxPublishReceipt {
  nonce: string;
  state:
    | 'receiving'
    | 'awaiting-approval'
    | 'publishing'
    | 'succeeded'
    | 'failed'
    | 'unknown'
    | 'cancelled';
  target: { universeId: string; placeId: string };
  sha256: string;
  totalBytes: number;
  receivedBytes: number;
  nextIndex: number;
  expiresAt: string;
  requiresDashboardReconciliation: boolean;
  versionNumber?: number;
  error?: { code: string; message: string };
}
export interface RobloxPublishSession {
  readonly signal: AbortSignal;
  assertCurrent(): void;
  request<T>(
    action: RobloxPublishAction,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
}
