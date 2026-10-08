import { randomBytes, randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { appResponseHeaders } from '../../../deployment/app-policy.mjs';
import type { Graph } from '../../src/model/types';
import type { WorkspaceSecurityStatus } from '../../src/storage/security-status';

// Run only after the reviewed release has been deployed. All browser contexts
// below are fresh, disposable profiles; never use launchPersistentContext.
test.skip(process.env.VN_PRODUCTION_SMOKE !== '1', 'Explicit post-deployment opt-in required.');
const app = 'https://app.visualnerve.com';
const website = 'https://www.visualnerve.com';
const bridge = process.env.VN_PRODUCTION_BRIDGE_ORIGIN ?? 'http://127.0.0.1:4317';
if (
  ![
    'http://127.0.0.1:4317',
    'http://localhost:4317',
    'https://127.0.0.1:4317',
    'https://localhost:4317',
  ].includes(bridge)
)
  throw new Error('Production smoke requires an exact HTTP(S) loopback bridge on port 4317.');
// Chrome's normal local-network permission applies to the default loopback
// connection. No certificate, mixed-content or local-network bypass is enabled.
const socket = bridge.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/bridge';

interface ToolResult<T> {
  isError: boolean;
  structuredContent: { status: number; body: T };
}
interface GraphSummary {
  id: string;
  name: string;
}
function headers(actual: Record<string, string>) {
  for (const [name, value] of Object.entries(appResponseHeaders([4317])))
    expect(actual[name.toLowerCase()], `Live ${name} must match the reviewed app policy`).toBe(
      value,
    );
}

async function diagnostics(page: Page) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('Uncaught browser exception'));
  page.on('request', (request) => {
    const hostname = new URL(request.url()).hostname;
    if (
      /(?:^|\.)(?:googletagmanager\.com|google-analytics\.com|analytics\.google\.com)$/.test(
        hostname,
      )
    )
      unexpected.push('Analytics network request');
  });
  // Diagnostic event listener only: no HTML, styles, application state or pixels
  // are modified, and only directive names (never credential-bearing URLs) remain.
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, '__productionSmokeCsp', { value: violations });
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
  });
  return async () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, '__productionSmokeCsp'))).toEqual([]);
  };
}

// Prevent Playwright fill/action failure diagnostics from retaining even the
// disposable test passphrase. The enclosing finally also closes the context
// before any automatic error-context collection; trace/video/screenshots are off.
async function credentialAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error('Disposable credential action failed; credential diagnostics were suppressed.');
  }
}
async function createVault(page: Page, password: string) {
  await expect(
    page.getByRole('dialog', { name: 'Protect your local workspace', exact: true }),
  ).toBeVisible();
  await credentialAction(async () => {
    await page.getByLabel('New workspace password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
    // Never read, log, screenshot or download this disposable recovery key.
    await page.getByLabel('I have saved my recovery key in a protected location.').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  });
  await page.getByLabel('I accept local storage and offline caching', { exact: true }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Your work stays in this browser', exact: true }),
  ).toBeHidden();
}
async function unlock(page: Page, password: string, title: string) {
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await credentialAction(async () => {
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  });
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByLabel('MCP access', { exact: true })).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function rpc(request: APIRequestContext, method: string, params: unknown) {
  const response = await request.post('/mcp', {
    headers: {
      'MCP-Protocol-Version': '2025-11-25',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: randomUUID(), method, params },
  });
  expect(response.status()).toBe(200);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}
async function call<T>(
  request: APIRequestContext,
  workspaceId: string,
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<ToolResult<T>> {
  return rpc(request, 'tools/call', {
    name: 'visual_nerve_request',
    arguments: { workspaceId, path, method, ...(data === undefined ? {} : { data }) },
  }) as Promise<ToolResult<T>>;
}
async function body<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status()).toBe(status);
  return response.json() as Promise<T>;
}

