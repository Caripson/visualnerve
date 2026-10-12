import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Synthetic time series browser protection phrase';

async function verifyCandlestickIllustration(page: Page) {
  const illustration = page.locator('#time-series').getByRole('img', { name: /Candlesticks/i });
  await expect(illustration).toBeVisible();
  await expect(illustration.locator('.analytics-candle')).toHaveCount(16);
  await expect(illustration.locator('rect:not(.analytics-candle-body)')).toHaveCount(0);
  await expect(illustration.locator('.analytics-signal')).toHaveAttribute(
    'data-observation-time',
    '2024-01-01T00:00:00.000Z',
  );
  await expect(illustration.locator('.analytics-signal')).toHaveAttribute(
    'data-detected-at',
    '2024-02-01T00:00:00.000Z',
  );
  const geometry = await illustration.locator('.analytics-candle').evaluateAll((candles) =>
    candles.map((candle) => {
      const body = candle.querySelector<SVGGraphicsElement>('.analytics-candle-body')!;
      const wick = candle.querySelector<SVGGraphicsElement>('.analytics-candle-wick')!;
      const bounds = body.getBBox();
      const wickBounds = wick.getBBox();
      return {
        time: candle.getAttribute('data-time'),
        open: Number(candle.getAttribute('data-open')),
        high: Number(candle.getAttribute('data-high')),
        low: Number(candle.getAttribute('data-low')),
        close: Number(candle.getAttribute('data-close')),
        fill: getComputedStyle(body).fill,
        stroke: getComputedStyle(body).stroke,
        body: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        wick: {
          x: wickBounds.x,
          y: wickBounds.y,
          width: wickBounds.width,
          height: wickBounds.height,
        },
      };
    }),
  );
  for (const candle of geometry) {
    expect(candle.time).toMatch(/^20\d{2}-\d{2}-01T00:00:00\.000Z$/);
    expect([candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)).toBe(true);
    expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
    expect(candle.body.width).toBeGreaterThan(0);
    if (candle.close === candle.open) expect(candle.body.height).toBe(0);
    else expect(candle.body.height).toBeGreaterThan(0);
    expect(candle.body.x).toBeGreaterThanOrEqual(0);
    expect(candle.body.x + candle.body.width).toBeLessThanOrEqual(640);
    expect(candle.body.y).toBeGreaterThanOrEqual(0);
    expect(candle.body.y + candle.body.height).toBeLessThanOrEqual(400);
    expect(candle.wick.width).toBe(0);
    expect(candle.wick.x).toBe(candle.body.x + candle.body.width / 2);
    expect(candle.wick.y).toBeLessThanOrEqual(candle.body.y);
    expect(candle.wick.y + candle.wick.height).toBeGreaterThanOrEqual(
      candle.body.y + candle.body.height,
    );
    expect(candle.wick.y).toBeGreaterThanOrEqual(0);
    expect(candle.wick.y + candle.wick.height).toBeLessThanOrEqual(400);
    expect(candle.stroke).not.toBe('none');
    if (candle.close > candle.open) expect(candle.fill).not.toBe('none');
    if (candle.close < candle.open) expect(candle.fill).toBe('none');
  }
}

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
  await section.locator('svg').scrollIntoViewIfNeeded();
  await verifyCandlestickIllustration(page);
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
      await verifyCandlestickIllustration(page);
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
