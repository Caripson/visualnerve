/** Portable wire types. No Cloudflare runtime or document encryption dependency. */
export const collaborationProtocol = 1 as const;
export const relayLimits = {
  members: 32,
  sockets: 64,
  socketsPerDevice: 3,
  pendingJoins: 16,
  invitations: 16,
  envelopeBytes: 256 * 1024,
  ciphertextBytes: 128 * 1024,
  keyPackageBytes: 32 * 1024,
  challengeMs: 30_000,
  invitationMs: 10 * 60_000,
  pendingJoinMs: 10 * 60_000,
  messagesPerMinute: 600,
  bytesPerMinute: 8 * 1024 * 1024,
  roomIdleMs: 7 * 24 * 60 * 60_000,
  roomLifetimeMs: 30 * 24 * 60 * 60_000,
} as const;

export type CollaborationRole = "owner" | "editor" | "viewer";
export interface TransportPublicKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}
export interface DeviceIdentity {
  deviceId: string;
  signingKey: TransportPublicKey;
  /** SHA-256 JWK thumbprint also bound to the client's MLS credential. */
  credentialId: string;
  /** The device's public Ed25519 MLS signature key, also pinned by clients. */
  mlsSignatureKey: string;
}
export interface RoomMember extends DeviceIdentity {
  role: CollaborationRole;
}
export interface RoomPolicy {
  protocol: 1;
  roomId: string;
  ownerDeviceId: string;
  revision: number;
  epoch: number;
  members: RoomMember[];
  /** Owner signature binds detached Commit and recipient-only Welcome bytes. */
  transition: null | {
    previousEpoch: number;
    commitHash: string;
    welcomeHashes: { deviceId: string; hash: string }[];
  };
}
export interface SignedRoomPolicy {
  policy: RoomPolicy;
  /** Base64url, unpadded, IEEE-P1363 ECDSA P-256/SHA-256 signature. */
  signature: string;
}
export interface CreateRoom {
  policy: SignedRoomPolicy;
}
export interface Challenge {
  type: "challenge";
  protocol: 1;
  roomId: string;
  connectionId: string;
  nonce: string;
  expiresAt: number;
}
export interface Authentication {
  type: "authenticate";
  protocol: 1;
  roomId: string;
  connectionId: string;
  nonce: string;
  device: DeviceIdentity;
  /** Invitation secrets are sent only in this TLS frame, never a URL. */
  invitation?: string;
  /** Public MLS KeyPackage; never a private key or document. */
  keyPackage?: string;
  signature: string;
}
export type RelayPayloadKind =
  | "application"
  | "presence"
  | "snapshot"
  | "sync-request";
export interface RelayCommand {
  kind: "relay";
  payloadKind: RelayPayloadKind;
  /** Opaque MLS bytes, base64url. No document fields are accepted here. */
  ciphertext: string;
  /** A snapshot/sync request may target a single approved member. */
  recipient?: string;
}
export interface PolicyCommand {
  kind: "policy";
  policy: SignedRoomPolicy;
  /** The owner's opaque MLS Commit moving exactly one epoch forward. */
  commit: string;
  /** MLS Welcome is sent only to the matching newly approved device. */
  welcomes: { deviceId: string; ciphertext: string }[];
}
export type ControlCommand =
  | { kind: "invite" }
  | { kind: "welcome"; recipient: string; ciphertext: string; commit: string }
  | { kind: "reject"; deviceId: string }
  | { kind: "revoke-invitations" }
  | { kind: "inspect" }
  | { kind: "leave" }
  | { kind: "delete-room" };
export interface SignedCommand {
  type: "command";
  protocol: 1;
  roomId: string;
  connectionId: string;
  deviceId: string;
  sequence: number;
  epoch: number;
  body: RelayCommand | PolicyCommand | ControlCommand;
  signature: string;
}
export interface PendingJoin extends DeviceIdentity {
  keyPackage: string;
  expiresAt: number;
}
export type ServerFrame =
  | Challenge
  | {
      type: "authenticated";
      protocol: 1;
      policy: SignedRoomPolicy;
      role: CollaborationRole;
    }
  | { type: "pending"; protocol: 1; expiresAt: number }
  | { type: "join-request"; protocol: 1; request: PendingJoin }
  | { type: "ack"; protocol: 1; sequence: number; result?: unknown }
  | { type: "relay"; protocol: 1; command: SignedCommand }
  | { type: "policy"; protocol: 1; policy: SignedRoomPolicy; commit: string }
  | {
      type: "welcome";
      protocol: 1;
      policy: SignedRoomPolicy;
      commit: string;
      ciphertext: string;
    }
  | { type: "error"; protocol: 1; code: string; sequence?: number };

/** JSON keys sort recursively. All protocol numeric fields are safe integers. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  throw new Error("Non-canonical protocol value");
}
export function signingInput(
  domain: "policy" | "authenticate" | "command",
  value: unknown,
): Uint8Array {
  return new TextEncoder().encode(
    `visual-nerve/collaboration/${domain}/v1\n${canonical(value)}`,
  );
}
