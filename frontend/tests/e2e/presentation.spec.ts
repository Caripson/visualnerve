import { expect, test, type APIRequestContext } from './fixtures';
import type { Graph } from '../../src/model/types';
import { browserLaunchOptions } from '../../playwright.config';
test.use({
  launchOptions: {
    ...browserLaunchOptions,
    args: [
      ...browserLaunchOptions.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});
async function create(
  request: APIRequestContext,
  name: string,
  description = 'This explains the first module.',
) {
  const response = await request.post('/api/v1/diagrams', { data: { name, type: 'process' } });
  expect(response.status()).toBe(201);
  const diagram = await response.json();
  expect(
    (
      await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          nodes: [
            {
              externalId: 'first',
              title: 'First module',
              description,
              x: 100,
              y: 120,
              width: 240,
              height: 100,
            },
            {
              externalId: 'second',
              title: 'Second module',
              description: 'This explains the second module.',
              x: 650,
              y: 220,
              width: 260,
              height: 100,
            },
            {
              externalId: 'third',
              title: 'Third module',
              description: 'This explains the final module.',
              x: 1100,
              y: 420,
              width: 220,
              height: 100,
            },
          ],
          edges: [
            { sourceExternalId: 'first', targetExternalId: 'second' },
            { sourceExternalId: 'second', targetExternalId: 'third' },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(
    (
      await request.put(`/api/v1/diagrams/${diagram.id}/presentation`, {
        data: {
          baseVersion: graph.diagram.version,
          presentation: {
            version: 1,
            nodeIds: graph.nodes.map((node) => node.id),
            // Manual-control assertions must not race automatic advancement while
            // Playwright waits for a moving button to become stable. Automatic
            // timing is covered by runtime tests and the short movie fixture.
            secondsPerNode: 30,
            transitionMs: 300,
          },
        },
      })
    ).ok(),
  ).toBe(true);
  return graph;
}
test('numbered walkthrough plays, pauses, skips, captions and persists sequence without saving its 2D camera', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Presentation acceptance');
  expect(
    (
      await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } })
    ).ok(),
  ).toBe(true);
  const player = page.getByRole('region', { name: 'Diagram player' });
  await expect(player).toBeVisible();
  await expect(page.locator('.presentation-node-number')).toHaveCount(3);
  // Wait for the normal initial overview to finish and be acknowledged before
  // asserting that the separate tour camera never saves a revision.
  await expect
    .poll(async () => {
      const saved = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
      return saved.diagram.settings.viewport;
    })
    .toBeTruthy();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () => {
      const saved = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
      const actual = await page.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
      const expected = saved.diagram.settings.viewport;
      return (
        expected &&
        Math.abs(actual.x - expected.x) < 0.001 &&
        Math.abs(actual.y - expected.y) < 0.001 &&
        Math.abs(actual.zoom - expected.zoom) < 0.001
      );
    })
    .toBe(true);
  const before = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  await player.getByRole('button', { name: 'Play presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(
    'This explains the first module.',
  );
  await player.getByRole('button', { name: 'Minimize player', exact: true }).click();
  await expect(player).toHaveAttribute('data-minimized', 'true');
  await expect(player).toHaveAttribute('data-status', 'playing');
  const captions = page.locator('.presentation-subtitles-overlay');
  await expect(captions.getByLabel('Walkthrough subtitles')).toHaveText(
    'This explains the first module.',
  );
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveCount(0);
  await expect(
    player.getByRole('button', { name: 'Presentation audio', exact: true }),
  ).toBeVisible();
  await expect(
    player.getByRole('button', { name: 'Presentation subtitles', exact: true }),
  ).toBeVisible();
  expect((await player.boundingBox())!.height).toBeLessThan(90);
  await page.screenshot({ path: '/tmp/visual-nerve-player-desktop.png' });
  await expect
    .poll(async () => (await (await request.get('/api/v1/presentation')).json()).minimized)
    .toBe(true);
  await player.getByRole('button', { name: 'Pause presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'paused');
  await player.getByRole('button', { name: 'Expand player', exact: true }).click();
  await expect(captions).toHaveCount(0);
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(
    'This explains the first module.',
  );
  await expect(player.locator('.presentation-current')).toHaveText('First module');
  expect(
    (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()).diagram.version,
  ).toBe(before.diagram.version);
  await player.getByRole('button', { name: 'Forward presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'paused');
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(
    'This explains the second module.',
  );
  await player.getByRole('button', { name: 'Presentation subtitles', exact: true }).click();
  await expect(player.getByLabel('Walkthrough subtitles')).toBeHidden();
  await player.getByRole('button', { name: 'Rewind presentation', exact: true }).click();
  await expect(player.locator('.presentation-current')).toHaveText('First module');
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.settings.viewport).toEqual(before.diagram.settings.viewport);
  expect(after.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
    before.nodes.map((node) => [node.id, node.x, node.y]),
  );
  await player.getByRole('button', { name: 'Close diagram player', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Diagram player', exact: true }).click();
  await expect(player.locator('.presentation-heading')).toContainText('1 / 3');
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await expect(page.getByLabel('Narration voice', { exact: true })).toHaveValue(
    'en_GB-alan-medium',
  );
  await page.getByLabel('Narration voice', { exact: true }).selectOption('sv_SE-nst-medium');
  await page.getByRole('button', { name: 'Save voice', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Presentation voice saved' })).toHaveText(
    'Presentation voice saved for this browser.',
  );
  // CI can delay the browser's IndexedDB-backed bridge response beyond 12s
  // even after the UI confirms persistence. Keep the exact-value requirement.
  await expect
    .poll(async () => await (await request.get('/api/v1/settings/presentation-voice')).json(), {
      timeout: 30000,
    })
    .toBe('sv_SE-nst-medium');
});
test('MCP player uses the same 3D diagram and transient camera with documented read/write controls', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Presentation in relief');
  await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } });
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const before = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  const mcp = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/presentation/play', method: 'POST', data: {} },
      },
    },
  });
  const response = await mcp.json();
  expect(response.result.isError).toBe(false);
  expect(response.result.structuredContent.status).toBe(200);
  const player = page.getByRole('region', { name: 'Diagram player' });
  await expect(player).toHaveAttribute('data-status', 'playing', { timeout: 15000 });
  const minimize = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 52,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/presentation', method: 'PATCH', data: { minimized: true } },
      },
    },
  });
  const minimized = (await minimize.json()).result;
  expect(minimized.isError).toBe(false);
  expect(minimized.structuredContent.body).toMatchObject({ minimized: true, status: 'playing' });
  await expect(player).toHaveAttribute('data-minimized', 'true');
  await expect(page.locator('.presentation-subtitles-overlay')).toContainText(
    'This explains the first module.',
  );
  await page.screenshot({ path: '/tmp/visual-nerve-player-3d.png' });
  await player.getByRole('button', { name: 'Expand player', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  expect((await (await request.get('/api/v1/presentation')).json()).minimized).toBe(false);
  const spatialCanvas = page.getByTestId('spatial-canvas');
  const playbackCamera = await spatialCanvas.getAttribute('data-camera-position');
  for (const key of ['Tab', 'Shift', 'a']) {
    await spatialCanvas.focus();
    await spatialCanvas.press(key);
    await expect(player).toHaveAttribute('data-status', 'playing');
    expect(await spatialCanvas.getAttribute('data-camera-position')).toBe(playbackCamera);
  }
  await request.post('/api/v1/presentation/pause', { data: {} });
  await expect(player).toHaveAttribute('data-status', 'paused');
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.version).toBe(before.diagram.version);
  expect(after.diagram.settings.spatialView).toEqual(before.diagram.settings.spatialView);
  expect(after.nodes).toEqual(before.nodes);
  const voices = await (await request.get('/api/v1/presentation/voices')).json();
  expect(voices.defaultVoiceId).toBe('en_GB-alan-medium');
  expect(voices.voices.map((voice: { language: string }) => voice.language)).toEqual([
    'en',
    'en',
    'en',
    'sv',
  ]);
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toBeHidden();
  await expect(page.locator('.presentation-node-number')).toHaveCount(3);
  await player.getByRole('button', { name: 'Play presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'playing');
});
test('player remains usable on a narrow screen and exposes a bounded order list', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Mobile presentation');
  await page.setViewportSize({ width: 390, height: 844 });
  await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } });
  const player = page.getByRole('region', { name: 'Diagram player' });
  await expect(player).toBeVisible();
  await player.getByRole('button', { name: 'Expand player', exact: true }).click();
  await player.getByRole('button', { name: 'Order', exact: true }).click();
  const rect = await player.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await expect(player.getByRole('listitem')).toHaveCount(3);
  await player.getByRole('button', { name: 'Move First module later', exact: true }).click();
  await expect(player.getByRole('listitem').first()).toContainText('Second module');
});

