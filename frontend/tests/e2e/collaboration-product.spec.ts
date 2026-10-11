import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Graph, GraphNode } from '../../src/model/types';
import type { HistoryRestoreResult, HistorySnapshot } from '../../src/history/types';
import { acknowledge } from './fixtures';
import { containedDialog, noHorizontalOverflow, touchControlIsReachable } from './mobile-fixtures';

// Exercise the actual isolated application, native crypto/IndexedDB and offline
// shell. No relay is configured by the standard product fixture: local document
// work remains optional. The API parity case explicitly grants bridge access;
// the other cases prove ordinary editing needs no API/MCP grant or relay.
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
  await expect(dialog).toContainText('Optional collaboration has not been independently audited.');
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

test('local document work survives native encrypted storage and cold API writes and history restore', async ({
  page,
  playwright,
}) => {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  const api = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    ignoreHTTPSErrors: true,
  });
  const profileName = 'Local document reviewer';
  const comment = 'Check the processing assumptions before approval.';
  const taskTitle = 'Validate the document baseline';
  const changedTitle = 'Approved cold API edit';
  const dialog = page.getByRole('dialog', { name: 'Live collaboration', exact: true });

  // Use the real human permission grant and HTTP -> bridge -> browser path.
  // Safe reads may establish transport readiness; they do not warm write-only
  // collaboration modules before the first native IndexedDB transaction.
  async function grant(diagramId?: string) {
    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByText('Local connection details', { exact: true }).click();
    await page
      .getByLabel('Local bridge address', { exact: true })
      .fill('wss://127.0.0.1:4329/bridge');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(
      page.getByText('Local connection updated. The token lasts for this browser session.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect
      .poll(async () => {
        if (diagramId) return (await api.get(`/api/v1/diagrams/${diagramId}`)).status();
        return (await (await api.get('/api/v1/health')).json()).connected;
      })
      .toBe(diagramId ? 200 : 1);
  }
  async function current(diagramId: string) {
    const response = await api.get(`/api/v1/diagrams/${diagramId}`);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as Graph;
  }
  async function openDocumentWork() {
    await page.getByRole('button', { name: openLabel, exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Document work', exact: true }).click();
  }

  try {
    await setup(page);
    await create(page);
    await openDocumentWork();
    await dialog.getByRole('button', { name: 'Create profile', exact: true }).click();
    await dialog.getByLabel('Profile name', { exact: true }).fill(profileName);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      dialog.getByText(profileName, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel('Acting document profile', { exact: true })).toHaveValue(/.+/);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await grant();
    const listed = await api.get('/api/v1/diagrams');
    expect(listed.status()).toBe(200);
    const [{ id: diagramId }] = (await listed.json()) as Graph['diagram'][];
    const first = await current(diagramId);
    const node = first.nodes[0];
    expect(node).toBeDefined();
    const profileId = first.diagram.collaboration!.profiles[0].id;

    await openDocumentWork();
    await dialog.getByRole('tab', { name: 'Comments', exact: true }).click();
    await dialog.getByLabel('Linked node', { exact: true }).selectOption(node.id);
    await dialog.getByLabel('Comment text', { exact: true }).fill(comment);
    await dialog.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Tasks', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
    await dialog.getByLabel('Task title', { exact: true }).fill(taskTitle);
    await dialog.getByLabel('Linked node', { exact: true }).selectOption(node.id);
    await dialog.getByLabel('Assigned profile', { exact: true }).selectOption(profileId);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText(taskTitle, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();

    const baseline = await current(diagramId);
    const document = baseline.diagram.collaboration!;
    expect(document.profiles).toHaveLength(1);
    expect(document.profiles[0]).toMatchObject({ id: profileId, name: profileName });
    expect(document.comments).toHaveLength(1);
    expect(document.comments[0]).toMatchObject({ nodeId: node.id, authorId: profileId });
    expect(document.comments[0].messages).toHaveLength(1);
    expect(document.comments[0].messages[0]).toMatchObject({ text: comment, authorId: profileId });
    expect(document.tasks).toHaveLength(1);
    expect(document.tasks[0]).toMatchObject({
      nodeId: node.id,
      title: taskTitle,
      authorId: profileId,
      assigneeId: profileId,
      status: 'todo',
    });
    const semantic = await api.get(`/api/v1/diagrams/${diagramId}/collaboration/document`);
    expect(semantic.status(), await semantic.text()).toBe(200);
    expect(await semantic.json()).toEqual({
      diagramId,
      baseVersion: baseline.diagram.version,
      document,
    });
    const saved = await api.post(`/api/v1/diagrams/${diagramId}/history`, {
      data: { baseVersion: baseline.diagram.version, name: 'Local document baseline' },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    const snapshot = (await saved.json()) as HistorySnapshot;

    await test.step('first cold write preserves content and is reflected on the canvas', async () => {
      await page.reload();
      await unlock(page, title);
      await grant(diagramId);
      const patched = await api.patch(`/api/v1/nodes/${node.id}`, {
        data: {
          version: baseline.nodes.find((item) => item.id === node.id)!.version,
          title: changedTitle,
        },
      });
      expect(patched.status(), await patched.text()).toBe(200);
      expect((await patched.json()) as GraphNode).toMatchObject({
        id: node.id,
        title: changedTitle,
      });
      await expect(
        page.locator('.canvas-shell .node-title').filter({ hasText: changedTitle }),
      ).toBeVisible();
      const changed = await current(diagramId);
      expect(changed.nodes).toHaveLength(baseline.nodes.length);
      expect(changed.diagram.collaboration!.profiles).toEqual(document.profiles);
      expect(changed.diagram.collaboration!.comments).toEqual(
        document.comments.map((thread) => ({ ...thread, nodeTitle: changedTitle })),
      );
      expect(changed.diagram.collaboration!.tasks).toEqual(
        document.tasks.map((task) => ({ ...task, nodeTitle: changedTitle })),
      );
      expect(changed.diagram.collaboration!.activity.length).toBeGreaterThan(
        document.activity.length,
      );
    });

    const changed = await current(diagramId);
    await test.step('first cold history restore uses the same atomic encrypted model', async () => {
      await page.reload();
      await unlock(page, title);
      await grant(diagramId);
      const response = await api.post(
        `/api/v1/diagrams/${diagramId}/history/${snapshot.id}/restore`,
        { data: { baseVersion: changed.diagram.version } },
      );
      expect(response.status(), await response.text()).toBe(200);
      const restored = (await response.json()) as HistoryRestoreResult;
      expect(restored.graph.nodes.find((item) => item.id === node.id)?.title).toBe(node.title);
      expect(restored.graph.diagram.collaboration!.profiles).toEqual(document.profiles);
      expect(restored.graph.diagram.collaboration!.comments).toEqual(document.comments);
      expect(restored.graph.diagram.collaboration!.tasks).toEqual(document.tasks);
      expect(restored.safetySnapshot.kind).toBe('pre-restore');
      const safety = await api.get(
        `/api/v1/diagrams/${diagramId}/history/${restored.safetySnapshot.id}`,
      );
      expect(safety.status(), await safety.text()).toBe(200);
      expect(
        (await safety.json()).graph.nodes.find((item: GraphNode) => item.id === node.id)?.title,
      ).toBe(changedTitle);
      await expect(
        page.locator('.canvas-shell .node-title').filter({ hasText: changedTitle }),
      ).toHaveCount(0);
      await openDocumentWork();
      await expect(dialog.getByLabel('Acting document profile', { exact: true })).toHaveValue(
        profileId,
      );
      await dialog.getByRole('tab', { name: 'Comments', exact: true }).click();
      await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
      await dialog.getByRole('tab', { name: 'Tasks', exact: true }).click();
      await expect(dialog.getByText(taskTitle, { exact: true })).toBeVisible();
    });
    expect(sockets.every((url) => url === 'wss://127.0.0.1:4329/bridge')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await api.dispose();
  }
});

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
