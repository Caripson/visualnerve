import { expect, test, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

test.skip(
  process.env.VITE_VISUAL_NERVE_BEHAVIORS_PREVIEW !== '1',
  'Requires the Behavior preview build',
);

async function openDemo(page: Page, demo: string) {
  await page.goto(`/app/?behaviors=1&demo=${demo}`);
  await acknowledge(page);
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Behavior library' })).toBeVisible();
}

async function run(page: Page, speed: '100' | 'max', runs: number) {
  await page.getByLabel('Simulation speed').selectOption(speed);
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await expect(page.getByLabel('Replay run').locator('option')).toHaveCount(runs + 1);
}

async function outcome(page: Page, completed: number) {
  // Completed is the third metric column in the selected saved run table.
  const rows = page.locator('.simulation-results tbody tr');
  await expect(rows.first().locator('td').nth(2)).toHaveText(String(completed));
}

test('checkout crosses the threshold with a single reserve allocation across Play, MAX, and deterministic replay', async ({
  page,
}) => {
  await openDemo(page, 'behaviors-cashier');
  await expect(page.getByLabel('Simulation random seed')).toHaveValue('42');
  await expect(page.getByLabel('Finish all generated work')).not.toBeChecked();
  await page.getByText(/Replay and compare runs/).click();

  await run(page, '100', 1);
  await outcome(page, 2);
  const trace = page.getByRole('list', { name: 'Simulated Behavior events' });
  await expect(trace).toContainText('queueChanged 14 → 15');
  await expect(trace).toContainText('queueChanged 15 → 16');
  await expect(trace.getByText(/Send “öppna” to Kassor/)).toHaveCount(1);
  await expect(trace.getByText(/Reserve slot opened and staff allocated/)).toHaveCount(1);
  const timed = await trace.getByRole('listitem').allTextContents();
  const previousRun = await page.getByLabel('Replay run').inputValue();

  await run(page, 'max', 2);
  await outcome(page, 2);
  await expect(trace.getByRole('listitem').first()).toBeVisible();
  expect(await trace.getByRole('listitem').allTextContents()).toEqual(timed);

  await page.getByRole('button', { name: 'Behavior library' }).click();
  await page.getByRole('button', { name: 'Edit Kötröskel' }).click();
  const source = page.getByRole('textbox', { name: 'Behavior source', exact: true });
  const original = await source.inputValue();
  await source.fill(original.replace('= 15', '= 25'));
  await page.getByRole('button', { name: 'Activate source', exact: true }).click();
  await page.keyboard.press('Escape');

  await page.getByLabel('Replay run').selectOption(previousRun);
  const replay = page.getByRole('slider', { name: 'Replay simulated time' });
  await replay.focus();
  await replay.press('End');
  await page.getByRole('button', { name: 'Inspect this moment' }).click();
  await expect(trace.getByRole('listitem')).toHaveCount(timed.length);
  expect(await trace.getByRole('listitem').allTextContents()).toEqual(timed);
  await page.getByText('Captured Behavior source', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Kötröskel' })).toContainText('= 15');
});

test('checkout with one busy staff member keeps one capacity and explains denied reserve', async ({
  page,
}) => {
  await openDemo(page, 'behaviors-cashier-busy');
  await page.getByText(/Replay and compare runs/).click();
  await run(page, 'max', 1);
  await outcome(page, 1);
  const trace = page.getByRole('list', { name: 'Simulated Behavior events' });
  await expect(trace).toContainText('queueChanged 15 → 16');
  await expect(trace).toContainText('Staff busy');
  await expect(trace).not.toContainText('Reserve slot opened');
});

test('checkout with threshold Behavior disabled has no directed signal or extra completed customer', async ({
  page,
}) => {
  await openDemo(page, 'behaviors-cashier-off');
  await page.getByText(/Replay and compare runs/).click();
  await run(page, 'max', 1);
  await outcome(page, 1);
  const trace = page.getByRole('list', { name: 'Simulated Behavior events' });
  await expect(page.getByText('No Behavior events at this time.')).toBeVisible();
  await expect(trace.getByRole('listitem')).toHaveCount(0);
});
