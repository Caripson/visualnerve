import {
  test,
  expect,
  chromium,
  type Page,
  type Download,
  type BrowserContext,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acknowledge } from './fixtures';
import templateManifest from '../../src/templates/manifest.json' with { type: 'json' };

const publicURL = 'https://public-app.test:4340';
const publicApp = `${publicURL}/app/`;
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
}
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: /New diagram/ }).click();
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
}
async function records(page: Page): Promise<Record<string, any[]>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('visual-nerve-cache');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            names = [...db.objectStoreNames],
            result: Record<string, unknown[]> = {};
          const tx = db.transaction(names, 'readonly');
          for (const name of names) {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => {
              result[name] = read.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}
async function buffer(download: Download) {
  const stream = await download.createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function backup(page: Page) {
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^visual-nerve-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const bytes = await buffer(file),
    data = JSON.parse(bytes.toString());
  expect(data.schemaVersion).toBe(8);
  expect(data.datasets).toEqual([]);
  expect(Number.isFinite(Date.parse(data.exportedAt))).toBe(true);
  expect(
    data.settings.some((item: { key: string }) =>
      ['mcp-access', 'bridge-url', 'storage-consent', 'workspace-id'].includes(item.key),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return { bytes, data };
}
async function inspect(page: Page, bytes: Buffer) {
  await settings(page);
  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'visual-nerve-backup.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByRole('dialog', { name: 'Import Visual Nerve backup' })).toBeVisible();
}
function networkAudit(context: BrowserContext) {
  const writes: string[] = [],
    external: string[] = [],
    contentRequests: string[] = [];
  context.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      writes.push(`${request.method()} ${request.url()}`);
    if (new URL(request.url()).origin !== publicURL) external.push(request.url());
    const path = new URL(request.url()).pathname;
    const publicMcpPage =
      ['GET', 'HEAD'].includes(request.method()) && ['/mcp/', '/mcp/index.html'].includes(path);
    if (
      (!publicMcpPage &&
        /^(?:\/api\/v1\/|\/mcp(?:\/|$)|\/diagrams(?:\/|$)|\/nodes(?:\/|$))/i.test(path)) ||
      /PutObject/i.test(request.url())
    )
      contentRequests.push(request.url());
  });
  return () => {
    expect(writes).toEqual([]);
    expect(external).toEqual([]);
    expect(contentRequests).toEqual([]);
  };
}

test('explicit acceptance is mandatory, cannot be dismissed, and enables storage only after consent', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  const audit = networkAudit(context);
  try {
    await page.goto(publicApp);
    const intro = page.getByRole('dialog', { name: 'Your work stays in this browser' });
    await expect(intro).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /New diagram/ })).toHaveCount(0);
    await expect(page.getByLabel('Close dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.modal-shade').click({ position: { x: 2, y: 2 } });
    await page.getByRole('button', { name: "I don't accept", exact: true }).click();
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('workspace stays closed');
    for (const rows of Object.values(await records(page))) expect(rows).toHaveLength(0);
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    await page.screenshot({ path: '../docs/acceptance/storage-acceptance.png' });
    await acknowledge(page);
    await settings(page);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await expect(page.getByText('MCP connection: Disabled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(intro).toHaveCount(0);
    expect(
      (await records(page)).settings.some(
        (record) => record.key === 'storage-consent' && record.value === true,
      ),
    ).toBe(true);
    audit();
  } finally {
    await context.close();
  }
});

test('same HTTPS static URL has independent Private A and Private B workspaces, portable only by backup', async ({
  browser,
}) => {
  const a = await browser.newContext({ ignoreHTTPSErrors: true }),
    b = await browser.newContext({ ignoreHTTPSErrors: true });
  const auditA = networkAudit(a),
    auditB = networkAudit(b);
  try {
    const pageA = await a.newPage(),
      pageB = await b.newPage();
    await pageA.goto(publicApp);
    await acknowledge(pageA);
    await create(pageA, 'Private A');
    await pageA.locator('.mindmap-root').dblclick();
    await pageA.getByLabel('Edit topic').fill('Private idea');
    await pageA.getByLabel('Edit topic').press('Tab');
    await pageA.getByLabel('Edit topic').fill('A local child');
    await pageA.getByLabel('Edit topic').press('Enter');
    await saved(pageA);
    await pageB.goto(publicApp);
    await acknowledge(pageB);
    await expect(pageB.locator('.diagram-item')).toHaveCount(0);
    await create(pageB, 'Private B');
    expect((await records(pageA)).diagrams.map((diagram) => diagram.name)).toEqual(['Private A']);
    expect((await records(pageB)).diagrams.map((diagram) => diagram.name)).toEqual(['Private B']);
    await pageA.reload();
    await saved(pageA);
    expect((await records(pageA)).nodes).toHaveLength(14);
    await pageA.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(pageA.locator('.mindmap-topic')).toHaveCount(14);
    await expect(pageA.locator('.diagram-item').filter({ hasText: 'Private B' })).toHaveCount(0);
    const exported = await backup(pageA);
    await inspect(pageB, exported.bytes);
    await expect(pageB.getByLabel('Merge with existing data')).toBeChecked();
    expect((await records(pageB)).diagrams).toHaveLength(1);
    await pageB.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await saved(pageB);
    expect((await records(pageB)).diagrams.map((diagram) => diagram.name).sort()).toEqual([
      'Private A',
      'Private B',
    ]);
    const imported = await records(pageB),
      importedId = imported.diagrams.find((diagram) => diagram.name === 'Private A').id;
    expect(imported.nodes.filter((node) => node.diagramId === importedId)).toHaveLength(14);
    await pageB.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(pageB.locator('.mindmap-topic')).toHaveCount(14);
    auditA();
    auditB();
  } finally {
    await a.close();
    await b.close();
  }
});

test('full backup restores after confirmed deletion, and replacement requires its own confirmation', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage(),
    audit = networkAudit(context);
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    await create(page, 'My Strategy');
    await page.getByRole('button', { name: 'Owners', exact: true }).click();
    await page.getByLabel('Owner name').fill('Local team');
    await page.getByRole('button', { name: 'Create owner', exact: true }).click();
    await page.getByLabel('Close dialog').click();
    await settings(page);
    await page.getByLabel('Theme').selectOption('dark');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // User templates use the same object store; seed one to verify full portability.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('visual-nerve-cache');
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('templates', 'readwrite'),
              store = tx.objectStore('templates'),
              read = store.getAll();
            read.onsuccess = () =>
              store.put({
                ...read.result[0],
                id: 'my-template',
                name: 'My custom template',
                builtin: false,
              });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
          request.onerror = () => reject(request.error);
        }),
    );
    const exported = await backup(page),
      originalId = (await records(page)).settings.find(
        (record) => record.key === 'workspace-id',
      ).value;
    expect(
      exported.data.owners.some((owner: { name: string }) => owner.name === 'Local team'),
    ).toBe(true);
    expect(
      exported.data.templates.some((template: { id: string }) => template.id === 'my-template'),
    ).toBe(true);
    await settings(page);
    await page.getByText('Delete all local data', { exact: true }).click();
    const remove = page.getByRole('button', {
      name: 'Delete all local Visual Nerve data',
      exact: true,
    });
    await expect(remove).toBeDisabled();
    expect((await records(page)).diagrams).toHaveLength(1);
    await page.getByLabel('Confirm deletion of all local data').check();
    await remove.click();
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser' }),
    ).toBeVisible();
    const empty = await records(page);
    for (const store of ['diagrams', 'nodes', 'edges', 'owners']) expect(empty[store]).toEqual([]);
    expect(empty.templates).toHaveLength(templateManifest.length);
    expect(empty.templates.every((record) => record.builtin)).toBe(true);
    expect(empty.settings.map((record) => record.key)).toEqual(['workspace-id']);
    await acknowledge(page);
    await inspect(page, exported.bytes);
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await saved(page);
    await expect(
      page.getByRole('heading', { name: 'My Strategy', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.mindmap-topic')).toHaveCount(13);
    expect((await records(page)).owners.map((owner) => owner.name)).toEqual(['Local team']);
    await create(page, 'Will be removed');
    await inspect(page, exported.bytes);
    await page.getByLabel('Replace all local data', { exact: true }).check();
    await expect(page.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled();
    await page.screenshot({ path: '../docs/acceptance/restore-confirmation.png' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await records(page)).diagrams).toHaveLength(2);
    await inspect(page, exported.bytes);
    await page.getByLabel('Replace all local data', { exact: true }).check();
    await page.getByLabel('Confirm replacement of all local data').check();
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await saved(page);
    const restored = await records(page);
    expect(restored.diagrams.map((diagram) => diagram.name)).toEqual(['My Strategy']);
    expect(restored.settings.find((record) => record.key === 'workspace-id').value).not.toBe(
      originalId,
    );
    expect(restored.settings.some((record) => record.key === 'mcp-access')).toBe(false);
    expect(restored.templates.find((record) => record.id === 'my-template').name).toBe(
      'My custom template',
    );
    await settings(page);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await page.screenshot({ path: '../docs/acceptance/data-privacy-settings.png' });
    audit();
  } finally {
    await context.close();
  }
});

test('closing and reopening the browser profile retains My Strategy on a public HTTPS static origin', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'visual-nerve-profile-'));
  const options = {
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 980 },
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--host-resolver-rules=MAP public-app.test 127.0.0.1',
      '--no-proxy-server',
    ],
  };
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, options);
    let audit = networkAudit(context);
    let page = await context.newPage();
    await page.goto(publicApp);
    await acknowledge(page);
    await create(page, 'My Strategy');
    await page.locator('.mindmap-root').dblclick();
    await page.getByLabel('Edit topic').press('Tab');
    await page.getByLabel('Edit topic').fill('Long term');
    await page.getByLabel('Edit topic').press('Enter');
    await saved(page);
    const before = await records(page);
    audit();
    await context.close();
    context = undefined;
    context = await chromium.launchPersistentContext(profile, options);
    audit = networkAudit(context);
    page = await context.newPage();
    await page.goto(publicApp);
    await saved(page);
    await expect(
      page.getByRole('heading', { name: 'My Strategy', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your work stays in this browser' })).toHaveCount(
      0,
    );
    const after = await records(page);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(after.diagrams[0].id).toBe(before.diagrams[0].id);
    audit();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('public HTTPS app grants read-only or write access solely to a local TLS MCP bridge, and closed/off sessions fail', async ({
  browser,
  playwright,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  const request = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    ignoreHTTPSErrors: true,
  });
  const sockets: string[] = [],
    errors: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const call = async (path: string, method = 'GET', data?: unknown) =>
    (
      await (
        await request.post('/mcp', {
          data: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'visual_nerve_request', arguments: { path, method, data } },
          },
        })
      ).json()
    ).result;
  const connected = async (count: number) =>
    expect
      .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
      .toBe(count);
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    await create(page, 'MCP Private Strategy');
    expect(sockets).toEqual([]);
    await settings(page);
    await expect(page.getByLabel('Visual Nerve website', { exact: true })).toHaveValue(
      new URL(publicURL).origin,
    );
    await expect(page.getByRole('link', { name: 'API documentation — 2D and 3D' })).toHaveAttribute(
      'href',
      new URL('/api/docs/', publicURL).href,
    );
    await page.getByText('Local connection details', { exact: true }).click();
    await page.getByLabel('Local bridge address').fill('wss://127.0.0.1:4329/bridge');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByLabel('MCP server URL for Codex', { exact: true })).toHaveValue(
      'https://127.0.0.1:4329/mcp',
    );
    await page.getByLabel('MCP access', { exact: true }).selectOption('read');
    await connected(1);
    await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
    const listed = await call('/diagrams');
    expect(listed.isError).toBe(false);
    const id = listed.structuredContent.body[0].id;
    const denied = await call(`/diagrams/${id}/nodes`, 'POST', { title: 'Denied mutation' });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent.status).toBe(403);
    const exportRead = await call('/export', 'POST', { diagramId: id, format: 'json' });
    expect(exportRead.isError).toBe(false);
    expect(exportRead.structuredContent.body.nodes).toHaveLength(13);
    const escalation = await call('/settings/mcp-access', 'PUT', { value: 'write' });
    expect(escalation.isError).toBe(true);
    expect(escalation.structuredContent.status).toBe(403);
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await connected(1);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const added = await call(`/diagrams/${id}/nodes`, 'POST', {
      title: 'Added via local MCP',
      x: 0,
      y: 300,
    });
    expect(added.isError).toBe(false);
    await expect(page.locator(`[data-node-id="${added.structuredContent.body.id}"]`)).toContainText(
      'Added via local MCP',
    );
    await saved(page);
    await page.reload();
    await saved(page);
    await connected(1);
    const stored = await call(`/diagrams/${id}`);
    expect(stored.structuredContent.body.nodes).toHaveLength(14);
    await settings(page);
    await page.getByLabel('MCP access', { exact: true }).selectOption('off');
    await connected(0);
    await expect(page.getByText('MCP connection: Disabled', { exact: true })).toBeVisible();
    const off = await call(`/diagrams/${id}/nodes`, 'POST', { title: 'Off mutation' });
    expect(off.isError).toBe(true);
    expect(off.structuredContent.status).toBe(503);
    expect(off.content[0].text).toContain('No active Visual Nerve browser session');
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await connected(1);
    await page.close();
    await connected(0);
    const closed = await call(`/diagrams/${id}/nodes`, 'POST', { title: 'Closed mutation' });
    expect(closed.isError).toBe(true);
    expect(closed.structuredContent.status).toBe(503);
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.every((url) => url === 'wss://127.0.0.1:4329/bridge')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await request.dispose();
  }
});

