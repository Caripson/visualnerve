let cleanup: (() => void) | undefined;
/** Thin cleanup hook; locking never imports the SVG renderer or its worker. */
export function registerSvgJobsCleanup(clear: () => void) {
  cleanup = clear;
}
export function clearSvgJobsIfLoaded() {
  cleanup?.();
}
