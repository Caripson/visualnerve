import { webcrypto } from 'node:crypto';
import { expect, test, type Download, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';
import { AppUpdateFixture } from './app-update-fixture';
import { VaultCrypto } from '../../src/security/vault-crypto';
import type { EncryptedVaultBackup } from '../../src/security/vault-schema';
import type { WorkspaceBackup } from '../../src/storage/database';

const password = 'Native app update acceptance protected phrase';
const title = 'Protected customer ledger across an app update';
let fixture: AppUpdateFixture;

test.beforeAll(async () => {
  fixture = await AppUpdateFixture.start();
});
test.afterAll(async () => {
  await fixture?.stop();
});
test.beforeEach(() => fixture.publish(1));
test.afterEach(async ({ context }, testInfo) => {
  for (const [index, page] of context.pages().entries()) {
    if (page.isClosed()) continue;
    const nativeRelease = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        installing: registration?.installing?.state ?? null,
        waiting: registration?.waiting?.state ?? null,
        active: registration?.active?.state ?? null,
        controller: navigator.serviceWorker.controller?.state ?? null,
        transitions: Reflect.get(window, '__nativeAppUpdateTransitions') ?? [],
      };
    });
    await testInfo.attach(`native-release-${index + 1}.json`, {
      body: JSON.stringify(nativeRelease, null, 2),
      contentType: 'application/json',
    });
  }
});

function notice(page: Page) {
  return page.locator('.app-update-notice');
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function nativeReleaseState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const controller = navigator.serviceWorker.controller;
    return {
      installing: registration?.installing?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      active: registration?.active?.state ?? null,
      controller: controller?.state ?? null,
      controlledByActive: !!controller && controller === registration?.active,
    };
  });
}
async function setup(page: Page) {
  await page.goto(fixture.origin);
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  await expect
    .poll(() => nativeReleaseState(page), {
      timeout: 30000,
      message: 'The complete offline release must activate and claim this native app page.',
    })
    .toMatchObject({ active: 'activated', controller: 'activated', controlledByActive: true });
  expect(await workerVersion(page, 'active')).toBe(fixture.first.version);
  // Claiming the initial worker is installation, not a newly available release.
  await expect(notice(page)).toHaveCount(0);
}
async function unlock(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Workspace password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function workerVersion(page: Page, which: 'active' | 'waiting') {
  return page.evaluate(async (kind) => {
    const worker = (await navigator.serviceWorker.getRegistration())?.[kind];
    if (!worker) return undefined;
    return new Promise<string>((accept, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(
        () => reject(new Error('Native release metadata did not respond.')),
        5000,
      );
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        accept(event.data.version);
      };
      worker.postMessage({ type: 'app-update-info' }, [channel.port2]);
    });
  }, which);
}
async function focus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function available(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || Reflect.has(window, '__nativeAppUpdateTransitions')) return;
    const transitions: unknown[] = [];
    Reflect.set(window, '__nativeAppUpdateTransitions', transitions);
    const watched = new Set<ServiceWorker>();
    const record = () => {
      transitions.push({
        elapsedMs: performance.now(),
        installing: registration.installing?.state ?? null,
        waiting: registration.waiting?.state ?? null,
        active: registration.active?.state ?? null,
        controller: navigator.serviceWorker.controller?.state ?? null,
      });
      for (const worker of [registration.installing, registration.waiting, registration.active]) {
        if (!worker || watched.has(worker)) continue;
        watched.add(worker);
        worker.addEventListener('statechange', record);
      }
    };
    registration.addEventListener('updatefound', record);
    record();
  });
  // Installing the full offline shell is a separate phase from displaying a
  // notice. Native cache/body settlement can outlast the editor's UI deadline.
  // Only focus/online discovery requests the update; this poll never calls update().
  await expect
    .poll(() => nativeReleaseState(page), {
      timeout: 30000,
      message: 'The discovered release must finish installing before it can be offered.',
    })
    .toMatchObject({ waiting: 'installed', active: 'activated', controller: 'activated' });
  expect(await workerVersion(page, 'waiting')).toBe(fixture.second.version);
  expect(await workerVersion(page, 'active')).toBe(fixture.first.version);
  await expect(notice(page).getByRole('button', { name: 'Update now', exact: true })).toBeVisible();
  await test.info().attach('native-release-installed.json', {
    body: JSON.stringify(
      await page.evaluate(() => Reflect.get(window, '__nativeAppUpdateTransitions')),
      null,
      2,
    ),
    contentType: 'application/json',
  });
}
async function createLedger(page: Page) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'protected-update-ledger.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Company,Customer,Amount\nAlpha,One,10\nAlpha,Two,20\nBeta,Three,30'),
  });
  const importing = page.getByRole('dialog', { name: 'Import CSV data', exact: true });
  await importing.getByLabel('CSV diagram name').fill(title);
  await importing
    .getByLabel('Grouping level 1', { exact: true })
    .selectOption({ label: 'Company' });
  await importing.getByRole('button', { name: 'Create data diagram' }).click();
  await expect(importing).toBeHidden();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await saved(page);
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace security', exact: true })).toBeVisible();
}
async function readDownload(download: Download) {
  const pieces: Buffer[] = [];
  for await (const piece of (await download.createReadStream())!) pieces.push(piece);
  return Buffer.concat(pieces).toString();
}
async function backup(page: Page): Promise<WorkspaceBackup> {
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  const text = await readDownload(await pending);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(text).not.toContain(title);
  const container = JSON.parse(text) as EncryptedVaultBackup;
  expect(container.format).toBe('visualnerve-backup');
  // Authenticate the actual UI export with the production codec and native
  // WebCrypto. The browser's encryption/IndexedDB implementations are untouched.
  const cryptography = new VaultCrypto(webcrypto as unknown as Crypto);
  const keys = await cryptography.unlockWithPassword(container.header, password);
  const bytes = await cryptography.decryptBackup(keys, container);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as WorkspaceBackup;
  } finally {
    bytes.fill(0);
    cryptography.destroyKeys(keys);
  }
}
async function selectRoot(page: Page) {
  await page.locator('.canvas-shell [data-testid="graph-node"]').first().click();
  await expect(page.getByLabel('Node description', { exact: true })).toBeVisible();
}
async function rememberPage(page: Page, value: string) {
  await page.evaluate((identity) => {
    Object.defineProperty(window, '__appUpdateAcceptanceIdentity', { value: identity });
  }, value);
}
async function identity(page: Page) {
  return page.evaluate(() => Reflect.get(window, '__appUpdateAcceptanceIdentity'));
}
async function releaseMarker(page: Page) {
  return page.locator('meta[name="visual-nerve-update-fixture"]').getAttribute('content');
}

