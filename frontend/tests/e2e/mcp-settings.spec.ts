import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { acknowledge } from './fixtures';

const settingsTrigger = 'Local only: storage and privacy';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: settingsTrigger, exact: true }).click();
  await expect(page.getByLabel('MCP access', { exact: true })).toBeVisible();
}

test('MCP automatically recovers from one temporary WebSocket constructor failure without reload', async ({
  page,
  request,
}) => {
  // Model a browser permission/security rejection once, then use the actual local socket.
  await page.addInitScript(() => {
    const original = window.WebSocket;
    const probe = { attempts: 0, failures: 0 };
    Object.defineProperty(window, '__mcpConstructorProbe', { value: probe });
    window.WebSocket = new Proxy(original, {
      construct(target, argumentsList) {
        if (new URL(String(argumentsList[0])).pathname === '/bridge') {
          probe.attempts++;
          if (probe.attempts === 1) {
            probe.failures++;
            throw new DOMException(
              'Temporary local connection permission failure',
              'SecurityError',
            );
          }
        }
        return Reflect.construct(target, argumentsList);
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await acknowledge(page);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await openSettings(page);
  const access = page.getByLabel('MCP access', { exact: true });
  await expect(access).toHaveValue('off');
  await connected(request, 0);
  await access.selectOption('read');
  await expect(page.getByText('MCP connection: Error', { exact: true })).toBeVisible();
  // No second setting change or page navigation is allowed to trigger recovery.
  await connected(request, 1);
  await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__mcpConstructorProbe'))).toEqual({
    attempts: 2,
    failures: 1,
  });
  await readAccess(request);
  await closeSettings(page);
  await openSettings(page);
  await expect(access).toHaveValue('read');
  await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
  expect(navigations).toBe(0);
  expect(errors).toEqual([]);
});

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByLabel('MCP access', { exact: true })).toBeHidden();
}

async function connected(request: APIRequestContext, count: number) {
  await expect
    .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
    .toBe(count);
}

async function mcp(request: APIRequestContext, path: string, method = 'GET', data?: unknown) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name: 'visual_nerve_request', arguments: { path, method, data } },
    },
  });
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}

async function readAccess(request: APIRequestContext) {
  const listed = await mcp(request, '/diagrams');
  expect(listed.isError).toBe(false);
  expect(listed.structuredContent.status).toBe(200);
  const denied = await mcp(request, '/diagrams', 'POST', {
    name: 'Read-only must reject this diagram',
    type: 'flowchart',
  });
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent.status).toBe(403);
}

async function writeAccess(request: APIRequestContext, name: string) {
  const created = await request.post('/api/v1/diagrams', {
    data: { name, type: 'flowchart' },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const stored = await mcp(request, `/diagrams/${diagram.id}`);
  expect(stored.isError).toBe(false);
  expect(stored.structuredContent.body.diagram.name).toBe(name);
  return diagram.id as string;
}

for (const origin of [
  {
    name: 'same-origin local app',
    app: 'http://127.0.0.1:4327/app/',
    service: 'http://127.0.0.1:4327',
    socket: 'ws://127.0.0.1:4327/bridge',
  },
  {
    name: 'public HTTPS app with local TLS bridge',
    app: 'https://public-app.test:4340/app/',
    service: 'https://127.0.0.1:4329',
    socket: 'wss://127.0.0.1:4329/bridge',
  },
]) {
  for (const initial of ['read', 'write'] as const) {
    test(`${origin.name}: MCP Off → ${initial} and later permission changes apply without reload`, async ({
      browser,
      playwright,
    }) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const request = await playwright.request.newContext({
        baseURL: origin.service,
        ignoreHTTPSErrors: true,
      });
      const sockets: string[] = [],
        errors: string[] = [];
      page.on('websocket', (socket) => sockets.push(socket.url()));
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(origin.app);
        await acknowledge(page);
        const identity = randomUUID();
        await page.evaluate((value) => {
          Object.defineProperty(window, '__mcpSettingsPageIdentity', { value });
        }, identity);
        let navigations = 0;
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) navigations++;
        });
        const samePage = async () => {
          expect(await page.evaluate(() => Reflect.get(window, '__mcpSettingsPageIdentity'))).toBe(
            identity,
          );
          expect(navigations).toBe(0);
        };

        await openSettings(page);
        const access = page.getByLabel('MCP access', { exact: true });
        await expect(access).toHaveValue('off');
        await expect(page.getByText('MCP connection: Disabled', { exact: true })).toBeVisible();
        await connected(request, 0);
        expect(sockets).toEqual([]);
        if (origin.socket.startsWith('wss:')) {
          await page.getByText('Local connection details', { exact: true }).click();
          await page.getByLabel('Local bridge address', { exact: true }).fill(origin.socket);
          await page.getByRole('button', { name: 'Save connection', exact: true }).click();
          await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
            `${origin.service}/mcp`,
          );
        }

        await access.selectOption(initial);
        await connected(request, 1);
        await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
        if (initial === 'read') await readAccess(request);
        else await writeAccess(request, 'First live MCP grant');
        await samePage();
        await closeSettings(page);
        await openSettings(page);
        await expect(access).toHaveValue(initial);
        await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();

        await access.selectOption('write');
        await connected(request, 1);
        const id = await writeAccess(request, 'Live MCP permission change');
        await access.selectOption('read');
        // The grant change reconnects the socket; the new connection must enforce read-only.
        await connected(request, 1);
        await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
        const denied = await request.post(`/api/v1/diagrams/${id}/nodes`, {
          data: { title: 'Denied immediately after downgrade' },
        });
        expect(denied.status()).toBe(403);
        await readAccess(request);
        await access.selectOption('off');
        await connected(request, 0);
        await expect(page.getByText('MCP connection: Disabled', { exact: true })).toBeVisible();
        const off = await mcp(request, '/diagrams');
        expect(off.isError).toBe(true);
        expect(off.structuredContent.status).toBe(503);
        await closeSettings(page);
        await openSettings(page);
        await expect(access).toHaveValue('off');

        await access.selectOption('read');
        await connected(request, 1);
        await readAccess(request);
        await access.selectOption('write');
        await connected(request, 1);
        await writeAccess(request, 'Live MCP re-enabled');
        await closeSettings(page);
        await expect(
          page.locator('.diagram-item').filter({ hasText: 'Live MCP re-enabled' }),
        ).toBeVisible();
        await samePage();
        expect(sockets.length).toBeGreaterThan(0);
        expect(sockets.every((socket) => socket === origin.socket)).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await request.dispose();
      }
    });
  }
}
