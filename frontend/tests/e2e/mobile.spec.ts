import { expect, test } from './fixtures';
import {
  actions,
  canvasWorldCenter,
  containedDialog,
  expectCanvasCenter,
  graph,
  noHorizontalOverflow,
  open,
  saved,
  screenshot,
  simulation,
  touchControlIsReachable,
  usableCanvas,
} from './mobile-fixtures';

// Ordinary 2D touch coverage uses the browser's normal graphics path.
test.use({ hasTouch: true, isMobile: true });

for (const device of [
  { width: 320, height: 640, type: 'flowchart' as const },
  { width: 360, height: 740, type: 'flowchart' as const },
  { width: 390, height: 844, type: 'mindmap' as const },
  { width: 844, height: 390, type: 'flowchart' as const },
]) {
  test(`mobile ${device.width}×${device.height}: ${device.type} canvas, drawers, touch editing and dialogs`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: device.width, height: device.height });
    const name = `Mobile ${device.type} ${device.width}`;
    const model = await graph(request, name, device.type);
    await open(page, name);
    await usableCanvas(page);

    const projectTrigger = page.getByRole('button', { name: 'Open projects', exact: true });
    await projectTrigger.tap();
    await containedDialog(page, 'Projects');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Projects', exact: true })).toBeHidden();
    await expect(projectTrigger).toBeFocused();

    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    const first = model.nodes.find((node) => node.externalId === 'first')!;
    const node = page.locator(`[data-node-id="${first.id}"]`).first();
    await expect(node).toBeInViewport({ ratio: 0.8 });
    await node.tap();
    const detailsTrigger = page.getByRole('button', { name: 'Open properties', exact: true });
    await detailsTrigger.tap();
    const properties = await containedDialog(page, 'Properties');
    await expect(properties.getByLabel('Node title', { exact: true })).toHaveValue('Start here');
    await properties.getByLabel('Node title', { exact: true }).fill('Edited on a phone');
    await properties.getByRole('button', { name: 'Close properties', exact: true }).tap();
    await expect(properties).toBeHidden();
    await expect(detailsTrigger).toBeFocused();
    await saved(page);
    expect((await (await request.get(`/api/v1/nodes/${first.id}`)).json()).title).toBe(
      'Edited on a phone',
    );
    await usableCanvas(page);
    await touchControlIsReachable(
      page.getByRole('button', { name: 'Draw on diagram', exact: true }),
    );
    await touchControlIsReachable(page.getByRole('button', { name: 'Fit view', exact: true }));

    await detailsTrigger.tap();
    await containedDialog(page, 'Properties');
    await page.keyboard.press('Escape');
    await expect(properties).toBeHidden();

    const actionTrigger = page.getByRole('button', { name: 'Diagram actions', exact: true });
    await actions(page);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Diagram actions menu', exact: true }),
    ).toBeHidden();
    await expect(actionTrigger).toBeFocused();
    const menu = await actions(page);
    await menu.getByRole('button', { name: 'Export', exact: true }).tap();
    const exportDialog = await containedDialog(page, 'Export diagram');
    await exportDialog.getByLabel('Export format', { exact: true }).selectOption('pdf');
    await exportDialog.getByLabel('PDF orientation', { exact: true }).selectOption('portrait');
    await containedDialog(page, 'Export diagram');
    await exportDialog.getByRole('button', { name: 'Close dialog', exact: true }).tap();
    await expect(exportDialog).toBeHidden();
    await usableCanvas(page);
    await screenshot(page, `${device.type}-${device.width}-${device.height}`);
    expect(errors).toEqual([]);
  });
}

