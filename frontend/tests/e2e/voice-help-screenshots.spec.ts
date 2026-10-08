import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { captureAppearancePair } from './capture-appearance';

test.skip(
  process.env.VN_CAPTURE_VOICE_HELP !== '1',
  'Opt in to refresh actual voice Settings screenshots.',
);
test.use({ viewport: { width: 1440, height: 1100 } });

test('capture the expanded local voice selector in both appearances', async ({ page, request }) => {
  // The consented fixture opens only a disposable context. No audio preparation or model download.
  expect((await request.get('/api/v1/presentation/voices')).ok()).toBe(true);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const voice = settings.getByRole('region', { name: 'Presentation voice settings', exact: true });
  await expect(voice.getByLabel('Narration voice')).toHaveValue('en_GB-alan-medium');
  await expect(voice.locator('option')).toHaveCount(20);
  await voice.scrollIntoViewIfNeeded();
  await captureAppearancePair(voice, resolve('../hugo/static/help/images'), 'presentation-voice');
});