test('live encrypted app saves and reloads offline, then enforces the same human grants and lock through UI/API/MCP', async ({
  browser,
  playwright,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: false, locale: 'en-US' });
  const page = await context.newPage();
  const control = await playwright.request.newContext({
    baseURL: bridge,
    ignoreHTTPSErrors: false,
  });
  let privateApi: APIRequestContext | undefined;
  let networkPermission: CDPSession | undefined;
  let password = `Disposable live verification ${randomBytes(24).toString('base64url')}`;
  const title = `Production smoke ${randomUUID()}`;
  try {
    // A dedicated empty bridge is mandatory. Never dispatch an unscoped private
    // command to an existing browser; every later private command pins our own ID.
    expect(
      (await body<{ connected: number }>(await control.get('/api/v1/health'))).connected,
      'Start a separate empty 4317 bridge; existing browser work must not be inspected',
    ).toBe(0);
    const initialized = await rpc(control, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'visualnerve-production-smoke', version: '1' },
    });
    expect(initialized.protocolVersion).toBe('2025-11-25');
    const docs = await rpc(control, 'tools/call', {
      name: 'visual_nerve_api_docs',
      arguments: { document: 'guide' },
    });
    expect(docs.isError).not.toBe(true);
    const clean = await diagnostics(page);
    const response = await page.goto(app);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).origin).toBe(app);
    headers(response!.headers());
    await expect(page.locator('meta[name="visualnerve-surface"]')).toHaveAttribute(
      'content',
      'isolated-app',
    );
    await expect(page.locator('meta[name="visualnerve-vault-required"]')).toHaveAttribute(
      'content',
      'true',
    );
    await expect(page.locator('meta[name="visualnerve-app-origin"]')).toHaveAttribute(
      'content',
      app,
    );
    expect(
      await page
        .locator('script[src*="consent"],script[src*="klaro"],script[src*="googletagmanager"]')
        .count(),
    ).toBe(0);
    await createVault(page, password);
    await page
      .getByRole('button', { name: /New diagram/ })
      .first()
      .click();
    await page.getByLabel('New diagram name', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
    await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await saved(page);
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    const protection = await credentialAction(() =>
      page.evaluate(
        async ({ title, password }) => {
          const names = (await indexedDB.databases()).map((database) => database.name);
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const open = indexedDB.open('visual-nerve-vault');
            open.onerror = () => reject(new Error('Disposable vault read failed'));
            open.onsuccess = () => {
              const db = open.result;
              const request = db.transaction('records', 'readonly').objectStore('records').getAll();
              request.onerror = () => {
                db.close();
                reject(new Error('Disposable vault read failed'));
              };
              request.onsuccess = () => {
                db.close();
                resolve(request.result);
              };
            };
          });
          const serialized = JSON.stringify(records);
          return {
            hasVault: names.includes('visual-nerve-vault'),
            hasPlaintextDatabase: names.includes('visual-nerve-cache'),
            hasRecords: records.length > 0,
            readableTitle: serialized.includes(title),
            readablePassword: serialized.includes(password),
          };
        },
        { title, password },
      ),
    );
    expect(protection).toEqual({
      hasVault: true,
      hasPlaintextDatabase: false,
      hasRecords: true,
      readableTitle: false,
      readablePassword: false,
    });
    await clean();
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeHidden();
    await unlock(page, password, title);
    await saved(page);
    const persistedRoot = page
      .locator('.canvas-shell [data-testid="graph-node"]')
      .filter({ has: page.getByText(title, { exact: true }) });
    await expect(persistedRoot).toHaveCount(1);
    const rootId = await persistedRoot.getAttribute('data-node-id');
    expect(rootId).toMatch(/^[\da-f-]{36}$/i);
    // Consent must activate and control the real production service worker.
    // Offline reload must still require human unlock of the same saved vault;
    // no bridge grant or worker/cache fixture is used to make it available.
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await navigator.serviceWorker.getRegistration())?.active?.state,
          ),
        { timeout: 60000 },
      )
      .toBe('activated');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60000 })
      .toBe(true);
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeHidden();
      await unlock(page, password, title);
      await expect(page.locator(`.canvas-shell [data-node-id="${rootId}"]`)).toContainText(title);
      await saved(page);
      await clean();
    } finally {
      await context.setOffline(false);
    }
    await settings(page);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await page.getByText('Storage details', { exact: true }).click();
    const workspaceId = (
      await page
        .getByText('Workspace ID', { exact: true })
        .locator('xpath=following-sibling::dd[1]')
        .innerText()
    ).trim();
    expect(workspaceId).toMatch(/^[\da-f-]{36}$/i);
    privateApi = await playwright.request.newContext({
      baseURL: bridge,
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { 'X-Visual-Nerve-Workspace': workspaceId },
    });
    await page.getByText('Local connection details', { exact: true }).click();
    await page.getByLabel('Local bridge address', { exact: true }).fill(socket);
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(`${bridge}/mcp`);
    const targetSession = await context.newCDPSession(page);
    let browserContextId: string | undefined;
    try {
      browserContextId = (await targetSession.send('Target.getTargetInfo')).targetInfo
        .browserContextId;
    } finally {
      await targetSession.detach();
    }
    if (!browserContextId)
      throw new Error('Loopback permission requires the fresh disposable browser context.');
    // Accept Chrome's normal loopback permission only for this exact app origin
    // and disposable profile. The separate application MCP grant is still chosen
    // through Settings below; TLS, CSP and network protections remain enabled.
    // Keep this CDP session until context close: detaching resets its overrides.
    networkPermission = await browser.newBrowserCDPSession();
    await networkPermission.send('Browser.setPermission', {
      permission: { name: 'loopback-network' },
      setting: 'granted',
      origin: app,
      embeddedOrigin: app,
      browserContextId,
    });
    expect(
      await page.evaluate(async () => {
        const permission = await navigator.permissions.query({
          name: 'loopback-network' as PermissionName,
        });
        return permission.state;
      }),
    ).toBe('granted');
    await page.getByLabel('MCP access', { exact: true }).selectOption('read');
    await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
    await expect.poll(async () => (await privateApi!.get('/api/v1/diagrams')).status()).toBe(200);
    const status = await body<WorkspaceSecurityStatus>(
      await privateApi.get('/api/v1/workspace/security'),
    );
    expect(status).toMatchObject({
      mode: 'encrypted',
      state: 'unlocked',
      cipher: 'AES-256-GCM',
      programmaticUnlock: false,
      requestsRenewIdleTimeout: false,
    });
    expect(
      (await call<WorkspaceSecurityStatus>(privateApi, workspaceId, '/workspace/security'))
        .structuredContent.body,
    ).toEqual(status);
    const summaries = await body<GraphSummary[]>(await privateApi.get('/api/v1/diagrams'));
    const diagram = summaries.find((entry) => entry.name === title);
    expect(diagram).toBeDefined();
    expect(
      (await call<GraphSummary[]>(privateApi, workspaceId, '/diagrams')).structuredContent.body,
    ).toEqual(summaries);
    expect(
      (await call(privateApi, workspaceId, '/workspace/lock', 'POST', {})).structuredContent.status,
    ).toBe(403);
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await expect
      .poll(
        async () => (await call(privateApi!, workspaceId, '/diagrams')).structuredContent.status,
      )
      .toBe(200);
    const added = await call<{ id: string }>(
      privateApi,
      workspaceId,
      `/diagrams/${diagram!.id}/nodes`,
      'POST',
      { title: 'Production verification node', x: 100, y: 400 },
    );
    expect(added.structuredContent.status).toBe(201);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(`[data-node-id="${added.structuredContent.body.id}"]`)).toContainText(
      'Production verification node',
    );
    await saved(page);
    const apiGraph = await body<Graph>(await privateApi.get(`/api/v1/diagrams/${diagram!.id}`));
    const mcpGraph = await call<Graph>(privateApi, workspaceId, `/diagrams/${diagram!.id}`);
    expect(mcpGraph.structuredContent.body).toEqual(apiGraph);
    const locked = await call<WorkspaceSecurityStatus>(
      privateApi,
      workspaceId,
      '/workspace/lock',
      'POST',
      {},
    );
    expect(locked.structuredContent.status).toBe(200);
    expect(locked.structuredContent.body.state).toBe('locked');
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    const deniedApi = await body<{ code: string }>(await privateApi.get('/api/v1/diagrams'), 423);
    const deniedMcp = await call<{ code: string }>(privateApi, workspaceId, '/diagrams');
    expect(deniedMcp.structuredContent.status).toBe(423);
    expect(deniedMcp.structuredContent.body.code).toBe('WORKSPACE_LOCKED');
    expect(deniedApi.code).toBe('WORKSPACE_LOCKED');
    expect(
      (await call<WorkspaceSecurityStatus>(privateApi, workspaceId, '/workspace/security'))
        .structuredContent.body.state,
    ).toBe('locked');
    await unlock(page, password, title);
    expect((await privateApi.get('/api/v1/diagrams')).status()).toBe(403);
    expect((await call(privateApi, workspaceId, '/diagrams')).structuredContent.status).toBe(403);
    await settings(page);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await page.getByLabel('MCP access', { exact: true }).selectOption('read');
    await expect.poll(async () => (await privateApi!.get('/api/v1/diagrams')).status()).toBe(200);
    const preserved = await body<Graph>(await privateApi.get(`/api/v1/diagrams/${diagram!.id}`));
    expect(preserved.nodes.some((node) => node.id === added.structuredContent.body.id)).toBe(true);
    await page.getByLabel('MCP access', { exact: true }).selectOption('off');
    await expect.poll(async () => (await privateApi!.get('/api/v1/diagrams')).status()).toBe(503);
    await clean();
  } finally {
    password = '';
    await context.close();
    await networkPermission?.detach();
    await privateApi?.dispose();
    await control.dispose();
  }
});

