import { expect, type Page } from '@playwright/test';

/** Navigate the reference like a user, including Swagger's virtualized operation list. */
export async function openAPIEndpoint(page: Page, method: string, path: string) {
  const endpoint = page
    .locator('.swagger-ui .opblock')
    .filter({ has: page.locator(`.opblock-summary-path[data-path="${path}"]`) })
    .filter({
      has: page.locator('.opblock-summary-method', { hasText: new RegExp(`^${method}$`) }),
    });

  // Swagger renders only the viewport plus overscan for large contracts. Waiting
  // for an offscreen generated DOM ID cannot make that operation materialize.
  await expect
    .poll(
      async () => {
        if (await endpoint.count()) return true;
        await page.mouse.wheel(0, Math.floor((page.viewportSize()?.height ?? 800) / 2));
        return (await endpoint.count()) > 0;
      },
      { intervals: [100, 200], message: `Scroll to the documented ${method} ${path} operation` },
    )
    .toBe(true);

  await expect(endpoint).toHaveCount(1);
  const summary = endpoint.locator('.opblock-summary-control');
  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(endpoint.getByRole('heading', { name: 'Responses', exact: true })).toBeVisible();
  return endpoint;
}
