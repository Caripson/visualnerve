import { execFileSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import english from '../../src/i18n/catalogs/en';

test.skip(
  process.env.VN_CAPTURE_LANGUAGE_HELP !== '1',
  'Opt in to refresh actual language Settings screenshots.',
);
test.use({
  viewport: { width: 1440, height: 1100 },
  colorScheme: 'light',
  // Failure artifacts must not capture the intermediate recovery-key screen.
  screenshot: 'off',
  trace: 'off',
});
const output = resolve('../hugo/static/help/images');
const password = 'Disposable language screenshot workspace passphrase';

// The encrypted app has no API/MCP grant. Capture its real System appearance
// through the browser's media preference, without changing application styles.
async function captureSystemAppearancePair(page: Page, target: Locator, name: string) {
  await mkdir(output, { recursive: true });
  try {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      const basename = theme === 'light' ? name : `${name}-dark`;
      const png = resolve(output, `${basename}.png`);
      await writeFile(png, await target.screenshot({ animations: 'disabled' }));
      try {
        execFileSync('cwebp', [
          '-lossless',
          '-m',
          '6',
          '-quiet',
          png,
          '-o',
          resolve(output, `${basename}.webp`),
        ]);
      } finally {
        await unlink(png);
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

test('capture encrypted app language controls and English Settings in both appearances', async ({
  page,
}) => {
  await page.goto('https://public-app.test:4341');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="visualnerve-vault-required"]')).toHaveAttribute(
    'content',
    'true',
  );
  const setup = page.getByRole('dialog', {
    name: english['security.gate.setupTitle'],
    exact: true,
  });
  await expect(setup).toBeVisible();
  await setup
    .getByLabel(english['security.credential.newWorkspacePassword'], { exact: true })
    .fill(password);
  await setup
    .getByLabel(english['security.credential.confirmNewPassword'], { exact: true })
    .fill(password);
  await setup.getByRole('button', { name: english['security.gate.create'], exact: true }).click();
  // Do not read, print or screenshot the recovery key. Acknowledge it before
  // capturing Settings, where neither passwords nor the recovery key appear.
  await page.getByLabel(english['security.recovery.savedAcknowledgement']).check();
  await page
    .getByRole('button', { name: english['security.recovery.continue'], exact: true })
    .click();
  await page
    .getByLabel(english['privacy.consent.acceptStorageAccessible'], { exact: true })
    .check();
  await page
    .getByRole('button', { name: english['privacy.consent.continue'], exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: english['privacy.consent.title'], exact: true }),
  ).toBeHidden();
  await page
    .getByRole('button', { name: english['privacy.localBadge.accessibleName'], exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: english['app.settings'], exact: true });
  const language = dialog.locator('.app-language-settings');
  await expect(language.getByTestId('app-language')).toHaveValue('en');
  await expect(language.locator('option')).toHaveCount(8);
  await expect(dialog.getByLabel(english['settings.themeField'], { exact: true })).toHaveValue(
    'system',
  );
  await expect(
    dialog.getByRole('region', { name: english['security.settings.title'], exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(english['security.backup.oldCredentials'], { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(english['security.backup.legacyReadable'], { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel(english['integration.settings.accessAccessible'], { exact: true }),
  ).toHaveValue('off');
  // Settings may contain an empty optional bridge-token field. No credential
  // value from the setup/recovery flow may enter the captured dialog.
  for (const field of await dialog.locator('input[type="password"]').all())
    await expect(field).toHaveValue('');
  await captureSystemAppearancePair(page, language, 'app-language');
  await captureSystemAppearancePair(page, dialog, 'settings');
});
