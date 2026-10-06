import type { ReactFlowInstance } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import {
  PRESENTATION_FOCUS,
  PRESENTATION_CAMERA_CANCEL,
  presentationFocus,
  presentationArrived,
  presentationInterrupted,
  presentationEase,
  type PresentationFocus,
} from './camera';

/** React Flow owns animation; this module owns completion, interruption and persistence suppression. */
export function attachCanvasPresentationCamera(
  flow: ReactFlowInstance<CanvasNode>,
  options: {
    transient: (value: boolean) => void;
    select: (id: string) => void;
    ignoreViewport?: (viewport: { x: number; y: number; zoom: number }) => void;
  },
) {
  let transient = false;
  let request: PresentationFocus | undefined;
  let pending = false;
  let generation = 0;
  let disposed = false;
  const cancel = (reason = 'Camera movement cancelled.', manual = false) => {
    const previous = request;
    request = undefined;
    const token = ++generation;
    if (previous && pending) presentationArrived(previous, reason);
    pending = false;
    if (previous && manual) presentationInterrupted(previous, reason);
    if (!transient) return;
    const frozen = flow.getViewport();
    // React Flow delivers move-end on a later task, after the promise below.
    // Remember its provenance even when cancelling or replacing this controller.
    options.ignoreViewport?.(frozen);
    // An immediate transform interrupts React Flow's in-flight d3 transition.
    // Keep suppression enabled through its final synchronous move-end event.
    void flow
      .setViewport(frozen, { duration: 0 })
      .catch(() => {})
      .finally(() => {
        if (generation === token && !disposed) {
          transient = false;
          options.transient(false);
        }
      });
  };
  const focus = (event: Event) => {
    const next = presentationFocus(event);
    if (!next) return;
    cancel('Camera movement replaced.');
    const node = flow.getNode(next.nodeId);
    if (!node || node.hidden) {
      presentationArrived(next, 'The presentation object is hidden or unavailable in this view.');
      return;
    }
    request = next;
    pending = true;
    const token = ++generation;
    transient = true;
    options.transient(true);
    // Selection is a transient preview; neither coordinates nor diagram revision changes.
    options.select(next.nodeId);
    void flow
      .fitView({
        nodes: [{ id: next.nodeId }],
        duration: next.transitionMs,
        ease: presentationEase,
        interpolate: 'linear',
        padding: 0.65,
        maxZoom: 1.15,
      })
      .then((arrived) => {
        if (generation !== token || request !== next) return;
        pending = false;
        options.ignoreViewport?.(flow.getViewport());
        presentationArrived(next, arrived ? undefined : 'The 2D camera is not ready.');
      })
      .catch((error: unknown) => {
        if (generation !== token || request !== next) return;
        pending = false;
        presentationArrived(
          next,
          error instanceof Error ? error.message : 'Camera movement failed.',
        );
      });
  };
  const explicitCancel = () => cancel();
  window.addEventListener(PRESENTATION_FOCUS, focus);
  window.addEventListener(PRESENTATION_CAMERA_CANCEL, explicitCancel);
  return {
    cancel,
    dispose: () => {
      cancel('The diagram view changed.', true);
      disposed = true;
      options.transient(false);
      window.removeEventListener(PRESENTATION_FOCUS, focus);
      window.removeEventListener(PRESENTATION_CAMERA_CANCEL, explicitCancel);
    },
  };
}
