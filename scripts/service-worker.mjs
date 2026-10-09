import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAssetPlan } from "./offline-asset-plan.mjs";

function files(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((file) =>
    file.isDirectory()
      ? files(resolve(directory, file.name), `${prefix}/${file.name}`)
      : [`${prefix}/${file.name}`],
  );
}
export function buildServiceWorker(
  publicDir,
  {
    surface = "site",
    assets: requestedAssets,
    retireAppPaths = surface === "app",
  } = {},
) {
  if (!["site", "app"].includes(surface))
    throw new Error("Unknown application surface.");
  const editorAssets = files(resolve(publicDir, "editor"), "/editor");
  const speechAssets = editorAssets.filter((path) =>
    path.startsWith("/editor/speech/"),
  );
  const route = (path) =>
    path.endsWith("/index.html") ? path.slice(0, -10) : path;
  const managedAssets = requestedAssets
    ? requestedAssets
    : [
        ...new Set([
          "/",
          "/app/",
          "/appearance.js",
          "/workspace-navigation.js",
          "/error.html",
          "/privacy/",
          "/license/",
          ...files(publicDir, "")
            .filter(
              (path) =>
                path.endsWith("/index.html") &&
                !path.startsWith("/api/") &&
                !path.startsWith("/editor/"),
            )
            .map(route),
          ...files(resolve(publicDir, "site"), "/site"),
          ...files(resolve(publicDir, "help"), "/help").map(route),
          ...editorAssets,
        ]),
      ];
  const plan = new OfflineAssetPlan({
    surface,
    assets: retireAppPaths
      ? managedAssets.filter((path) => !/^\/app(?:\/|$)/.test(path))
      : managedAssets,
    lazyAssets: speechAssets,
  });
  const { assets, lazyAssets } = plan;
  const runtime = readFileSync(
    new URL("./service-worker-runtime.js", import.meta.url),
    "utf8",
  );
  const hash = createHash("sha256")
    .update(runtime)
    .update(JSON.stringify({ assets, lazyAssets, retireAppPaths, surface }));
  for (const path of plan.inventory)
    hash
      .update(path)
      .update(
        readFileSync(
          resolve(
            publicDir,
            path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1),
          ),
        ),
      );
  const cacheName = `visual-nerve-${surface === "app" ? "app-" : ""}shell-${hash.digest("hex").slice(0, 12)}`;
  const source = runtime
    .replace("__CACHE_NAME__", JSON.stringify(cacheName))
    .replace("__ASSETS__", JSON.stringify(assets))
    .replace("__LAZY_ASSETS__", JSON.stringify(lazyAssets))
    .replace(
      "__RETIRED_APP_PATHS__",
      JSON.stringify(retireAppPaths ? surface : false),
    );
  writeFileSync(resolve(publicDir, "sw.js"), source);
  return { cacheName, assets, lazyAssets };
}
let main = false;
try {
  main =
    !!process.argv[1] &&
    realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url));
} catch {
  /* Imported through stdin/eval. */
}
if (main) {
  const result = buildServiceWorker(
    resolve(dirname(fileURLToPath(import.meta.url)), "../public"),
    { retireAppPaths: process.env.HUGO_PARAMS_ENVIRONMENT === "production" },
  );
  console.log(
    `Built offline application shell: ${result.assets.length} local assets.`,
  );
}
