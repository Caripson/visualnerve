import { randomBytes } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { APP_LOCALES } from '../../src/i18n/types';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';
import { acknowledge } from './fixtures';

test.use({ hasTouch: true });
const app = 'https://public-app.test:4341';

async function encryptedWorkspace(page: Page) {
  await page.goto(app);
  const password = randomBytes(24).toString('base64url');
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
}

async function touchTarget(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const label = element.querySelector('[data-app-chrome-text]');
    const range = document.createRange();
    if (label) range.selectNodeContents(label);
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      labelRects: label
        ? Array.from(range.getClientRects()).map((box) => ({
            x: box.x,
            y: box.y,
            right: box.right,
            bottom: box.bottom,
          }))
        : [],
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  for (const label of geometry.labelRects) {
    expect(label.x).toBeGreaterThanOrEqual(geometry.x);
    expect(label.right).toBeLessThanOrEqual(geometry.right);
    expect(label.y).toBeGreaterThanOrEqual(geometry.y);
    expect(label.bottom).toBeLessThanOrEqual(geometry.bottom);
  }
}

async function inlineNavigation(page: Page) {
  const header = page.locator('.site-shell');
  const nav = page.locator('#workspace-site-nav');
  await expect(header).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(page.locator('.workspace-menu-toggle')).toHaveCount(0);
  const visible = await nav.getByRole('link').all();
  expect(visible).toHaveLength(3);
  for (const link of visible) await touchTarget(page, link);
  await touchTarget(page, header.locator('.site-brand'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(await nav.evaluate((element) => getComputedStyle(element).flexWrap)).toBe('nowrap');
  const application = page.locator('.application');
  if (await application.count()) {
    const bounds = await application.boundingBox();
    expect(bounds!.y).toBe(48);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}

test('welcome has inline localized Guide, Privacy and GitHub links, while the opened mobile editor keeps its Projects and Edit controls', async ({
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
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        await inlineNavigation(page);
        const nav = page.locator('#workspace-site-nav');
        await expect(
          nav.getByRole('link', { name: active['chrome.guide'], exact: true }),
        ).toHaveAttribute('href', '/help/');
        await expect(
          nav.getByRole('link', { name: active['chrome.privacy'], exact: true }),
        ).toHaveAttribute('href', '/privacy/');
        await expect(
          nav.getByRole('link', { name: active['chrome.reportIssue'], exact: true }),
        ).toHaveAttribute('href', 'https://github.com/Caripson/visualnerve/issues/new/choose');
        if (id === 'en' && viewport.width === 390)
          await page.screenshot({
            path: testInfo.outputPath('workspace-welcome-inline-' + colorScheme + '.png'),
            animations: 'disabled',
          });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  const nav = page.locator('#workspace-site-nav');
  await expect(nav).toBeVisible();
  expect(await nav.getByRole('link').count()).toBe(7);
  await expect(
    nav.getByRole('link', { name: active['chrome.apiReference'], exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole('link', { name: active['chrome.workspace'], exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: active['privacy.localBadge.accessibleName'] }).click();
  await page.getByTestId('app-language').selectOption('en');
  await page.getByRole('dialog').locator('.modal-heading button').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Create a diagram', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await create.getByLabel('New diagram name', { exact: true }).fill('Mobile workspace');
  await create.getByRole('button', { name: /^Blank\b/ }).click();
  await create.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Mobile workspace', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.site-shell')).toBeHidden();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  const projects = page.getByRole('button', { name: 'Open projects', exact: true });
  const properties = page.getByRole('button', { name: 'Open properties', exact: true });
  await touchTarget(page, projects);
  await touchTarget(page, properties);
  await page.screenshot({
    path: testInfo.outputPath('mobile-workspace-controls.png'),
    animations: 'disabled',
  });
  await projects.tap();
  await expect(page.getByRole('dialog', { name: 'Projects', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('mobile-workspace-projects.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(projects).toBeFocused();
  await properties.tap();
  const panel = page.getByRole('dialog', { name: 'Properties', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Diagram name', { exact: true })).toHaveValue('Mobile workspace');
  await page.keyboard.press('Escape');
  await expect(properties).toBeFocused();
  expect(errors).toEqual([]);
});

test('Help and private API share inline compact links that activate directly by touch and keyboard', async ({
  page,
}) => {
  for (const path of ['/help/', '/api/docs/']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(app + path);
    await inlineNavigation(page);
    const nav = page.locator('#workspace-site-nav');
    await page.locator('.site-brand').focus();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Guide', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Privacy', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      nav.getByRole('link', { name: 'Report an issue on GitHub', exact: true }),
    ).toBeFocused();
    await nav.getByRole('link', { name: 'Privacy', exact: true }).tap();
    await expect(page).toHaveURL(app + '/privacy/');
    await expect(page.locator('main')).toContainText('AES-256-GCM');
    await page
      .locator('#workspace-site-nav')
      .getByRole('link', { name: 'Guide', exact: true })
      .tap();
    await expect(page).toHaveURL(app + '/help/');
    await page.setViewportSize({ width: 1440, height: 980 });
    await expect(
      page.locator('#workspace-site-nav').getByRole('link', { name: 'API reference', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('#workspace-site-nav').getByRole('link', { name: 'Workspace', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 640 });
    await inlineNavigation(page);
  }
});
