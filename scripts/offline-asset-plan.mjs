/** Bounded project/speech license texts available before visiting dependency notices. */
export const APP_PRECACHE_LICENSE_PATHS = Object.freeze([
  "/licenses/inventory.json",
  "/licenses/visualnerve-LICENSE",
  "/licenses/visualnerve-NOTICE",
  "/licenses/espeak-ng-NOTICE",
  "/licenses/espeak-ng-COPYING",
  "/licenses/piper-phonemize-NOTICE",
  "/licenses/piper-phonemize-LICENSE.md",
  "/licenses/piper-tts-web-NOTICE",
  "/licenses/piper-voices-NOTICE",
]);
const appCoreLicenses = new Set(APP_PRECACHE_LICENSE_PATHS);

/** Classify exact local assets without removing anything from the managed inventory. */
export class OfflineAssetPlan {
  constructor({ surface = "site", assets, lazyAssets = [] }) {
    if (!["site", "app"].includes(surface))
      throw new Error("Unknown application surface.");
    for (const path of [...assets, ...lazyAssets])
      if (
        typeof path !== "string" ||
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("..") ||
        /[?#\\]/.test(path)
      )
        throw new Error("Offline assets must be exact local paths.");
    const deferred = new Set(lazyAssets);
    for (const path of assets) {
      // Optional MLS compilation is requested only after collaboration opens.
      // Publishing/hash-covering the asset must not download it during normal app installation.
      if (/^\/editor\/assets\/mls_bg-[\w-]{8,}\.wasm$/.test(path))
        deferred.add(path);
      // All notices remain published and hash-covered. Dependency notices are
      // cached on reading; inventory and project/speech notices remain core.
      else if (surface === "app" && appCoreLicenses.has(path))
        deferred.delete(path);
      else if (
        surface === "app" &&
        path.startsWith("/licenses/") &&
        !appCoreLicenses.has(path) &&
        !path.endsWith("/")
      )
        deferred.add(path);
    }
    this.assets = Object.freeze(
      [...new Set(assets)].filter((path) => !deferred.has(path)),
    );
    this.lazyAssets = Object.freeze([...deferred]);
    this.inventory = Object.freeze([...this.assets, ...this.lazyAssets]);
  }
}
