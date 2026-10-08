import { expect, test, type Page, type Download } from '@playwright/test';
import { acknowledge } from './fixtures';
const app = 'https://public-app.test:4341';
const password = 'Browser test encrypted workspace phrase';
async function setup(page: Page) {
  await page.goto(app);
  await expect(page.getByRole('dialog', { name: 'Protect your local workspace' })).toBeVisible();
  await expect(page.getByLabel('Security of downloaded copies')).toContainText(
    'Changing your workspace password',
  );
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your recovery key' })).toBeVisible();
  const recovery = await page.getByLabel('Recovery key — keep it private').inputValue();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  return recovery;
}
async function create(page: Page, name: string) {
  await page
    .getByRole('button', { name: /New diagram/ })
    .first()
    .click();
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace security', exact: true })).toBeVisible();
}
async function downloadText(download: Download) {
  const pieces: Buffer[] = [];
  for await (const piece of (await download.createReadStream())!) pieces.push(piece);
  return Buffer.concat(pieces).toString();
}
async function unlock(page: Page, value = password) {
  await page.getByLabel('Workspace password', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}
async function raw(page: Page) {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open('visual-nerve-vault');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('records').objectStore('records').getAll();
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
    return { names, text: JSON.stringify(values) };
  });
}
test('isolated app protects creation, saved records, reload and encrypted workspace exports in real Chrome', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const recovery = await setup(page);
  expect(recovery).toMatch(/^VNREC1-/);
  await create(page, 'Private browser canary process');
  const stored = await raw(page);
  expect(stored.names).toContain('visual-nerve-vault');
  expect(stored.names).not.toContain('visual-nerve-cache');
  expect(stored.text).not.toContain('Private browser canary process');
  expect(stored.text).not.toContain(password);
  expect(stored.text).not.toContain(recovery);
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const text = await downloadText(await pending);
  expect(JSON.parse(text).format).toBe('visualnerve-backup');
  expect(text).not.toContain('Private browser canary process');
  expect(text).not.toContain(password);
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Private browser canary process', exact: true }),
  ).toBeHidden();
  await unlock(page, 'Wrong test workspace password');
  await expect(page.getByRole('alert')).toContainText('Could not authenticate');
  await unlock(page);
  await expect(
    page.getByRole('heading', { name: 'Private browser canary process', exact: true, level: 1 }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await unlock(page);
  await expect(
    page.getByRole('heading', { name: 'Private browser canary process', exact: true, level: 1 }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('joining tabs require their own password and manual lock revokes both tabs', async ({
  page,
  context,
}) => {
  await setup(page);
  await create(page, 'Shared encrypted profile');
  const second = await context.newPage();
  await second.goto(app);
  await expect(
    second.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await unlock(second);
  await expect(
    second.getByRole('heading', { name: 'Shared encrypted profile', exact: true, level: 1 }),
  ).toBeVisible();
  await settings(page);
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  for (const tab of [page, second]) {
    await expect(
      tab.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    await expect(
      tab.getByRole('heading', { name: 'Shared encrypted profile', exact: true }),
    ).toBeHidden();
  }
  await unlock(second);
  await expect(
    second.getByRole('heading', { name: 'Shared encrypted profile', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
});
test('password and recovery forms fit a mobile viewport without revealing the canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app);
  const dialog = page.getByRole('dialog', { name: 'Protect your local workspace' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your recovery key' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /New diagram/ })).toBeHidden();
});

test('password changes lock the live vault while an older backup keeps its original credentials', async ({
  page,
}) => {
  const recovery = await setup(page);
  await create(page, 'Original backup credential example');
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const content = await downloadText(await pending);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change workspace password', exact: true });
  await expect(dialog.getByLabel('Security of downloaded copies')).toContainText(
    'Older encrypted backups',
  );
  const nextPassword = 'New browser-only password for the current workspace';
  await dialog.getByLabel('New workspace password', { exact: true }).fill(nextPassword);
  await dialog.getByLabel('Confirm new password', { exact: true }).fill(nextPassword);
  await dialog.getByLabel('Current workspace password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Change password and lock', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await unlock(page);
  await expect(page.getByRole('alert')).toContainText('Could not authenticate');
  await unlock(page, nextPassword);
  await expect(
    page.getByRole('heading', {
      name: 'Original backup credential example',
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await settings(page);
  const backupFile = {
    name: 'original-encrypted-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  };
  await page.getByLabel('Restore backup file', { exact: true }).setInputFiles(backupFile);
  const reader = page.getByRole('dialog', { name: 'Unlock encrypted backup', exact: true });
  await expect(reader).toBeVisible();
  await reader.getByLabel('Backup password', { exact: true }).fill(nextPassword);
  await reader.getByRole('button', { name: 'Read backup', exact: true }).click();
  await expect(reader.getByRole('alert')).toContainText('Could not authenticate');
  await reader.getByLabel('Backup password', { exact: true }).fill(password);
  await reader.getByRole('button', { name: 'Read backup', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Import Visual Nerve backup', exact: true });
  await expect(preview).toContainText('1 diagram');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settings(page);
  await page.getByLabel('Restore backup file', { exact: true }).setInputFiles(backupFile);
  await reader.getByLabel('Backup credential type').selectOption('recovery');
  await reader.getByLabel('Backup recovery key', { exact: true }).fill(recovery);
  await reader.getByRole('button', { name: 'Read backup', exact: true }).click();
  await expect(preview).toContainText('1 diagram');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  const stored = await raw(page);
  expect(stored.text).not.toContain('Original backup credential example');
  expect(stored.text).not.toContain(password);
  expect(stored.text).not.toContain(nextPassword);
});

test('a saved inactivity limit locks the actual app without losing durable work', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await create(page, 'Automatic lock preserves saved work');
  await settings(page);
  await page.getByLabel('Lock after inactivity (minutes)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save session limits', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Session limits saved.' })).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Automatic lock preserves saved work', exact: true }),
  ).toBeHidden();
  await unlock(page);
  await expect(
    page.getByRole('heading', {
      name: 'Automatic lock preserves saved work',
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
});

test('the encrypted workspace exposes the same model to MCP and retains only safe locked control', async ({
  page,
  playwright,
}) => {
  const request = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    ignoreHTTPSErrors: true,
  });
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: {
          name: 'visual_nerve_request',
          arguments: { path, method, ...(data === undefined ? {} : { data }) },
        },
      },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    return body.result;
  };
  const connected = async (count: number) =>
    expect
      .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
      .toBe(count);
  try {
    await setup(page);
    await create(page, 'Encrypted MCP parity canary');
    await connected(0);
    await settings(page);
    await page.getByText('Local connection details', { exact: true }).click();
    await page
      .getByLabel('Local bridge address', { exact: true })
      .fill('wss://127.0.0.1:4329/bridge');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await page.getByLabel('MCP access', { exact: true }).selectOption('read');
    await connected(1);
    const discovered = await call('/workspace/security');
    expect(discovered.structuredContent.body).toMatchObject({
      mode: 'encrypted',
      state: 'unlocked',
      cipher: 'AES-256-GCM',
      programmaticUnlock: false,
    });
    const denied = await call('/workspace/lock', 'POST', {});
    expect(denied.structuredContent.status).toBe(403);
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await expect.poll(async () => (await call('/diagrams')).structuredContent.status).toBe(200);
    const invalid = await call('/workspace/lock', 'POST', {
      password: 'Credentials must never be accepted here',
    });
    expect(invalid.structuredContent.status).toBe(422);
    const listed = await call('/diagrams');
    const diagram = listed.structuredContent.body.find(
      (item: { name: string }) => item.name === 'Encrypted MCP parity canary',
    );
    expect(diagram).toBeDefined();
    const added = await call(`/diagrams/${diagram.id}/nodes`, 'POST', {
      title: 'The same encrypted MCP model',
      x: 0,
      y: 400,
    });
    expect(added.structuredContent.status).toBe(201);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(`[data-node-id="${added.structuredContent.body.id}"]`)).toContainText(
      'The same encrypted MCP model',
    );
    const locked = await call('/workspace/lock', 'POST', {});
    expect(locked.structuredContent.status).toBe(200);
    expect(locked.structuredContent.body.state).toBe('locked');
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    await connected(1);
    const privateRead = await call('/diagrams');
    expect(privateRead.structuredContent.status).toBe(423);
    expect(privateRead.structuredContent.body.code).toBe('WORKSPACE_LOCKED');
    expect(JSON.stringify(privateRead)).not.toContain('Encrypted MCP parity canary');
    expect((await call('/workspace/security')).structuredContent.body.state).toBe('locked');
    expect((await call('/workspace/lock', 'POST', {})).structuredContent.body.state).toBe('locked');
    await unlock(page);
    await expect(
      page.getByRole('heading', { name: 'Encrypted MCP parity canary', exact: true, level: 1 }),
    ).toBeVisible();
    expect((await call('/workspace/security')).structuredContent.body.state).toBe('unlocked');
    expect((await call('/diagrams')).structuredContent.status).toBe(403);
    expect((await call('/workspace/lock', 'POST', {})).structuredContent.status).toBe(403);
    await expect(
      page.getByRole('heading', { name: 'Encrypted MCP parity canary', exact: true, level: 1 }),
    ).toBeVisible();
    await settings(page);
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await expect.poll(async () => (await call('/diagrams')).structuredContent.status).toBe(200);
    await page.getByLabel('MCP access', { exact: true }).selectOption('off');
    await connected(0);
    expect((await call('/diagrams')).structuredContent.status).toBe(503);
    await page.reload();
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    await connected(0);
  } finally {
    await request.dispose();
  }
});

test('an encrypted transfer preserves original object identities and leaves the legacy source intact', async ({
  page,
  context,
}) => {
  await page.goto('http://127.0.0.1:4327/app/');
  await acknowledge(page);
  await create(page, 'Original origin transfer canary');
  const nodeIds = await page
    .locator('[data-node-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort());
  expect(nodeIds.length).toBeGreaterThan(1);
  const original = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('visual-nerve-cache');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const read = db.transaction(['diagrams', 'nodes', 'edges']);
    const result = await Promise.all(
      ['diagrams', 'nodes', 'edges'].map(
        (name) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = read.objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    db.close();
    return result;
  });
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Export encrypted transfer', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'Encrypted transfer backup', exact: true });
  const transferPassword = 'Original encrypted transfer password phrase';
  await transfer.getByLabel('Transfer backup password', { exact: true }).fill(transferPassword);
  await transfer.getByLabel('Confirm transfer password', { exact: true }).fill(transferPassword);
  await transfer.getByRole('button', { name: 'Prepare encrypted backup', exact: true }).click();
  await expect(transfer.getByLabel('Recovery key — keep it private')).toBeVisible();
  const download = page.waitForEvent('download');
  await transfer.getByLabel('I have saved my recovery key in a protected location.').check();
  await transfer.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
  const content = await downloadText(await download);
  expect(JSON.parse(content).format).toBe('visualnerve-backup');
  expect(content).not.toContain('Original origin transfer canary');
  expect(content).not.toContain(transferPassword);
  const destination = await context.newPage();
  await setup(destination);
  await settings(destination);
  await destination
    .getByRole('button', { name: 'Transfer existing workspace', exact: true })
    .click();
  await destination.getByLabel('Restore backup file', { exact: true }).setInputFiles({
    name: 'encrypted-origin-transfer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  const reader = destination.getByRole('dialog', { name: 'Unlock encrypted backup', exact: true });
  await reader.getByLabel('Backup password', { exact: true }).fill(transferPassword);
  await reader.getByRole('button', { name: 'Read backup', exact: true }).click();
  const preview = destination.getByRole('dialog', {
    name: 'Move an existing workspace',
    exact: true,
  });
  await expect(preview).toContainText('original identifiers');
  await expect(destination.locator('[data-node-id]')).toHaveCount(0);
  await preview.getByRole('checkbox', { name: /I have kept the source workspace/ }).check();
  await preview.getByRole('button', { name: 'Transfer and verify', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('Transfer verified:', { timeout: 30000 });
  await preview.getByRole('button', { name: 'Open transferred workspace', exact: true }).click();
  await expect(
    destination.getByRole('heading', {
      name: 'Original origin transfer canary',
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  expect(
    await destination
      .locator('[data-node-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort()),
  ).toEqual(nodeIds);
  const copied = await raw(destination);
  expect(copied.names).not.toContain('visual-nerve-cache');
  expect(copied.text).not.toContain('Original origin transfer canary');
  await destination.reload();
  await unlock(destination);
  await expect(
    destination.getByRole('heading', {
      name: 'Original origin transfer canary',
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const remaining = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('visual-nerve-cache');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const read = db.transaction(['diagrams', 'nodes', 'edges']);
    const result = await Promise.all(
      ['diagrams', 'nodes', 'edges'].map(
        (name) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = read.objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    db.close();
    return result;
  });
  expect(remaining).toEqual(original);
});

test('offline encrypted reload and cache clearing preserve private records and unrelated caches', async ({
  page,
  context,
}) => {
  await setup(page);
  await create(page, 'Offline encrypted work canary');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const names = await caches.keys();
        for (const name of names.filter((value) => /^visual-nerve-app-shell-/.test(value)))
          if (await (await caches.open(name)).match(location.origin + '/')) return true;
        return false;
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await unlock(page);
  await expect(
    page.getByRole('heading', { name: 'Offline encrypted work canary', exact: true, level: 1 }),
  ).toBeVisible();
  const before = await raw(page);
  await page.evaluate(async () => {
    await (
      await caches.open('unrelated-encrypted-browser-test')
    ).put('/unrelated', new Response('keep'));
  });
  await settings(page);
  await page.getByRole('button', { name: 'Clear app cache', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'App cache cleared.' })).toBeVisible();
  expect((await raw(page)).text).toBe(before.text);
  const cachesAfter = await page.evaluate(() => caches.keys());
  expect(cachesAfter).toContain('unrelated-encrypted-browser-test');
  expect(cachesAfter.some((value) => /^visual-nerve-app-shell-/.test(value))).toBe(false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Offline encrypted work canary', exact: true, level: 1 }),
  ).toBeVisible();
  await context.setOffline(false);
});

test('incident rotation replaces the current content key while an old backup keeps its old credentials', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url() + (request.postData() ?? '')));
  const originalRecovery = await setup(page);
  await create(page, 'Incident rotation private canary');
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const originalBackup = await downloadText(await pending);
  const previous = JSON.parse((await raw(page)).text) as {
    id: string;
    encrypted: { keyVersion: number };
  }[];
  await page.getByText('Suspected content-key exposure', { exact: true }).click();
  await page.getByRole('button', { name: 'Rotate workspace content key', exact: true }).click();
  const rotation = page.getByRole('dialog', {
    name: 'Rotate the workspace content key',
    exact: true,
  });
  await expect(rotation).toBeVisible();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await expect(rotation.getByLabel('Security of downloaded copies')).toContainText(
    'Copies held by someone else cannot be recalled.',
  );
  const nextPassword = 'Entirely new password after content key incident';
  await rotation.getByLabel('New workspace password', { exact: true }).fill(nextPassword);
  await rotation.getByLabel('Confirm new password', { exact: true }).fill(nextPassword);
  await rotation.getByLabel('Current workspace password', { exact: true }).fill(password);
  await rotation.getByRole('button', { name: 'Prepare new content key', exact: true }).click();
  const recovery = await rotation.getByLabel('Recovery key — keep it private').inputValue();
  expect(recovery).not.toBe(originalRecovery);
  await expect(
    rotation.getByRole('button', { name: 'Rotate content key and lock', exact: true }),
  ).toBeDisabled();
  await rotation.getByLabel('I have saved my recovery key in a protected location.').check();
  await rotation.getByRole('button', { name: 'Rotate content key and lock', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const current = JSON.parse((await raw(page)).text) as {
    id: string;
    encrypted: { keyVersion: number };
  }[];
  expect(current.every((record) => record.encrypted.keyVersion === 2)).toBe(true);
  expect(current.some((record) => previous.some((old) => old.id === record.id))).toBe(false);
  await unlock(page);
  await expect(page.getByRole('alert')).toContainText('Could not authenticate');
  await unlock(page, nextPassword);
  await expect(
    page.getByRole('heading', { name: 'Incident rotation private canary', exact: true, level: 1 }),
  ).toBeVisible();
  await settings(page);
  await page.getByLabel('Restore backup file', { exact: true }).setInputFiles({
    name: 'pre-incident-encrypted-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(originalBackup),
  });
  const reader = page.getByRole('dialog', { name: 'Unlock encrypted backup', exact: true });
  await reader.getByLabel('Backup password', { exact: true }).fill(password);
  await reader.getByRole('button', { name: 'Read backup', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Import Visual Nerve backup', exact: true });
  await expect(preview).toContainText('1 diagram');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  const rawText = (await raw(page)).text;
  for (const secret of [
    password,
    nextPassword,
    originalRecovery,
    recovery,
    'Incident rotation private canary',
  ]) {
    expect(rawText).not.toContain(secret);
    expect(requests.join('\n')).not.toContain(secret);
  }
});
