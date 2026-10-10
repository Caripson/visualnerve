import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditStatic } from "./audit-static.mjs";
import {
  appSurfaceOptions,
  appResponseHeaders,
} from "../deployment/app-policy.mjs";
import {
  appBody,
  appBrand,
  appDocument,
  policyBody,
  rewriteAppLinks,
  appSurfaceStyles,
} from "../deployment/app-shell.mjs";

export { auditAppSurface } from "../deployment/app-surface-audit.mjs";
import {
  auditAppSurface,
  copiedAsset,
  filesIn,
  helpPage,
  policyNames,
  text,
} from "../deployment/app-surface-audit.mjs";

function put(directory, path, value) {
  mkdirSync(dirname(resolve(directory, path)), { recursive: true });
  writeFileSync(resolve(directory, path), value);
}

export async function buildAppSurface(
  sourceDirectory,
  destinationDirectory,
  input = {},
) {
  const source = realpathSync(sourceDirectory),
    requested = resolve(destinationDirectory);
  const options = appSurfaceOptions(input);
  const sourceFiles = auditStatic(source);
  const within = (parent, child) => {
    const path = relative(parent, child);
    return (
      path === "" ||
      (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))
    );
  };
  if (within(source, requested) || within(requested, source))
    throw new Error("App output and source must not overlap.");
  mkdirSync(dirname(requested), { recursive: true });
  const destination = resolve(
    realpathSync(dirname(requested)),
    basename(requested),
  );
  if (within(source, destination) || within(destination, source))
    throw new Error("App output and source must not overlap.");
  if (existsSync(destination))
    auditAppSurface(destination, { allowLegacyAlias: true });
  const output = mkdtempSync(
    resolve(dirname(destination), ".visualnerve-app-surface-"),
  );
  try {
    for (const path of sourceFiles.filter(copiedAsset)) {
      mkdirSync(dirname(resolve(output, path)), { recursive: true });
      copyFileSync(resolve(source, path), resolve(output, path));
    }
    const workspace = text(source, "help/index.html"),
      brand = appBrand(workspace);
    const root =
      '<div id="visual-nerve"><noscript>Visual Nerve needs JavaScript for its interactive editor. The <a href="/help/">guide</a> and <a href="/api/docs/">API documentation</a> are available separately.</noscript></div>';
    const app = appDocument("Workspace", "/", root, brand, options, {
      modules: ["/editor/app.js"],
      workspaceChrome: true,
    });
    put(output, "index.html", app);
    for (const path of sourceFiles.filter(helpPage)) {
      const original = text(source, path);
      const title =
        original
          .match(/<title>(.*?)<\/title>/)?.[1]
          ?.replace(/\s*[·|]\s*Visual Nerve.*$/, "") ?? "Help";
      put(
        output,
        path,
        appDocument(
          title,
          `/${path.replace(/index\.html$/, "")}`,
          rewriteAppLinks(appBody(original), options),
          brand,
          options,
          {
            bodyClass: "help-site",
            styles: ["/help/help.css", "/site/syntax.css"],
            scripts: ["/help/help.js"],
          },
        ),
      );
    }
    for (const name of policyNames)
      put(
        output,
        `${name}/index.html`,
        appDocument(
          name[0].toUpperCase() + name.slice(1),
          `/${name}/`,
          rewriteAppLinks(
            policyBody(text(source, `${name}/index.html`)),
            options,
          ),
          brand,
          options,
          { styles: ["/site/syntax.css"] },
        ),
      );
    for (const path of ["api/docs/docs.css", "api/docs/docs.js"])
      put(output, path, text(source, path));
    put(
      output,
      "api/docs/index.html",
      appDocument(
        "API reference",
        "/api/docs/",
        rewriteAppLinks(appBody(text(source, "api/docs/index.html")), options),
        brand,
        options,
        {
          bodyClass: "api-reference-page",
          styles: ["/swagger/swagger-ui.css", "/api/docs/docs.css"],
          scripts: ["/swagger/swagger-ui-bundle.js", "/api/docs/docs.js"],
        },
      ),
    );
    put(
      output,
      "error.html",
      appDocument(
        "Page not found",
        "/error.html",
        '<main class="app-document"><h1>Page not found</h1><p>This app origin serves the workspace, its guides and API reference.</p><p><a href="/">Return to the workspace</a> · <a href="/help/">Read the guides</a></p></main>',
        brand,
        options,
      ),
    );
    put(output, "site/app-surface.css", appSurfaceStyles);
    put(output, "robots.txt", "User-agent: *\nDisallow: /\n");
    put(
      output,
      "app-surface.json",
      JSON.stringify(
        {
          format: "visual-nerve-app-surface",
          schemaVersion: 1,
          vaultRequired: true,
          ...options,
          entrySha256: createHash("sha256")
            .update(readFileSync(resolve(output, "editor/app.js")))
            .digest("hex"),
          responseHeaders: appResponseHeaders(
            options.bridgePorts,
            options.collaborationRelayOrigin,
          ),
        },
        null,
        2,
      ) + "\n",
    );
    // The cache owner supplies the same abort/clear handshake as the existing app shell.
    const { buildServiceWorker } = await import("./service-worker.mjs");
    if (typeof buildServiceWorker !== "function")
      throw new Error(
        "An importable service-worker generator is required before preparing the app surface.",
      );
    const assets = filesIn(output).map(
      (path) => `/${path.replace(/index\.html$/, "")}`,
    );
    await buildServiceWorker(output, { surface: "app", assets });
    const files = auditAppSurface(output);
    if (existsSync(destination)) rmSync(destination, { recursive: true });
    renameSync(output, destination);
    return { directory: destination, files, ...options };
  } finally {
    if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  }
}

function isMain() {
  try {
    return (
      !!process.argv[1] &&
      pathToFileURL(realpathSync(process.argv[1])).href ===
        pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    return false;
  }
}
if (isMain()) {
  if (process.argv.length > 4)
    throw new Error(
      "Usage: node scripts/build-app-surface.mjs [public [public-app]]",
    );
  const result = await buildAppSurface(
    process.argv[2] ?? "public",
    process.argv[3] ?? "public-app",
    {
      ...(process.env.APP_SURFACE_ORIGIN
        ? { appOrigin: process.env.APP_SURFACE_ORIGIN }
        : {}),
      ...(process.env.APP_WEBSITE_ORIGIN
        ? { websiteOrigin: process.env.APP_WEBSITE_ORIGIN }
        : {}),
      ...(process.env.APP_BRIDGE_PORTS
        ? { bridgePorts: process.env.APP_BRIDGE_PORTS.split(",").map(Number) }
        : {}),
      ...(process.env.COLLABORATION_RELAY_ORIGIN
        ? { collaborationRelayOrigin: process.env.COLLABORATION_RELAY_ORIGIN }
        : {}),
    },
  );
  console.log(
    `Prepared isolated app surface: ${result.files.length} audited files at ${result.directory}; nothing deployed.`,
  );
}
