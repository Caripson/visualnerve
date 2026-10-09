import { expect, test, type Page } from '@playwright/test';

const app = 'https://public-app.test:4341';
const notice = '/licenses/zustand-LICENSE';

async function shellPaths(page: Page) {
  return page.evaluate(async () => {
    const shell = (await caches.keys()).find((name) => name.startsWith('visual-nerve-app-shell-'));
    if (!shell) return [];
    return (await (await caches.open(shell)).keys()).map(
      (request) => new URL(request.url).pathname,
    );
  });
}

test('isolated offline setup caches the editor and guides before individual notices, then caches a visited notice for offline use', async ({
  page,
  context,
}) => {
  const violations: string[] = [];
  const requestedNotices: string[] = [];
  context.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/licenses/')) requestedNotices.push(path);
  });
  page.on('pageerror', (error) => violations.push(error.message));
  const response = await page.goto(app);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('dialog', { name: 'Protect your local workspace', exact: true }),
  ).toBeVisible();
  // This static-worker test uses a fresh, empty browser context. It never creates
  // a vault, unlocks a workspace or grants integration access. Consent and private
  // offline reopening are covered through the actual UI in encrypted-capabilities.
  await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => undefined),
  );
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
      { timeout: 60000 },
    )
    .toBe('activated');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const initial = await shellPaths(page);
  for (const path of [
    '/',
    '/editor/app.js',
    '/help/settings/',
    '/help/help.js',
    '/help/index.json',
    '/api/docs/',
    '/swagger/swagger-ui-bundle.js',
    '/licenses/inventory.json',
    '/licenses/visualnerve-LICENSE',
    '/licenses/espeak-ng-NOTICE',
  ])
    expect(initial).toContain(path);
  expect(initial.some((path) => path.startsWith('/help/images/'))).toBe(true);
  expect(initial.filter((path) => path.startsWith('/licenses/'))).toHaveLength(9);
  expect(initial).not.toContain(notice);
  expect(requestedNotices).toContain('/licenses/inventory.json');
  expect(requestedNotices).not.toContain(notice);
  expect(initial.some((path) => path.startsWith('/editor/speech/'))).toBe(false);

  await context.setOffline(true);
  try {
    expect(
      await page.evaluate(async (path) => {
        try {
          await fetch(path);
          return false;
        } catch {
          return true;
        }
      }, notice),
    ).toBe(true);
    expect(await shellPaths(page)).not.toContain(notice);
  } finally {
    await context.setOffline(false);
  }
  const online = await page.evaluate(async (path) => {
    const response = await fetch(path);
    const text = await response.text();
    return { status: response.status, text };
  }, notice);
  expect(online.status).toBe(200);
  expect(online.text).toContain('MIT');
  await expect.poll(async () => (await shellPaths(page)).includes(notice)).toBe(true);
  await context.setOffline(true);
  try {
    expect(await page.evaluate(async (path) => (await fetch(path)).text(), notice)).toBe(
      online.text,
    );
  } finally {
    await context.setOffline(false);
  }
  expect(violations).toEqual([]);
  await expect(
    page.getByRole('dialog', { name: 'Protect your local workspace', exact: true }),
  ).toBeVisible();
});
