const owners = new Set<() => void>();
/** Essential lock/transfer owners clear already-loaded private work without loading the builder. */
export function registerRobloxCleanup(cleanup: () => void) {
  owners.add(cleanup);
}
export function clearRobloxIfLoaded() {
  for (const cleanup of owners) cleanup();
}
