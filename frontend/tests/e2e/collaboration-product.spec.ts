import { expect, test, type Locator, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';
import { containedDialog, noHorizontalOverflow, touchControlIsReachable } from './mobile-fixtures';

// Exercise the actual isolated application, native crypto/IndexedDB and offline
// shell. No relay is configured by the standard product fixture: collaboration
// must remain optional and must not require an API/MCP grant or network service.
const app = 'https://public-app.test:4341';
const password = 'Optional collaboration product smoke test passphrase';
const openLabel = 'Open collaboration and participants';
const title = 'Optional collaboration keeps local work';

async function setup(page: Page) {
  await page.goto(app);
  await expect(page.getByRole('dialog', { name: 'Protect your local workspace' })).toBeVisible();
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your recovery key' })).toBeVisible();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
}

async function unavailable(page: Page) {
  const dialog = await containedDialog(page, 'Live collaboration');
  await expect(dialog).toContainText('The collaboration relay is not configured.');
  await expect(dialog).toContainText('Your local workspace works normally.');
  await expect(dialog.getByRole('button', { name: 'Start private room', exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByRole('button', { name: 'Request to join', exact: true })).toHaveCount(0);
  await dialog.getByText('Before you share', { exact: true }).click();
  await expect(dialog).toContainText('Participants can keep copies.');
  await expect(dialog).toContainText('Removing a participant or changing a password cannot revoke');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toBeHidden();
  // An idle feature has no floating control intercepting normal diagram input.
  await expect(page.locator('.collaboration-live-overlay .collaboration-presence')).toHaveCount(0);
}

async function create(page: Page) {
  await page.getByRole('button', { name: 'Create a diagram', exact: true }).click();
  await page.getByLabel('New diagram name').fill(title);
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function reachable(control: Locator) {
  await touchControlIsReachable(control);
  const bounds = (await control.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(24);
  expect(bounds.height).toBeGreaterThanOrEqual(24);
}

async function unlock(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

for (const width of [1440, 1024]) {
  test(`isolated optional collaboration: desktop ${width}, local editing and lock teardown`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    const sockets: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) => sockets.push(socket.url()));
    await page.setViewportSize({ width, height: 980 });
    await setup(page);
    await page.getByRole('button', { name: openLabel, exact: true }).click();
    await unavailable(page);
    await create(page);
    const open = page.getByRole('button', { name: openLabel, exact: true });
    for (const headerWidth of width === 1440 ? [1181, 1280, 1360, 1361, 1440] : [1024]) {
      await test.step(`readable document title and actions at ${headerWidth}px`, async () => {
        await page.setViewportSize({ width: headerWidth, height: 980 });
        await noHorizontalOverflow(page);
        const titleBounds = (await page.locator('.document-title h1').boundingBox())!;
        expect(titleBounds.width).toBeGreaterThanOrEqual(100);
        await reachable(open);
        await reachable(page.getByRole('button', { name: 'Export', exact: true }));
      });
    }
    await open.click();
    await unavailable(page);
    await expect(page.locator('.collaboration-live-overlay')).toHaveCount(1);

    const renamed = `${title} ${width}`;
    await page.getByRole('button', { name: `Rename project: ${title}`, exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill(renamed);
    await page.getByLabel('Project name', { exact: true }).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    const nodeTitles = await page.locator('.canvas-shell .node-title').allTextContents();
    expect(nodeTitles.length).toBeGreaterThan(0);

    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Unlock your workspace' })).toBeVisible();
    await expect(page.locator('.collaboration-live-overlay')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Live collaboration', exact: true })).toHaveCount(
      0,
    );
    await unlock(page, renamed);
    // Unlock mounts a fresh App and does not resurrect the previous controller.
    await expect(page.locator('.collaboration-live-overlay')).toHaveCount(0);
    expect(await page.locator('.canvas-shell .node-title').allTextContents()).toEqual(nodeTitles);

    if (width === 1440) {
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
          {
            timeout: 30000,
            message: 'The complete offline shell must activate and claim the app.',
          },
        )
        .toMatchObject({ active: 'activated', controller: 'activated', controlledByActive: true });
      await context.setOffline(true);
      await page.reload();
      await unlock(page, renamed);
      expect(await page.locator('.canvas-shell .node-title').allTextContents()).toEqual(nodeTitles);
      await page.getByRole('button', { name: openLabel, exact: true }).click();
      await unavailable(page);
      await noHorizontalOverflow(page);
    }
    expect(sockets).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const appearance of ['light', 'dark'] as const) {
  test(`isolated optional collaboration: mobile 390 ${appearance}, menu and dialog reachability`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: appearance });
    await setup(page);
    const welcome = page.getByRole('button', { name: openLabel, exact: true });
    await reachable(welcome);
    await welcome.click();
    await unavailable(page);
    await create(page);
    await noHorizontalOverflow(page);
    const actions = page.getByRole('button', { name: 'Diagram actions', exact: true });
    await reachable(actions);
    await actions.click();
    const menu = await containedDialog(page, 'Diagram actions menu');
    const open = menu.getByRole('button', { name: openLabel, exact: true });
    await reachable(open);
    await open.click();
    await expect(menu).toBeHidden();
    await unavailable(page);
    await noHorizontalOverflow(page);
    await reachable(page.getByRole('button', { name: 'Open projects', exact: true }));
    await reachable(page.getByRole('button', { name: 'Open properties', exact: true }));
    expect(errors).toEqual([]);
  });
}

const failedChunkTest = test.extend({ serviceWorkers: 'block' });
failedChunkTest(
  'a failed optional collaboration chunk can close without trapping the editor',
  async ({ page }) => {
    let blocked = 0;
    await page.route('**/editor/assets/CollaborationFeature-*.js', (route) => {
      blocked++;
      return route.abort('failed');
    });
    await setup(page);
    await page.getByRole('button', { name: openLabel, exact: true }).click();
    const failed = page.getByRole('dialog', { name: 'Tool could not open', exact: true });
    await expect(failed).toBeVisible();
    expect(blocked).toBe(1);
    await failed.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(failed).toBeHidden();
    await create(page);
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);
  },
);

test('legacy local workspaces explain collaboration requirements and remain editable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await acknowledge(page);
  await page.getByRole('button', { name: openLabel, exact: true }).click();
  const dialog = await containedDialog(page, 'Live collaboration');
  await expect(dialog).toContainText('Live collaboration requires the encrypted app workspace.');
  await expect(dialog).toContainText('does not move or share your existing diagrams');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toBeHidden();
  await create(page);
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
