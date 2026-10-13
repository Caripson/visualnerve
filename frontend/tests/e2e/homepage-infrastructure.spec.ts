import axe from 'axe-core';
import { expect, test, type Locator, type Page } from '@playwright/test';

const templates = [
  ['api', 'API & Compute Capacity', 'api-compute-capacity'],
  ['network', 'Network & Multi-Site Capacity', 'network-multi-site-capacity'],
  ['energy', 'Energy & Power Capacity', 'energy-power-capacity'],
  ['datacenter', 'Datacenter Capacity', 'datacenter-capacity'],
] as const;

async function appearance(page: Page, theme: 'light' | 'dark' | 'system') {
  await page.evaluate((value) => {
    (
      window as unknown as { visualNerveAppearance: { setPreference(value: string): void } }
    ).visualNerveAppearance.setPreference(value);
  }, theme);
}
async function screensLoaded(section: Locator, theme: 'light' | 'dark') {
  const images = section.locator('.infrastructure-monitor__screen img');
  await images.evaluateAll((elements) =>
    elements.forEach((element) => {
      (element as HTMLImageElement).loading = 'eager';
    }),
  );
  await expect(images).toHaveCount(4);
  await expect
    .poll(() =>
      images.evaluateAll(async (elements) =>
        (
          await Promise.all(
            elements.map(async (element) => {
              const image = element as HTMLImageElement;
              if (!image.complete || !image.currentSrc || image.naturalWidth === 0) return false;
              // A w-srcset image reports density-corrected dimensions; decode the chosen file alone.
              const source = new Image();
              source.src = image.currentSrc;
              try {
                await source.decode();
              } catch {
                return false;
              }
              return (
                [480, 960, 1440].includes(source.naturalWidth) &&
                source.naturalHeight === source.naturalWidth * 0.625
              );
            }),
          )
        ).every(Boolean),
      ),
    )
    .toBe(true);
  const paths = await images.evaluateAll((elements) =>
    elements.map((element) => new URL((element as HTMLImageElement).currentSrc).pathname),
  );
  for (const [index, [name]] of templates.entries())
    expect(paths[index]).toMatch(
      new RegExp(
        `^/site/images/infrastructure-${name}(?:-(?:480|960))?${theme === 'dark' ? '-dark' : ''}-[a-f0-9]{16}\\.webp$`,
      ),
    );
}

for (const width of [320, 390, 768, 1440])
  for (const theme of ['light', 'dark'] as const)
    test(`capacity templates use actual screens without overflow at ${width}px in ${theme}`, async ({
      browser,
    }, info) => {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      const requests: string[] = [],
        errors: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto('http://127.0.0.1:4327/');
        const reject = page.getByRole('button', { name: 'Reject analytics', exact: true });
        if (await reject.isVisible()) await reject.click();
        const section = page.getByRole('region', { name: /^Where does\s*capacity run out\?$/ });
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        await expect(section.locator('.infrastructure-monitor')).toHaveCount(4);
        await expect(section.getByRole('heading', { level: 3 })).toHaveCount(4);
        for (const [, title, key] of templates) {
          await expect(section.getByRole('heading', { name: title, exact: true })).toBeVisible();
          const link = section.locator(`.infrastructure-template__open[href$="?demo=${key}"]`);
          await expect(link).toHaveCount(1);
          const destination = new URL((await link.getAttribute('href')) ?? '', page.url());
          expect(destination.origin).toBe('http://127.0.0.1:4327');
          expect(destination.pathname).toBe('/app/');
          expect([...destination.searchParams]).toEqual([['demo', key]]);
          await link.focus();
          await expect(link).toBeFocused();
        }
        await expect(section.locator('.infrastructure-monitor__hardware')).toHaveCount(4);
        await expect(section.locator('img.infrastructure-peripherals')).toHaveCount(1);
        for (const hardware of await section
          .locator('.infrastructure-monitor__hardware, img.infrastructure-peripherals')
          .all())
          await expect(hardware).toHaveAttribute('alt', '');
        for (const image of await section.locator('.infrastructure-monitor__screen img').all()) {
          expect(await image.getAttribute('alt')).toMatch(
            /Visual Nerve|simulat(?:ion|or)|running/i,
          );
          await expect(image).toHaveAttribute('width', '1440');
          await expect(image).toHaveAttribute('height', '900');
        }
        await screensLoaded(section, theme);
        const override = theme === 'dark' ? 'light' : 'dark';
        await appearance(page, override);
        await expect(page.locator('html')).toHaveAttribute('data-theme', override);
        await screensLoaded(section, override);
        await appearance(page, 'system');
        await screensLoaded(section, theme);
        expect(
          await section
            .locator('.infrastructure-stage')
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe('rgba(0, 0, 0, 0)');
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        // Present the section from its top after the keyboard navigation checks.
        // Otherwise an oversized element capture can include fixed controls that
        // are outside the current viewport, even when they are visually hidden.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await section.evaluate((element) =>
          element.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        await expect
          .poll(() =>
            page
              .locator('.site-skip')
              .evaluate((element) => element.getBoundingClientRect().bottom),
          )
          .toBeLessThanOrEqual(0);
        await section.screenshot({
          path: info.outputPath(`homepage-infrastructure-${width}-${theme}.png`),
        });
        expect(errors).toEqual([]);
        expect(requests.filter((url) => new URL(url).origin !== 'http://127.0.0.1:4327')).toEqual(
          [],
        );
        expect(
          requests.filter((url) => /\/editor\/|\/bridge(?:\?|$)|\/api\/v1\//.test(url)),
        ).toEqual([]);
        expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
      } finally {
        await context.close();
      }
    });

test('capacity section remains accessible and still with reduced motion', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 950 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4327/');
    const reject = page.getByRole('button', { name: 'Reject analytics', exact: true });
    if (await reject.isVisible()) await reject.click();
    const section = page.locator('#infrastructure');
    await section.scrollIntoViewIfNeeded();
    const motion = await section.locator('*').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return { animation: style.animationName, transition: style.transitionDuration };
      }),
    );
    expect(
      motion.every(
        (style) =>
          style.animation === 'none' &&
          style.transition.split(',').every((value) => Number.parseFloat(value) <= 0.01),
      ),
    ).toBe(true);
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run('#infrastructure', {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      return result.violations.map((value) => ({
        id: value.id,
        impact: value.impact,
        nodes: value.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
  } finally {
    await context.close();
  }
});
