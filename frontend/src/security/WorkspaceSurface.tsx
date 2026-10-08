import { App } from '../App';
import { vaultSession } from '../storage/runtime';
import { bindWorkspaceLock } from './workspace-lock';
import { WorkspaceTransferBoundary } from './WorkspaceTransferBoundary';

// This module is imported only after the gate opens. Register the complete
// synchronous revocation handler before React can mount any private editor UI.
if (vaultSession) bindWorkspaceLock(vaultSession);

export function WorkspaceSurface() {
  return vaultSession ? (
    <WorkspaceTransferBoundary>
      <App />
    </WorkspaceTransferBoundary>
  ) : (
    <App />
  );
}
