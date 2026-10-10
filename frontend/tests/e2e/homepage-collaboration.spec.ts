import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`homepage collaboration explains access and follows Appearance at ${width}px in ${colorScheme}`, async ({
      browser,
    }, info) => {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        colorScheme,
      });
      const page = await context.newPage();
      try {
        await page.goto('http://127.0.0.1:4327/');
        const reject = page.getByRole('button', { name: 'Reject analytics', exact: true });
        if (await reject.isVisible()) await reject.click();
        const section = page.getByRole('region', {
          name: /A shared diagram\.\s*Approved people\./,
        });
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        await expect(section.getByRole('heading', { level: 3 })).toHaveCount(3);
        await expect(section).toContainText('An invitation alone does not grant access.');
        await expect(section).toContainText('MLS (RFC 9420)');
        await expect(section).toContainText('AES-256-GCM');
        await expect(section).toContainText('Requires a configured collaboration relay.');
        await expect(section).toContainText('has not been independently audited.');
        await expect(
          section.getByRole('link', { name: 'Read the collaboration guide' }),
        ).toHaveAttribute('href', '/help/collaboration/');
        await expect(section.getByRole('link', { name: 'Sharing and security' })).toHaveAttribute(
          'href',
          '/security/#optional-realtime-collaboration',
        );
        await expect(section.locator('figcaption')).toContainText('Concept illustration.');

        const image = section.getByRole('img');
        await image.evaluate((element) => ((element as HTMLImageElement).loading = 'eager'));
        const assertImage = async (theme: 'light' | 'dark') => {
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect
            .poll(() =>
              image.evaluate((element) => {
                const image = element as HTMLImageElement;
                return {
                  loaded: image.complete && image.naturalWidth > 0,
                  path: image.currentSrc ? new URL(image.currentSrc).pathname : '',
                };
              }),
            )
            .toEqual({
              loaded: true,
              path: `/site/images/collaboration${theme === 'dark' ? '-dark' : ''}.webp`,
            });
          const corners = await image.evaluate((element) => {
            const image = element as HTMLImageElement;
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return [
              [0, 0],
              [canvas.width - 1, 0],
              [0, canvas.height - 1],
              [canvas.width - 1, canvas.height - 1],
            ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
          });
          expect(
            Math.max(...corners),
            'The illustration must not add an opaque rectangular background',
          ).toBeLessThanOrEqual(1);
        };
        await assertImage(colorScheme);

        // The same public Appearance controller must override the operating-system choice.
        const manual: 'light' | 'dark' = colorScheme === 'dark' ? 'light' : 'dark';
        await page.evaluate<void, 'light' | 'dark'>((theme) => {
          const appearance = (
            window as unknown as {
              visualNerveAppearance: { setPreference(value: 'light' | 'dark' | 'system'): void };
            }
          ).visualNerveAppearance;
          appearance.setPreference(theme);
        }, manual);
        await assertImage(manual);
        await page.evaluate(() => {
          (
            window as unknown as {
              visualNerveAppearance: { setPreference(value: 'system'): void };
            }
          ).visualNerveAppearance.setPreference('system');
        });
        await assertImage(colorScheme);

        const explanation = section.locator('.collaboration-agent');
        const summary = explanation.locator('summary');
        await expect(explanation).not.toHaveAttribute('open');
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(explanation).toHaveAttribute('open', '');
        await expect(explanation).toContainText('both that participant’s room role');
        await expect(explanation).toContainText('explicit local write grant');
        await expect(explanation).toContainText('cannot invite or approve people');
        await page.keyboard.press('Space');
        await expect(explanation).not.toHaveAttribute('open');

        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await section.screenshot({
          path: info.outputPath(`homepage-collaboration-${width}-${colorScheme}.png`),
        });
        expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
      } finally {
        await context.close();
      }
    });
  }
}
