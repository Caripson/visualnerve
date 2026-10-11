import { useLayoutEffect, useRef } from 'react';
import { reservePresenceBounds } from './presence-layout';

// Both canvas modes and optional fixed UI contribute to the same reserved slot.
const controlSelector = [
  '.react-flow__controls',
  '.canvas-tools-panel',
  '.context-toolbar',
  '.react-flow__minimap',
  '.overview-panel',
  '.spatial-toolbar',
  '.spatial-caption',
  '.spatial-object-list',
  '.spatial-limit',
  '.presentation-player',
  '.presentation-subtitles-overlay',
  '.app-update-notice',
  '.canvas-statusbar',
  '[data-canvas-control-reservation]',
].join(',');

export function usePresenceDock(active: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    const overlay = button?.closest('.collaboration-live-overlay');
    if (!active || !button || !overlay) return;
    let frame = 0;
    let observed: Element[] = [];
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    function position() {
      frame = 0;
      const canvas = document.querySelector('.main-workspace .canvas-shell');
      if (!canvas || canvas.closest('[inert]')) {
        button!.dataset.docked = 'unavailable';
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const viewport = window.visualViewport;
      const canvasBounds = {
        left: Math.max(canvasRect.left, viewport?.offsetLeft ?? 0),
        right: Math.min(
          canvasRect.right,
          (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
        ),
        top: Math.max(canvasRect.top, viewport?.offsetTop ?? 0),
        bottom: Math.min(
          canvasRect.bottom,
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
        ),
      };
      button!.style.maxWidth = `${Math.max(0, Math.min(320, canvasBounds.right - canvasBounds.left - 24))}px`;
      const elements = [...document.querySelectorAll(controlSelector)].filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length
        );
      });
      const nextObserved = [canvas, button!, ...elements];
      if (
        nextObserved.length !== observed.length ||
        nextObserved.some((item, index) => item !== observed[index])
      ) {
        resize?.disconnect();
        for (const element of nextObserved) resize?.observe(element);
        observed = nextObserved;
      }
      const size = button!.getBoundingClientRect();
      const slot = reservePresenceBounds(
        canvasBounds,
        size.width,
        size.height,
        elements.map((element) => element.getBoundingClientRect()),
      );
      button!.dataset.docked = slot ? 'true' : 'unavailable';
      if (slot) {
        button!.style.left = `${slot.left}px`;
        button!.style.top = `${slot.top}px`;
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(position);
    }
    const mutations = new MutationObserver((records) => {
      if (
        records.some((record) => {
          const element =
            record.target instanceof Element ? record.target : record.target.parentElement;
          return (
            !overlay!.contains(record.target) &&
            !element?.closest(
              '.react-flow__viewport, .react-flow__edges, .collaboration-canvas-presence',
            )
          );
        })
      )
        schedule();
    });
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'hidden', 'inert', 'data-minimized'],
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    position();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [active]);
  return ref;
}
