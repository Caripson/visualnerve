import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  appContentSecurityPolicy,
  appSurfaceOptions,
  appResponseHeaders,
} from "./app-policy.mjs";

const guideNames = [
  "getting-started",
  "editing",
  "layouts",
  "3d",
  "csv",
  "connected-data",
  "sql",
  "code",
  "diagram-import",
  "understanding",
  "presentations",
  "simulation",
  "sharing",
  "settings",
  "api-mcp",
  "collaboration",
  "troubleshooting",
];
export const policyNames = ["privacy", "security", "license"];
const generatedFiles = [
  "index.html",
  "error.html",
  "sw.js",
  "robots.txt",
  "app-surface.json",
  "site/app-surface.css",
  ...policyNames.map((name) => `${name}/index.html`),
];
export const copiedAsset = (path) =>
  [
    "appearance.js",
    "openapi.yaml",
    "site/mark.svg",
    "site/syntax.css",
  ].includes(path) ||
  /^editor\/(?:app\.(?:js|css)|assets\/[\w.-]+\.(?:js|css|svg|png|woff2?)|speech\/(?:ort-wasm(?:-simd)?\.wasm|piper_phonemize\.(?:wasm|data)))$/.test(
    path,
  ) ||
  /^editor\/assets\/mls_bg-[\w-]{8,}\.wasm$/.test(path) ||
  /^swagger\/swagger-ui(?:-bundle\.js|\.css)$/.test(path) ||
  /^licenses\/[\w.-]+$/.test(path) ||
  /^help\/(?:help\.(?:css|js)|index\.json|images\/[\w.-]+\.webp)$/.test(path);
export const helpPage = (path) =>
  path === "help/index.html" ||
  guideNames.some((name) => path === `help/${name}/index.html`);

export function filesIn(directory, prefix = "") {
  return readdirSync(resolve(directory, prefix)).flatMap((name) => {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(resolve(directory, path));
    if (stat.isSymbolicLink())
      throw new Error(`App surface must not contain symlinks: ${path}`);
    return stat.isDirectory() ? filesIn(directory, path) : [path];
  });
}
export const text = (directory, path) =>
  readFileSync(resolve(directory, path), "utf8");
export function auditAppSurface(directory, { allowLegacyAlias = false } = {}) {
  if (lstatSync(directory).isSymbolicLink())
    throw new Error("The app output must not be a symlink.");
  const files = filesIn(directory);
  const manifest = JSON.parse(text(directory, "app-surface.json"));
  if (
    manifest.format !== "visual-nerve-app-surface" ||
    manifest.schemaVersion !== 1 ||
    manifest.vaultRequired !== true
  )
    throw new Error("The output is not an isolated app surface.");
  const options = appSurfaceOptions(manifest);
  if (
    manifest.entrySha256 !==
    createHash("sha256")
      .update(readFileSync(resolve(directory, "editor/app.js")))
      .digest("hex")
  )
    throw new Error("App entry does not match the prepared surface.");
  for (const path of files) {
    if (
      !generatedFiles.includes(path) &&
      !(allowLegacyAlias && path === "app/index.html") &&
      !copiedAsset(path) &&
      !helpPage(path) &&
      path !== "api/docs/index.html" &&
      !/^api\/docs\/docs\.(?:css|js)$/.test(path)
    )
      throw new Error(`Unexpected file in isolated app surface: ${path}`);
    if (path.endsWith(".json")) {
      const json = JSON.parse(text(directory, path));
      if (["visual-nerve", "visual-nerve-workspace"].includes(json.format))
        throw new Error(`User export found in app surface: ${path}`);
    }
    if (
      /\.(?:js|css)$/.test(path) &&
      /googletagmanager\.com\/gtag|google-analytics\.com|window\.(?:gtag|klaro)\b/.test(
        text(directory, path),
      )
    )
      throw new Error(`Analytics/consent code found in app surface: ${path}`);
    if (!path.endsWith(".html")) continue;
    const html = text(directory, path);
    const metaPolicy = appContentSecurityPolicy(
      options.bridgePorts,
      options.collaborationRelayOrigin,
    )
      .split("; ")
      .filter((directive) => !directive.startsWith("frame-ancestors "))
      .join("; ")
      .replaceAll("'", "&#39;");
    if (
      !html.includes(
        `<meta http-equiv="Content-Security-Policy" content="${metaPolicy}">`,
      )
    )
      throw new Error(
        `App meta security policy is missing or changed: ${path}`,
      );
    if (/<meta\b[^>]*name=["']visualnerve-google-analytics["']/i.test(html))
      throw new Error(`Analytics configuration found in app surface: ${path}`);
    const relayMeta = [
      ...html.matchAll(
        /<meta\b[^>]*name=["']visual-nerve-collaboration-relay["'][^>]*>/gi,
      ),
    ];
    if (
      options.collaborationRelayOrigin
        ? relayMeta.length !== 1 ||
          relayMeta[0][0] !==
            `<meta name="visual-nerve-collaboration-relay" content="${options.collaborationRelayOrigin}">`
        : relayMeta.length !== 0
    )
      throw new Error(
        `Collaboration relay configuration is missing or changed: ${path}`,
      );
    for (const marker of [
      '<meta name="visualnerve-surface" content="isolated-app">',
      '<meta name="visualnerve-vault-required" content="true">',
      `<meta name="visualnerve-app-origin" content="${options.appOrigin}">`,
    ])
      if (!html.includes(marker))
        throw new Error(`App surface marker is missing: ${path}`);
    if (/<(?:base|iframe|object)\b|<[a-z][^>]*\son[a-z]+\s*=/i.test(html))
      throw new Error(`Unsafe executable HTML in app surface: ${path}`);
    for (const script of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      const source = script[1].match(/\bsrc="(\/[\w./-]+)"/)?.[1];
      if (!source || script[2].trim() || !files.includes(source.slice(1)))
        throw new Error(`Non-local or inline script in app surface: ${path}`);
    }
    for (const link of html.matchAll(
      /<link\b[^>]*rel="stylesheet"[^>]*href="([^\"]+)"/gi,
    ))
      if (!link[1].startsWith("/") || !files.includes(link[1].slice(1)))
        throw new Error(`Non-local stylesheet in app surface: ${path}`);
  }
  for (const required of [
    ...generatedFiles,
    "editor/app.js",
    "editor/app.css",
    "appearance.js",
    "site/mark.svg",
    "help/index.html",
    "help/help.js",
    "help/help.css",
    "api/docs/index.html",
    "api/docs/docs.js",
    "api/docs/docs.css",
    "openapi.yaml",
  ])
    if (!files.includes(required))
      throw new Error(`App surface is missing ${required}`);
  if (
    JSON.stringify(manifest.responseHeaders) !==
    JSON.stringify(
      appResponseHeaders(options.bridgePorts, options.collaborationRelayOrigin),
    )
  )
    throw new Error(
      "App response-header policy does not match its configuration.",
    );
  return files.sort();
}
