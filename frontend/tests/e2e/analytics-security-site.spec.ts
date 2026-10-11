import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Synthetic time series browser protection phrase';

async function setup(page: Page) {
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
}

test('public section is lightweight, transparent and links to the real consent-protected template', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  const section = page.locator('#time-series');
  await expect(section.getByRole('heading', { name: 'Turn data into signals' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'Explore the template' })).toHaveAttribute(
    'href',
    /\?demo=time-series-analysis$/,
  );
  await expect(section.getByRole('link', { name: 'Read the guide' })).toHaveAttribute(
    'href',
    '/help/time-series-analysis/',
  );
  expect(await section.locator('svg text').count()).toBe(0);
  expect(
    await section.locator('svg').evaluate((svg) => getComputedStyle(svg).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  expect(requests.some((url) => /worker|AnalyticsWorkspace|analytics\/engine/.test(url))).toBe(
    false,
  );
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).filter((db) => db.name?.startsWith('visual-nerve')),
    ),
  ).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`public analysis section fits ${width}px ${colorScheme} with real accessible links`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 980 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/');
      const section = page.locator('#time-series');
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByRole('link', { name: 'Explore the template' })).toBeVisible();
      await expect(section.getByRole('link', { name: 'API & MCP documentation' })).toHaveAttribute(
        'href',
        '/developers/#time-series-analysis',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const box = await section.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      await section.screenshot({ path: `../tmp/analytics-home-${width}-${colorScheme}.png` });
    });
  }
}

test('encrypted demo survives reload and offline analysis without leaking data or creating another document', async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const external: string[] = [],
    errors: string[] = [],
    consoleMessages: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== app) external.push(request.url());
    expect(request.method()).toBe('GET');
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.goto(`${app}/?demo=time-series-analysis`);
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeHidden();
  await setup(page);
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible({
    timeout: 60000,
  });
  await expect(page).not.toHaveURL(/demo=/);
  await expect(page.getByRole('button', { name: 'Growth & Churn', exact: true })).toHaveCount(1);
  const canary = 'PRIVATE_ANALYTICS_BROWSER_CANARY';
  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await page.getByLabel('Measurement name', { exact: true }).fill(canary);
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(page.getByLabel('Measurement results')).toBeVisible();
  await page.getByRole('button', { name: 'Save definition and result', exact: true }).click();
  await expect(page.getByText('Saved in your encrypted workspace.', { exact: true })).toBeVisible();
  const raw = await page.evaluate(async () => {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open('visual-nerve-vault');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result,
          read = db.transaction('records').objectStore('records').getAll();
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
      };
    });
    const cacheNames = await caches.keys();
    let cachedContent = '';
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response?.headers.get('content-type')?.match(/text|json|javascript|xml/))
          cachedContent += await response.text();
      }
    }
    return {
      records: JSON.stringify(records),
      storage: JSON.stringify({ ...localStorage }),
      cacheNames,
      cachedContent,
    };
  });
  expect(raw.records + raw.storage + raw.cachedContent + consoleMessages.join('\n')).not.toContain(
    canary,
  );
  expect(raw.records).not.toContain('Retention pressure');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Growth & Churn', exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await page.getByLabel('Saved measurement', { exact: true }).selectOption({ label: canary });
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(page.getByLabel('Measurement results')).toBeVisible();
  await page.getByRole('tab', { name: /4 · Detect/ }).click();
  await page.getByRole('button', { name: 'Evaluate saved rules', exact: true }).click();
  await expect(page.locator('.analytics-signal-item').first()).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
