import { readFile } from 'node:fs/promises';
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
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name, type: 'process' } })
  ).json();
  expect(
    (
      await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          nodes: [
            {
              externalId: 'build',
              title: 'Build truck',
              description: 'Original assembly description',
              x: 100,
              y: 120,
              width: 280,
              height: 100,
              color: '#d8efdf',
            },
            {
              externalId: 'deliver',
              title: 'Deliver truck',
              description: 'Original delivery description',
              x: 700,
              y: 220,
              width: 280,
              height: 100,
            },
            {
              externalId: 'service',
              title: 'Service truck',
              description: 'Original service description',
              x: 1350,
              y: 380,
              width: 280,
              height: 100,
            },
          ],
          edges: [
            { sourceExternalId: 'build', targetExternalId: 'deliver', label: 'Ready to deliver' },
            { sourceExternalId: 'deliver', targetExternalId: 'service', label: 'In service' },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  let graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(
    (
      await request.put(`/api/v1/diagrams/${diagram.id}/presentation`, {
        data: {
          baseVersion: graph.diagram.version,
          presentation: {
            version: 1,
            nodeIds: graph.nodes.map((n) => n.id),
            secondsPerNode: 2,
            transitionMs: 200,
          },
        },
      })
    ).ok(),
  ).toBe(true);
  graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  return graph;
}
async function save(request: APIRequestContext, graph: Graph, view?: unknown) {
  const storyboard = {
    version: 1,
    scenes: [
      {
        id: crypto.randomUUID(),
        name: 'Assembly and delivery',
        nodeIds: graph.nodes.slice(0, 2).map((n) => n.id),
        edgeIds: [graph.edges[0].id],
        narration: 'Scene narration describes assembly and delivery together.',
        seconds: 2,
        transitionMs: 300,
        ...(view ? { view } : {}),
      },
      {
        id: crypto.randomUUID(),
        name: 'Service life',
        nodeIds: [graph.nodes[2].id],
        edgeIds: [],
        narration: 'Scene narration explains service through the life of the truck.',
        seconds: 2,
        transitionMs: 300,
      },
    ],
  };
  const current = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  const response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/storyboard`, {
    data: { baseVersion: current.diagram.version, storyboard },
  });
  expect(response.ok()).toBe(true);
  return storyboard;
}
test('edits authored multi-object scenes, previews a saved 2D view and keeps numbered nodes and layout', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Editable truck storyboard');
  await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } });
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  await save(request, graph, { mode: '2d', viewport: { x: 80, y: 30, zoom: 0.55 } });
  await request.post('/api/v1/presentation/open', { data: { source: 'storyboard' } });
  const player = page.getByRole('region', { name: 'Diagram player' });
  await expect(player.locator('.presentation-heading')).toContainText('1 / 2');
  await player.getByRole('button', { name: 'Order', exact: true }).click();
  const editor = player.getByLabel('Storyboard editor');
  await editor
    .getByLabel('Scene narration')
    .fill('Updated authored scene narration, independent of the original nodes.');
  await editor.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const before = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  expect(before.nodes[0].description).toBe('Original assembly description');
  expect(before.diagram.settings.presentation!.nodeIds).toEqual(graph.nodes.map((n) => n.id));
  const preview = await request.post('/api/v1/presentation/seek', { data: { index: 0 } });
  expect(preview.ok()).toBe(true);
  await expect(player).toHaveAttribute('data-status', 'paused');
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(
    'Updated authored scene narration, independent of the original nodes.',
  );
  await expect
    .poll(() =>
      page.locator('.react-flow__viewport').evaluate((element) => {
        const m = new DOMMatrix(getComputedStyle(element).transform);
        return (
          Math.abs(m.e - 80) < 0.01 && Math.abs(m.f - 30) < 0.01 && Math.abs(m.a - 0.55) < 0.001
        );
      }),
    )
    .toBe(true);
  expect((await request.post('/api/v1/presentation/seek', { data: { index: 1 } })).ok()).toBe(true);
  await expect(player).toHaveAttribute('data-status', 'paused');
  await expect(player.locator('.presentation-current')).toHaveText('Service life');
  await player.getByRole('button', { name: 'Close diagram player', exact: true }).click();
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.settings).toEqual(before.diagram.settings);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  await page.reload();
  await page.getByRole('button', { name: 'Diagram player', exact: true }).click();
  await player.getByRole('button', { name: 'Storyboard scenes', exact: true }).click();
  await expect(player.locator('.presentation-heading')).toContainText('1 / 2');
  expect(
    (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/storyboard`)).json()).scenes,
  ).toHaveLength(2);
});
test('plays a saved 3D scene and exports a playable storyboard movie without changing saved geometry', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const graph = await create(request, '3D storyboard truck movie');
  await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } });
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  const camera = await page.getByTestId('spatial-canvas').evaluate((canvas) => ({
    position: JSON.parse(canvas.dataset.cameraPosition!),
    target: JSON.parse(canvas.dataset.cameraTarget!),
    up: JSON.parse(canvas.dataset.cameraUp!),
  }));
  await save(request, graph, { mode: '3d', camera });
  await request.post('/api/v1/presentation/open', { data: { source: 'storyboard' } });
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const before = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  const player = page.getByRole('region', { name: 'Diagram player' });
  expect((await request.post('/api/v1/presentation/play', { data: {} })).ok()).toBe(true);
  await expect(player).toHaveAttribute('data-status', 'playing', { timeout: 20000 });
  await expect(player.getByLabel('Walkthrough subtitles')).toHaveText(
    'Scene narration describes assembly and delivery together.',
  );
  await request.post('/api/v1/presentation/pause', { data: {} });
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  expect(
    (
      await request.post('/api/v1/presentation/video', {
        data: { source: 'storyboard', audio: false, subtitles: true },
      })
    ).ok(),
  ).toBe(true);
  const movie = await downloadPromise;
  const bytes = Array.from(await readFile((await movie.path())!));
  const decoded = await page.evaluate(async (bytes) => {
    const video = document.createElement('video');
    video.muted = true;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    video.src = url;
    try {
      await new Promise<void>((r, j) => {
        video.onloadedmetadata = () => r();
        video.onerror = () => j(Error('Storyboard video decode failed'));
      });
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    } finally {
      video.src = '';
      URL.revokeObjectURL(url);
    }
  }, bytes);
  expect(decoded).toMatchObject({ width: 1280, height: 720 });
  expect(decoded.duration).toBeGreaterThanOrEqual(6);
  await expect
    .poll(async () => (await (await request.get('/api/v1/presentation/video')).json()).status)
    .toBe('complete');
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.settings).toEqual(before.diagram.settings);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  await request.post('/api/v1/presentation/close', { data: {} });
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
});

