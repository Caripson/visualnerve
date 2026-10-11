import { useEffect, useSyncExternalStore } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { Modal } from '../components/Modal';
import { useI18n } from '../i18n';
import { vaultSession, vaultCrypto } from '../storage/runtime';
import { collaborationRuntime } from './runtime';
import { CollaborationPanel, PresenceBar, PresenceCanvasLayer } from './ui';
import { useEditor } from '../state/editor';
import { getSpatialView } from '../spatial/types';
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
  const canvas = useStore((state) => state.domNode);
  const flow = useReactFlow();
  const graph = useEditor((state) => state.graph);
  const twoDimensional = !!graph && getSpatialView(graph).mode === '2d';
  useEffect(() => () => collaborationRuntime.release(controller), [controller]);
  useEffect(() => {
    if (!canvas || !twoDimensional || snapshot.status !== 'live') return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      controller.setPointer(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    };
    const leave = () => controller.setPointer();
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerleave', leave, { passive: true });
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      leave();
    };
  }, [canvas, controller, flow, snapshot.status, twoDimensional]);
  return (
    <>
      <div className="collaboration-live-overlay">
        <PresenceBar snapshot={snapshot} onOpen={onOpen} />
      </div>
      {twoDimensional && <PresenceCanvasLayer snapshot={snapshot} />}
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
