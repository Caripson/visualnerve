import { expect, test } from '@playwright/test';
import { APP_LOCALES } from '../../src/i18n/types';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Disposable language acceptance passphrase';
test.use({ locale: 'sv-SE' });

test('first-visit password drafts and recovery warnings stay available through every language change', async ({
  page,
}) => {
  await page.goto(app);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  const passwords = page.locator('input[type="password"]');
  const catalogs = new LocaleCatalogLoader();
  for (const { id } of APP_LOCALES) {
    const catalog = await catalogs.load(id);
    await page.locator('.vault-language select').selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    await expect(page.getByRole('dialog')).toHaveAttribute(
      'aria-label',
      catalog['security.gate.setupTitle'],
    );
    await expect(passwords.nth(0)).toHaveValue(password);
    await expect(passwords.nth(1)).toHaveValue(password);
    await expect(page.locator('.backup-security-notice')).toBeVisible();
  }
});

test('installed encrypted app switches previously unopened languages offline while locked and retains its saved diagram', async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app);
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  await page
    .getByRole('button', { name: /New diagram/ })
    .first()
    .click();
  const name = 'Untranslated encrypted language canary';
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const objectCount = await page.locator('.canvas-shell .mindmap-topic').count();
  expect(objectCount).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
      { timeout: 60000 },
    )
    .toBe('activated');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const catalogPaths = await page.evaluate(async () => {
    const cache = (await caches.keys()).find((name) => name.startsWith('visual-nerve-app-shell-'))!;
    return (await (await caches.open(cache)).keys())
      .map((request) => new URL(request.url).pathname)
      .filter((path) => /\/assets\/(?:en|da|nb|sv|fi|de|es|fr)-[\w-]+\.js$/.test(path));
  });
  expect(catalogPaths).toHaveLength(8);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  try {
    const catalogs = new LocaleCatalogLoader();
    for (const { id } of APP_LOCALES) {
      const catalog = await catalogs.load(id);
      await page.locator('.vault-language select').selectOption(id);
      await expect(page.locator('html')).toHaveAttribute('lang', id);
      await expect(page.getByRole('dialog')).toHaveAttribute(
        'aria-label',
        catalog['security.gate.unlockTitle'],
      );
      await expect(page.getByRole('heading', { level: 1, name, exact: true })).toHaveCount(0);
    }
    await page.locator('.vault-language select').selectOption('sv');
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
    const swedish = await catalogs.load('sv');
    await page
      .getByLabel(swedish['security.credential.workspacePassword'], { exact: true })
      .fill(password);
    await page.getByRole('button', { name: swedish['security.gate.unlock'], exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    await expect(page.locator('.canvas-shell .mindmap-topic')).toHaveCount(objectCount);
  } finally {
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
});
