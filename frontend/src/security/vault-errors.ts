export type VaultErrorCode =
  | 'INVALID_SCHEMA'
  | 'UNSAFE_KDF'
  | 'INVALID_PASSWORD'
  | 'INVALID_RECOVERY_KEY'
  | 'AUTHENTICATION_FAILED'
  | 'KEY_DESTROYED'
  | 'UNSUPPORTED_CRYPTO'
  | 'LIMIT_EXCEEDED';

const messages: Record<VaultErrorCode, string> = {
  INVALID_SCHEMA: 'Invalid or unsupported encrypted workspace format.',
  UNSAFE_KDF: 'Unsupported or unsafe password derivation parameters.',
  INVALID_PASSWORD: 'Use a password of at least 12 characters and at most 1024 UTF-8 bytes.',
  INVALID_RECOVERY_KEY: 'Invalid recovery key format.',
  AUTHENTICATION_FAILED: 'Could not authenticate the encrypted workspace or its contents.',
  KEY_DESTROYED: 'The workspace key is unavailable. Unlock the workspace again.',
  UNSUPPORTED_CRYPTO: 'This browser does not support the required secure cryptography.',
  LIMIT_EXCEEDED: 'The encrypted workspace operation exceeds its supported size limits.',
};

/** Error messages never incorporate passwords, recovery material or document contents. */
export class VaultCryptoError extends Error {
  constructor(public readonly code: VaultErrorCode) {
    super(messages[code]);
    this.name = 'VaultCryptoError';
  }
}
