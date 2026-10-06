import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from './fixtures';
import type { Graph } from '../../src/model/types';
import { browserLaunchOptions } from '../../playwright.config';
import { decodedMovieColors, encodedColorSwatches, installVideoColorProbe } from './video-colors';

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
  const response = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'first',
          title: 'Build truck',
          description: 'Build the truck and test its safety.',
          x: 100,
          y: 100,
          width: 280,
          height: 110,
          color: '#d8efdf',
        },
        {
          externalId: 'second',
          title: 'Deliver truck',
          description: 'Deliver the truck to its customer.',
          x: 680,
          y: 260,
          width: 280,
          height: 110,
        },
      ],
      edges: [{ sourceExternalId: 'first', targetExternalId: 'second', label: 'Ready to deliver' }],
    },
  });
  expect(response.ok()).toBe(true);
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
  await request.post('/api/v1/presentation/open', { data: { diagramId: diagram.id } });
  return graph;
}
for (const mode of ['2d', '3d'] as const) {
  test(`exports a playable ${mode} movie with captions, native nodes and an unchanged diagram`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180000);
    const graph = await create(request, `Truck movie ${mode}`);
    const player = page.getByRole('region', { name: 'Diagram player' });
    await expect(player).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()).diagram
            .settings.viewport,
      )
      .toBeTruthy();
    await expect
      .poll(async () => {
        const saved = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
        const actual = await page.locator('.react-flow__viewport').evaluate((element) => {
          const m = new DOMMatrix(getComputedStyle(element).transform);
          return { x: m.e, y: m.f, zoom: m.a };
        });
        return (
          Math.abs(saved.diagram.settings.viewport.x - actual.x) < 0.001 &&
          Math.abs(saved.diagram.settings.viewport.y - actual.y) < 0.001 &&
          Math.abs(saved.diagram.settings.viewport.zoom - actual.zoom) < 0.001
        );
      })
      .toBe(true);
    if (mode === '3d') {
      await page.getByRole('button', { name: '3D view', exact: true }).click();
      await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
        timeout: 30000,
      });
    }
    await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
    const before = (await (
      await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
    ).json()) as Graph;
    if (mode === '2d') {
      await request.post('/api/v1/presentation/play', { data: {} });
      await expect(player).toHaveAttribute('data-status', 'playing');
    }
    await installVideoColorProbe(page);
    const download = page.waitForEvent('download', { timeout: 120000 });
    if (mode === '2d')
      await player.getByRole('button', { name: 'Export walkthrough video', exact: true }).click();
    else
      expect(
        (
          await request.post('/api/v1/presentation/video', {
            data: { audio: false, subtitles: true },
          })
        ).ok(),
      ).toBe(true);
    const movie = await download;
    expect(movie.suggestedFilename()).toMatch(/walkthrough\.(mp4|webm)$/);
    await movie.saveAs(testInfo.outputPath(movie.suggestedFilename()));
    const bytes = Array.from(await readFile((await movie.path())!));
    const decoded = await decodedMovieColors(page, bytes);
    await testInfo.attach(`decoded-${mode}-colors`, {
      body: JSON.stringify(decoded, null, 2),
      contentType: 'application/json',
    });
    expect(decoded).toMatchObject({ width: 1280, height: 720 });
    expect(decoded.duration).toBeGreaterThanOrEqual(6);
    expect(decoded.samples).toHaveLength(4);
    for (const sample of decoded.samples) {
      expect(sample.format).toBe('RGBA');
      expect(sample.colors).toBeGreaterThan(8);
      expect(sample.neutralCount).toBeGreaterThan(1000);
      expect(sample.meanError).toBeLessThan(8);
      expect(sample.neutralError).toBeLessThan(5);
      expect(sample.pinkRatio).toBeLessThan(0.001);
    }
    expect(
      decoded.samples.reduce((sum, sample) => sum + sample.nativeGreenCount, 0),
    ).toBeGreaterThan(100);
    for (const sample of decoded.samples.filter((sample) => sample.nativeGreenCount > 20))
      expect(sample.nativeGreenError).toBeLessThan(8);
    if (mode === '2d') {
      const swatches = await encodedColorSwatches(page);
      await testInfo.attach('decoded-rgb-swatches', {
        body: JSON.stringify(swatches, null, 2),
        contentType: 'application/json',
      });
      for (const swatch of swatches)
        for (let channel = 0; channel < 3; channel++)
          expect(Math.abs(swatch.decoded[channel] - swatch.expected[channel])).toBeLessThanOrEqual(
            8,
          );
    }
    await expect
      .poll(async () => (await (await request.get('/api/v1/presentation/video')).json()).status)
      .toBe('complete');
    const after = (await (
      await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
    ).json()) as Graph;
    expect(after.diagram.version).toBe(before.diagram.version);
    expect(after.diagram.settings).toEqual(before.diagram.settings);
    expect(after.nodes).toEqual(before.nodes);
    if (mode === '2d') {
      // Export temporarily takes over the camera. Resume must return to the
      // paused player's object before continuing its remaining narration/time.
      const paused = await (await request.get('/api/v1/presentation')).json();
      await request.post('/api/v1/presentation/play', { data: {} });
      await expect(player).toHaveAttribute('data-status', 'playing');
      await expect
        .poll(() =>
          page.evaluate((id) => {
            const host = document
              .querySelector('.canvas-shell .react-flow')
              ?.getBoundingClientRect();
            const node = document
              .querySelector(`.react-flow__node[data-id="${id}"]`)
              ?.getBoundingClientRect();
            return Boolean(
              host &&
              node &&
              Math.abs(node.x + node.width / 2 - host.x - host.width / 2) < 12 &&
              Math.abs(node.y + node.height / 2 - host.y - host.height / 2) < 12,
            );
          }, paused.nodeId),
        )
        .toBe(true);
      await request.post('/api/v1/presentation/pause', { data: {} });
    }
    // Cancellation is a write command and never produces a partial download.
    expect((await request.post('/api/v1/presentation/video', { data: {} })).ok()).toBe(true);
    const cancel = await request.delete('/api/v1/presentation/video', { data: {} });
    expect(cancel.ok()).toBe(true);
    expect((await cancel.json()).status).toBe('cancelled');
    await expect(
      player.getByRole('button', { name: 'Play presentation', exact: true }),
    ).toBeEnabled();
  });
}
