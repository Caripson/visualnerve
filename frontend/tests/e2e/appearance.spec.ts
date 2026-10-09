import { test, expect, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';
import { openAPIEndpoint } from './api-docs-fixture';

const publicURL = 'https://public-app.test:4340';
const publicApp = `${publicURL}/app/`;
const referencePaths = [
  '/help/',
  '/privacy/',
  '/license/',
  '/error.html',
  '/api/docs',
  '/api/docs/',
];

async function colors(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const background =
      style.backgroundColor === 'rgba(0, 0, 0, 0)'
        ? getComputedStyle(document.documentElement).backgroundColor
        : style.backgroundColor;
    return { background, text: style.color };
  });
}

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  expect(channels, `Expected an opaque computed color, received ${color}`).toHaveLength(3);
  const linear = channels!.map((value) => {
    const fraction = value / 255;
    return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

async function appearance(page: Page, theme: 'dark' | 'light') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const values = await colors(page);
  const background = luminance(values.background),
    foreground = luminance(values.text);
  expect(
    (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  if (theme === 'dark') expect(background).toBeLessThan(foreground);
  else expect(background).toBeGreaterThan(foreground);
  return values;
}

async function chooseTheme(page: Page, theme: 'dark' | 'light' | 'system') {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption(theme);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

async function screenshotTheme(page: Page, theme: 'light' | 'dark') {
  await appearance(page, theme);
  const pictures = page.locator('[data-appearance-image]');
  expect(await pictures.count()).toBeGreaterThan(0);
  await pictures
    .locator('img')
    .evaluateAll((images) =>
      images.forEach((image) => ((image as HTMLImageElement).loading = 'eager')),
    );
  await expect
    .poll(() =>
      pictures.evaluateAll((elements) =>
        elements.every((picture) => {
          const image = picture.querySelector('img')!;
          return (
            image.complete &&
            image.naturalWidth > 0 &&
            image.currentSrc.endsWith(
              document.documentElement.dataset.theme === 'dark' ? '-dark.webp' : '.webp',
            ) &&
            (document.documentElement.dataset.theme === 'dark' ||
              !image.currentSrc.endsWith('-dark.webp'))
          );
        }),
      ),
    )
    .toBe(true);
  expect(
    await pictures.evaluateAll((elements) =>
      elements.every((picture) => {
        const link = picture.closest('a[data-appearance-link]');
        return (
          !link || (link as HTMLAnchorElement).href === picture.querySelector('img')!.currentSrc
        );
      }),
    ),
  ).toBe(true);
}

test('fresh product images load only the System-selected variant and switch without creating storage', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'dark' });
  const page = await context.newPage();
  const captures: string[] = [];
  page.on('request', (request) => {
    if (/\/(?:help|site)\/images\/.*\.webp$/.test(new URL(request.url()).pathname))
      captures.push(new URL(request.url()).pathname);
  });
  try {
    await page.goto(publicURL + '/');
    await screenshotTheme(page, 'dark');
    expect(captures.length).toBeGreaterThan(0);
    expect(captures.every((path) => path.endsWith('-dark.webp'))).toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await screenshotTheme(page, 'light');
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
  } finally {
    await context.close();
  }
});

test('public and Help screenshots follow saved Appearance rather than OS preference, including live changes and full-size links', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'light' });
  const editor = await context.newPage();
  try {
    await editor.goto(publicApp);
    await acknowledge(editor);
    await chooseTheme(editor, 'dark');
    const pages: Page[] = [];
    for (const path of ['/', '/features/', '/help/simulation/']) {
      const page = await context.newPage();
      await page.goto(publicURL + path);
      await screenshotTheme(page, 'dark');
      pages.push(page);
    }
    await chooseTheme(editor, 'light');
    for (const page of pages) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await screenshotTheme(page, 'light');
    }
    await editor.emulateMedia({ colorScheme: 'dark' });
    await chooseTheme(editor, 'system');
    for (const page of pages) await screenshotTheme(page, 'dark');
    for (const page of pages) {
      await page.emulateMedia({ colorScheme: 'light' });
      await screenshotTheme(page, 'light');
      await page.reload();
      await screenshotTheme(page, 'light');
    }
  } finally {
    await context.close();
  }
});

