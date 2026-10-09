import { appContentSecurityPolicy } from "./app-policy.mjs";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

export function appBrand(source) {
  const brand = source.match(
    /<a\b[^>]*class="site-brand"[^>]*>([\s\S]*?)<\/a>/,
  )?.[1];
  if (!brand)
    throw new Error("The source workspace shell is missing its brand.");
  return brand;
}

export function appHeader(brand, options, workspace = false) {
  return `<header class="site-shell"${workspace ? ' data-app-chrome' : ''}><a class="site-brand" href="/">${brand}</a><nav aria-label="Site" data-app-chrome-label="site"><a href="/"><span data-app-chrome-text="workspace">Workspace</span></a><a href="/help/"><span data-app-chrome-text="guide">Guide</span></a><a href="/api/docs/"><span data-app-chrome-text="apiReference">API reference</span></a><a href="/privacy/"><span data-app-chrome-text="privacy">Privacy</span></a><a href="/license/">Johan Caripson · MPL-2.0</a><a href="${escape(options.websiteOrigin)}/" target="_blank" rel="noopener noreferrer"><span data-app-chrome-text="website">Website</span> <span aria-hidden="true">↗</span></a></nav></header>`;
}

export function appDocument(title, path, body, brand, options, assets = {}) {
  // Framing protection requires the HTTP header; browsers ignore frame-ancestors in a meta policy.
  const metaCsp = appContentSecurityPolicy(options.bridgePorts)
    .split("; ")
    .filter((directive) => !directive.startsWith("frame-ancestors "))
    .join("; ");
  const styles = [
    "/editor/app.css",
    "/site/app-surface.css",
    ...(assets.styles ?? []),
  ];
  const scripts = ["/appearance.js", ...(assets.scripts ?? [])];
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><meta name="visualnerve-surface" content="isolated-app"><meta name="visualnerve-vault-required" content="true"><meta name="visualnerve-app-origin" content="${escape(options.appOrigin)}"><meta http-equiv="Content-Security-Policy" content="${escape(metaCsp)}"><title>${escape(title)} · Visual Nerve</title><link rel="canonical" href="${escape(new URL(path, options.appOrigin).href)}"><link rel="icon" href="/site/mark.svg">${styles.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}${scripts.map((path) => `<script src="${path}"${path === "/appearance.js" ? "" : " defer"}></script>`).join("")}${(assets.modules ?? []).map((path) => `<script type="module" src="${path}"></script>`).join("")}</head><body${assets.bodyClass ? ` class="${escape(assets.bodyClass)}"` : ""}>${appHeader(brand, options, assets.workspaceChrome === true)}${body}</body></html>\n`;
}

export function rewriteAppLinks(html, options) {
  return html.replace(
    /<a\b([^>]*?)href=(['"])(\/[^'"]*)\2([^>]*?)>/g,
    (original, before, quote, href, after) => {
      const path = href.split(/[?#]/)[0];
      if (
        path === "/" ||
        /^\/(?:app|help|privacy|security|license)(?:\/|$)/.test(path) ||
        /^\/(?:api\/docs|openapi\.yaml|licenses\/)/.test(path)
      )
        return original;
      // Product links leave the app origin explicitly; no marketing page is copied into it.
      const attributes = `${before}${after}`.replace(
        /\s+(?:target|rel)=(['"])[^'"]*\1/g,
        "",
      );
      return `<a${attributes} href="${escape(new URL(href, options.websiteOrigin).href)}" target="_blank" rel="noopener noreferrer">`;
    },
  );
}

export function appBody(source) {
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1];
  if (!body)
    throw new Error("A source documentation page is missing its body.");
  return body.replace(
    /<header\b[^>]*class="site-shell"[^>]*>[\s\S]*?<\/header>/,
    "",
  );
}

export function policyBody(source) {
  const article = source.match(
    /<article\b[^>]*class="product-article"[^>]*>([\s\S]*?)<\/article>/,
  )?.[1];
  const title = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  if (!article || !title)
    throw new Error("A source policy page is missing its article/title.");
  return `<main class="app-document" id="main" tabindex="-1"><h1>${title}</h1>${article}</main>`;
}

export const appSurfaceStyles = `.app-document{max-width:76rem;margin:auto;padding:clamp(1.25rem,4vw,3rem);line-height:1.7;overflow-wrap:anywhere}.app-document h1{font-size:clamp(1.8rem,4vw,2.7rem);line-height:1.2}.app-document h2{margin-top:2rem}.app-document p,.app-document li{max-width:74ch}.app-document table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}.app-document td,.app-document th{padding:.65rem;border:1px solid var(--border)}.app-document pre{overflow:auto;padding:1rem;border:1px solid var(--border);border-radius:.6rem}.app-document a{text-underline-offset:.18em}.site-shell nav{flex-wrap:wrap}.site-shell nav a{min-height:2.2rem;display:inline-flex;align-items:center}@media(max-width:760px){.app-document{padding:1.25rem}.site-shell nav a{font-size:.78rem}}\n`;