test('live app Help/API render under CSP, unknown routes are 404, and www legacy entry remains accessible', async ({
  browser,
  playwright,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: false, locale: 'en-US' });
  const page = await context.newPage();
  const request = await playwright.request.newContext({ ignoreHTTPSErrors: false });
  try {
    const clean = await diagnostics(page);
    for (const path of ['/help/', '/help/settings/', '/api/docs/']) {
      const response = await page.goto(`${app}${path}`);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).origin).toBe(app);
      headers(response!.headers());
      if (path.startsWith('/api/')) await expect(page.locator('.swagger-ui')).toBeVisible();
      else await expect(page.locator('main')).toBeVisible();
      await clean();
    }
    for (const path of [
      `/missing-production-verification-${randomUUID()}/`,
      `/editor/assets/missing-${randomUUID()}.js`,
    ]) {
      const missing = await request.get(`${app}${path}`);
      expect(missing.status()).toBe(404);
    }
    // Path-style HTTPS uses S3's real certificate even for this dotted bucket.
    const directS3 = await request.get(
      'https://s3.us-east-1.amazonaws.com/app.visualnerve.com/index.html',
    );
    expect(directS3.status()).toBe(403);
    // Fetch static HTML only: do not execute the legacy app or open any old-origin
    // IndexedDB. A disposable request context has no existing user browser profile.
    const legacy = await request.get(`${website}/app/`);
    expect(legacy.status()).toBe(200);
    expect(new URL(legacy.url()).origin).toBe(website);
    expect(new URL(legacy.url()).pathname).toBe('/app/');
    expect(await legacy.text()).toMatch(/id="visual-nerve"/);
  } finally {
    await context.close();
    await request.dispose();
  }
});
