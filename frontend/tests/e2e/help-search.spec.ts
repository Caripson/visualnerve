import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`help search keeps results beside the field and supports clear and keyboard navigation at ${width}px`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: width < 900,
    });
    const page = await context.newPage();
    try {
      await page.goto('/help/code/');
      if (width < 900) {
        await expect(page.locator('.site-shell a[href="/api/docs/"]')).toBeHidden();
        expect(
          await page.locator('.site-brand b').evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
      const search = page.getByRole('searchbox', { name: 'Search help', exact: true });
      const topics = page.locator('.help-mobile-topics');
      if (width < 900) await topics.locator('summary').click();
      await search.fill('COBOL');
      const results = page.getByRole('region', { name: 'Search results', exact: true });
      await expect(results).toContainText(/guide.*found/);
      if (width < 900) await expect(topics).not.toHaveAttribute('open');
      const first = results.getByRole('link').first();
      await expect(first).toBeInViewport();
      const geometry = await page.evaluate(() => {
        const search = document.querySelector('#help-search')!,
          sidebar = document.querySelector('.help-sidebar')!;
        const s = search.getBoundingClientRect(),
          p = sidebar.getBoundingClientRect();
        return {
          left: s.left - p.left,
          right: p.right - s.right,
          height: s.height,
          font: Number.parseFloat(getComputedStyle(search).fontSize),
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(6);
      expect(geometry.right).toBeGreaterThanOrEqual(6);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      if (width < 900) expect(geometry.font).toBeGreaterThanOrEqual(16);
      expect(geometry.overflow).toBe(0);
      await search.press('ArrowDown');
      await expect(first).toBeFocused();
      await first.press('Escape');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await expect(results).toBeHidden();
      await expect(search).toHaveAttribute('aria-expanded', 'false');
      await search.fill('source');
      await expect(results.getByRole('link').first()).toBeVisible();
      await page.getByRole('button', { name: 'Clear help search', exact: true }).click();
      await expect(search).toBeFocused();
      await expect(results).toBeHidden();
      await search.fill('COBOL');
      await search.press('Enter');
      await expect(first).toBeFocused();
      const destination = await first.getAttribute('href');
      await page.screenshot({ path: testInfo.outputPath(`help-search-${width}.png`) });
      await first.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(`${destination!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      );
      if (width < 900) {
        await page.locator('.help-mobile-topics > summary').click();
        const current = page.locator('.help-mobile-topics .help-topic.is-current');
        await current.focus();
        await expect(current).toBeFocused();
        expect(
          await current.evaluate((element) => element.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  });
}
