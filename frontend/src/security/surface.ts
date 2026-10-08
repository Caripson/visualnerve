/** The isolated origin always requires a vault, even if its HTML marker is missing. */
export function isEncryptedWorkspaceSurface(): boolean {
  return (
    (typeof location !== 'undefined' && location.hostname === 'app.visualnerve.com') ||
    (typeof document !== 'undefined' &&
      document.querySelector('meta[name="visualnerve-vault-required"]')?.getAttribute('content') ===
        'true')
  );
}
