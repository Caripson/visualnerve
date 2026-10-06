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
async function create(request: APIRequestContext, name: string) {
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
              description: 'This explains the first module.',
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
            secondsPerNode: 2,
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
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
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
  await player.getByRole('button', { name: 'Pause presentation', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'paused');
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
    'en_US-ljspeech-high',
  );
  await page.getByLabel('Narration voice', { exact: true }).selectOption('sv_SE-nst-medium');
  await page.getByRole('button', { name: 'Save voice', exact: true }).click();
  await expect
    .poll(async () => await (await request.get('/api/v1/settings/presentation-voice')).json())
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
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
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
  await request.post('/api/v1/presentation/pause', { data: {} });
  await expect(player).toHaveAttribute('data-status', 'paused');
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.version).toBe(before.diagram.version);
  expect(after.diagram.settings.spatialView).toEqual(before.diagram.settings.spatialView);
  expect(after.nodes).toEqual(before.nodes);
  const voices = await (await request.get('/api/v1/presentation/voices')).json();
  expect(voices.defaultVoiceId).toBe('en_US-ljspeech-high');
  expect(voices.voices.map((voice: { language: string }) => voice.language)).toEqual([
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
  await player.getByRole('button', { name: 'Order', exact: true }).click();
  const rect = await player.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await expect(player.getByRole('listitem')).toHaveCount(3);
  await player.getByRole('button', { name: 'Move First module later', exact: true }).click();
  await expect(player.getByRole('listitem').first()).toContainText('Second module');
});
