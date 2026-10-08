import { execFileSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/** Capture actual application themes; never manufacture pixels or override its styles. */
export async function captureAppearancePair(
  target: Page | Locator,
  directory: string,
  name: string,
) {
  const page = 'page' in target ? target.page() : target;
  const settingsURL = new URL('/api/v1/settings', page.url()).href;
  const response = await page.request.get(settingsURL);
  expect(response.ok(), 'Capture requires the consented, connected local workspace').toBeTruthy();
  const settings = (await response.json()) as { key: string; value: unknown }[];
  expect(settings.find(({ key }) => key === 'storage-consent')?.value).toBe(true);
  const preference = settings.find(({ key }) => key === 'theme')?.value;
  const originalDark = await page.evaluate(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const originalTheme = await page.locator('html').getAttribute('data-theme');
  const explicit = preference === 'light' || preference === 'dark';
  async function setPreference(value: unknown) {
    const saved = await page.request.put(new URL('/api/v1/settings/theme', page.url()).href, {
      data: { value },
    });
    expect(saved.ok(), 'Capture theme preference must save through the real API').toBeTruthy();
  }
  await mkdir(directory, { recursive: true });
  try {
    // System/absent preferences remain untouched. Explicit preferences are restored in finally.
    if (explicit) await setPreference('system');
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      const spatial = page.getByTestId('spatial-canvas');
      if (await spatial.isVisible())
        await expect(spatial).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
      const basename = theme === 'light' ? name : `${name}-dark`;
      const bytes = await target.screenshot({ animations: 'disabled' });
      const png = resolve(directory, `${basename}.png`);
      await writeFile(png, bytes);
      try {
        execFileSync('cwebp', [
          '-lossless',
          '-m',
          '6',
          '-quiet',
          png,
          '-o',
          resolve(directory, `${basename}.webp`),
        ]);
      } finally {
        await unlink(png);
      }
      console.log(`${basename}.webp ${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`);
    }
  } finally {
    await page.emulateMedia({ colorScheme: originalDark ? 'dark' : 'light' });
    if (explicit) await setPreference(preference);
    if (originalTheme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', originalTheme);
  }
}
