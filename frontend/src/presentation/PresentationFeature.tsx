import { lazy, useEffect, useState } from 'react';
import { LazyDialogBoundary } from '../components/LazyDialogBoundary';
import { useEditor } from '../state/editor';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import { presentation, usePresentation } from './service';
import { videoExport } from './video-service';
import { usePresentationLifecycle } from './usePresentationLifecycle';

const Player = lazy(() =>
  import('./Player').then((module) => ({ default: module.PresentationPlayerView })),
);

/** Keep safety subscriptions active while deferring player UI until it is requested. */
export function PresentationFeature() {
  usePresentationLifecycle();
  const graph = useEditor((state) => state.graph);
  const player = usePresentation();
  const visible = !!graph && player.open && graph.diagram.id === player.diagramId;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (visible) setLoaded(true);
  }, [visible]);
  // Once requested, retain the view's paging/order state while it is closed,
  // just as the previously eager component did. Vault lock still unmounts App.
  if (!loaded && !visible) return null;
  return (
    <LazyDialogBoundary
      active={visible}
      close={() => {
        videoExport.cancel();
        presentation.close();
      }}
      beforeReload={settleWorkspaceBeforeReload}
    >
      <Player />
    </LazyDialogBoundary>
  );
}
