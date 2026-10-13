import axe from 'axe-core';
import { expect, test } from '@playwright/test';
import { acknowledge } from './fixtures';

for (const width of [320, 390, 768, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`the Roblox website section explains the real workflow accessibly at ${width}px in ${theme}`, async ({
      browser,
    }, info) => {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      const requests: string[] = [];
      const errors: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto('http://127.0.0.1:4327/');
        const reject = page.getByRole('button', { name: 'Reject analytics', exact: true });
        if (await reject.isVisible()) await reject.click();
        const section = page.locator('#roblox');
        await section.scrollIntoViewIfNeeded();
        await expect(section.getByRole('heading', { level: 2 })).toHaveText(
          'Your idea.Your world.Your game.',
        );
        await expect(section.locator('ol > li')).toHaveCount(3);
        const link = section.getByRole('link', { name: 'Build my first game' });
        expect(await link.getAttribute('href')).toBe('/app/?demo=roblox-game-builder');
        await link.focus();
        await expect(link).toBeFocused();
        await expect(section.getByRole('img')).toHaveAccessibleName(
          'World pieces connected by your game rules',
        );
        expect(
          await section
            .locator('svg')
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe('rgba(0, 0, 0, 0)');
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await page.addScriptTag({ content: axe.source });
        const result = await page.evaluate(async () => {
          const api = (
            window as unknown as {
              axe: {
                run: (
                  context: unknown,
                  options: unknown,
                ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
              };
            }
          ).axe;
          return api.run(document.querySelector('#roblox'), {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          });
        });
        expect(result.violations).toEqual([]);
        expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
        expect(requests.some((url) => /\/editor\/|\/api\/|\/mcp/.test(new URL(url).pathname))).toBe(
          false,
        );
        expect(requests.filter((url) => new URL(url).origin !== 'http://127.0.0.1:4327')).toEqual(
          [],
        );
        expect(errors).toEqual([]);
        await section.evaluate((element) =>
          element.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        await section.screenshot({
          path: info.outputPath(`roblox-homepage-${width}-${theme}.png`),
        });
      } finally {
        await context.close();
      }
    });
  }
test('the public Roblox template link waits for consent, creates the real starter and consumes the URL once', async ({
  page,
}) => {
  await page.goto('/app/?demo=roblox-game-builder');
  await expect(
    page.getByRole('dialog', { name: 'Your work stays in this browser', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'World & rules', exact: true })).toBeHidden();
  await acknowledge(page);
  await expect(page.getByRole('button', { name: 'World & rules', exact: true })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect(page).toHaveURL('http://127.0.0.1:4327/app/');
  await expect(page.locator('button[data-diagram-id]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'World & rules', exact: true })).toBeVisible();
  await expect(page.locator('button[data-diagram-id]')).toHaveCount(1);
});
