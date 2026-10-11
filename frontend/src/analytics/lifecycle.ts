const cleanup = new Set<() => void>();
/** Locking clears already-loaded analysis owners without loading a sensitive feature chunk. */
export function registerAnalyticsCleanup(clear: () => void) {
  cleanup.add(clear);
}
export function clearAnalyticsIfLoaded() {
  for (const clear of cleanup) clear();
}
