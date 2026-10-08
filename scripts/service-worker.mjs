import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function files(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((file) =>
    file.isDirectory()
      ? files(resolve(directory, file.name), `${prefix}/${file.name}`)
      : [`${prefix}/${file.name}`],
  );
}
export function buildServiceWorker(
  publicDir,
  { surface = "site", assets: requestedAssets } = {},
) {
  if (!["site", "app"].includes(surface))
    throw new Error("Unknown application surface.");
  const editorAssets = files(resolve(publicDir, "editor"), "/editor");
  const lazyAssets = editorAssets.filter((path) =>
    path.startsWith("/editor/speech/"),
  );
  const route = (path) =>
    path.endsWith("/index.html") ? path.slice(0, -10) : path;
  const assets = requestedAssets
    ? [...new Set(requestedAssets.filter((path) => !lazyAssets.includes(path)))]
    : [
        ...new Set([
          "/",
          "/app/",
          "/appearance.js",
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
          ...editorAssets.filter((path) => !lazyAssets.includes(path)),
        ]),
      ];
  for (const path of [...assets, ...lazyAssets])
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("..") ||
      /[?#\\]/.test(path)
    )
      throw new Error("Offline assets must be exact local paths.");
  const runtime = readFileSync(
    new URL("./service-worker-runtime.js", import.meta.url),
    "utf8",
  );
  const hash = createHash("sha256").update(runtime);
  for (const path of [...assets, ...lazyAssets])
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
    .replace("__LAZY_ASSETS__", JSON.stringify(lazyAssets));
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
  );
  console.log(
    `Built offline application shell: ${result.assets.length} local assets.`,
  );
}
