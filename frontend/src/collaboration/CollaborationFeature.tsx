import { useEffect, useSyncExternalStore } from 'react';
import { Modal } from '../components/Modal';
import { useI18n } from '../i18n';
import { vaultSession, vaultCrypto } from '../storage/runtime';
import { collaborationRuntime } from './runtime';
import { CollaborationPanel, PresenceBar } from './ui';
interface CollaborationFeatureProps {
  open: boolean;
  close(): void;
  onOpen(): void;
  initialInvitation?: string;
}

export function CollaborationFeature(props: CollaborationFeatureProps) {
  const { t } = useI18n();
  // Older local workspaces can keep using the editor without constructing a
  // controller whose persistence requires the isolated encrypted app surface.
  if (!vaultSession || !vaultCrypto)
    return props.open ? (
      <Modal title={t('collaboration.title')} close={props.close}>
        <p>{t('collaboration.requiresEncryption')}</p>
        <a href="https://app.visualnerve.com/" target="_blank" rel="noopener noreferrer">
          {t('collaboration.openEncryptedApp')}
        </a>
      </Modal>
    ) : null;
  return <EncryptedCollaborationFeature {...props} />;
}

/** Closing the panel keeps its encrypted live session; locking/unmounting destroys it. */
function EncryptedCollaborationFeature({
  open,
  close,
  onOpen,
  initialInvitation,
}: CollaborationFeatureProps) {
  const controller = collaborationRuntime.getController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => collaborationRuntime.release(controller), [controller]);
  return (
    <>
      <div className="collaboration-live-overlay">
        <PresenceBar snapshot={snapshot} onOpen={onOpen} />
      </div>
      {open && (
        <CollaborationPanel
          controller={controller}
          close={close}
          initialInvitation={initialInvitation}
        />
      )}
    </>
  );
}