test('prepares every resident face in a multi-object 3D scene before recording its first frame', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const graph = await create(request, 'Delayed storyboard card appearance');
  const storyboard = await save(request, graph);
  await page.getByRole('button', { name: graph.diagram.name, exact: true }).click();
  await expect(page.getByRole('button', { name: '3D view', exact: true })).toBeVisible();
  await page.evaluate((title) => {
    const runtime = window as unknown as {
      releaseStoryboardTexture(): void;
      storyboardTextureBlocked: boolean;
      storyboardPreparedIds: string[];
      storyboardRecordedFrames: number;
    };
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (release = resolve));
    runtime.releaseStoryboardTexture = release;
    runtime.storyboardTextureBlocked = false;
    runtime.storyboardPreparedIds = [];
    runtime.storyboardRecordedFrames = 0;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      if (
        this.src.startsWith('data:image/svg+xml') &&
        decodeURIComponent(this.src).includes(title)
      ) {
        runtime.storyboardTextureBlocked = true;
        await ready;
      }
      return decode.call(this);
    };
    window.addEventListener('visualnerve:video-spatial-prepare', (event) => {
      runtime.storyboardPreparedIds = (event as CustomEvent).detail.nodeIds ?? [];
    });
    window.addEventListener('visualnerve:video-spatial-frame', () => {
      runtime.storyboardRecordedFrames++;
    });
  }, graph.nodes[1].title);
  try {
    await page.getByRole('button', { name: '3D view', exact: true }).click();
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
      timeout: 30000,
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).storyboardTextureBlocked))
      .toBe(true);
    await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
    const before = (await (
      await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
    ).json()) as Graph;
    expect(
      (
        await request.post('/api/v1/presentation/video', {
          data: { source: 'storyboard', audio: false, subtitles: false },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as any).storyboardPreparedIds))
      .toEqual(storyboard.scenes[0].nodeIds);
    await page.evaluate(async () => {
      for (let frame = 0; frame < 8; frame++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(await page.evaluate(() => (window as any).storyboardRecordedFrames)).toBe(0);
    expect((await (await request.get('/api/v1/presentation/video')).json()).status).toBe(
      'preparing',
    );
    await page.evaluate(() => (window as any).releaseStoryboardTexture());
    await expect
      .poll(() => page.evaluate(() => (window as any).storyboardRecordedFrames), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);
    await request.delete('/api/v1/presentation/video', { data: {} });
    await request.post('/api/v1/presentation/close', { data: {} });
    const after = (await (
      await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
    ).json()) as Graph;
    expect(after.diagram.settings).toEqual(before.diagram.settings);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
  } finally {
    await page.evaluate(() => (window as any).releaseStoryboardTexture());
    await request.delete('/api/v1/presentation/video', { data: {} });
  }
});
test('explains saved-view incompatibility in Overview and reveals canonical objects with Auto-fit', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Storyboard overview compatibility');
  await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } });
  await save(request, graph, { mode: '2d', viewport: { x: 0, y: 0, zoom: 1 } });
  const current = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  expect(
    (
      await request.put(`/api/v1/diagrams/${graph.diagram.id}/overview`, {
        data: {
          baseVersion: current.diagram.version,
          overview: { version: 1, enabled: true, grouping: 'auto', expanded: [] },
        },
      })
    ).ok(),
  ).toBe(true);
  await request.post('/api/v1/presentation/open', { data: { source: 'storyboard' } });
  const player = page.getByRole('region', { name: 'Diagram player' });
  await player.getByRole('button', { name: 'Order', exact: true }).click();
  const editor = player.getByLabel('Storyboard editor');
  await expect(editor.getByRole('button', { name: 'Capture current view' })).toBeDisabled();
  await expect(editor.getByRole('note')).toContainText('Choose Details or use Auto-fit objects');
  await request.post('/api/v1/presentation/seek', { data: { index: 0 } });
  await expect(player).toHaveAttribute('data-status', 'error');
  await expect(player).toContainText('Choose Details or use Auto-fit objects');
  expect(
    (
      await request.post('/api/v1/presentation/video', {
        data: { source: 'storyboard', audio: false, subtitles: true },
      })
    ).status(),
  ).toBe(422);
  await editor.getByRole('button', { name: 'Auto-fit objects' }).click();
  await editor.getByRole('button', { name: 'Save scene' }).click();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const before = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  await request.post('/api/v1/presentation/seek', { data: { index: 0 } });
  await expect(player).toHaveAttribute('data-status', 'paused');
  for (const node of graph.nodes.slice(0, 2))
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"]`)).toHaveClass(/selected/);
  await request.post('/api/v1/presentation/close', { data: {} });
  const after = (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()) as Graph;
  expect(after.diagram.settings).toEqual(before.diagram.settings);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
});
