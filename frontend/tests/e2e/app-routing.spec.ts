import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const publicURL = 'https://public-app.test:4340';
const publicApp = `${publicURL}/app/`;

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function createMap(page: Page, name: string) {
  await page.getByRole('button', { name: /New diagram/ }).click();
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
}
async function workspace(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        settings: { key: string; value: unknown }[];
        diagrams: { id: string; name: string; type: string }[];
        nodes: {
          id: string;
          diagramId: string;
          title: string;
          parentId?: string;
          description: string;
          status?: string;
        }[];
        simulationModels: {
          diagramId: string;
          model: {
            type: string;
            schemaVersion: number;
            nodes: unknown[];
            particleTypes: unknown[];
          };
        }[];
      }>((resolve, reject) => {
        const request = indexedDB.open('visual-nerve-cache');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const result: any = { version: db.version };
          const names = ['settings', 'diagrams', 'nodes', 'simulationModels'];
          const transaction = db.transaction(names, 'readonly');
          for (const name of names) {
            const read = transaction.objectStore(name).getAll();
            read.onsuccess = () => {
              result[name] = read.result;
            };
          }
          transaction.oncomplete = () => {
            db.close();
            resolve(result);
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
}
function retained(data: Awaited<ReturnType<typeof workspace>>) {
  return {
    version: data.version,
    workspaceId: data.settings.find((setting) => setting.key === 'workspace-id')?.value,
    theme: data.settings.find((setting) => setting.key === 'theme')?.value,
    diagrams: data.diagrams.map(({ id, name, type }) => ({ id, name, type })),
    nodes: data.nodes.map(({ id, diagramId, title, parentId, description, status }) => ({
      id,
      diagramId,
      title,
      parentId,
      description,
      status,
    })),
  };
}

test('public home introduces the product without creating a workspace; its app CTA opens the editor', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const editorRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/editor/app.js') editorRequests.push(request.url());
  });
  try {
    await page.goto(publicURL);
    await expect(page.locator('#visual-nerve')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your work stays in this browser' })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
    ).not.toContain('visual-nerve-cache');
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    expect(editorRequests).toEqual([]);
    await page.locator('a[href="/app/"]').first().click();
    await expect(page).toHaveURL(publicApp);
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser' }),
    ).toBeVisible();
    await acknowledge(page);
    await createMap(page, 'Opened from public home');
    expect((await workspace(page)).diagrams.map((diagram) => diagram.name)).toEqual([
      'Opened from public home',
    ]);
  } finally {
    await context.close();
  }
});

test('moving a real saved root workspace to /app/ retains identities, content, status and settings without reacceptance', async ({
  browser,
  request,
}) => {
  const editorResponse = await request.get('/app/');
  expect(editorResponse.ok()).toBe(true);
  const editorHTML = await editorResponse.text();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // Run the real editor at its former URL, using the same origin and actual native UI.
    // Non-navigation root fetches remain public, including the new worker's precache.
    await page.route(`${publicURL}/`, async (route) => {
      if (route.request().isNavigationRequest())
        await route.fulfill({ contentType: 'text/html', body: editorHTML });
      else await route.continue();
    });
    await page.goto(publicURL);
    await acknowledge(page);
    await createMap(page, 'Saved before the route move');
    await page.locator('.mindmap-root').dblclick();
    await page.getByLabel('Edit topic').fill('My existing root idea');
    await page.getByLabel('Edit topic').press('Enter');
    await page.getByLabel('Choose status', { exact: true }).click();
    await page.getByLabel('Selection status', { exact: true }).selectOption('done');
    await saved(page);
    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await saved(page);
    const before = retained(await workspace(page));
    expect(before.nodes).toHaveLength(13);
    expect(before.workspaceId).toBeTruthy();
    expect(before.nodes.find((node) => node.title === 'My existing root idea')?.status).toBe(
      'done',
    );
    await page.unroute(`${publicURL}/`);
    await page.goto(publicURL);
    await expect(page.locator('#visual-nerve')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('a[href="/app/"]').first().click();
    await saved(page);
    await expect(page.getByRole('dialog', { name: 'Your work stays in this browser' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('heading', { name: 'Saved before the route move', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('.mindmap-root')).toContainText('My existing root idea');
    await expect(page.locator('.mindmap-root')).toHaveAttribute('data-node-status', 'done');
    expect(retained(await workspace(page))).toEqual(before);
    await page.reload();
    await saved(page);
    expect(retained(await workspace(page))).toEqual(before);
  } finally {
    await context.close();
  }
});

test('accepted users can move between public home and all editor aliases offline without losing diagrams', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    await createMap(page, 'Offline workspace');
    const before = retained(await workspace(page));
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
    await page.goto(publicURL);
    await expect(page.locator('#visual-nerve')).toHaveCount(0);
    await expect(page.locator('a[href="/app/"]').first()).toBeVisible();
    expect(
      await page.locator('h1').evaluate((element) => getComputedStyle(element).fontFamily),
    ).not.toBe('"Times New Roman"');
    for (const path of ['/app/', '/app', '/app/index.html']) {
      await page.goto(publicURL + path);
      await saved(page);
      await expect(
        page.getByRole('heading', { name: 'Offline workspace', exact: true, level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole('dialog', { name: 'Your work stays in this browser' }),
      ).toHaveCount(0);
      expect(retained(await workspace(page))).toEqual(before);
    }
  } finally {
    await context.close();
  }
});

test('kiosk demo CTA waits for acceptance, creates the standard editable simulation and never duplicates on reload', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(publicURL);
    await page.locator('a[href="/app/?demo=kiosk"]').click();
    await expect(page).toHaveURL(`${publicApp}?demo=kiosk`);
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser' }),
    ).toBeVisible();
    expect((await workspace(page)).diagrams).toEqual([]);
    await acknowledge(page);
    await expect(page).toHaveURL(publicApp);
    await saved(page);
    await expect(
      page.getByRole('heading', { name: 'Kiosk package pickup', exact: true, level: 1 }),
    ).toBeVisible();
    const first = await workspace(page);
    expect(first.diagrams).toHaveLength(1);
    expect(first.diagrams[0].type).toBe('process-simulator');
    expect(first.simulationModels).toHaveLength(1);
    expect(first.simulationModels[0].model.type).toBe('process-simulator');
    expect(first.simulationModels[0].model.schemaVersion).toBe(1);
    expect(first.simulationModels[0].model.particleTypes).toHaveLength(2);
    await page.reload();
    await saved(page);
    expect((await workspace(page)).diagrams.map((diagram) => diagram.id)).toEqual([
      first.diagrams[0].id,
    ]);
    await page.goto(`${publicApp}?demo=kiosk&source=public-home#example`);
    await expect(page).toHaveURL(`${publicApp}?source=public-home#example`);
    await saved(page);
    const second = await workspace(page);
    expect(second.diagrams).toHaveLength(2);
    expect(new Set(second.diagrams.map((diagram) => diagram.id)).size).toBe(2);
    await page.reload();
    await saved(page);
    expect((await workspace(page)).diagrams.map((diagram) => diagram.id)).toEqual(
      second.diagrams.map((diagram) => diagram.id),
    );
  } finally {
    await context.close();
  }
});
