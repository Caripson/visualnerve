import { expect, test } from '@playwright/test';
import { acknowledge } from './fixtures';

for (const [key, title] of [
  ['api-compute-capacity', 'API & Compute Capacity'],
  ['network-multi-site-capacity', 'Network & Multi-Site Capacity'],
  ['energy-power-capacity', 'Energy & Power Capacity'],
  ['datacenter-capacity', 'Datacenter Capacity'],
])
  test(`the public ${key} link waits for consent and does not create a duplicate after reload`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:4327/app/?demo=${key}`);
    await expect(
      page.getByRole('dialog', { name: 'Your work stays in this browser', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeHidden();
    await acknowledge(page);
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:4327/app/');
    await expect(page.locator('button[data-diagram-id]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await expect(page.locator('button[data-diagram-id]')).toHaveCount(1);
  });
