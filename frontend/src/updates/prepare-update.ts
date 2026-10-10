import { useEditor } from '../state/editor';
import { vaultSession } from '../storage/runtime';
import { workspace } from '../storage/workspace';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import { AppUpdateBlockedError } from './errors';
import { hasCollaborationUpdateTask } from '../collaboration/update-task';

const requireNoCollaboration = () => {
  if (hasCollaborationUpdateTask()) throw new AppUpdateBlockedError('finishTask');
};

/** A human-approved restart saves under the current, revocable vault session. */
export async function prepareAppUpdate() {
  // Restart would discard live MLS owner/device keys. Leaving is a separate
  // deliberate human action; update preparation must never do it implicitly.
  requireNoCollaboration();
  const status = vaultSession?.getSnapshot().status;
  if (status === 'locked') return;
  if (status === 'unlocking' || status === 'uninitialized')
    throw new AppUpdateBlockedError('finishTask');
  if (
    document.querySelector('[role="dialog"][aria-modal="true"]:not([data-app-update-dialog])') ||
    document.querySelector('.csv-import-progress')
  )
    throw new AppUpdateBlockedError('finishTask');
  const [{ isVideoExporting }, { simulationService }] = await Promise.all([
    import('../presentation/commands'),
    import('../simulation/service'),
  ]);
  requireNoCollaboration();
  if (isVideoExporting()) throw new AppUpdateBlockedError('finishTask');
  await simulationService.settleBeforeAppUpdate();
  requireNoCollaboration();
  if (useEditor.getState().preferenceError)
    throw new Error(useEditor.getState().preferenceError!.message);
  await workspace.retryFailedSaves();
  requireNoCollaboration();
  await settleWorkspaceBeforeReload();
  requireNoCollaboration();
  // Reloaded encrypted tabs require a fresh agent grant. Lower access before
  // activation as well, so an external writer cannot race the saved UI state.
  if (useEditor.getState().mcpAccess !== 'off') await workspace.setPreference('mcp-access', 'off');
  requireNoCollaboration();
  await simulationService.settleBeforeAppUpdate();
  await settleWorkspaceBeforeReload();
  requireNoCollaboration();
}
