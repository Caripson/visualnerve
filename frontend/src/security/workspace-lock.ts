import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { disposeCsvWorker } from '../data/client';
import { disposeDataModelWorker } from '../data/modelClient';
import { bridge } from '../integration/bridge';
import { simulationService } from '../simulation/service';
import { presentation } from '../presentation/service';
import { disposeVideoExport } from '../presentation/video-service';
import { speechService } from '../presentation/speech/service';
import type { VaultSession } from './vault-session';

/** Register once at the application boundary, never in an API password endpoint. */
export function bindWorkspaceLock(session: VaultSession) {
  return session.onLock(async () => {
    // Restrict an existing authorized transport before clearing its editor grant.
    // No new connection or content authorization is created while locked.
    bridge.restrictToControl();
    workspace.stop();
    useEditor.getState().setGraph(null);
    useEditor.setState({
      diagrams: [],
      owners: [],
      clipboard: null,
      workspaceId: '',
      mcpAccess: 'off',
      privacyAcknowledged: false,
    });
    disposeCsvWorker();
    disposeDataModelWorker();
    simulationService.dispose();
    presentation.close();
    const stoppedVideo = disposeVideoExport();
    speechService.dispose();
    await Promise.all([stoppedVideo, presentation.settled()]);
    await workspace.clearUnlockedState();
  });
}
