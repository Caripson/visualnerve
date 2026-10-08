// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { requireAppApproval } from '../../deployment/require-app-approval.mjs';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-app-surface-'));
  temporary.push(directory);
  const source = join(directory, 'public'),
    output = join(directory, 'public-app');
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), value);
  };
  const header =
    '<header class="site-shell"><a class="site-brand" href="/"><span class="brand-symbol">⌘</span><b>Visual Nerve</b></a><nav><a href="/features/">Features</a></nav></header>';
  const shell = (body: string) =>
    `<!doctype html><html><head><title>Source · Visual Nerve</title><meta name="visualnerve-google-analytics" content="G-TEST1234"><script src="/site/consent.js"></script></head><body>${header}${body}</body></html>`;
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
  put('editor/speech/ort-wasm.wasm', 'local WASM');
  put('editor/speech/piper_phonemize.wasm', 'local phonemizer');
  put('editor/speech/piper_phonemize.data', 'local pronunciations');
  put(
    'help/index.html',
    shell(
      '<main class="help-main"><a href="/mcp/">Bridge setup</a><a href="/help/editing/">Editing</a></main>',
    ),
  );
  put('help/editing/index.html', shell('<main class="help-main"><h1>Editing</h1></main>'));
  put('help/help.js', 'window.localHelp = true;');
  put('help/help.css', '.help-main{}');
  put('help/index.json', '{"guides":[]}');
  put('help/images/editor.webp', 'approved screenshot');
  put('site/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
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

it('prepares a separate app root, editable alias and local documentation without marketing or consent executables', async () => {
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
  expect(readFileSync(join(output, 'app/index.html'), 'utf8')).toBe(html);
  expect(html).not.toMatch(/visualnerve-google-analytics|consent\.js|klaro|Marketing|\/features\//);
  expect(prepared.files).not.toContain('site/site.js');
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
  expect(worker).toContain('/editor/speech/piper_phonemize.wasm');
  expect(worker).not.toMatch(/site\/consent|vendor\/klaro|\/features\//);
  expect(readFileSync(join(output, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
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
  expect(csp).toContain('wss://127.0.0.1:4317/bridge');
  expect(csp).toContain('ws://localhost:4317/bridge');
  expect(csp).not.toContain('[::1]');
  expect(csp).toContain('https://us.aws.cdn.hf.co');
  expect(csp).not.toMatch(/'unsafe-eval'|google|klaro|https:\s|wss:\s|:\*|https:\/\/\*/);
  expect(appContentSecurityPolicy([9443])).toContain('wss://localhost:9443/bridge');
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

it('keeps the current website deployment unchanged while attaching app-only security headers to a separate stack', () => {
  expect(template.Parameters.CanonicalDomain.Default).toBe('');
  expect(template.Resources.AppHeaders).toBeUndefined();
  expect(appTemplate.Parameters.CanonicalDomain.Default).toBe('app.visualnerve.com');
  expect(appTemplate.Parameters.BucketName.Default).toBe('');
  expect(
    appTemplate.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior
      .ResponseHeadersPolicyId,
  ).toEqual({ Ref: 'AppHeaders' });
  const headers = appTemplate.Resources.AppHeaders.Properties.ResponseHeadersPolicyConfig;
  expect(
    headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy['Fn::Sub'],
  ).toContain('localhost:${BridgePort}/bridge');
  expect(headers.SecurityHeadersConfig.StrictTransportSecurity.Preload).toBe(false);
  expect(headers.SecurityHeadersConfig.FrameOptions.FrameOption).toBe('DENY');
  expect(headers.CorsConfig).toBeUndefined();
  expect(
    appTemplate.Resources.AppBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,
  ).toBe(true);
});

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
