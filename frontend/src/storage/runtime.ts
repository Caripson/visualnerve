import { database } from './database';
import { EncryptedWorkspaceDatabase } from './encrypted-database';
import { VaultCrypto } from '../security/vault-crypto';
import { VaultLogicalRecordCodec } from '../security/vault-logical-record';
import { VaultSession } from '../security/vault-session';
import { VaultRecordStorage } from '../security/vault-storage';
import { isEncryptedWorkspaceSurface } from '../security/surface';
// Constructing the legacy adapter does not open IndexedDB. The isolated app
// never creates a plaintext working copy of sensitive content.
export const vaultCrypto = isEncryptedWorkspaceSurface() ? new VaultCrypto() : undefined;
export const vaultSession = vaultCrypto
  ? new VaultSession(new VaultRecordStorage(), vaultCrypto)
  : undefined;
export const workspaceStorage =
  vaultSession && vaultCrypto
    ? new EncryptedWorkspaceDatabase(vaultSession, new VaultLogicalRecordCodec(vaultCrypto))
    : database.asStorage();
