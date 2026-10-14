// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildAppSurface, auditAppSurface } from '../../scripts/build-app-surface.mjs';
import {
  appContentSecurityPolicy,
  appResponseHeaders,
  appSurfaceOptions,
} from '../../deployment/app-policy.mjs';
import { appTemplate } from '../../deployment/app-template.mjs';
import { template } from '../../deployment/template.mjs';
import { spawnSync } from 'node:child_process';
import { requireAppApproval } from '../../deployment/require-app-approval.mjs';
import { SITE_ICON_FILES } from '../../scripts/site-icons.mjs';
import { fingerprintAssets } from '../../scripts/fingerprinted-assets.mjs';

const temporary: string[] = [];
const helpGuideNames = readdirSync(new URL('../../hugo/content/help/', import.meta.url))
  .filter((name) => name.endsWith('.md') && name !== '_index.md')
  .map((name) => name.slice(0, -3))
  .sort();
afterEach(() =>
  temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-app-surface-'));
  temporary.push(directory);
  const source = join(directory, 'public'),
    output = join(directory, 'public-app');
  const put = (path: string, value: string | Buffer) => {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), value);
  };
  const header =
    '<header class="site-shell"><a class="site-brand" href="/"><span class="brand-symbol">⌘</span><b>Visual Nerve</b></a><nav><a href="/features/">Features</a></nav></header>';
  const shell = (body: string) =>
    `<!doctype html><html><head><title>Source · Visual Nerve</title><meta name="visualnerve-google-analytics" content="G-TEST1234"><script src="/site/consent.js"></script><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Public marketing"}</script></head><body>${header}${body}</body></html>`;
  put('index.html', shell('<main>Marketing homepage</main>'));
  put(
    'app/index.html',
    shell('<div id="visual-nerve"><noscript>Enable JavaScript</noscript></div>'),
  );
  put('error.html', shell('<main>Marketing error page</main>'));
  put('sw.js', '/* old mixed public shell must not be copied */');
  put('appearance.js', 'window.appearance = true;');
  put('editor/app.js', 'import "./assets/worker-example.js";');
  put('editor/app.css', '.site-shell{}');
  put('editor/assets/worker-example.js', 'export const localWorker = true;');
  put('editor/assets/mls_bg-testhash.wasm', 'checked compiled MLS module');
  put('editor/speech/ort-wasm.wasm', 'local WASM');
  put('editor/speech/piper_phonemize.wasm', 'local phonemizer');
  put('editor/speech/piper_phonemize.data', 'local pronunciations');
  put(
    'help/index.html',
    shell(
      `<main class="help-main"><a href="/mcp/">Bridge setup</a>${helpGuideNames
        .map((name) => `<a href="/help/${name}/">${name}</a>`)
        .join('')}</main>`,
    ),
  );
  for (const name of helpGuideNames)
    put(`help/${name}/index.html`, shell(`<main class="help-main"><h1>${name}</h1></main>`));
  put('help/help.js', 'window.localHelp = true;');
  put('help/help.css', '.help-main{}');
  put(
    'help/index.json',
    JSON.stringify({ guides: helpGuideNames.map((name) => ({ url: `/help/${name}/` })) }),
  );
  put('help/images/editor.webp', 'approved screenshot');
  put('site/mark.svg', readFileSync(new URL('../../hugo/static/site/mark.svg', import.meta.url)));
  for (const name of SITE_ICON_FILES)
    put(name, readFileSync(new URL(`../../hugo/static/${name}`, import.meta.url)));
  put('site/syntax.css', '.highlight{}');
  put('site/site.js', 'window.marketing = true;');
  put('site/consent.js', 'window.gtag = () => {};');
  put('site/vendor/klaro.js', 'window.klaro = {};');
  for (const policy of ['privacy', 'license', 'security'])
    put(
      `${policy}/index.html`,
      shell(
        `<h1>${policy}</h1><article class="product-article"><p>Policy text</p><a href="/developers/">Product reference</a></article>`,
      ),
    );
  for (const page of ['features', 'use-cases', 'process-simulator', 'mcp', 'developers'])
    put(`${page}/index.html`, shell('<main>Marketing</main>'));
  put('openapi.yaml', '{"info":{"version":"test"},"paths":{}}');
  put('api/docs/index.html', shell('<main id="swagger-ui"></main>'));
  put('api/docs/docs.js', 'window.localDocs = true;');
  put('api/docs/docs.css', '.api-reference{}');
  put('swagger/swagger-ui-bundle.js', 'window.SwaggerUIBundle = () => {};');
  put('swagger/swagger-ui.css', '.swagger-ui{}');
  put('licenses/visualnerve-LICENSE', 'MPL-2.0');
  put('licenses/inventory.json', '[]');
  return { directory, source, output, put };
}