for (const path of referencePaths) {
  test(`fresh ${path} follows System appearance without creating a workspace`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'dark' });
    const page = await context.newPage();
    try {
      await page.goto(`${publicURL}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const dark = await appearance(page, 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      const light = await appearance(page, 'light');
      expect(light.background).not.toBe(dark.background);
      expect(light.text).not.toBe(dark.text);
      await page.emulateMedia({ colorScheme: 'dark' });
      expect(await appearance(page, 'dark')).toEqual(dark);
      expect(
        await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
      ).toEqual([]);
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      ).toBe(0);
    } finally {
      await context.close();
    }
  });
}

test('reference pages inherit saved Settings and update live across tabs, including System changes', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'light' });
  const editor = await context.newPage();
  try {
    await editor.goto(publicApp);
    await acknowledge(editor);
    await chooseTheme(editor, 'dark');
    await appearance(editor, 'dark');
    const references: Page[] = [];
    for (const path of referencePaths) {
      const page = await context.newPage();
      await page.goto(`${publicURL}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await appearance(page, 'dark');
      references.push(page);
    }
    await chooseTheme(editor, 'light');
    for (const page of references) await appearance(page, 'light');
    // A fixed preference must remain fixed when the operating-system preference changes.
    for (const page of [editor, ...references]) await page.emulateMedia({ colorScheme: 'dark' });
    for (const page of references) await appearance(page, 'light');
    await chooseTheme(editor, 'system');
    for (const page of [editor, ...references]) await appearance(page, 'dark');
    for (const page of [editor, ...references]) await page.emulateMedia({ colorScheme: 'light' });
    for (const page of [editor, ...references]) await appearance(page, 'light');
    await editor.reload();
    await editor
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await expect(editor.getByLabel('Theme', { exact: true })).toHaveValue('system');
    await editor.getByRole('button', { name: 'Done', exact: true }).click();
    for (const page of references) {
      await page.reload();
      await appearance(page, 'light');
    }
    await chooseTheme(editor, 'dark');
    await editor.reload();
    await appearance(editor, 'dark');
    await editor
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await expect(editor.getByLabel('Theme', { exact: true })).toHaveValue('dark');
    await editor.getByRole('button', { name: 'Done', exact: true }).click();
    for (const page of references) await appearance(page, 'dark');
  } finally {
    await context.close();
  }
});

for (const width of [1440, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`API reference is readable at ${width}px in ${colorScheme} and makes no external requests`, async ({
      browser,
    }, testInfo) => {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        colorScheme,
        viewport: { width, height: width === 320 ? 740 : 980 },
      });
      const requests: string[] = [],
        errors: string[] = [];
      context.on('request', (request) => requests.push(request.url()));
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${publicURL}/api/docs/`);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Visual Nerve local API', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.swagger-ui .info .title')).toContainText(
          'Visual Nerve local API',
        );
        await appearance(page, colorScheme);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await page.screenshot({
          path: testInfo.outputPath(
            `api-docs-${width === 320 ? 'mobile' : 'desktop'}-${colorScheme}-introduction.png`,
          ),
        });
        const endpoint = await openAPIEndpoint(page, 'GET', '/diagrams');
        await expect(page.getByRole('button', { name: /Try it out/ })).toHaveCount(0);
        const foreground = await page.evaluate(
          () => getComputedStyle(document.documentElement).color,
        );
        const detailLabels = endpoint.locator('.opblock-section-header h4, .tab li button');
        expect(await detailLabels.count()).toBeGreaterThan(0);
        for (const heading of await detailLabels.all())
          await expect(heading).toHaveCSS('color', foreground);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await page.screenshot({
          path: testInfo.outputPath(
            `api-docs-${width === 320 ? 'mobile' : 'desktop'}-${colorScheme}.png`,
          ),
        });
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.filter((url) => new URL(url).origin !== publicURL)).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test('the loopback API reference retains local Try it out without opening a workspace', async ({
  page,
}) => {
  await page.goto('/api/docs');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Visual Nerve local API', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.swagger-ui .info .title')).toContainText('Visual Nerve local API');
  await openAPIEndpoint(page, 'GET', '/diagrams');
  await expect(page.getByRole('button', { name: /Try it out/ })).toBeVisible();
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).toEqual([]);
});

test('large API references keep offscreen endpoints reachable through the virtualized list', async ({
  page,
}) => {
  const contractResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/openapi.yaml',
  );
  await page.goto(`${publicURL}/api/docs/`);
  await expect(page.locator('.swagger-ui .info .title')).toContainText('Visual Nerve local API');
  const contract = await (await contractResponse).json();
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
  const operationCount = Object.values(contract.paths).reduce<number>(
    (count, path) => count + Object.keys(path as object).filter((key) => methods.has(key)).length,
    0,
  );
  expect(operationCount).toBeGreaterThanOrEqual(100);
  await expect(page.locator('.operations-virtual')).toHaveCount(1);
  expect(await page.locator('.swagger-ui .opblock').count()).toBeLessThan(operationCount);
  await expect(page.locator('.opblock-summary-path[data-path="/workspace/security"]')).toHaveCount(
    0,
  );
  const endpoint = await openAPIEndpoint(page, 'GET', '/workspace/security');
  await expect(endpoint.locator('.opblock-body')).toContainText('"mode"');
  await expect(endpoint.locator('.opblock-body')).toContainText('"schemaVersion"');
  await expect(page.getByRole('button', { name: /Try it out/ })).toHaveCount(0);
});
