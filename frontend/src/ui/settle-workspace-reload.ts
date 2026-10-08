import { useEditor } from '../state/editor';
import { flushSpatialCamera, workspace } from '../storage/workspace';

/** A missing optional tool can reload only after the originating session saved its edits. */
export async function settleWorkspaceBeforeReload() {
  const operation = await workspace.repo.db.captureOperation();
  try {
    await operation.check();
    operation.signal.throwIfAborted();
    useEditor.getState().finishEditing();
    flushSpatialCamera();
    await workspace.settled();
    await operation.check();
    operation.signal.throwIfAborted();
  } finally {
    operation.dispose();
  }
}
