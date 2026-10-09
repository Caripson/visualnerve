import { expect, test, type Page } from '@playwright/test';
import { APP_LOCALES } from '../../src/i18n/types';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';
import { acknowledge } from './fixtures';

test.use({ hasTouch: true });
const app = 'https://public-app.test:4341';

async function encryptedWorkspace(page: Page) {
  await page.goto(app);
  const password = 'Disposable mobile navigation acceptance passphrase';
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
}

async function containedMenu(page: Page) {
  const nav = page.locator('#workspace-site-nav');
  await expect(nav).toBeVisible();
  const geometry = await nav.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThanOrEqual(48);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.overflow).toBe(0);
  for (const link of await nav.getByRole('link').all()) {
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport({ ratio: 0.8 });
    expect(
      await link.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  }
}

test('isolated app site navigation is reachable in all eight languages on narrow phones, short landscape and tablets', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await encryptedWorkspace(page);
  const catalogs = new LocaleCatalogLoader();
  let active = await catalogs.load('en');
  for (const { id } of APP_LOCALES) {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.getByRole('button', { name: active['privacy.localBadge.accessibleName'] }).click();
    active = await catalogs.load(id);
    await page.getByTestId('app-language').selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    await page.getByRole('dialog').locator('.modal-heading button').click();
    const trigger = page.locator('.workspace-menu-toggle');
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 844, height: 390 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(trigger).toHaveAccessibleName(active['chrome.site']);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#workspace-site-nav')).toBeHidden();
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        await trigger.tap();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await containedMenu(page);
        if (id === 'en' && viewport.width === 320 && colorScheme === 'dark')
          await page.screenshot({ path: testInfo.outputPath('workspace-site-menu-320-dark.png') });
        const nav = page.locator('#workspace-site-nav');
        await expect(
          nav.getByRole('link', { name: active['chrome.apiReference'], exact: true }),
        ).toHaveAttribute('href', '/api/docs/');
        await expect(
          nav.getByRole('link', { name: active['chrome.guide'], exact: true }),
        ).toHaveAttribute('href', '/help/');
        await expect(
          nav.getByRole('link', { name: active['chrome.workspace'], exact: true }),
        ).toHaveAttribute('href', '/');
        await nav.getByRole('link').first().focus();
        await page.keyboard.press('Escape');
        await expect(nav).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.press('ArrowDown');
        await expect(nav.getByRole('link').first()).toBeFocused();
        await containedMenu(page);
        await page.touchscreen.tap(2, 100);
        await expect(nav).toBeHidden();
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await expect(page.locator('.workspace-menu-toggle')).toBeHidden();
  const nav = page.locator('#workspace-site-nav');
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((element) => getComputedStyle(element).flexWrap)).toBe('nowrap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(errors).toEqual([]);
});

test('reference pages use the same mobile disclosure, close on navigation, resize and keyboard focus leaving it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app}/help/`);
  const trigger = page.locator('.workspace-menu-toggle');
  const nav = page.locator('#workspace-site-nav');
  await trigger.tap();
  await containedMenu(page);
  // Touch browsers may not report the next focus destination. A transient
  // unknown destination must never remove a link before it activates.
  await trigger.evaluate((element) => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  });
  await expect(nav).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(nav).toBeHidden();
  await trigger.tap();
  await nav.getByRole('link', { name: 'Privacy', exact: true }).tap();
  await expect(page).toHaveURL(`${app}/privacy/`);
  await expect(nav).toBeHidden();
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(nav.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.site-brand')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link').first()).toBeFocused();
  await nav.getByRole('link').last().focus();
  await page.keyboard.press('Tab');
  await expect(nav).toBeHidden();
  await trigger.tap();
  await expect(nav).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 980 });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeHidden();
  await expect(nav).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeHidden();
  await trigger.tap();
  await containedMenu(page);
});
