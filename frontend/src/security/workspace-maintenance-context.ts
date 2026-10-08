import { createContext, useContext } from 'react';
import type { WorkspaceBackup } from '../storage/database';

// Keep the hooks independent of the maintenance implementation. Ordinary editor
// components must not eagerly load transfer/rotation UI through a context import.
export const TransferContext = createContext<
  ((backup: WorkspaceBackup) => Promise<void>) | undefined
>(undefined);
export const RotationContext = createContext<(() => Promise<void>) | undefined>(undefined);
export const useWorkspaceTransfer = () => useContext(TransferContext);
export const useVaultKeyRotation = () => useContext(RotationContext);
