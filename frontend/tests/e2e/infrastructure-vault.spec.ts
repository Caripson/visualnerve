import { expect, test, type Page, type Worker } from '@playwright/test';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Synthetic infrastructure offline vault passphrase';

// Keep generated credentials out of failure screenshots and DOM/network traces.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace security', exact: true })).toBeVisible();
  await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
}

async function unlock(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Workspace password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await saved(page);
}

async function metric(page: Page, label: string) {
  const text = await page
    .getByRole('region', { name: 'Infrastructure capacity metrics' })
    .locator(`[data-infrastructure-metric="${label}"]`)
    .innerText();
  return Number(text.split(' ')[0].replaceAll(',', ''));
}

async function privateStorageCheck(page: Page, canary: string) {
  const result = await page.evaluate(
    async ({ canary, password }) => {
      const names = (await indexedDB.databases()).map((db) => db.name);
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
      const privateCachePaths: string[] = [];
      let cachedCanary = false,
        cachedPassword = false;
      const cacheNames = await caches.keys();
      for (const name of cacheNames)
        for (const request of await (await caches.open(name)).keys()) {
          const path = new URL(request.url).pathname;
          if (/^\/(?:api\/v1\/|diagrams\/|nodes\/|workspace\/|backup\/)/.test(path))
            privateCachePaths.push(path);
          const response = await (await caches.open(name)).match(request);
          if (
            response &&
            /(?:text|javascript|json|svg)/i.test(response.headers.get('content-type') ?? '')
          ) {
            const body = await response.text();
            cachedCanary ||= body.includes(canary);
            cachedPassword ||= body.includes(password);
          }
        }
      // Only booleans/counts leave the browser, never ciphertext, credentials or private records.
      return {
        encryptedDatabase: names.includes('visual-nerve-vault'),
        legacyDatabase: names.includes('visual-nerve-cache'),
        records: records.length,
        plaintextCanary: text.includes(canary),
        plaintextPassword: text.includes(password),
        plaintextDomain: text.includes('coreSeconds') || text.includes('amountMiB'),
        caches: cacheNames.length,
        privateCachePaths,
        cachedCanary,
        cachedPassword,
      };
    },
    { canary, password },
  );
  expect(result).toMatchObject({
    encryptedDatabase: true,
    legacyDatabase: false,
    plaintextCanary: false,
    plaintextPassword: false,
    plaintextDomain: false,
    privateCachePaths: [],
    cachedCanary: false,
    cachedPassword: false,
  });
  expect(result.records).toBeGreaterThan(0);
  expect(result.caches).toBeGreaterThan(0);
}

test('encrypted model2 active locking and offline MAX use actual local workers without grants or plaintext caches', async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const name = `Private compute capacity ${crypto.randomUUID()}`;
  const errors: string[] = [];
  const disallowedRequests: string[] = [];
  const sockets: string[] = [];
  const closedWorkers = new Set<Worker>();
  const spawnedWorkers: Worker[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => {
    spawnedWorkers.push(worker);
    worker.on('close', () => closedWorkers.add(worker));
  });
  page.on('websocket', (socket) => sockets.push(new URL(socket.url()).origin));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (
      url.origin !== app ||
      !['GET', 'HEAD'].includes(request.method()) ||
      /^(?:\/api\/v1\/|\/mcp(?:\/|$)|\/diagrams\/|\/nodes\/|\/workspace\/)/.test(url.pathname)
    )
      disallowedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Reflect.set(window, '__infrastructureVaultCsp', violations);
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
  });
  try {
    await test.step('Create an encrypted workspace and a real API & Compute gallery model', async () => {
      const response = await page.goto(app);
      const policy = response!.headers()['content-security-policy'];
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("worker-src 'self' blob:");
      expect(policy).not.toContain("'unsafe-eval'");
      await page.getByLabel('New workspace password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Save your recovery key' })).toBeVisible();
      await page.getByLabel('I have saved my recovery key in a protected location.').check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await acknowledge(page);
      await page
        .getByRole('button', { name: /^New diagram/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'API & Compute Capacity', exact: false }).click();
      await page.getByLabel('New diagram name').fill(name);
      await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
      await saved(page);
    });
    await test.step('Lock an actually running 1x workload and terminate its worker before fresh unlock', async () => {
      await page.getByLabel('Simulation speed').selectOption('1');
      const before = new Set(page.workers());
      await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
      await expect(page.locator('.simulation-run-status')).toHaveText('running');
      await expect
        .poll(() => page.workers().filter((worker) => !before.has(worker)).length)
        .toBeGreaterThan(0);
      const activeWorkers = page.workers().filter((worker) => !before.has(worker));
      await expect.poll(() => metric(page, 'cpu:Completed CPU work')).toBeGreaterThan(0);
      await expect.poll(() => metric(page, 'ram:Used now')).toBeGreaterThan(0);
      await settings(page);
      await page.getByRole('button', { name: 'Lock now', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeHidden();
      await expect(
        page.getByRole('region', { name: 'Infrastructure capacity metrics' }),
      ).toBeHidden();
      await expect
        .poll(() => activeWorkers.every((worker) => closedWorkers.has(worker)))
        .toBe(true);
      await unlock(page, name);
      await expect(page.locator('.simulation-run-status')).toHaveText('ready');
    });
    await test.step('Wait for a complete activated and claimed static app before going offline', async () => {
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const registration = await navigator.serviceWorker.getRegistration();
              const controller = navigator.serviceWorker.controller;
              return {
                active: registration?.active?.state ?? null,
                controller: controller?.state ?? null,
                controlledByActive: !!controller && controller === registration?.active,
              };
            }),
          { timeout: 30000 },
        )
        .toEqual({
          active: 'activated',
          controller: 'activated',
          controlledByActive: true,
        });
      await privateStorageCheck(page, name);
      expect(await page.evaluate(() => Reflect.get(window, '__infrastructureVaultCsp'))).toEqual(
        [],
      );
    });
    await test.step('Reload locked, unlock and execute a new MAX worker with the network disabled', async () => {
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeHidden();
      await unlock(page, name);
      await page.getByLabel('Simulation speed').selectOption('max');
      await page.getByLabel('Simulation duration hours').fill(String(6 / 3600));
      await page.getByLabel('Simulation random seed').fill('42');
      const before = spawnedWorkers.length;
      await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
      await expect(page.locator('.simulation-run-status')).toHaveText('completed', {
        timeout: 30000,
      });
      // A successful final result intentionally terminates its worker before the UI publishes it.
      expect(spawnedWorkers.length).toBeGreaterThan(before);
      expect(
        spawnedWorkers
          .slice(before)
          .some((worker) => worker.url().startsWith(`${app}/editor/assets/worker-`)),
      ).toBe(true);
      await expect(
        page.getByRole('region', { name: 'Infrastructure capacity metrics' }),
      ).toBeVisible();
      expect(await metric(page, 'cpu:Peak reserved')).toBe(2);
      expect(await metric(page, 'ram:Peak used')).toBe(480);
      const completed = await metric(page, 'cpu:Completed CPU work');
      expect(completed).toBeGreaterThan(1);
      expect(completed).toBeLessThanOrEqual(12);
      await saved(page);
      await privateStorageCheck(page, name);
      expect(await page.evaluate(() => Reflect.get(window, '__infrastructureVaultCsp'))).toEqual(
        [],
      );
      expect(errors).toEqual([]);
      expect(disallowedRequests).toEqual([]);
      expect(sockets).toEqual([]);
    });
    await settings(page);
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
