import { useSyncExternalStore } from 'react';

export const COMPACT_LAYOUT_QUERY =
  '(max-width: 900px), (max-width: 1100px) and (max-height: 500px)';

export function matchesCompactLayout() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function')
    return window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
  return window.innerWidth <= 900 || (window.innerWidth <= 1100 && window.innerHeight <= 500);
}

function subscribe(listener: () => void) {
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** One layout boundary for the app shell, canvas tools and simulation controls. */
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, matchesCompactLayout, () => false);
}
