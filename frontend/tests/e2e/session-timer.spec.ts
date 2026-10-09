import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Disposable session timer acceptance passphrase';
async function policy(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        idleTimeoutMs: number;
        absoluteTimeoutMs: number;
        sessionTimerEnabled?: boolean;
      }>((resolve, reject) => {
        const open = indexedDB.open('visual-nerve-vault');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction('metadata', 'readonly')
            .objectStore('metadata')
            .get('control');
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            db.close();
            resolve(read.result.policy);
          };
        };
      }),
  );
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace security', exact: true })).toBeVisible();
}

test('actual encrypted app offers default-on automatic locking, persists opt-out and keeps password and manual locking', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app);
  const timer = page.getByRole('checkbox', { name: 'Automatic session lock', exact: true });
  await expect(timer).toBeChecked();
  await expect(page.getByRole('dialog')).toContainText('IndexedDB');
  await expect(page.getByRole('dialog')).toContainText('AES-256-GCM');
  await timer.uncheck();
  await expect(page.getByRole('dialog')).toContainText('Automatic locking is off.');
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const intro = page.getByRole('dialog', { name: 'Your work stays in this browser', exact: true });
  await expect(intro).toContainText('AES-256-GCM');
  await expect(intro).not.toContainText('can be a public website');
  await acknowledge(page);
  expect(await policy(page)).toEqual({
    idleTimeoutMs: 900000,
    absoluteTimeoutMs: 28800000,
    sessionTimerEnabled: false,
  });
  await settings(page);
  await expect(timer).not.toBeChecked();
  await expect(page.getByLabel('Lock after inactivity (minutes)', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Maximum session (hours)', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await expect(timer).not.toBeChecked();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await settings(page);
  await timer.check();
  await expect(page.getByLabel('Lock after inactivity (minutes)', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save session limits', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Session limits saved' })).toBeVisible();
  expect(await policy(page)).toEqual({ idleTimeoutMs: 900000, absoluteTimeoutMs: 28800000 });
  await timer.uncheck();
  await page.getByRole('button', { name: 'Save session limits', exact: true }).click();
  await expect.poll(async () => (await policy(page)).sessionTimerEnabled).toBe(false);
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await expect(timer).not.toBeChecked();
  expect(errors).toEqual([]);
});
