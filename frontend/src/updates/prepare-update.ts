import { useEditor } from '../state/editor';
import { vaultSession } from '../storage/runtime';
import { workspace } from '../storage/workspace';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import { AppUpdateBlockedError } from './errors';

/** A human-approved restart saves under the current, revocable vault session. */
export async function prepareAppUpdate() {
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
  if (isVideoExporting()) throw new AppUpdateBlockedError('finishTask');
  await simulationService.settleBeforeAppUpdate();
  if (useEditor.getState().preferenceError)
    throw new Error(useEditor.getState().preferenceError!.message);
  await workspace.retryFailedSaves();
  await settleWorkspaceBeforeReload();
  // Reloaded encrypted tabs require a fresh agent grant. Lower access before
  // activation as well, so an external writer cannot race the saved UI state.
  if (useEditor.getState().mcpAccess !== 'off') await workspace.setPreference('mcp-access', 'off');
  await simulationService.settleBeforeAppUpdate();
  await settleWorkspaceBeforeReload();
}
