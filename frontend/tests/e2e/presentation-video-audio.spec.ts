import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from './fixtures';
import type { Graph } from '../../src/model/types';
import { decodedMovieAudio, installNarrationFixture } from './video-audio';

// Fulfill only the genuine speech Worker script. Every video frame, WAV
// resample, AudioData, AAC/Opus packet, container and decode remains native.
test.use({ serviceWorkers: 'block' });

async function create(request: APIRequestContext, name: string) {
  const response = await request.post('/api/v1/diagrams', { data: { name, type: 'process' } });
  expect(response.ok()).toBe(true);
  const diagram = await response.json();
  expect(
    (
      await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          nodes: [
            {
              externalId: 'first',
              title: 'First narration',
              description: 'FIRST changing audio signal.',
              x: 0,
              y: 0,
            },
            {
              externalId: 'second',
              title: 'Second narration',
              description: 'SECOND distinct changing audio signal.',
              x: 400,
              y: 0,
            },
          ],
          edges: [{ sourceExternalId: 'first', targetExternalId: 'second' }],
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
  expect(
    (await request.post('/api/v1/presentation/open', { data: { diagramId: diagram.id } })).ok(),
  ).toBe(true);
}

for (const forceOpus of [false, true]) {
  test(`preserves complete changing narration and silent gaps in ${forceOpus ? 'forced WebM/Opus API' : 'preferred native codec UI'} video export`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installNarrationFixture(page, forceOpus);
    await create(request, forceOpus ? 'Opus audio regression' : 'Native audio regression');
    const player = page.getByRole('region', { name: 'Diagram player' });
    await expect(player).toBeVisible();
    await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
    const download = page.waitForEvent('download', { timeout: 120000 });
    if (forceOpus)
      expect(
        (
          await request.post('/api/v1/presentation/video', {
            data: { audio: true, subtitles: false },
          })
        ).ok(),
      ).toBe(true);
    else {
      await player.getByRole('button', { name: 'Presentation audio', exact: true }).click();
      await expect(
        player.getByRole('button', { name: 'Presentation audio', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      const subtitles = player.getByRole('button', { name: 'Presentation subtitles', exact: true });
      if ((await subtitles.getAttribute('aria-pressed')) === 'true') await subtitles.click();
      await player.getByRole('button', { name: 'Export walkthrough video', exact: true }).click();
    }
    const movie = await download;
    if (forceOpus) expect(movie.suggestedFilename()).toMatch(/\.webm$/);
    else expect(movie.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
    await movie.saveAs(testInfo.outputPath(movie.suggestedFilename()));
    const decoded = await decodedMovieAudio(
      page,
      Array.from(await readFile((await movie.path())!)),
    );
    await testInfo.attach('native-decoded-audio-waveform-checks', {
      body: JSON.stringify(decoded, null, 2),
      contentType: 'application/json',
    });
    expect(decoded.channels).toBe(1);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.duration).toBeGreaterThan(4);
    expect(decoded.starts).toHaveLength(2);
    expect(decoded.clips).toHaveLength(2);
    if (forceOpus) expect(decoded.codecs).toEqual(['opus']);
    else
      expect(decoded.codecs).toEqual([
        movie.suggestedFilename().endsWith('.mp4') ? 'mp4a.40.2' : 'opus',
      ]);
    for (const clip of decoded.clips) {
      expect(clip.duration).toBeCloseTo(1.6, 2);
      expect(Math.abs(clip.alignmentSeconds)).toBeLessThan(0.15);
      expect(clip.correlation).toBeGreaterThan(0.94);
      for (const segment of clip.segments) expect(segment).toBeGreaterThan(0.92);
      expect(clip.start + clip.duration).toBeLessThanOrEqual(decoded.duration + 0.05);
    }
    for (const gap of decoded.silence) {
      expect(gap.seconds).toBeGreaterThan(0.05);
      expect(gap.rms).toBeLessThan(0.002);
    }
    await expect
      .poll(async () => (await (await request.get('/api/v1/presentation/video')).json()).status)
      .toBe('complete');
    expect(errors).toEqual([]);
  });
}