test('remote bridge addresses are rejected before any socket or content transmission', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage(),
    sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    await create(page, 'Keep private');
    await settings(page);
    await page.getByText('Local connection details', { exact: true }).click();
    await page.getByLabel('Local bridge address').fill('wss://remote.example/bridge');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.locator('.settings-message')).toContainText(
      'MCP can connect only to localhost',
    );
    expect(sockets).toEqual([]);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
  } finally {
    await context.close();
  }
});

test('export menu separates one diagram from all data and storage retention denial is explained', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    });
    await page.goto(publicApp);
    await acknowledge(page);
    await create(page, 'Export choices');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByLabel('Export target')).toHaveValue('diagram');
    await expect(page.getByLabel('Export format')).toBeVisible();
    await page.getByLabel('Export target').selectOption('workspace');
    await expect(page.getByLabel('Export format')).toHaveCount(0);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export all data', exact: true }).click();
    expect((await pending).suggestedFilename()).toMatch(/^visual-nerve-backup-/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await settings(page);
    await page.getByText('Storage details', { exact: true }).click();
    await expect(page.getByText('IndexedDB · schema 8', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ask browser to keep local data', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'did not grant persistent storage' }),
    ).toBeVisible();
    await expect(page.getByText(/does not prevent manual clearing/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('privacy and backup controls fit a phone without horizontal overflow', async ({ browser }) => {
  const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await page.goto(publicApp);
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await acknowledge(page);
    await settings(page);
    await expect(page.getByRole('button', { name: 'Export all data', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: '../docs/acceptance/data-privacy-mobile.png' });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 });
    await settings(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await context.close();
  }
});

test('substantial data gets a one-time dismissible backup reminder and public API reference cannot upload content', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage(),
    audit = networkAudit(context);
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    for (let index = 0; index < 10; index++) await create(page, `Local diagram ${index + 1}`);
    await expect(page.locator('.backup-nudge')).toContainText('10 local diagrams');
    await page.getByLabel('Dismiss backup reminder').click();
    await expect(page.locator('.backup-nudge')).toHaveCount(0);
    await page.reload();
    await saved(page);
    await expect(page.locator('.backup-nudge')).toHaveCount(0);
    await backup(page);
    expect((await records(page)).settings.some((record) => record.key === 'last-export')).toBe(
      true,
    );
    await page.goto(`${publicURL}/api/docs/`);
    await expect(page.locator('.swagger-ui .info .title')).toContainText('Visual Nerve local API');
    await page.locator('#operations-default-get_diagrams').click();
    await expect(page.getByRole('button', { name: /Try it out/ })).toHaveCount(0);
    audit();
  } finally {
    await context.close();
  }
});