for (const device of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`mobile ${device.width}×${device.height}: simulator controls, metrics, scenarios and authoritative settings`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(device);
    const name = `Mobile simulation ${device.width}`;
    const model = await simulation(request, name);
    const work = model.simulation!.nodes.find((node) => node.type === 'work')!;
    await open(page, name);
    await usableCanvas(page);
    if (device.width === 390) {
      const workCard = page.locator(`.react-flow__node[data-id="${work.id}"]`);
      await expect(workCard).toBeInViewport({ ratio: 0.8 });
      const center = await canvasWorldCenter(page);
      await page.setViewportSize({ width: 844, height: 390 });
      await usableCanvas(page);
      await expectCanvasCenter(page, center);
      await expect(workCard).toBeInViewport({ ratio: 0.8 });
      await screenshot(page, 'simulation-rotated-844-390');
      await page.setViewportSize(device);
      await usableCanvas(page);
      await expectCanvasCenter(page, center);
      await expect(workCard).toBeInViewport({ ratio: 0.8 });
    }
    const base = `/api/v1/diagrams/${model.diagram.id}/simulation`;
    await page.getByRole('button', { name: 'Play simulation', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeEnabled();
    // Discover this UI-created run once; live progress belongs to its exact
    // state endpoint rather than repeatedly querying the run archive.
    const runsResponse = await request.get(`${base}/runs`);
    expect(runsResponse.ok()).toBe(true);
    const runs = await runsResponse.json();
    expect(runs).toHaveLength(1);
    const firstRun = runs[0];
    expect(firstRun).toMatchObject({
      id: expect.any(String),
      diagramId: model.diagram.id,
      status: 'running',
    });
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/runs/${firstRun.id}/state`)).json()).metrics.queue
            .current,
      )
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Pause simulation', exact: true }).tap();
    await expect
      .poll(async () => (await (await request.get(`${base}/runs/${firstRun.id}`)).json()).status)
      .toBe('paused');
    const frozen = await (await request.get(`${base}/runs/${firstRun.id}/state`)).json();
    await page.waitForTimeout(200);
    expect(
      (await (await request.get(`${base}/runs/${firstRun.id}/state`)).json()).timeSeconds,
    ).toBe(frozen.timeSeconds);
    await usableCanvas(page);

    const detailsTrigger = page.getByRole('button', {
      name: 'Open simulation details',
      exact: true,
    });
    await detailsTrigger.tap();
    const details = await containedDialog(page, 'Simulation details');
    await details.getByLabel('Simulation panel', { exact: true }).selectOption('metrics');
    await expect(details.locator('[data-metric="Current queue"]')).toHaveText(
      String(frozen.metrics.queue.current),
    );
    await noHorizontalOverflow(page);
    await screenshot(page, `simulation-metrics-${device.width}-${device.height}`);
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(detailsTrigger).toBeFocused();

    await detailsTrigger.tap();
    await details.getByLabel('Simulation panel', { exact: true }).selectOption('run');
    page.once('dialog', (dialog) => dialog.accept('Mobile what if'));
    await details.getByRole('button', { name: 'New scenario', exact: true }).tap();
    await expect(
      details.getByLabel('Simulation scenario', { exact: true }).locator('option:checked'),
    ).toHaveText('Mobile what if');
    await details
      .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
      .tap();
    const settings = await containedDialog(page, 'Process Simulator settings');
    await settings.getByLabel('Settings section', { exact: true }).selectOption('nodes');
    await settings.getByLabel('Simulation node', { exact: true }).selectOption(work.id);
    await settings.getByLabel('Work capacity', { exact: true }).fill('3');
    for (const section of [
      'connections',
      'particles',
      'resources',
      'improvements',
      'economics',
      'complete model',
      'nodes',
    ]) {
      await settings.getByLabel('Settings section', { exact: true }).selectOption(section);
      await expect(settings.getByLabel('Settings section', { exact: true })).toHaveValue(section);
      await containedDialog(page, 'Process Simulator settings');
    }
    await expect(
      settings.getByRole('button', { name: 'Apply assumptions', exact: true }),
    ).toBeInViewport();
    await settings.getByRole('button', { name: 'Apply assumptions', exact: true }).tap();
    await expect(settings).toBeHidden();
    await saved(page);
    const semantic = await (await request.get(base)).json();
    expect(semantic.nodes.find((node: { id: string }) => node.id === work.id).work.capacity).toBe(
      1,
    );
    const scenario = semantic.scenarios.find(
      (scenario: { name: string }) => scenario.name === 'Mobile what if',
    );
    expect(scenario.overrides.nodes[work.id].work.capacity).toBe(3);
    if (!(await details.isVisible())) await detailsTrigger.tap();
    await details.getByLabel('Simulation panel', { exact: true }).selectOption('run');
    await details.getByRole('button', { name: 'Run simulation', exact: true }).tap();
    await expect(details).toBeHidden();
    await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Pause simulation', exact: true }).tap();
    await expect
      .poll(async () => (await (await request.get(`${base}/runs`)).json()).length)
      .toBe(2);
    const next = (await (await request.get(`${base}/runs`)).json()).at(-1);
    expect(next.options.scenarioId).toBe(scenario.id);
    expect(
      (await (await request.get(`${base}/runs/${next.id}/state`)).json()).nodes[work.id].capacity,
    ).toBe(3);
    await usableCanvas(page);
    await screenshot(page, `simulation-${device.width}-${device.height}`);
    expect(errors).toEqual([]);
  });
}

test('mobile 390×844: template dialog and walkthrough remain usable with compact controls', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const model = await graph(request, 'Mobile walkthrough');
  await open(page, model.diagram.name);
  const current = await (await request.get(`/api/v1/diagrams/${model.diagram.id}`)).json();
  const sequence = await request.put(`/api/v1/diagrams/${model.diagram.id}/presentation`, {
    data: {
      baseVersion: current.diagram.version,
      presentation: {
        version: 1,
        nodeIds: model.nodes.map((node) => node.id),
        secondsPerNode: 8,
        transitionMs: 0,
      },
    },
  });
  expect(sequence.ok()).toBeTruthy();
  let menu = await actions(page);
  await menu.getByRole('button', { name: 'New diagram', exact: true }).tap();
  const creation = await containedDialog(page, 'New diagram');
  await creation.getByLabel('New diagram name', { exact: true }).fill('A mobile template');
  await creation.getByRole('button', { name: /Process Simulator/ }).tap();
  await creation
    .getByRole('button', { name: 'Create diagram', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    creation.getByRole('button', { name: 'Create diagram', exact: true }),
  ).toBeInViewport();
  await noHorizontalOverflow(page);
  await creation.getByRole('button', { name: 'Close dialog', exact: true }).tap();
  menu = await actions(page);
  await menu.getByRole('button', { name: 'Diagram player', exact: true }).tap();
  const player = page.getByRole('region', { name: 'Diagram player', exact: true });
  await expect(player).toBeVisible();
  await expect(player.getByRole('button', { name: 'Expand player', exact: true })).toBeVisible();
  expect((await player.boundingBox())!.height).toBeLessThanOrEqual(844 * 0.3);
  await player.getByRole('button', { name: 'Play presentation', exact: true }).tap();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await player.getByRole('button', { name: 'Pause presentation', exact: true }).tap();
  await expect(player).toHaveAttribute('data-status', 'paused');
  await player.getByRole('button', { name: 'Expand player', exact: true }).tap();
  await expect(
    player.getByRole('button', { name: 'Presentation audio', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await player.getByRole('button', { name: 'Order', exact: true }).tap();
  await expect(player.getByLabel('Seconds per node', { exact: true })).toHaveValue('8');
  const subtitle = player.getByLabel('Walkthrough subtitles', { exact: true });
  await expect(subtitle).toHaveText('The first mobile step.');
  expect(
    await subtitle.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    }),
  ).toBeGreaterThanOrEqual(
    await subtitle.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight)),
  );
  await noHorizontalOverflow(page);
  await screenshot(page, 'walkthrough-390-844');
  await player.getByRole('button', { name: 'Minimize player', exact: true }).tap();
  await expect(player.getByRole('button', { name: 'Expand player', exact: true })).toBeVisible();
  await player.getByRole('button', { name: 'Close diagram player', exact: true }).tap();
  await expect(player).toBeHidden();
  await usableCanvas(page);
});
