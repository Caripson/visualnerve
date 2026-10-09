export function buildServiceWorker(
  publicDir: string,
  options?: {
    surface?: "site" | "app";
    assets?: readonly string[];
    retireAppPaths?: boolean;
  },
): {
  cacheName: string;
  assets: readonly string[];
  lazyAssets: readonly string[];
};
