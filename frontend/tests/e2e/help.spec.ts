import { test, expect, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const publicURL = 'https://public-app.test:4340';
const publicApp = `${publicURL}/app/`;
type Guide = { title: string; url: string; summary: string; text: string };
async function index(page: Page): Promise<Guide[]> {
  return page.evaluate(async () => {
    const response = await fetch('/help/index.json');
    if (!response.ok) throw new Error(`Help index returned ${response.status}`);
    const value = await response.json();
    if (value.version !== 1) throw new Error('Unknown help index version');
    return value.guides;
  });
}
async function noOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}
async function imagesLoaded(page: Page) {
  await page.locator('.help-article img').evaluateAll((images) => {
    for (const image of images) (image as HTMLImageElement).loading = 'eager';
  });
  await expect
    .poll(() =>
      page
        .locator('.help-article img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
}

test('the help hub and all 16 guides have real screenshots, valid local links and working anchors', async ({
  browser,
  request,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  const external: string[] = [],
    errors: string[] = [];
  context.on('request', (event) => {
    if (new URL(event.url()).origin !== publicURL) external.push(event.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${publicURL}/help/`);
    const guides = await index(page);
    expect(guides).toHaveLength(16);
    expect(new Set(guides.map((guide) => guide.url)).size).toBe(16);
    await expect(
      page.getByRole('region', { name: 'All guides', exact: true }).locator('a'),
    ).toHaveCount(16);
    const links = new Set<string>();
    const anchors = new Map<string, Set<string>>();
    const record = (destination: string) => {
      const url = new URL(destination);
      if (url.origin !== publicURL) return;
      const path = url.pathname + url.search;
      links.add(path);
      if (url.hash) {
        const ids = anchors.get(path) ?? new Set<string>();
        ids.add(decodeURIComponent(url.hash.slice(1)));
        anchors.set(path, ids);
      }
    };
    // Existing API/setup/privacy links must keep resolving to the new guide hub.
    for (const path of ['/help/', '/privacy/', '/api/docs/']) {
      await page.goto(`${publicURL}${path}`);
      for (const destination of await page
        .locator('a[href]')
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLAnchorElement).href),
        )) {
        if (new URL(destination).pathname.startsWith('/help/')) record(destination);
      }
    }
    for (const guide of guides) {
      expect(guide.url).toMatch(/^\/help\/[a-z0-9-]+\/$/);
      expect(guide.summary.trim().length).toBeGreaterThan(20);
      expect(guide.text.trim().length).toBeGreaterThan(500);
      await page.goto(`${publicURL}${guide.url}`);
      await expect(
        page.getByRole('heading', { level: 1, name: guide.title, exact: true }),
      ).toBeVisible();
      await expect(page.locator('.help-toc summary')).toHaveText('On this page');
      const screenshots = page.locator('.help-article figure img');
      expect(await screenshots.count(), `${guide.title} needs a screenshot`).toBeGreaterThan(0);
      await imagesLoaded(page);
      expect(
        await screenshots.evaluateAll((images) =>
          images.every((image) => !!image.getAttribute('alt')?.trim()),
        ),
      ).toBe(true);
      expect(
        await screenshots.evaluateAll((images) =>
          images.every((image) => {
            const link = image.closest('a');
            return (
              link?.href === (image as HTMLImageElement).currentSrc && link?.target === '_blank'
            );
          }),
        ),
      ).toBe(true);
      const destinations = await page
        .locator('.help-article a[href], .help-toc a[href], .help-guide-pagination a[href]')
        .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
      for (const destination of destinations) record(destination);
      await noOverflow(page, 1440);
    }
    for (const path of links) {
      const response = await request.get(path);
      expect(response.status(), `Broken guide destination ${path}`).toBe(200);
      const ids = anchors.get(path);
      if (ids?.size) {
        const html = await response.text();
        const present = await page.evaluate(
          ({ html, wanted }) => {
            const document = new DOMParser().parseFromString(html, 'text/html');
            return wanted.map((id) => ({ id, exists: !!document.getElementById(id) }));
          },
          { html, wanted: [...ids] },
        );
        for (const { id, exists } of present)
          expect(exists, `Broken guide anchor ${path}#${id}`).toBe(true);
      }
    }
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
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

test('local full-text search is keyboard accessible, handles no results and clears with Escape', async ({
  page,
}) => {
  await page.goto('/help/');
  await page.keyboard.press('/');
  const search = page.getByRole('combobox', { name: 'Search help', exact: true });
  await expect(search).toBeFocused();
  await search.fill('COBOL');
  const results = page.getByRole('region', { name: 'Search results', exact: true });
  await expect(results).toContainText(/guide.*found/);
  const link = results.getByRole('link').first();
  await expect(link).toBeVisible();
  const destination = await link.getAttribute('href');
  // Results are ordinary links and remain reachable without a pointer.
  await expect(link).toHaveAttribute('href', /\/help\//);
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.keyboard.press('Tab');
    if (await link.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    new RegExp(`${destination!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('no-such-visualnerve-topic-987654');
  await expect(results).toContainText('No guides found');
  await expect(results.getByRole('link')).toHaveCount(0);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(results).toBeHidden();
  // Slash while typing must remain part of the query rather than hijacking focus.
  await search.press('/');
  await expect(search).toHaveValue('/');
});

for (const width of [1440, 390, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`all help pages remain readable at ${width}px in ${colorScheme}`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(180000);
      const context = await browser.newContext({
          ignoreHTTPSErrors: true,
          colorScheme,
          viewport: { width, height: width < 900 ? 844 : 980 },
        }),
        page = await context.newPage();
      try {
        await page.goto(`${publicURL}/help/`);
        const guides = await index(page);
        for (const path of ['/help/', ...guides.map((guide) => guide.url)]) {
          await page.goto(`${publicURL}${path}`);
          await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
          await expect(page.locator('h1')).toBeVisible();
          await noOverflow(page, width);
          await imagesLoaded(page);
          await noOverflow(page, width);
        }
        await page.goto(`${publicURL}/help/`);
        if (width < 900) {
          const topics = page.locator('.help-mobile-topics');
          await topics.getByText('Topics', { exact: true }).click();
          await expect(topics.getByRole('link')).toHaveCount(17);
          await topics.getByRole('link').nth(1).click();
          await expect(page).toHaveURL(`${publicURL}${guides[0].url}`);
          await noOverflow(page, width);
        }
        await page.screenshot({
          path: testInfo.outputPath(`help-${width}-${colorScheme}.png`),
          fullPage: false,
        });
      } finally {
        await context.close();
      }
    });
  }
}

test('accepted local workspace caches every guide, screenshot and the help search index for offline use', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  try {
    await page.goto(publicApp);
    await acknowledge(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto(`${publicURL}/help/`);
    const guides = await index(page);
    const onlineScreenshots = new Set<string>();
    for (const guide of guides) {
      await page.goto(`${publicURL}${guide.url}`);
      for (const image of await page
        .locator('.help-article picture')
        .evaluateAll((pictures) =>
          pictures.flatMap((picture) => [
            picture.querySelector<HTMLImageElement>('img')!.src,
            new URL(picture.querySelector('source')!.getAttribute('srcset')!, location.href).href,
          ]),
        ))
        onlineScreenshots.add(image);
    }
    const assets = [
      '/help/',
      '/help/index.json',
      ...guides.map((guide) => guide.url),
      ...[...onlineScreenshots].map((url) => new URL(url).pathname),
    ];
    expect(
      await page.evaluate(
        async (paths) => Promise.all(paths.map(async (path) => !!(await caches.match(path)))),
        assets,
      ),
    ).toEqual(assets.map(() => true));
    await context.setOffline(true);
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const guide of guides) {
      await page.goto(`${publicURL}${guide.url}`);
      await expect(
        page.getByRole('heading', { level: 1, name: guide.title, exact: true }),
      ).toBeVisible();
      await imagesLoaded(page);
      expect(
        await page
          .locator('.help-article img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).currentSrc.endsWith('-dark.webp')),
          ),
      ).toBe(true);
    }
    await page.goto(`${publicURL}/help/`);
    await page.getByRole('combobox', { name: 'Search help', exact: true }).fill('COBOL');
    await expect(page.getByRole('region', { name: 'Search results', exact: true })).toContainText(
      /guide.*found/,
    );
  } finally {
    await context.setOffline(false);
    await context.close();
  }
});
