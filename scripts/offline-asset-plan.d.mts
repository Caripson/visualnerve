export const APP_PRECACHE_LICENSE_PATHS: readonly string[];
export class OfflineAssetPlan {
  constructor(options: {
    surface?: "site" | "app";
    assets: readonly string[];
    lazyAssets?: readonly string[];
  });
  readonly assets: readonly string[];
  readonly lazyAssets: readonly string[];
  readonly inventory: readonly string[];
}
