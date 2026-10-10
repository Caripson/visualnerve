/** Narrow wasm-bindgen ABI generated from the versioned adapter source. */
export class MlsCryptoSession {
  constructor(deviceId: string, credentialId: string);
  key_package(): Uint8Array;
  signature_public_key(): Uint8Array;
  create_group(roomId: string): void;
  join(
    welcome: Uint8Array,
    roomId: string,
    ownerDeviceId: string,
    ownerSignatureKey: Uint8Array,
  ): void;
  info(): string;
  add_member(
    keyPackage: Uint8Array,
    deviceId: string,
    credentialId: string,
    expectedSignatureKey: Uint8Array,
  ): string;
  remove_member(deviceId: string): string;
  rotate(): string;
  merge_pending_commit(): void;
  discard_pending_commit(): void;
  encrypt(payload: Uint8Array): Uint8Array;
  process(message: Uint8Array, expectedDeviceId: string): string;
  close(): void;
  free(): void;
}
export default function init(input: {
  module_or_path: URL | Response | BufferSource | WebAssembly.Module;
}): Promise<unknown>;
