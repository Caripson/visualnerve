import { expect, test } from './fixtures';

// Downloads the pinned 63 MB public voice model. Opt in for release/browser audits,
// rather than making offline CI depend on an external model hosting service.
test('real Alan voice: cold progress, audible PCM, warm reuse and offline replay', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.VISUAL_NERVE_LIVE_SPEECH !== '1', 'Explicit live voice download audit');
  test.setTimeout(480000);
  await request.get('/api/v1/health');
  await page.addInitScript(() => {
    const evidence = {
      starts: 0,
      decoded: [] as { duration: number; sampleRate: number; peak: number }[],
    };
    (window as unknown as { voiceEvidence: typeof evidence }).voiceEvidence = evidence;
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
      const audio = await decode.call(this, data);
      const samples = audio.getChannelData(0);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      evidence.decoded.push({ duration: audio.duration, sampleRate: audio.sampleRate, peak });
      return audio;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      evidence.starts++;
      return start.apply(this, args);
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('region', { name: 'Presentation voice settings', exact: true });
  await expect(settings.getByLabel('Narration voice', { exact: true })).toHaveValue(
    'en_GB-alan-medium',
  );
  await settings.getByRole('button', { name: 'Clear downloaded voices', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Downloaded voice models cleared');
  const models: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('huggingface.co')) models.push(req.url());
  });
  const begin = Date.now();
  await settings.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect(settings.getByRole('progressbar', { name: 'Voice preparation' })).toBeVisible();
  await expect(settings.getByRole('status').filter({ hasText: /\d+%/ })).toBeVisible({
    timeout: 60000,
  });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => (window as unknown as { voiceEvidence: { starts: number } }).voiceEvidence.starts,
        ),
      { timeout: 240000 },
    )
    .toBe(1);
  const coldMs = Date.now() - begin;
  await expect(settings.getByRole('button', { name: 'Preview voice', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    settings.getByText('Voice downloaded and available offline.', { exact: false }),
  ).toBeVisible();
  expect(models.length).toBeGreaterThanOrEqual(2);
  const modelRequests = models.length;
  const warm = Date.now();
  await settings.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => (window as unknown as { voiceEvidence: { starts: number } }).voiceEvidence.starts,
        ),
      { timeout: 60000 },
    )
    .toBe(2);
  const warmMs = Date.now() - warm;
  await settings.getByRole('button', { name: 'Cancel voice preview', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Preview voice', exact: true })).toBeVisible();
  expect(models).toHaveLength(modelRequests);
  await page.context().setOffline(true);
  try {
    await settings.getByRole('button', { name: 'Preview voice', exact: true }).click();
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { voiceEvidence: { starts: number } }).voiceEvidence.starts,
          ),
        { timeout: 60000 },
      )
      .toBe(3);
    await expect(settings.getByRole('button', { name: 'Preview voice', exact: true })).toBeVisible({
      timeout: 30000,
    });
  } finally {
    await page.context().setOffline(false);
  }
  const evidence = await page.evaluate(
    () =>
      (
        window as unknown as {
          voiceEvidence: {
            starts: number;
            decoded: { duration: number; sampleRate: number; peak: number }[];
          };
        }
      ).voiceEvidence,
  );
  expect(evidence.decoded).toHaveLength(3);
  for (const clip of evidence.decoded) {
    expect(clip.duration).toBeGreaterThan(2);
    expect(clip.peak).toBeGreaterThan(0.05);
    expect(clip.sampleRate).toBeGreaterThanOrEqual(22050);
  }
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await info.attach('real-piper-evidence', {
    body: JSON.stringify({ coldMs, warmMs, modelRequests, ...evidence }, null, 2),
    contentType: 'application/json',
  });
});
