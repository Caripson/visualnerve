import { expect, test, type Page } from './fixtures';

async function bounds(page: Page, label: string) {
  const panel = page.getByRole('dialog', { name: `${label} menu`, exact: true });
  await expect(panel).toBeVisible();
  const result = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const toolbar = document.querySelector('.editor-toolbar')!;
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: innerWidth,
      height: innerHeight,
      parent: element.parentElement === document.body,
      toolbarHeight: toolbar.clientHeight,
      toolbarScrollHeight: toolbar.scrollHeight,
    };
  });
  expect(result.parent).toBe(true);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(result.height);
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.width);
  expect(result.toolbarScrollHeight).toBeLessThanOrEqual(result.toolbarHeight + 1);
  return panel;
}

test('data actions escape toolbar clipping and remain usable on a constrained desktop', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  const created = await request.post('/api/v1/sql/diagrams', {
    data: { sql: 'CREATE TABLE customer (id INT PRIMARY KEY);', name: 'Toolbar data menu' },
  });
  expect(created.status()).toBe(201);
  await expect(page.locator('.project-title-button')).toHaveText('Toolbar data menu');
  const trigger = page.getByRole('button', { name: 'Explore data', exact: true });
  await trigger.click();
  const panel = await bounds(page, 'Explore data');
  await expect(panel).toContainText('Data behind this diagram');
  await expect(panel.getByRole('button', { name: 'Refresh source' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Data quality' })).toBeEnabled();
  const quality = panel.getByRole('button', { name: 'Data quality' });
  const point = await quality.boundingBox();
  expect(point).toBeTruthy();
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim(),
      { x: point!.x + point!.width / 2, y: point!.y + point!.height / 2 },
    ),
  ).toBe('Data quality');
  await quality.click();
  await expect(page.getByRole('dialog', { name: 'Explore data menu' })).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Data quality', exact: true })).toContainText(
    'SQL schema checks',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Examples menu' })).toContainText(
    'New 3D truck lifecycle example',
  );
});

test('mobile tools fit the screen, scroll within the popup and retain SELECT diagnostics', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const created = await request.post('/api/v1/sql/diagrams', {
    data: {
      sql: 'SELECT b.id, b.name AS name, b.id AS name FROM business b;',
      name: 'Mobile query tools',
    },
  });
  expect(created.status()).toBe(201);
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  const panel = await bounds(page, 'More tools');
  await expect(panel.getByRole('button', { name: 'Visualize code', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh source' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Data quality', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Data quality', exact: true })).toContainText(
    'SQL SELECT structure checks',
  );
  await expect(page.getByRole('dialog', { name: 'Data quality', exact: true })).toContainText(
    'repeated output names',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
