const cleanup = new Set<() => void>();
/** Thin shared cleanup hook; locking never imports export renderers or their workers. */
export function registerSvgJobsCleanup(clear: () => void) {
  cleanup.add(clear);
}
export function clearSvgJobsIfLoaded() {
  for (const clear of cleanup) clear();
}
