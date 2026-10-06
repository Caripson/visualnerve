import { getViewportForBounds, type ReactFlowInstance } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import {
  PRESENTATION_FOCUS,
  PRESENTATION_CAMERA_CANCEL,
  PRESENTATION_VIEW_REQUEST,
  presentationFocus,
  presentationArrived,
  presentationInterrupted,
  presentationEase,
  type PresentationFocus,
  type PresentationViewRequest,
} from './camera';

/** React Flow owns animation; this module owns completion, interruption and persistence suppression. */
export function attachCanvasPresentationCamera(
  flow: ReactFlowInstance<CanvasNode>,
  options: {
    transient(value: boolean): void;
    select(id: string): void;
    viewportSize(): { width: number; height: number };
    selectMany?(nodeIds: string[], edgeIds: string[]): void;
    /** Reveal canonical objects behind view-only overview proxies before checking readiness. */
    reveal?(request: PresentationFocus): Promise<void> | void;
    ignoreViewport?(viewport: { x: number; y: number; zoom: number }): void;
  },
) {
  let transient = false,
    request: PresentationFocus | undefined,
    pending = false,
    generation = 0,
    disposed = false;
  const cancel = (reason = 'Camera movement cancelled.', manual = false) => {
    const previous = request;
    request = undefined;
    const token = ++generation;
    if (previous && pending) presentationArrived(previous, reason);
    pending = false;
    if (previous && manual) presentationInterrupted(previous, reason);
    if (!transient) return;
    const frozen = flow.getViewport();
    options.ignoreViewport?.(frozen);
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
    if (next.view && next.view.mode !== '2d') {
      presentationArrived(next, 'Switch to 3D to play this saved storyboard camera.');
      return;
    }
    const ids = next.nodeIds ?? [next.nodeId];
    if (
      !options.reveal &&
      ids.some((id) => {
        const node = flow.getNode(id);
        return !node || node.hidden;
      })
    ) {
      presentationArrived(next, 'The presentation object is hidden or unavailable in this view.');
      return;
    }
    request = next;
    pending = true;
    const token = ++generation;
    transient = true;
    options.transient(true);
    if (options.selectMany) options.selectMany(ids, next.edgeIds ?? []);
    else options.select(next.nodeId);
    void (async () => {
      if (options.reveal) await options.reveal(next);
      if (generation !== token || request !== next) return;
      if (options.reveal) {
        const deadline = performance.now() + 5000;
        while (
          ids.some((id) => {
            const node = flow.getNode(id);
            return !node || node.hidden;
          })
        ) {
          if (generation !== token || request !== next) return;
          if (performance.now() > deadline)
            throw new Error('The storyboard objects are hidden or unavailable in this view.');
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      if (
        ids.some((id) => {
          const node = flow.getNode(id);
          return !node || node.hidden;
        })
      )
        throw new Error('The presentation object is hidden or unavailable in this view.');
      let target = next.view?.mode === '2d' ? next.view.viewport : undefined;
      if (!target) {
        const { width, height } = options.viewportSize();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
          throw new Error('The 2D diagram viewport is not ready. Open the diagram and try again.');
        // fitView queues a later fit that setViewport cannot cancel. Compute the same
        // bounds directly so an interrupted tour owns only one cancelable animation.
        // React Flow's bounds retain absolute parent/child positions and measured sizes.
        target = getViewportForBounds(flow.getNodesBounds(ids), width, height, 0.05, 1.15, 0.65);
      }
      const arrived = await flow.setViewport(target, {
        duration: next.transitionMs,
        ease: presentationEase,
        interpolate: 'linear',
      });
      if (generation !== token || request !== next) return;
      pending = false;
      options.ignoreViewport?.(flow.getViewport());
      presentationArrived(next, arrived ? undefined : 'The 2D camera is not ready.');
    })().catch((error: unknown) => {
      if (generation !== token || request !== next) return;
      pending = false;
      presentationArrived(next, error instanceof Error ? error.message : 'Camera movement failed.');
    });
  };
  const capture = (event: Event) => {
    const detail = (event as CustomEvent<PresentationViewRequest>).detail;
    if (detail?.respond) detail.respond({ mode: '2d', viewport: flow.getViewport() });
  };
  const explicitCancel = () => cancel();
  window.addEventListener(PRESENTATION_FOCUS, focus);
  window.addEventListener(PRESENTATION_CAMERA_CANCEL, explicitCancel);
  window.addEventListener(PRESENTATION_VIEW_REQUEST, capture);
  return {
    cancel,
    dispose() {
      cancel('The diagram view changed.', true);
      disposed = true;
      options.transient(false);
      window.removeEventListener(PRESENTATION_FOCUS, focus);
      window.removeEventListener(PRESENTATION_CAMERA_CANCEL, explicitCancel);
      window.removeEventListener(PRESENTATION_VIEW_REQUEST, capture);
    },
  };
}
