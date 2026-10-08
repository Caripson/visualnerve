import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const routes = [
  '/',
  '/features/',
  '/use-cases/',
  '/process-simulator/',
  '/mcp/',
  '/developers/',
  '/privacy/',
  '/security/',
  '/license/',
];
test('all public pages have useful metadata, real images and valid local destinations', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const external: string[] = [];
  page.on('request', (event) => {
    if (new URL(event.url()).origin !== 'http://127.0.0.1:4327') external.push(event.url());
  });
  const destinations = new Map<string, Set<string>>();
  for (const path of routes) {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(
      (await page.locator('meta[name=description]').getAttribute('content'))!.length,
    ).toBeGreaterThan(30);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      'https://visualnerve.caripson.com' + path,
    );
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
    await page
      .locator('main img')
      .evaluateAll((images) =>
        images.forEach((image) => ((image as HTMLImageElement).loading = 'eager')),
      );
    await expect
      .poll(() =>
        page
          .locator('main img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    for (const destination of await page
      .locator('main a[href],.public-header a[href],.public-footer a[href]')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))) {
      const url = new URL(destination);
      if (url.origin !== 'http://127.0.0.1:4327') continue;
      const set = destinations.get(url.pathname) || new Set<string>();
      if (url.hash) set.add(decodeURIComponent(url.hash.slice(1)));
      destinations.set(url.pathname, set);
    }
  }
  for (const [path, hashes] of destinations) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    if (hashes.size) {
      const html = await response.text();
      const missing = await page.evaluate(
        ({ html, hashes }) => {
          const document = new DOMParser().parseFromString(html, 'text/html');
          return hashes.filter((hash) => !document.getElementById(hash));
        },
        { html, hashes: [...hashes] },
      );
      expect(missing, path).toEqual([]);
    }
  }
  expect(external).toEqual([]);
});
test('the four device images are distinct real viewport captures', async ({ request }) => {
  const hashes = new Set<string>();
  for (const name of ['phone', 'tablet', 'desktop', 'laptop']) {
    for (const suffix of ['', '-dark']) {
      const response = await request.get('/site/images/' + name + suffix + '.webp');
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
      // Natural viewport sizes are decoded below; neither theme is a recolored image.
      expect(bytes.length).toBeGreaterThan(5000);
    }
  }
  expect(hashes.size).toBe(8);
});
for (const width of [1440, 768, 390, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(
      'public pages at ' +
        width +
        'px in ' +
        colorScheme +
        ' have usable navigation and no clipping',
      async ({ browser }, testInfo) => {
        test.setTimeout(120000);
        const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme });
        const page = await context.newPage();
        try {
          for (const path of routes) {
            await page.goto('http://127.0.0.1:4327' + path);
            const decline = page.getByRole('button', { name: 'Reject analytics', exact: true });
            if (await decline.isVisible()) await decline.click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
            await expect
              .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
              .toBe(width);
            await expect(page.locator('h1')).toBeVisible();
            await expect(page.locator('.public-header .brand-symbol')).toHaveText('⌘');
            const divider = await page.locator('.public-header-shell').evaluate((header) => {
              const bounds = header.getBoundingClientRect();
              return {
                left: bounds.left,
                right: bounds.right,
                border: getComputedStyle(header).borderBottomWidth,
              };
            });
            const floating = routes.indexOf(path) < 6;
            expect(divider).toEqual({ left: 0, right: width, border: floating ? '0px' : '1px' });
            await expect(page.locator('.public-header-shell')).toHaveClass(
              floating ? /public-header-shell--floating/ : /^public-header-shell$/,
            );
            if (floating) {
              const island = await page.locator('.public-header').boundingBox();
              expect(island!.x).toBeGreaterThan(0);
              expect(island!.y).toBeGreaterThan(0);
              expect(island!.x + island!.width).toBeLessThan(width);
            }
            expect(await page.locator('main').innerText()).not.toMatch(
              /iPhone|iPad|iMac|MacBook Pro/,
            );
            if (path === '/') {
              const icons = page.locator('.feature-card .feature-icon');
              await expect(icons).toHaveCount(4);
              // Mobile text enlargement must never turn icon glyphs into wrapped text.
              await icons.evaluateAll((elements) => {
                for (const icon of elements) (icon as HTMLElement).style.fontSize = '40px';
              });
              const geometry = await icons.evaluateAll((elements) =>
                elements.map((icon) => {
                  const svg = icon.querySelector('svg')!;
                  const frame = icon.getBoundingClientRect();
                  const vector = svg.getBoundingClientRect();
                  return {
                    text: icon.textContent?.trim(),
                    frame: { width: frame.width, height: frame.height },
                    vector: { width: vector.width, height: vector.height },
                    inset: {
                      left: vector.left - frame.left,
                      right: frame.right - vector.right,
                      top: vector.top - frame.top,
                      bottom: frame.bottom - vector.bottom,
                    },
                    ink: getComputedStyle(svg).stroke,
                    color: getComputedStyle(icon).color,
                  };
                }),
              );
              for (const icon of geometry) {
                expect(icon.text).toBe('');
                expect(icon.frame).toEqual({ width: 38, height: 38 });
                expect(icon.vector).toEqual({ width: 20, height: 20 });
                for (const inset of Object.values(icon.inset)) expect(inset).toBe(9);
                expect(icon.ink).toBe(icon.color);
              }
              await icons.evaluateAll((elements) => {
                for (const icon of elements)
                  (icon as HTMLElement).style.removeProperty('font-size');
              });
              await page
                .locator('.feature-card')
                .filter({ hasText: 'Make unfamiliar data readable' })
                .screenshot({ path: testInfo.outputPath(`code-icon-${width}-${colorScheme}.png`) });
            }
            if (path === '/features/') {
              await page
                .locator('.site-capture img')
                .evaluateAll((images) =>
                  images.forEach((image) => ((image as HTMLImageElement).loading = 'eager')),
                );
              await expect
                .poll(() =>
                  page
                    .locator('.site-capture img')
                    .evaluateAll((images) =>
                      images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
                    ),
                )
                .toBe(true);
              const phone = page.locator(
                '.site-capture--phone:has(img[src="/site/images/phone.webp"])',
              );
              await expect(phone).toHaveCount(1);
              expect(await page.locator('.site-capture--laptop').count()).toBeGreaterThan(0);
              const bounds = await page.locator('.site-capture').evaluateAll((frames) =>
                frames.map((frame) => {
                  const rect = frame.getBoundingClientRect();
                  const image = frame.querySelector('picture img')! as HTMLImageElement;
                  const screen = image.getBoundingClientRect();
                  return {
                    left: rect.left,
                    right: rect.right,
                    ratio: screen.width / screen.height,
                    expectedRatio: frame.classList.contains('site-capture--phone')
                      ? 390 / 844
                      : frame.classList.contains('site-capture--laptop')
                        ? 16 / 10
                        : image.naturalWidth / image.naturalHeight,
                    fit: getComputedStyle(image).objectFit,
                    background: getComputedStyle(frame).backgroundColor,
                    hardwareBackground: getComputedStyle(
                      frame.querySelector('.device-frame') ??
                        frame.querySelector('.site-capture__detail')!,
                    ).backgroundColor,
                    detail: frame.classList.contains('site-capture--detail'),
                    currentSrc: image.currentSrc,
                    link: frame.querySelector<HTMLAnchorElement>('.site-capture__link')!.href,
                  };
                }),
              );
              for (const frame of bounds) {
                expect(frame.left).toBeGreaterThanOrEqual(0);
                expect(frame.right).toBeLessThanOrEqual(width);
                expect(Math.abs(frame.ratio - frame.expectedRatio)).toBeLessThan(0.001);
                expect(frame.fit).toBe(frame.detail ? 'fill' : 'contain');
                expect(frame.link).toBe(frame.currentSrc);
                expect(new URL(frame.currentSrc).pathname.endsWith('-dark.webp')).toBe(
                  colorScheme === 'dark',
                );
                expect(frame.background).toBe('rgba(0, 0, 0, 0)');
                expect(frame.hardwareBackground).toBe('rgba(0, 0, 0, 0)');
              }
              await phone.screenshot({
                path: testInfo.outputPath('phone-frame-' + width + '-' + colorScheme + '.png'),
              });
              await page
                .locator('.site-capture--laptop')
                .first()
                .screenshot({
                  path: testInfo.outputPath('laptop-frame-' + width + '-' + colorScheme + '.png'),
                });
            }
          }
          await page.goto('http://127.0.0.1:4327/');
          expect(
            await page
              .locator('.device-showcase, .device')
              .evaluateAll((frames) =>
                frames.every(
                  (frame) => getComputedStyle(frame).backgroundColor === 'rgba(0, 0, 0, 0)',
                ),
              ),
          ).toBe(true);
          // Eagerly load the hero captures before asserting their natural screen size.
          await page
            .locator('.device-showcase .device-screen img')
            .evaluateAll((images) =>
              images.forEach((image) => ((image as HTMLImageElement).loading = 'eager')),
            );
          await expect
            .poll(() =>
              page
                .locator('.device-showcase .device-screen img')
                .evaluateAll((images) =>
                  images.every(
                    (image) =>
                      (image as HTMLImageElement).complete &&
                      (image as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            )
            .toBe(true);
          expect(
            await page
              .locator('.device-showcase .device-screen img')
              .evaluateAll((images) =>
                images.map((image) => [
                  (image as HTMLImageElement).naturalWidth,
                  (image as HTMLImageElement).naturalHeight,
                ]),
              ),
          ).toEqual([
            [1920, 1080],
            [1024, 1366],
            [1440, 900],
            [390, 844],
          ]);
          for (const [device, ratio] of [
            ['laptop', 16 / 10],
            ['phone', 390 / 844],
          ] as const) {
            const screen = await page
              .locator('.device-showcase .device-' + device + ' .device-screen img')
              .boundingBox();
            expect(Math.abs(screen!.width / screen!.height - ratio)).toBeLessThan(0.001);
          }
          if (width <= 1000) {
            const menu = page.getByRole('button', { name: /^Menu/ });
            await menu.click();
            await expect(menu).toHaveAttribute('aria-expanded', 'true');
            const nav = page.getByRole('navigation', { name: 'Site', exact: true });
            await expect(nav.getByRole('link', { name: 'Features', exact: true })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu).toBeFocused();
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await menu.click();
            await nav.getByRole('link', { name: 'Features', exact: true }).click();
            await expect(page).toHaveURL(/\/features\/$/);
          }
          await page.goto('http://127.0.0.1:4327/');
          const reject = page.getByRole('button', { name: 'Reject analytics', exact: true });
          if (await reject.isVisible()) await reject.click();
          await page.locator('.device-showcase').screenshot({
            path: testInfo.outputPath('devices-' + width + '-' + colorScheme + '.png'),
          });
          await page.screenshot({
            path: testInfo.outputPath('homepage-' + width + '-' + colorScheme + '.png'),
            fullPage: true,
          });
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(width);
          expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
        } finally {
          await context.close();
        }
      },
    );
  }
}
