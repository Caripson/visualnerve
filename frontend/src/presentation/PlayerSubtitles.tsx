import { useI18n } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PresentationRuntimeState } from './types';
import { subtitlePages } from './video-subtitles';

export interface PlayerSubtitlesProps {
  narration: string;
  stepId: string;
  status: PresentationRuntimeState['status'];
  getPlaybackTime: () => { elapsedMs: number; durationMs: number };
  bottom: number;
}

function pageAtTime(count: number, elapsedMs: number, durationMs: number) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((elapsedMs / durationMs) * count)));
}

/** Captions follow the player's clock; resizing or panel changes never restart narration. */
export function PlayerSubtitles({
  narration,
  stepId,
  status,
  getPlaybackTime,
  bottom,
}: PlayerSubtitlesProps) {
  const { t } = useI18n();
  const caption = useRef<HTMLDivElement>(null);
  const playbackTime = useRef(getPlaybackTime);
  const measuredPages = useRef<string[][]>([]);
  const [pages, setPages] = useState<string[][]>([]);
  const [page, setPage] = useState(0);

  useLayoutEffect(() => {
    playbackTime.current = getPlaybackTime;
  }, [getPlaybackTime]);

  useLayoutEffect(() => {
    const element = caption.current;
    const container = element?.parentElement;
    if (!element || !container) return;
    let active = true;
    let previousLayout = '';
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      // Keep captions readable when canvas measurement is unavailable.
    }
    const reflow = (force = false) => {
      if (!active) return;
      const style = getComputedStyle(element);
      const font =
        style.font ||
        `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize || '18px'} ${style.fontFamily || 'system-ui, sans-serif'}`;
      const size = Number.parseFloat(style.fontSize) || 18;
      const spacing = Number.parseFloat(style.letterSpacing) || 0;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const width = Math.max(
        1,
        (container.clientWidth ||
          container.getBoundingClientRect().width ||
          Math.min(640, window.innerWidth - 32)) - padding,
      );
      const layout = `${width}|${font}|${spacing}`;
      if (!force && layout === previousLayout) return;
      previousLayout = layout;
      if (context) {
        context.font = font;
        if ('letterSpacing' in context) context.letterSpacing = `${spacing}px`;
      }
      const measure = (text: string) => {
        const count = Array.from(text).length;
        return context
          ? context.measureText(text).width +
              ('letterSpacing' in context ? 0 : Math.max(0, count - 1) * spacing)
          : count * size * 0.55 + Math.max(0, count - 1) * spacing;
      };
      const next = subtitlePages(narration, measure, width, 2);
      measuredPages.current = next;
      setPages(next);
      const time = playbackTime.current();
      setPage(pageAtTime(next.length, time.elapsedMs, time.durationMs));
    };
    reflow();
    const resize = () => reflow();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    // The caption can shrink to a short cue; available width belongs to the overlay.
    observer?.observe(container);
    window.addEventListener('resize', resize);
    const fontsLoaded = () => reflow(true);
    document.fonts?.addEventListener('loadingdone', fontsLoaded);
    void document.fonts?.ready.then(fontsLoaded);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.fonts?.removeEventListener('loadingdone', fontsLoaded);
    };
  }, [narration, stepId]);

  useEffect(() => {
    if (!narration.trim()) return;
    const update = () => {
      const time = playbackTime.current();
      setPage(pageAtTime(measuredPages.current.length, time.elapsedMs, time.durationMs));
    };
    update();
    if (status !== 'playing') return;
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [narration, status, stepId]);

  if (!narration.trim()) return null;
  const current = Math.max(0, Math.min(page, pages.length - 1));
  return (
    <div className="presentation-subtitles-overlay" style={{ bottom }}>
      <div
        ref={caption}
        className="presentation-caption"
        role="region"
        aria-label={t('presentation.subtitlesRegion')}
        aria-description={narration}
        data-page={current + 1}
        data-page-count={pages.length}
      >
        {pages[current]?.join('\n') || narration}
      </div>
    </div>
  );
}
