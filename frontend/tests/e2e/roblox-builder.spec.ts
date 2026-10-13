import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { browserLaunchOptions } from '../../playwright.config';
import { captureAppearancePair } from './capture-appearance';
import type { Graph } from '../../src/model/types';

test.use({
  launchOptions: {
    ...browserLaunchOptions,
    args: [
      ...browserLaunchOptions.args,
      // SwiftShader still renders real WebGL. Software compositing avoids observed
      // macOS Chrome input-acknowledgement stalls when the world tab unmounts.
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved');
async function current(request: APIRequestContext, name: string): Promise<Graph> {
  const list = await (await request.get('/api/v1/diagrams')).json();
  const entry = list.find((item: { name: string }) => item.name === name);
  expect(entry).toBeTruthy();
  return (await request.get(`/api/v1/diagrams/${entry.id}`)).json();
}
async function create(
  page: Page,
  name: string,
  mode: 'My first game' | 'My own idea' | 'A bigger adventure',
) {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByLabel('Template collection').selectOption('roblox');
  await dialog.getByRole('button', { name: /^Roblox Game Builder/ }).click();
  await dialog.getByRole('radio', { name: new RegExp(mode) }).check();
  await dialog.getByLabel('New diagram name').fill(name);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
}
async function capture(page: Page, name: string) {
  if (process.env.VN_CAPTURE_ROBLOX !== '1') return;
  if (name === 'roblox-prefabs') {
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 1400 });
    const parameters = page
      .getByRole('dialog')
      .locator('details')
      .filter({
        has: page
          .locator('summary')
          .filter({ hasText: 'Parameters · give each copy its own settings' }),
      });
    await parameters.locator('summary').click();
    await parameters.scrollIntoViewIfNeeded();
    await parameters.evaluate((element) => {
      const modal = element.closest('[role="dialog"]') as HTMLElement;
      const steps = modal.querySelector('.roblox-tabs')!;
      modal.scrollTop +=
        element.getBoundingClientRect().top - steps.getBoundingClientRect().bottom - 16;
    });
    await expect
      .poll(async () => {
        const summary = await parameters.locator('summary').boundingBox();
        const steps = await page.locator('.roblox-tabs').boundingBox();
        return summary!.y - (steps!.y + steps!.height);
      })
      .toBeGreaterThanOrEqual(8);
    try {
      await captureAppearancePair(parameters, resolve('../hugo/static/help/images'), name);
    } finally {
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    return;
  }
  await page.getByRole('dialog').evaluate((element) => {
    element.scrollTop = 0;
  });
  await captureAppearancePair(
    page.getByRole('dialog'),
    resolve('../hugo/static/help/images'),
    name,
  );
}

test('prefab parameter help capture keeps controls below the sticky steps', async ({
  page,
  request,
}) => {
  test.skip(process.env.VN_CAPTURE_ROBLOX !== '1', 'Screenshot regeneration is opt-in.');
  await create(page, 'Reusable adventure pieces', 'A bigger adventure');
  expect(
    (await current(request, 'Reusable adventure pieces')).diagram.game!.prefabs.length,
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'World & rules', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Prefabs', exact: true }).click();
  await capture(page, 'roblox-prefabs');
});

test('the creative game workflow edits native objects, saves rules, runs two-player logic and builds a real Studio place', async ({
  page,
  request,
}) => {
  if (process.env.VN_CAPTURE_ROBLOX === '1') test.setTimeout(240000);
  await create(page, 'Crystal Island studio review', 'A bigger adventure');
  let graph = await current(request, 'Crystal Island studio review');
  expect(graph.diagram.game!.prefabs.length).toBeGreaterThan(0);
  expect(graph.diagram.game!.quests.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'World & rules', exact: true }).click();
  const builder = page.getByRole('dialog', { name: /Roblox Game Builder/ });
  await expect(builder.getByLabel('World geometry preview')).toBeVisible();
  await expect(builder.locator('.roblox-world-canvas canvas')).toBeVisible();
  await capture(page, 'roblox-world');
  await builder.getByLabel('Object to add', { exact: true }).selectOption('decoration');
  await builder.getByRole('button', { name: 'Add object', exact: true }).click();
  await builder.getByLabel('Object name', { exact: true }).fill('A crystal lookout');
  await builder.getByLabel('Position (studs) X', { exact: true }).fill('110');
  await builder.getByLabel('Position (studs) Y', { exact: true }).fill('6');
  await saved(page);
  graph = await current(request, 'Crystal Island studio review');
  expect(
    graph.diagram.game!.entities.find((item) => item.name === 'A crystal lookout')!.transform
      .position,
  ).toMatchObject({ x: 110, y: 6 });
  await builder.getByRole('button', { name: '2 · Rules' }).click();
  await builder.getByRole('button', { name: 'Add rule', exact: true }).click();
  await builder.getByLabel('Rule name', { exact: true }).fill('My welcome message');
  await builder
    .getByLabel('Action 1 message', { exact: true })
    .fill('Welcome to the island I designed!');
  await saved(page);
  await capture(page, 'roblox-rules');
  graph = await current(request, 'Crystal Island studio review');
  expect(
    graph.diagram.game!.rules.find((item) => item.name === 'My welcome message')!.actions,
  ).toEqual([{ kind: 'message', text: 'Welcome to the island I designed!' }]);
  await builder.getByRole('button', { name: 'Prefabs', exact: true }).click();
  await builder.getByLabel('River crystal Score reward', { exact: true }).fill('75');
  await saved(page);
  await capture(page, 'roblox-prefabs');
  await builder.getByRole('button', { name: 'Test rules', exact: true }).click();
  await builder.getByRole('button', { name: 'Add test player', exact: true }).click();
  const crystal = graph.diagram.game!.instances.find((item) => item.name === 'Camp crystal')!;
  const local = graph.diagram.game!.prefabs.find((item) => item.id === crystal.prefabId)!
    .entities[0];
  await builder
    .getByLabel('Test object', { exact: true })
    .selectOption(`${crystal.id}/${local.id}`);
  await builder.getByRole('button', { name: 'Trigger event', exact: true }).click();
  await expect(builder.getByRole('article', { name: 'Player2 results' })).toContainText('1/3');
  await expect(builder.getByRole('article', { name: 'Player1 results' })).toContainText('0/3');
  await builder.getByRole('button', { name: '3 · Check & build' }).click();
  await builder.getByRole('button', { name: 'Build Roblox files', exact: true }).click();
  await expect(builder.getByText('2. Review and download', { exact: true })).toBeVisible();
  await capture(page, 'roblox-build');
  const pendingDownload = page.waitForEvent('download');
  await builder
    .getByRole('button', { name: 'Download Studio place (.rbxlx)', exact: true })
    .click();
  const downloaded = await pendingDownload;
  expect(downloaded.suggestedFilename()).toMatch(/\.rbxlx$/);
  const xml = await readFile((await downloaded.path())!, 'utf8');
  expect(xml).toContain('<Item class="Workspace"');
  expect(xml).toContain('<Item class="SpawnLocation"');
  expect(xml).toContain('<Item class="Humanoid"');
  expect(xml).toContain('A crystal lookout');
  expect(xml).toContain('VisualNerve_server_');
  expect(xml).toContain('Welcome to the island I designed!');
  await builder.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await saved(page);
  await page.getByRole('button', { name: 'World & rules', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '2 · Rules' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /My welcome message/ }),
  ).toBeVisible();
});

for (const [profile, width, height] of [
  ['tablet', 1024, 1366],
  ['phone', 390, 844],
] as const) {
  test(`the ${profile} game builder keeps world, numeric properties and rule tools reachable without overflow`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await create(page, `My ${profile} game`, 'My first game');
    expect((await current(request, `My ${profile} game`)).diagram.game!.name).toBe(
      `My ${profile} game`,
    );
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'World & rules', exact: true }).click();
    const builder = page.getByRole('dialog', { name: /Roblox Game Builder/ });
    await expect(builder.locator('.roblox-world-canvas canvas')).toBeVisible();
    await expect
      .poll(() => builder.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (profile === 'phone') await capture(page, 'roblox-mobile');
    await builder.getByLabel('Position (studs) X', { exact: true }).fill('8');
    await saved(page);
    expect(
      (await current(request, `My ${profile} game`)).diagram.game!.entities[0].transform.position.x,
    ).toBe(8);
    const coordinate = builder.getByLabel('Position (studs) X', { exact: true });
    await coordinate.press('ControlOrMeta+A');
    await coordinate.pressSequentially('-12.5');
    await coordinate.press('Tab');
    await saved(page);
    expect(
      (await current(request, `My ${profile} game`)).diagram.game!.entities[0].transform.position.x,
    ).toBe(-12.5);
    await coordinate.press('ControlOrMeta+A');
    await coordinate.press('Backspace');
    await expect(coordinate).toHaveValue('');
    await coordinate.press('Tab');
    await expect(coordinate).toHaveValue('-12.5');
    await expect(
      builder.getByText('No new number was applied. The previous value was restored.'),
    ).toBeVisible();
    expect(
      (await current(request, `My ${profile} game`)).diagram.game!.entities[0].transform.position.x,
    ).toBe(-12.5);
    await builder.getByLabel('Object to add', { exact: true }).selectOption('decoration');
    await builder.getByRole('button', { name: 'Add object', exact: true }).click();
    await builder.getByLabel('Object name', { exact: true }).fill(`My ${profile} lookout`);
    await saved(page);
    await builder.getByRole('button', { name: '2 · Rules' }).click();
    await builder.getByRole('button', { name: 'Add rule', exact: true }).click();
    await builder.getByLabel('Action 1 message', { exact: true }).fill(`Made on a ${profile}`);
    await saved(page);
    expect(
      (await current(request, `My ${profile} game`)).diagram.game!.rules.at(-1)!.actions,
    ).toEqual([{ kind: 'message', text: `Made on a ${profile}` }]);
    await expect
      .poll(() => builder.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await builder.getByRole('button', { name: '3 · Check & build' }).click();
    await builder.getByRole('button', { name: 'Build Roblox files', exact: true }).click();
    await expect(builder.getByText('2. Review and download', { exact: true })).toBeVisible();
    const pendingDownload = page.waitForEvent('download');
    await builder
      .getByRole('button', { name: 'Download Studio place (.rbxlx)', exact: true })
      .click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toMatch(/\.rbxlx$/);
    const xml = await readFile((await download.path())!, 'utf8');
    expect(xml).toContain(`My ${profile} game`);
    expect(xml).toContain(`My ${profile} lookout`);
    expect(xml).toContain(`Made on a ${profile}`);
    expect(xml).toContain('<Item class="SpawnLocation"');
    await expect
      .poll(() => builder.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