it('prepares a single app root and local documentation without legacy alias, marketing or consent executables', async () => {
  const { source, output } = fixture();
  const original = readFileSync(join(source, 'app/index.html'), 'utf8');
  const prepared = await buildAppSurface(source, output);
  expect(auditAppSurface(output)).toEqual(prepared.files);
  expect(readFileSync(join(source, 'app/index.html'), 'utf8')).toBe(original);
  expect(readFileSync(join(source, 'sw.js'), 'utf8')).toContain('old mixed public shell');
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  expect(html).toContain('<div id="visual-nerve">');
  expect(html).toContain('<meta name="visualnerve-vault-required" content="true">');
  expect(html).toContain(
    '<meta name="visualnerve-app-origin" content="https://app.visualnerve.com">',
  );
  expect(html).toContain('type="module" src="/editor/app.js"');
  expect(html).toContain('<nav id="workspace-site-nav"');
  expect(html).toContain('data-app-chrome-text="guide"');
  expect(html).toContain('data-app-chrome-text="privacy"');
  expect(html).toContain('class="github-link"');
  expect(html).toContain('data-app-chrome-label="reportIssue"');
  expect(html).not.toMatch(/workspace-menu-toggle|workspace-navigation\.js/);
  expect(prepared.files).not.toContain('app/index.html');
  expect(html).not.toMatch(/visualnerve-google-analytics|consent\.js|klaro|Marketing|\/features\//);
  expect(prepared.files).not.toContain('site/site.js');
  expect(prepared.files).not.toContain('workspace-navigation.js');
  for (const path of [
    'site/consent.js',
    'site/vendor/klaro.js',
    'features/index.html',
    'mcp/index.html',
    'developers/index.html',
  ])
    expect(prepared.files).not.toContain(path);
  const help = readFileSync(join(output, 'help/index.html'), 'utf8');
  expect(help).toContain(
    'href="https://www.visualnerve.com/mcp/" target="_blank" rel="noopener noreferrer"',
  );
  expect(help).toContain('href="/help/editing/"');
  expect(help).not.toContain('visualnerve-google-analytics');
  const api = readFileSync(join(output, 'api/docs/index.html'), 'utf8');
  expect(api).toContain('src="/swagger/swagger-ui-bundle.js"');
  expect(api).toContain('<main id="swagger-ui">');
  expect(api).not.toContain('consent.js');
  const worker = readFileSync(join(output, 'sw.js'), 'utf8');
  expect(worker).toMatch(/visual-nerve-app-shell-[a-f0-9]{12}/);
  expect(worker).toContain('/api/docs/');
  expect(worker).toContain('/editor/assets/worker-example.js');
  expect(worker).toContain('/editor/assets/mls_bg-testhash.wasm');
  expect(prepared.files).toContain('editor/assets/mls_bg-testhash.wasm');
  expect(JSON.parse(worker.match(/^const assets = (.*);$/m)![1])).not.toContain(
    '/editor/assets/mls_bg-testhash.wasm',
  );
  expect(JSON.parse(worker.match(/^const lazyAssets = (.*);$/m)![1])).toContain(
    '/editor/assets/mls_bg-testhash.wasm',
  );
  expect(worker).toContain('/editor/speech/piper_phonemize.wasm');
  expect(worker).not.toMatch(/site\/consent|vendor\/klaro|\/features\//);
  expect(readFileSync(join(output, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
});

it('copies every current Help guide with matching search, navigation and offline routes', async () => {
  const { source, output } = fixture();
  expect(helpGuideNames).toHaveLength(26);
  const prepared = await buildAppSurface(source, output);
  expect(prepared.files.filter((path) => /^help\/[^/]+\/index\.html$/.test(path))).toEqual(
    helpGuideNames.map((name) => `help/${name}/index.html`),
  );
  const index = JSON.parse(readFileSync(join(output, 'help/index.json'), 'utf8'));
  const navigation = readFileSync(join(output, 'help/index.html'), 'utf8');
  const worker = readFileSync(join(output, 'sw.js'), 'utf8');
  const offlineRoutes = JSON.parse(worker.match(/^const assets = (.*);$/m)![1]);
  expect(index.guides.map((guide: { url: string }) => guide.url).sort()).toEqual(
    helpGuideNames.map((name) => `/help/${name}/`),
  );
  for (const name of helpGuideNames) {
    expect(navigation).toContain(`href="/help/${name}/"`);
    expect(offlineRoutes).toContain(`/help/${name}/`);
  }
});

it('keeps homepage infrastructure CSS, frames and screenshots outside the private app package', async () => {
  const { source, output } = fixture();
  const assets = [
    'site/infrastructure.css',
    'site/devices/infrastructure-monitor.svg',
    'site/devices/infrastructure-peripherals.svg',
    ...['api', 'network', 'energy', 'datacenter'].flatMap((name) => [
      `site/images/infrastructure-${name}.webp`,
      `site/images/infrastructure-${name}-dark.webp`,
    ]),
  ];
  for (const path of assets) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), 'Synthetic public marketing fixture');
  }
  const prepared = await buildAppSurface(source, output);
  expect(prepared.files).not.toEqual(expect.arrayContaining(assets));
  for (const path of assets) {
    expect(prepared.files).not.toContain(path);
    mkdirSync(dirname(join(output, path)), { recursive: true });
    writeFileSync(join(output, path), 'Unexpected marketing asset');
    expect(() => auditAppSurface(output)).toThrow('Unexpected file in isolated app surface');
    rmSync(join(output, path));
  }
});

it('publishes the source-derived icons on every isolated app route and caches their real bytes', async () => {
  const { source, output } = fixture();
  const prepared = await buildAppSurface(source, output);
  const worker = readFileSync(join(output, 'sw.js'), 'utf8');
  const cached = JSON.parse(worker.match(/^const assets = (.*);$/m)![1]);
  for (const name of SITE_ICON_FILES) {
    expect(prepared.files).toContain(name);
    expect(readFileSync(join(output, name))).toEqual(readFileSync(join(source, name)));
    expect(cached).toContain(`/${name}`);
  }
  for (const route of ['index.html', 'help/index.html', 'api/docs/index.html', 'error.html']) {
    const html = readFileSync(join(output, route), 'utf8');
    expect(html).not.toContain('application/ld+json');
    expect(html).toContain('href="/favicon.ico" type="image/x-icon"');
    expect(html).toContain('href="/favicon-96x96.png" type="image/png" sizes="96x96"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"');
  }
  rmSync(join(output, 'favicon.ico'));
  expect(() => auditAppSurface(output)).toThrow('App surface is missing favicon.ico');
});

it('copies and caches both compact simulator Help captures and their verified fingerprints', async () => {
  const { source, output, put } = fixture();
  for (const suffix of ['', '-dark'])
    put(`help/images/simulation-compact${suffix}.webp`, `compact ${suffix} synthetic fixture`);
  put(
    'help/simulation/index.html',
    readFileSync(join(source, 'help/simulation/index.html'), 'utf8').replace(
      '</main>',
      '<picture data-appearance-image><source srcset="/help/images/simulation-compact-dark.webp" media="(prefers-color-scheme: dark)"><img src="/help/images/simulation-compact.webp" alt="Collapsed simulator controls"></picture></main>',
    ),
  );
  const mapping = fingerprintAssets(source);
  const prepared = await buildAppSurface(source, output);
  expect(auditAppSurface(output)).toEqual(prepared.files);
  const worker = readFileSync(join(output, 'sw.js'), 'utf8');
  const cached = JSON.parse(worker.match(/^const assets = (.*);$/m)![1]);
  const guide = readFileSync(join(output, 'help/simulation/index.html'), 'utf8');
  for (const suffix of ['', '-dark']) {
    const stable = `/help/images/simulation-compact${suffix}.webp`,
      fingerprint = mapping.get(stable)!;
    for (const path of [stable, fingerprint]) {
      expect(prepared.files).toContain(path.slice(1));
      expect(readFileSync(join(output, path))).toEqual(readFileSync(join(source, path)));
    }
    expect(cached).toContain(fingerprint);
    expect(guide).toContain(fingerprint);
  }
});

it('upgrades an icon-free prior output while requiring icons in the replacement package', async () => {
  const { source, output } = fixture();
  await buildAppSurface(source, output);
  for (const name of SITE_ICON_FILES) rmSync(join(output, name));
  expect(() => auditAppSurface(output)).toThrow('App surface is missing favicon.ico');
  const prepared = await buildAppSurface(source, output);
  expect(prepared.files).toEqual(auditAppSurface(output));
  for (const name of SITE_ICON_FILES) expect(prepared.files).toContain(name);
});

it('rejects any missing guide and refuses to promote an incomplete new package', async () => {
  const { source, output } = fixture();
  await buildAppSurface(source, output);
  for (const name of helpGuideNames) {
    const path = join(output, `help/${name}/index.html`);
    const html = readFileSync(path, 'utf8');
    rmSync(path);
    expect(() => auditAppSurface(output)).toThrow(`App surface is missing help/${name}/index.html`);
    writeFileSync(path, html);
  }
  const original = readFileSync(join(output, 'app-surface.json'), 'utf8');
  rmSync(join(source, 'help/flowchart-symbols/index.html'));
  await expect(buildAppSurface(source, output)).rejects.toThrow(
    'App surface is missing help/flowchart-symbols/index.html',
  );
  expect(readFileSync(join(output, 'app-surface.json'), 'utf8')).toBe(original);
  expect(auditAppSurface(output)).toContain('help/flowchart-symbols/index.html');
});

it('rejects Help search and navigation inventories that disagree with the packaged guides', async () => {
  const { source, output } = fixture();
  await buildAppSurface(source, output);
  const indexPath = join(output, 'help/index.json');
  const originalIndex = readFileSync(indexPath, 'utf8');
  const index = JSON.parse(originalIndex);
  index.guides.pop();
  writeFileSync(indexPath, JSON.stringify(index));
  expect(() => auditAppSurface(output)).toThrow('App Help search index does not match');
  index.guides.push({ url: '/help/unreviewed-guide/' });
  writeFileSync(indexPath, JSON.stringify(index));
  expect(() => auditAppSurface(output)).toThrow('App Help search index does not match');
  writeFileSync(indexPath, originalIndex);
  const navigationPath = join(output, 'help/index.html');
  const navigation = readFileSync(navigationPath, 'utf8');
  writeFileSync(navigationPath, navigation.replace('href="/help/ibm-flowcharting/"', 'href="/"'));
  expect(() => auditAppSurface(output)).toThrow(
    'App Help navigation is missing /help/ibm-flowcharting/',
  );
  writeFileSync(
    navigationPath,
    navigation.replace('</main>', '<a href="/help/unreviewed-guide/">Unreviewed</a></main>'),
  );
  expect(() => auditAppSurface(output)).toThrow(
    'App Help navigation refers to an unavailable guide',
  );
});

it('safely upgrades a previous 17-guide package without relaxing publication or destination safety', async () => {
  const { source, output } = fixture();
  await buildAppSurface(source, output);
  for (const name of [
    'time-series-analysis',
    'ibm-flowcharting',
    'flowchart-symbols',
    'notation-collections',
    'hipo',
    'dfd',
    'uml',
    'bpmn',
    'infrastructure-capacity',
  ])
    rmSync(join(output, `help/${name}`), { recursive: true });
  expect(() => auditAppSurface(output)).toThrow(
    'App surface is missing help/time-series-analysis/index.html',
  );
  const editingPath = join(output, 'help/editing/index.html');
  const editing = readFileSync(editingPath, 'utf8');
  rmSync(editingPath);
  await expect(buildAppSurface(source, output)).rejects.toThrow(
    'App surface is missing help/editing/index.html',
  );
  writeFileSync(editingPath, editing);
  writeFileSync(join(output, 'personal.txt'), 'keep this');
  await expect(buildAppSurface(source, output)).rejects.toThrow('Unexpected file');
  expect(readFileSync(join(output, 'personal.txt'), 'utf8')).toBe('keep this');
  rmSync(join(output, 'personal.txt'));
  const next = await buildAppSurface(source, output);
  expect(next.files.filter((path) => /^help\/[^/]+\/index\.html$/.test(path))).toHaveLength(26);
  expect(auditAppSurface(output)).toEqual(next.files);
});

it('builds from a retired production website and safely replaces a previously audited app alias without publishing it again', async () => {
  const { source, output } = fixture();
  rmSync(join(source, 'app'), { recursive: true });
  const first = await buildAppSurface(source, output);
  expect(first.files).not.toContain('app/index.html');
  const root = readFileSync(join(output, 'index.html'), 'utf8');
  mkdirSync(join(output, 'app'));
  writeFileSync(join(output, 'app/index.html'), root);
  expect(() => auditAppSurface(output)).toThrow('Unexpected file');
  const next = await buildAppSurface(source, output);
  expect(next.files).not.toContain('app/index.html');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe(root);
  expect(() => readFileSync(join(source, 'app/index.html'))).toThrow();
});

it('rejects unexpected outputs and never replaces a directory containing unrelated files', async () => {
  const { source, output } = fixture();
  mkdirSync(output);
  writeFileSync(join(output, 'personal.txt'), 'keep this');
  await expect(buildAppSurface(source, output)).rejects.toThrow();
  expect(readFileSync(join(output, 'personal.txt'), 'utf8')).toBe('keep this');
  rmSync(output, { recursive: true });
  await buildAppSurface(source, output);
  writeFileSync(join(output, 'site/consent.js'), 'window.gtag = () => {};');
  expect(() => auditAppSurface(output)).toThrow('Unexpected file');
});

it('rejects unreviewed WASM names while copying the exact hashed MLS asset family', async () => {
  const { source, output, put } = fixture();
  put('editor/assets/unreviewed-testhash.wasm', 'not an approved module family');
  await expect(buildAppSurface(source, output)).rejects.toThrow('Unexpected file in static bundle');
  rmSync(join(source, 'editor/assets/unreviewed-testhash.wasm'));
  const prepared = await buildAppSurface(source, output);
  expect(prepared.files).toContain('editor/assets/mls_bg-testhash.wasm');
  expect(readFileSync(join(output, 'editor/assets/mls_bg-testhash.wasm'), 'utf8')).toBe(
    'checked compiled MLS module',
  );
});

it('rejects weakened HTML policy and analytics hidden inside otherwise allowed files', async () => {
  const { source, output } = fixture();
  await buildAppSurface(source, output, { bridgePorts: [9443] });
  const path = join(output, 'index.html');
  const original = readFileSync(path, 'utf8');
  expect(original).toContain('wss://localhost:9443/bridge');
  writeFileSync(path, original.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
  expect(() => auditAppSurface(output)).toThrow('App meta security policy');
  writeFileSync(
    path,
    original.replace(
      '</head>',
      '<meta name="visualnerve-google-analytics" content="G-TEST1234"></head>',
    ),
  );
  expect(() => auditAppSurface(output)).toThrow('Analytics configuration');
  writeFileSync(path, original);
  writeFileSync(join(output, 'editor/assets/worker-example.js'), 'window.gtag = () => {};');
  expect(() => auditAppSurface(output)).toThrow('Analytics/consent code');
});

it('rejects private exports, inline scripts and same-origin/symlink-overlapping output preparation', async () => {
  const { directory, source, output, put } = fixture();
  put('licenses/private.json', '{"format":"visual-nerve-workspace"}');
  await expect(buildAppSurface(source, output)).rejects.toThrow('User export');
  rmSync(join(source, 'licenses/private.json'));
  await expect(buildAppSurface(source, join(source, 'app-copy'))).rejects.toThrow('overlap');
  const alias = join(directory, 'source-alias');
  symlinkSync(source, alias, 'dir');
  await expect(buildAppSurface(source, join(alias, 'app-copy'))).rejects.toThrow('overlap');
  await expect(
    buildAppSurface(source, output, { appOrigin: 'https://www.visualnerve.com' }),
  ).rejects.toThrow('separate origin');
  await buildAppSurface(source, output);
  writeFileSync(
    join(output, 'index.html'),
    readFileSync(join(output, 'index.html'), 'utf8').replace(
      '</head>',
      '<script>alert("injected")</script></head>',
    ),
  );
  expect(() => auditAppSurface(output)).toThrow('Non-local or inline script');
});

it('allows only reviewed loopback bridge ports, local executable assets and fixed voice downloads in CSP', () => {
  const csp = appContentSecurityPolicy();
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(appSurfaceOptions().bridgePorts).toEqual([47417, 4317]);
  expect(csp).toContain('wss://127.0.0.1:47417/bridge');
  expect(csp).toContain('ws://localhost:47417/bridge');
  expect(csp).toContain('wss://127.0.0.1:4317/bridge');
  expect(csp).toContain('ws://localhost:4317/bridge');
  expect(csp).not.toContain('[::1]');
  expect(csp).toContain('https://us.aws.cdn.hf.co');
  expect(csp).not.toMatch(/'unsafe-eval'|google|klaro|https:\s|wss:\s|:\*|https:\/\/\*/);
  expect(appContentSecurityPolicy([9443])).toContain('wss://localhost:9443/bridge');
  expect(appContentSecurityPolicy([9443])).not.toContain(':47417/bridge');
  expect(appContentSecurityPolicy([4317])).not.toContain(':47417/bridge');
  expect(csp).not.toContain(':4318/bridge');
  expect(appContentSecurityPolicy([4317, 4318])).toContain('ws://127.0.0.1:4318/bridge');
  for (const ports of [[], [0], [-1], [65536], [1, 1]])
    expect(() => appContentSecurityPolicy(ports)).toThrow();
  expect(() =>
    appSurfaceOptions({
      appOrigin: 'https://app.visualnerve.com',
      websiteOrigin: 'https://app.visualnerve.com',
    }),
  ).toThrow('separate origin');
  const headers = appResponseHeaders();
  expect(headers['X-Frame-Options']).toBe('DENY');
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  expect(headers['Permissions-Policy']).toContain('microphone=()');
});

it('keeps collaboration disabled by default and pins one explicit HTTPS/WSS relay only when configured', async () => {
  const { source, output } = fixture();
  const origin = 'https://visual-nerve-collaboration.entis.workers.dev';
  await buildAppSurface(source, output);
  const disabled = readFileSync(join(output, 'index.html'), 'utf8');
  expect(disabled).not.toContain('visual-nerve-collaboration-relay');
  expect(disabled).not.toContain(origin);
  const prepared = await buildAppSurface(source, output, { collaborationRelayOrigin: origin });
  expect(prepared.files).toContain('help/collaboration/index.html');
  for (const path of ['index.html', 'help/collaboration/index.html', 'api/docs/index.html']) {
    const html = readFileSync(join(output, path), 'utf8');
    expect(html).toContain(`<meta name="visual-nerve-collaboration-relay" content="${origin}">`);
    expect(html).toContain(`${origin} ${origin.replace('https:', 'wss:')}`);
    expect(html).not.toContain('visualnerve-google-analytics');
  }
  const manifest = JSON.parse(readFileSync(join(output, 'app-surface.json'), 'utf8'));
  expect(manifest.collaborationRelayOrigin).toBe(origin);
  expect(manifest.bridgePorts).toEqual([47417, 4317]);
  expect(manifest.responseHeaders).toEqual(appResponseHeaders(undefined, origin));
  const directives = appContentSecurityPolicy(undefined, origin).split('; ');
  expect(directives.find((directive) => directive.startsWith('script-src '))).not.toContain(origin);
  expect(directives.find((directive) => directive.startsWith('connect-src '))).toContain(
    ` ${origin} `,
  );
  expect(readFileSync(join(source, 'help/collaboration/index.html'), 'utf8')).not.toContain(origin);
  expect(auditAppSurface(output)).toEqual(prepared.files);
});

it('rejects missing, duplicated or changed relay pins even when the package otherwise passes its audit', async () => {
  const { source, output } = fixture(),
    origin = 'https://relay.example.com';
  await buildAppSurface(source, output, { collaborationRelayOrigin: origin });
  const path = join(output, 'index.html'),
    original = readFileSync(path, 'utf8');
  const pin = `<meta name="visual-nerve-collaboration-relay" content="${origin}">`;
  for (const changed of [
    original.replace(pin, ''),
    original.replace(pin, pin + pin),
    original.replace(pin, pin.replace(origin, 'https://other.example.com')),
  ]) {
    writeFileSync(path, changed);
    expect(() => auditAppSurface(output)).toThrow('Collaboration relay configuration');
  }
  writeFileSync(path, original);
  const manifest = JSON.parse(readFileSync(join(output, 'app-surface.json'), 'utf8'));
  manifest.responseHeaders = appResponseHeaders();
  writeFileSync(join(output, 'app-surface.json'), JSON.stringify(manifest));
  expect(() => auditAppSurface(output)).toThrow('response-header policy');
});

it.each([
  '',
  'http://relay.example.com',
  'wss://relay.example.com',
  'https://relay.example.com/',
  'https://user:secret@relay.example.com',
  'https://relay.example.com/path',
  'https://relay.example.com?token=secret',
  'https://relay.example.com#secret',
  'https://*.example.com',
  ' https://relay.example.com',
  'https://relay.example.com;script-src',
])('rejects unsafe or nonexact deployment relay configuration %s', (origin) => {
  expect(() => appSurfaceOptions({ collaborationRelayOrigin: origin })).toThrow(
    'exact HTTPS origin',
  );
  expect(() => appResponseHeaders([4317], origin)).toThrow('exact HTTPS origin');
});

it('threads the public relay build variable through the CLI without changing the source website', () => {
  const { source, output } = fixture(),
    origin = 'https://relay.example.com';
  const script = new URL('../../scripts/build-app-surface.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, source, output], {
    encoding: 'utf8',
    env: { COLLABORATION_RELAY_ORIGIN: origin },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toContain(`content="${origin}"`);
  expect(readFileSync(join(source, 'help/index.html'), 'utf8')).not.toContain(origin);
});

it('keeps the current website deployment unchanged while attaching app-only security headers to a separate stack', () => {
  expect(template.Parameters.CanonicalDomain.Default).toBe('');
  expect(template.Resources.AppHeaders).toBeUndefined();
  expect(appTemplate.Parameters.CanonicalDomain.Default).toBe('app.visualnerve.com');
  expect(appTemplate.Parameters.BucketName.Default).toBe('');
  expect(appTemplate.Parameters.BridgePort.Default).toBe(47417);
  expect(
    appTemplate.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior
      .ResponseHeadersPolicyId,
  ).toEqual({ Ref: 'AppHeaders' });
  const headers = appTemplate.Resources.AppHeaders.Properties.ResponseHeadersPolicyConfig;
  const alternatives =
    headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy['Fn::If'];
  const csp = alternatives[2]['Fn::Sub'];
  expect(csp).toContain('localhost:${BridgePort}/bridge');
  expect(csp).toContain('localhost:4317/bridge');
  expect(csp.replaceAll('${BridgePort}', '47417')).toBe(appContentSecurityPolicy());
  expect(headers.SecurityHeadersConfig.StrictTransportSecurity.Preload).toBe(false);
  expect(headers.SecurityHeadersConfig.FrameOptions.FrameOption).toBe('DENY');
  expect(headers.CorsConfig).toBeUndefined();
  expect(
    appTemplate.Resources.AppBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,
  ).toBe(true);
});

it.each([47417, 4317, 9443])(
  'CloudFormation exports matching bridge ports and deduplicated CSP for primary port %s',
  (port) => {
    expect(appTemplate.Conditions.LegacyBridgePort).toEqual({
      'Fn::Equals': [{ Ref: 'BridgePort' }, '4317'],
    });
    const select = (value: { 'Fn::If': unknown[] }) => {
      const [condition, legacy, current] = value['Fn::If'];
      expect(condition).toBe('LegacyBridgePort');
      const selected = port === 4317 ? legacy : current;
      return typeof selected === 'string'
        ? selected
        : (selected as { 'Fn::Sub': string })['Fn::Sub'].replaceAll('${BridgePort}', String(port));
    };
    const ports = select(appTemplate.Outputs.AppBridgePorts.Value).split(',').map(Number);
    expect(ports).toEqual(port === 4317 ? [4317] : [port, 4317]);
    const headers = appTemplate.Resources.AppHeaders.Properties.ResponseHeadersPolicyConfig;
    const policy = select(
      headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
    );
    expect(policy).toBe(appContentSecurityPolicy(ports));
    const loopbacks = policy.match(/wss?:\/\/(?:127\.0\.0\.1|localhost):\d+\/bridge/g)!;
    expect(loopbacks).toHaveLength(ports.length * 4);
    expect(new Set(loopbacks).size).toBe(loopbacks.length);
  },
);

it('requires separate exact-commit app approval and verification before a future opt-in publication', () => {
  const sha = 'a'.repeat(40);
  const environment = {
    GITHUB_SHA: sha,
    GITHUB_REF: 'refs/heads/main',
    APP_SURFACE_APPROVED_SHA: sha,
    APP_SURFACE_STAGING_VERIFIED_SHA: sha,
    APP_S3_BUCKET: 'reviewed-app-bucket',
    APP_CLOUDFRONT_DISTRIBUTION_ID: 'E1234567890ABC',
  };
  expect(requireAppApproval(environment)).toBe(sha);
  for (const changed of [
    { GITHUB_REF: 'refs/heads/other' },
    { APP_SURFACE_APPROVED_SHA: 'b'.repeat(40) },
    { APP_SURFACE_STAGING_VERIFIED_SHA: '' },
    { APP_S3_BUCKET: 'www.visualnerve.com' },
    { APP_CLOUDFRONT_DISTRIBUTION_ID: '' },
  ])
    expect(() => requireAppApproval({ ...environment, ...changed })).toThrow();
});
