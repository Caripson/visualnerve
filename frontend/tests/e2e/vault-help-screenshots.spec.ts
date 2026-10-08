import { execFileSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

test.skip(process.env.VN_CAPTURE_VAULT_HELP !== '1', 'Opt in to capture the real encrypted UI.');
test.use({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
const output = resolve('../hugo/static/help/images');
const password = 'Disposable screenshot test workspace password';

// Unlike ordinary connected help captures, the setup/locked UI has no private
// API grant. Use its real System appearance; never inject styles or fake pixels.
async function capture(page: Page, target: Locator, name: string) {
  await mkdir(output, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
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
  await page.emulateMedia({ colorScheme: 'light' });
}

test('capture password setup, session settings, password change, incident rotation, MCP and locked workspace in both themes', async ({
  page,
}) => {
  await page.goto('https://public-app.test:4341');
  const setup = page.getByRole('dialog', { name: 'Protect your local workspace', exact: true });
  await expect(setup).toBeVisible();
  await setup.getByRole('heading').click();
  await capture(page, setup, 'vault-setup');
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  // The recovery key is never captured or checked into the repository.
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const security = page.getByRole('region', { name: 'Workspace security', exact: true });
  await expect(security).toBeVisible();
  await capture(page, security, 'vault-session-settings');
  await capture(
    page,
    page.getByRole('region', { name: 'MCP and API integration', exact: true }),
    'mcp-settings',
  );
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const change = page.getByRole('dialog', { name: 'Change workspace password', exact: true });
  await expect(change).toBeVisible();
  await change.getByRole('heading').click();
  await capture(page, change, 'vault-password-change');
  await change.getByRole('button', { name: 'Cancel', exact: true }).click();
  await security.getByText('Suspected content-key exposure', { exact: true }).click();
  await security.getByRole('button', { name: 'Rotate workspace content key', exact: true }).click();
  const rotation = page.getByRole('dialog', {
    name: 'Rotate the workspace content key',
    exact: true,
  });
  await expect(rotation).toBeVisible();
  await rotation.getByRole('heading').click();
  // This longer real dialog needs enough viewport height to show its full
  // password form and actions; capture the UI without changing its styles.
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 1600 });
  try {
    await expect(
      rotation.getByRole('button', { name: 'Prepare new content key', exact: true }),
    ).toBeVisible();
    await capture(page, rotation, 'vault-content-key-rotation');
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  await rotation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  const locked = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
  await expect(locked).toBeVisible();
  await locked.getByRole('heading').click();
  await capture(page, locked, 'vault-unlock');
});