test('focus discovers a real release; approved update saves the latest edit and preserves encrypted sources, history and settings without reloading another tab', async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  await setup(page);
  await createLedger(page);
  await page.getByRole('button', { name: 'Understand', exact: true }).click();
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Diagram history', exact: true });
  await history.getByLabel('Snapshot name', { exact: true }).fill('Before static release update');
  await history.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await expect(history.getByRole('status')).toHaveText('Named snapshot saved locally.');
  await history.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await settings(page);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await saved(page);

  const other = await context.newPage();
  await other.goto(fixture.origin);
  await unlock(other);
  await expect(other.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await saved(other);
  await rememberPage(other, 'keep the other app tab running');
  let otherNavigations = 0;
  other.on('framenavigated', (frame) => {
    if (frame === other.mainFrame()) otherNavigations++;
  });
  const before = await backup(page);
  expect(before.datasets?.[0].rows).toHaveLength(3);
  expect(before.history?.snapshots.map((snapshot) => snapshot.name)).toContain(
    'Before static release update',
  );
  await rememberPage(page, 'original release stays open until approval');
  fixture.publish(2);
  await focus(page);
  await available(page);
  expect(await releaseMarker(page)).toBe('1');
  expect(await identity(page)).toBe('original release stays open until approval');

  await selectRoot(page);
  const editedId = await page.locator('.react-flow__node.selected').getAttribute('data-id');
  const description = 'The newest typed explanation must be saved before this approved restart.';
  await page.getByLabel('Node description', { exact: true }).fill(description);
  await expect(page.locator('.save-status')).toHaveText('Saving…');
  const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await notice(page).getByRole('button', { name: 'Update now', exact: true }).click();
  await reloaded;
  await unlock(page);
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await saved(page);
  expect(await releaseMarker(page)).toBe('2');
  expect(await workerVersion(page, 'active')).toBe(fixture.second.version);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const after = await backup(page);
  expect(after.datasets).toEqual(before.datasets);
  expect(after.history).toEqual(before.history);
  expect(after.edges).toEqual(before.edges);
  expect(after.owners).toEqual(before.owners);
  expect(after.settings).toEqual(before.settings);
  expect(after.nodes.find((node) => node.id === editedId)?.description).toBe(description);
  const content = (node: WorkspaceBackup['nodes'][number]) => {
    const { updatedAt: _updated, version: _version, ...value } = node;
    return value;
  };
  expect(after.nodes.map(content)).toEqual(
    before.nodes.map((node) => content(node.id === editedId ? { ...node, description } : node)),
  );
  expect(
    after.diagrams.map((diagram) => ({
      id: diagram.id,
      name: diagram.name,
      settings: diagram.settings,
    })),
  ).toEqual(
    before.diagrams.map((diagram) => ({
      id: diagram.id,
      name: diagram.name,
      settings: diagram.settings,
    })),
  );
  expect(otherNavigations).toBe(0);
  expect(await releaseMarker(other)).toBe('1');
  expect(await identity(other)).toBe('keep the other app tab running');
  await expect(other.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await expect(notice(other)).toBeVisible();
});

test('offline discovery keeps editing available; reconnect finds the release and Later preserves the current page and typed work', async ({
  page,
  context,
}) => {
  await setup(page);
  await createLedger(page);
  await selectRoot(page);
  await rememberPage(page, 'offline editor without a forced reload');
  await context.setOffline(true);
  try {
    fixture.publish(2);
    await focus(page);
    await page
      .getByLabel('Node description', { exact: true })
      .fill('Saved while discovery is offline.');
    await saved(page);
    await expect(notice(page)).toHaveCount(0);
    expect(await identity(page)).toBe('offline editor without a forced reload');
    await context.setOffline(false);
    // The native online event, with no explicit registration.update(), triggers discovery.
    await available(page);
    await page
      .getByLabel('Node description', { exact: true })
      .fill('Keep this typed work after Later.');
    await notice(page).getByRole('button', { name: 'Later', exact: true }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByLabel('Node description', { exact: true })).toHaveValue(
      'Keep this typed work after Later.',
    );
    await saved(page);
    expect(await identity(page)).toBe('offline editor without a forced reload');
    expect(await releaseMarker(page)).toBe('1');
    expect(await workerVersion(page, 'active')).toBe(fixture.first.version);
    expect(await workerVersion(page, 'waiting')).toBe(fixture.second.version);
    await focus(page);
    await expect(notice(page)).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test('a native save rejection keeps the old release and Retry update preserves that same edit without another change', async ({
  page,
}) => {
  await setup(page);
  await createLedger(page);
  fixture.publish(2);
  await focus(page);
  await available(page);
  await selectRoot(page);
  const editedId = await page.locator('.react-flow__node.selected').getAttribute('data-id');
  await rememberPage(page, 'save failure must not restart this page');
  // Explicit negative fixture: reject writes at the real native IDB boundary.
  // Positive tests above keep IDB, crypto and service worker APIs unmodified.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, '__restoreAppUpdateAcceptancePut', {
      value: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'records')
        throw new DOMException('Explicit app update save failure fixture.', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  await page
    .getByLabel('Node description', { exact: true })
    .fill('Keep the newest edit after rejected persistence.');
  await notice(page).getByRole('button', { name: 'Update now', exact: true }).click();
  await expect(notice(page).getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Node description', { exact: true })).toHaveValue(
    'Keep the newest edit after rejected persistence.',
  );
  expect(await identity(page)).toBe('save failure must not restart this page');
  expect(await releaseMarker(page)).toBe('1');
  expect(await workerVersion(page, 'active')).toBe(fixture.first.version);
  expect(await workerVersion(page, 'waiting')).toBe(fixture.second.version);

  await page.evaluate(() => Reflect.get(window, '__restoreAppUpdateAcceptancePut')());
  // Correcting the storage boundary is sufficient. Do not touch the optimistic
  // edit or manufacture another autosave before using the real Retry control.
  const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await notice(page).getByRole('button', { name: 'Retry update', exact: true }).click();
  await reloaded;
  await unlock(page);
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await saved(page);
  expect(await releaseMarker(page)).toBe('2');
  expect(await workerVersion(page, 'active')).toBe(fixture.second.version);
  await page.locator(`.canvas-shell [data-node-id="${editedId}"]`).click();
  await expect(page.getByLabel('Node description', { exact: true })).toHaveValue(
    'Keep the newest edit after rejected persistence.',
  );
});

test('the real update notice and controls fit desktop and 390px light and dark layouts', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await setup(page);
  await createLedger(page);
  fixture.publish(2);
  await focus(page);
  await available(page);
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 980;
    await page.setViewportSize({ width, height });
    for (const appearance of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: appearance });
      await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
      const bounds = await notice(page).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
      for (const label of ['Later', 'Update now']) {
        const button = notice(page).getByRole('button', { name: label, exact: true });
        await expect(button).toBeVisible();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const path = testInfo.outputPath(`update-notice-${width}-${appearance}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`Update notice ${width}px ${appearance}`, {
        path,
        contentType: 'image/png',
      });
    }
  }
  await notice(page).getByRole('button', { name: 'Later', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
});
