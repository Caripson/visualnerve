import {
  relayLimits,
  type DeviceIdentity,
  type SignedRoomPolicy,
  type TransportPublicKey,
} from "./protocol";

export class RelayError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 422,
  ) {
    super(code);
  }
}
export function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RelayError("INVALID_ENVELOPE");
  const object = value as Record<string, unknown>;
  if (
    required.some((key) => !(key in object)) ||
    Object.keys(object).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new RelayError("INVALID_ENVELOPE");
  return object;
}
export function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new RelayError("INVALID_INTEGER");
  return value as number;
}
export function deviceId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value))
    throw new RelayError("INVALID_DEVICE");
  return value;
}
export function roomId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new RelayError("INVALID_ROOM");
  return value;
}
export function decode(
  value: unknown,
  maximum: number,
  exact?: number,
): Uint8Array {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > Math.ceil((maximum * 4) / 3) ||
    value.length % 4 === 1
  )
    throw new RelayError("INVALID_BINARY");
  let raw: string;
  try {
    raw = atob(
      value.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (value.length % 4)) % 4),
    );
  } catch {
    throw new RelayError("INVALID_BINARY");
  }
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (
    bytes.length > maximum ||
    (exact !== undefined && bytes.length !== exact) ||
    encode(bytes) !== value
  )
    throw new RelayError("INVALID_BINARY");
  return bytes;
}
export function encode(value: Uint8Array): string {
  let raw = "";
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function publicKey(value: unknown): TransportPublicKey {
  const key = record(value, ["kty", "crv", "x", "y"]);
  if (key.kty !== "EC" || key.crv !== "P-256")
    throw new RelayError("INVALID_PUBLIC_KEY");
  decode(key.x, 32, 32);
  decode(key.y, 32, 32);
  return key as unknown as TransportPublicKey;
}
export function identity(value: unknown): DeviceIdentity {
  const device = record(value, [
    "deviceId",
    "signingKey",
    "credentialId",
    "mlsSignatureKey",
  ]);
  deviceId(device.deviceId);
  publicKey(device.signingKey);
  if (
    typeof device.credentialId !== "string" ||
    !/^[a-f0-9]{64}$/.test(device.credentialId)
  )
    throw new RelayError("INVALID_CREDENTIAL");
  decode(device.mlsSignatureKey, 32, 32);
  return device as unknown as DeviceIdentity;
}
export function signedPolicy(value: unknown): SignedRoomPolicy {
  const signed = record(value, ["policy", "signature"]);
  decode(signed.signature, 64, 64);
  const policy = record(signed.policy, [
    "protocol",
    "roomId",
    "ownerDeviceId",
    "revision",
    "epoch",
    "members",
    "transition",
  ]);
  if (policy.protocol !== 1) throw new RelayError("UNSUPPORTED_PROTOCOL");
  roomId(policy.roomId);
  deviceId(policy.ownerDeviceId);
  integer(policy.revision, 1);
  integer(policy.epoch);
  if (
    !Array.isArray(policy.members) ||
    policy.members.length < 1 ||
    policy.members.length > relayLimits.members
  )
    throw new RelayError("MEMBER_LIMIT");
  const ids = new Set<string>();
  const credentials = new Set<string>();
  const mlsKeys = new Set<string>();
  let owners = 0;
  for (const value of policy.members) {
    const member = record(value, [
      "deviceId",
      "signingKey",
      "credentialId",
      "mlsSignatureKey",
      "role",
    ]);
    identity({
      deviceId: member.deviceId,
      signingKey: member.signingKey,
      credentialId: member.credentialId,
      mlsSignatureKey: member.mlsSignatureKey,
    });
    if (!["owner", "editor", "viewer"].includes(String(member.role)))
      throw new RelayError("INVALID_ROLE");
    if (ids.has(String(member.deviceId)))
      throw new RelayError("DUPLICATE_DEVICE");
    ids.add(String(member.deviceId));
    if (
      credentials.has(String(member.credentialId)) ||
      mlsKeys.has(String(member.mlsSignatureKey))
    )
      throw new RelayError("DUPLICATE_IDENTITY");
    credentials.add(String(member.credentialId));
    mlsKeys.add(String(member.mlsSignatureKey));
    if (member.role === "owner") {
      owners++;
      if (member.deviceId !== policy.ownerDeviceId)
        throw new RelayError("INVALID_OWNER");
    }
  }
  if (owners !== 1) throw new RelayError("INVALID_OWNER");
  if (policy.transition !== null) {
    const transition = record(policy.transition, [
      "previousEpoch",
      "commitHash",
      "welcomeHashes",
    ]);
    integer(transition.previousEpoch);
    if (
      typeof transition.commitHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(transition.commitHash) ||
      !Array.isArray(transition.welcomeHashes) ||
      transition.welcomeHashes.length > relayLimits.members
    )
      throw new RelayError("INVALID_TRANSITION");
    const recipients = new Set<string>();
    for (const value of transition.welcomeHashes) {
      const welcome = record(value, ["deviceId", "hash"]);
      deviceId(welcome.deviceId);
      if (
        typeof welcome.hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(welcome.hash) ||
        recipients.has(String(welcome.deviceId))
      )
        throw new RelayError("INVALID_TRANSITION");
      recipients.add(String(welcome.deviceId));
    }
  }
  return signed as unknown as SignedRoomPolicy;
}
export function sameIdentity(a: DeviceIdentity, b: DeviceIdentity): boolean {
  return (
    a.deviceId === b.deviceId &&
    a.credentialId === b.credentialId &&
    a.mlsSignatureKey === b.mlsSignatureKey &&
    a.signingKey.x === b.signingKey.x &&
    a.signingKey.y === b.signingKey.y
  );
}
