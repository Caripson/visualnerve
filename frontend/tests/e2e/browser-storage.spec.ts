import { expect, test as base, type Page } from '@playwright/test';
import { test as integrated, acknowledge } from './fixtures';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
base(
  'normal workspace saves, searches and restores backups without graph network requests',
  async ({ page, context }) => {
    const apiRequests: string[] = [],
      errors: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') || request.url().includes('/mcp'))
        apiRequests.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/');
    await acknowledge(page);
    await page.getByRole('button', { name: /New diagram/ }).click();
    await page.getByLabel('New diagram name').fill('Browser only');
    await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
    await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await saved(page);
    await page.getByRole('button', { name: 'Owners', exact: true }).click();
    await page.getByLabel('Owner name').fill('Unassigned browser owner');
    await page.getByRole('button', { name: 'Create owner', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save owner', exact: true })).toBeVisible();
    await page.getByLabel('Close dialog').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Theme').selectOption('dark');
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export all data', exact: true }).click();
    const download = await downloading;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const buffer = Buffer.concat(chunks),
      backup = JSON.parse(buffer.toString());
    expect(backup.format).toBe('visual-nerve-workspace');
    expect(backup.nodes).toHaveLength(13);
    expect(
      backup.owners.some((owner: { name: string }) => owner.name === 'Unassigned browser owner'),
    ).toBe(true);
    expect(backup.templates).toHaveLength(10);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          }),
        );
    });
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Browser only', exact: true, level: 1 }),
    ).toBeVisible();
    await saved(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /^Search/ }).click();
    await page.getByLabel('Global search').fill('Browser only');
    await expect(
      page
        .locator('.search-results')
        .getByRole('button', { name: /Browser only/ })
        .first(),
    ).toBeVisible();
    await page.getByLabel('Close dialog').click();
    await page.getByRole('button', { name: 'Delete diagram', exact: true }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('heading', { name: /Give your thinking/ })).toBeVisible();
    await page
      .getByLabel('Import file')
      .setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer });
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Browser only', exact: true, level: 1 }),
    ).toBeVisible();
    await saved(page);
    expect(apiRequests).toEqual([]);
    expect(errors).toEqual([]);
  },
);

integrated(
  'MCP tools commit in browser IndexedDB and refresh the visible editor',
  async ({ page, request }) => {
    const initialize = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'Browser test', version: '1' },
        },
      },
    });
    expect((await initialize.json()).result.protocolVersion).toBe('2025-06-18');
    const call = async (id: number, path: string, method = 'GET', data?: unknown) => {
      const response = await request.post('/mcp', {
        data: {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'visual_nerve_request', arguments: { path, method, data } },
        },
      });
      const result = (await response.json()).result;
      expect(result.isError).toBe(false);
      return result.structuredContent.body;
    };
    const diagram = await call(2, '/diagrams', 'POST', {
      name: 'MCP browser map',
      type: 'mindmap',
    });
    await expect(
      page.locator('.diagram-item').filter({ hasText: 'MCP browser map' }),
    ).toBeVisible();
    await page.locator('.diagram-item').filter({ hasText: 'MCP browser map' }).click();
    const root = await call(3, `/diagrams/${diagram.id}/nodes`, 'POST', {
      title: 'Created through MCP',
      color: '#23664d',
    });
    await expect(page.locator(`[data-node-id="${root.id}"]`)).toContainText('Created through MCP');
    await call(4, `/nodes/${root.id}/children`, 'POST', { title: 'Browser-owned child' });
    await expect(page.locator('.mindmap-topic')).toHaveCount(2);
    await saved(page);
    await page.reload();
    await saved(page);
    const stored = await call(5, `/diagrams/${diagram.id}`);
    expect(stored.nodes).toHaveLength(2);
    expect(stored.nodes[1].parentId).toBe(root.id);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('MCP access', { exact: true }).selectOption('off');
    await expect
      .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
      .toBe(0);
    // Query the bridge directly after the browser opted out; the server has no retained graph data.
    const response = await page.context().request.get('/api/v1/diagrams');
    expect(response.status()).toBe(503);
  },
);
