import { useEffect } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import type { CanvasNode } from './projection';
import { resizedCanvasViewport } from './navigation';

export function useResponsiveCanvasViewport(
  enabled: boolean,
  diagramId: string | undefined,
  cameraOwned: () => boolean,
) {
  const flow = useReactFlow<CanvasNode>();
  const store = useStoreApi<CanvasNode>();
  useEffect(() => {
    if (!enabled || !diagramId) return;
    const initial = store.getState();
    let size = { width: initial.width, height: initial.height };
    let before: typeof size | undefined;
    let frame = 0;
    const unsubscribe = store.subscribe((state) => {
      const next = { width: state.width, height: state.height };
      if (next.width === size.width && next.height === size.height) return;
      if (!size.width || !size.height || !next.width || !next.height) {
        size = next;
        return;
      }
      before ??= size;
      size = next;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const previous = before;
        before = undefined;
        if (previous && !cameraOwned())
          void flow.setViewport(resizedCanvasViewport(flow.getViewport(), previous, size));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [enabled, diagramId, flow, store, cameraOwned]);
}
