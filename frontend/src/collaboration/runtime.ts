import { workspace } from '../storage/workspace';
import { vaultCrypto, vaultSession } from '../storage/runtime';
import { collaborationRelayOrigin } from './config';
import { CollaborationController } from './controller';
import { CollaborationPrivateStore } from './persistence/private-store';
/** Loaded on explicit collaboration UI/API use, never by the normal editor entry. */
class CollaborationRuntime {
  controller?: CollaborationController;
  getController(): CollaborationController {
    if (this.controller) return this.controller;
    if (!vaultSession || !vaultCrypto)
      throw new Error('Collaboration requires the isolated encrypted workspace.');
    this.controller = new CollaborationController({
      workspace,
      session: vaultSession,
      store: new CollaborationPrivateStore(vaultSession, vaultCrypto),
      relay: collaborationRelayOrigin(),
      origin: location.origin,
    });
    return this.controller;
  }
  release(controller: CollaborationController) {
    if (this.controller === controller) {
      controller.dispose();
      this.controller = undefined;
    }
  }
  inspect = () => this.controller?.getSnapshot();
  async disconnect(diagramId: string) {
    if (this.controller?.getSnapshot().diagramId !== diagramId)
      throw new Error('No collaboration session exists for this diagram.');
    await this.controller.leave();
  }
}
export const collaborationRuntime = new CollaborationRuntime();
