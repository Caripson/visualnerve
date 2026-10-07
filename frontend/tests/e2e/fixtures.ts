import { expect, test as base } from '@playwright/test';
export { expect } from '@playwright/test';
export type { APIRequestContext, Page } from '@playwright/test';
// Existing integration scenarios exercise HTTP -> bridge -> browser -> IndexedDB.
export async function acknowledge(page: import('@playwright/test').Page) {
  await page.getByLabel('I accept local storage and offline caching', { exact: true }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your work stays in this browser' })).toBeHidden();
}
export const test = base.extend({
  request: async ({ page, playwright, baseURL }, use) => {
    const request = await playwright.request.newContext({ baseURL });
    await page.goto('/app/');
    await acknowledge(page);
    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const connected = async () => {
      await expect
        .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
        .toBeGreaterThan(0);
    };
    await connected();
    const proxy = new Proxy(request, {
      get(target, key) {
        const member = Reflect.get(target, key);
        if (typeof member !== 'function') return member;
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(String(key)))
          return member.bind(target);
        return async (...args: unknown[]) => {
          if (
            (String(args[0]).includes('/api/v1/') && !String(args[0]).endsWith('/health')) ||
            String(args[0]).includes('/mcp')
          )
            await connected();
          return member.apply(target, args);
        };
      },
    });
    await use(proxy);
    await request.dispose();
  },
});
