import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Synthetic capacity template entry passphrase';
const templates = [
  ['api-compute-capacity', 'API & Compute Capacity'],
  ['network-multi-site-capacity', 'Network & Multi-Site Capacity'],
  ['energy-power-capacity', 'Energy & Power Capacity'],
  ['datacenter-capacity', 'Datacenter Capacity'],
] as const;

// Recovery material and password fields must not enter browser failure artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function unlocked(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Workspace password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function saved(page: Page, name: string, count: number) {
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(page).toHaveURL(`${app}/`);
  await expect(page.locator('button[data-diagram-id]')).toHaveCount(count);
}

test('public capacity links wait for vault unlock, persist encrypted models and remain unique after reload', async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const outgoing: string[] = [];
  const sockets: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== app || !['GET', 'HEAD'].includes(request.method()))
      outgoing.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  page.on('websocket', (socket) => sockets.push(new URL(socket.url()).origin));

  await test.step('Create the first example only after human setup and local-storage consent', async () => {
    const [key, name] = templates[0];
    await page.goto(`${app}/?demo=${key}`);
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeHidden();
    await expect(page).toHaveURL(`${app}/?demo=${key}`);
    await page.getByLabel('New workspace password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Save your recovery key' })).toBeVisible();
    await page.getByLabel('I have saved my recovery key in a protected location.').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeHidden();
    await expect(page).toHaveURL(`${app}/?demo=${key}`);
    await acknowledge(page);
    await saved(page, name, 1);
    await page.reload();
    await unlocked(page);
    await saved(page, name, 1);
  });

  for (const [index, [key, name]] of templates.entries()) {
    if (index === 0) continue;
    await test.step(`${name} remains pending while locked and creates once after unlock`, async () => {
      await page.goto(`${app}/?demo=${key}`);
      await expect(
        page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeHidden();
      await expect(page.locator('button[data-diagram-id]')).toHaveCount(0);
      await expect(page).toHaveURL(`${app}/?demo=${key}`);
      await unlocked(page);
      await saved(page, name, index + 1);
      await page.reload();
      await unlocked(page);
      await saved(page, name, index + 1);
    });
  }

  const storage = await page.evaluate(
    async (names) => {
      const databases = (await indexedDB.databases()).map((value) => value.name);
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('visual-nerve-vault');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('records', 'readonly').objectStore('records').getAll();
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
        };
      });
      const text = JSON.stringify(records);
      return {
        vault: databases.includes('visual-nerve-vault'),
        legacy: databases.includes('visual-nerve-cache'),
        records: records.length,
        plaintextModel: text.includes('coreSeconds') || text.includes('amountMiB'),
        plaintextNames: names.some((name) => text.includes(name)),
      };
    },
    templates.map(([, name]) => name),
  );
  expect(storage).toMatchObject({
    vault: true,
    legacy: false,
    plaintextModel: false,
    plaintextNames: false,
  });
  expect(storage.records).toBeGreaterThan(0);
  expect(outgoing).toEqual([]);
  expect(sockets).toEqual([]);
});
