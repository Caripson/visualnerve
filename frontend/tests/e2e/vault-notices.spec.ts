import { expect, test, type Download, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';
import { SPEECH_MODEL_CACHE } from '../../src/presentation/speech/protocol';

const publicURL = 'https://public-app.test:4340';
const publicApp = `${publicURL}/app/`;
const ownedShell = /^visual-nerve-(?:app-)?shell-[a-f0-9]{12}$/;

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Data and Privacy', exact: true })).toBeVisible();
}
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: /New diagram/ }).click();
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
}
async function downloaded(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function storedWorkspace(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const request = indexedDB.open('visual-nerve-cache');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const names = [...database.objectStoreNames];
          const result: Record<string, unknown[]> = {};
          const transaction = database.transaction(names, 'readonly');
          for (const name of names) {
            const read = transaction.objectStore(name).getAll();
            read.onsuccess = () => {
              result[name] = read.result;
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}
function backupNotice(page: Page) {
  return page.getByRole('complementary', { name: 'Security of downloaded copies', exact: true });
}

test('legacy app warns at first use, Settings and export that current downloaded JSON is readable', async ({
  page,
}) => {
  await page.goto(publicApp);
  await expect(backupNotice(page)).toContainText('contain readable workspace content');
  await expect(backupNotice(page)).toContainText('do not update files you already downloaded');
  await expect(backupNotice(page).getByRole('link')).toHaveAttribute(
    'href',
    '/help/settings/#downloaded-copies-and-password-changes',
  );
  await acknowledge(page);
  await create(page, 'Readable backup proof');
  await settings(page);
  await expect(backupNotice(page)).toContainText('contain readable workspace content');
  await expect(backupNotice(page)).not.toContainText('Older encrypted backups');
  const dataDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const backup = await downloaded(await dataDownload);
  expect(backup.format).toBe('visual-nerve-workspace');
  expect(
    backup.diagrams.some((diagram: { name: string }) => diagram.name === 'Readable backup proof'),
  ).toBe(true);
  expect(backup.nodes.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(backupNotice(page)).toContainText('contain readable workspace content');
  await page.getByLabel('Export format').selectOption('markdown');
  await expect(backupNotice(page)).toContainText('contain readable workspace content');
  await page.getByLabel('Export target').selectOption('workspace');
  await expect(backupNotice(page)).toContainText('contain readable workspace content');
  const menuDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  expect((await downloaded(await menuDownload)).format).toBe('visual-nerve-workspace');
});

test('Clear app cache uses the real service worker handshake and preserves all workspace records and unrelated caches', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(publicApp);
  await acknowledge(page);
  await create(page, 'Cache clearing preserves this');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await settings(page);
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await saved(page);
  await page.evaluate(async (voiceCache) => {
    await (
      await caches.open(voiceCache)
    ).put('/test-voice-model', new Response('downloaded voice fixture'));
    await (
      await caches.open('visual-nerve-app-shell-abcdef123456')
    ).put('/fixture-app', new Response('old isolated app asset'));
    await (
      await caches.open('unrelated-cache-owned-by-another-feature')
    ).put('/keep-this', new Response('preserve me'));
  }, SPEECH_MODEL_CACHE);
  const before = await storedWorkspace(page);
  const beforeKeys = await page.evaluate(() => caches.keys());
  expect(beforeKeys.some((name) => ownedShell.test(name))).toBe(true);
  expect(beforeKeys).toContain(SPEECH_MODEL_CACHE);
  await page.getByRole('button', { name: 'Clear app cache', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'App cache cleared.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear app cache', exact: true })).toBeEnabled();
  const afterKeys = await page.evaluate(() => caches.keys());
  expect(afterKeys.filter((name) => ownedShell.test(name) || name === SPEECH_MODEL_CACHE)).toEqual(
    [],
  );
  expect(afterKeys).toContain('visual-nerve-cache-control-v1');
  expect(afterKeys).toContain('unrelated-cache-owned-by-another-feature');
  expect(
    await page.evaluate(async () =>
      (
        await (await caches.open('unrelated-cache-owned-by-another-feature')).match('/keep-this')
      )?.text(),
    ),
  ).toBe('preserve me');
  expect(await storedWorkspace(page)).toEqual(before);
  await page.getByRole('button', { name: 'Clear app cache', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'App cache cleared.' })).toBeVisible();
  expect(await storedWorkspace(page)).toEqual(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await saved(page);
  await expect(
    page.getByRole('heading', { name: 'Cache clearing preserves this', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(pageErrors).toEqual([]);
});

test('Help explicitly distinguishes readable current backups from older encrypted copies retaining old credentials', async ({
  page,
}) => {
  await page.goto(`${publicURL}/help/settings/#downloaded-copies-and-password-changes`);
  const section = page.locator('#downloaded-copies-and-password-changes');
  await expect(section).toBeVisible();
  const article = page.locator('.help-article');
  await expect(article).toContainText(
    'Ordinary backups from the existing plaintext workspace, individual diagram JSON/Markdown exports',
  );
  await expect(article).toContainText(
    'changing its password or recovery key does not change previously downloaded encrypted backups',
  );
  await expect(article).toContainText(
    'An old backup still uses the password or recovery material that protected it when it was created',
  );
  await expect(article).toContainText('A new workspace password cannot revoke that file');
  await expect(article).toContainText('Plaintext exports remain unencrypted');
});