test('minimized captions and touch controls fit portrait and landscape without selection toolbar collisions', async ({
  page,
  request,
}) => {
  const narration = `${'The walkthrough explains the diagram one module at a time. '.repeat(8)}https://example.test/${'long-identifier'.repeat(12)}`;
  const graph = await create(request, 'Compact cinema captions', narration);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open projects', exact: true }).click();
  await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).click();
  const first = page.locator(`.react-flow__node[data-id="${graph.nodes[0].id}"]`);
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.locator('.selection-tools')).toBeVisible();
  // Start in the already open diagram, preserving the user's selection.
  // Passing diagramId intentionally navigates/reopens it and clears selection.
  await request.post('/api/v1/presentation/open', { data: {} });
  const player = page.getByRole('region', { name: 'Diagram player', exact: true });
  const captions = page.locator('.presentation-subtitles-overlay');
  await expect(player).toHaveAttribute('data-minimized', 'true');
  await player.getByRole('button', { name: 'Play presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await expect(first).toHaveClass(/selected/);
  await expect(page.locator('.selection-tools')).toHaveCount(0);
  const cue = captions.getByLabel('Walkthrough subtitles');
  await expect.poll(async () => Number(await cue.getAttribute('data-page'))).toBeGreaterThan(1);
  await player.getByRole('button', { name: 'Pause presentation', exact: true }).click();
  const pausedPage = await cue.getAttribute('data-page');
  await page.waitForTimeout(300);
  expect(await cue.getAttribute('data-page')).toBe(pausedPage);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 780, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(player).toHaveAttribute('data-minimized', 'true');
    const dock = (await player.boundingBox())!;
    const caption = (await captions.boundingBox())!;
    const canvas = (await page.locator('.canvas-shell').boundingBox())!;
    expect(dock.x).toBeGreaterThanOrEqual(canvas.x);
    expect(dock.x + dock.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(caption.x).toBeGreaterThanOrEqual(canvas.x);
    expect(caption.x + caption.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(caption.y).toBeGreaterThanOrEqual(canvas.y);
    expect(caption.y + caption.height).toBeLessThanOrEqual(dock.y - 8);
    for (const name of ['3D view', 'Canvas options', 'Fit View']) {
      const canvasControl = page.getByRole('button', { name, exact: true });
      await expect(canvasControl).toBeInViewport({ ratio: 1 });
      expect(
        await canvasControl.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          );
        }),
      ).toBe(true);
    }
    for (const name of [
      'Rewind presentation',
      'Play presentation',
      'Forward presentation',
      'Presentation audio',
      'Presentation subtitles',
      'Expand player',
      'Close diagram player',
    ]) {
      const control = player.getByRole('button', { name, exact: true });
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(
        await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit !== null && element.contains(hit);
        }),
      ).toBe(true);
    }
    await page.screenshot({
      path: `/tmp/visual-nerve-player-${viewport.width}-${viewport.height}.png`,
    });
  }
  await player.getByRole('button', { name: 'Presentation subtitles', exact: true }).click();
  await expect(captions).toHaveCount(0);
  await expect(player).toHaveAttribute('data-status', 'paused');
  await request.patch('/api/v1/presentation', { data: { subtitles: true, minimized: false } });
  await expect(player).toHaveAttribute('data-minimized', 'false');
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(narration);
  await request.patch('/api/v1/presentation', { data: { minimized: true } });
  await expect(captions).toBeVisible();
  await player.getByRole('button', { name: 'Close diagram player', exact: true }).click();
  await expect(captions).toHaveCount(0);
  await expect(page.locator('.selection-tools')).toBeVisible();
  await expect(first).toHaveClass(/selected/);
});
