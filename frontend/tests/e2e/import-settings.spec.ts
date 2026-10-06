import { test, expect, type Page } from './fixtures';

const key = '/api/v1/settings/import-file-limit-mb';
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

test('settings bounds and persists the local import ceiling with an experimental warning and readable phone spacing', async ({
  page,
  request,
}, testInfo) => {
  let modal = await settings(page);
  const section = page.getByRole('region', { name: 'Import settings', exact: true });
  const input = page.getByLabel('Maximum import file size (MB)', { exact: true });
  await expect(input).toHaveValue('50');
  await expect(section).toContainText('Only imports up to 50 MB are supported and guaranteed.');
  await input.fill('1024');
  await expect(section.getByRole('note')).toContainText('Larger imports are experimental');
  await section.getByRole('button', { name: 'Save import limit', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('saved for this browser');
  expect(await (await request.get(key)).json()).toBe(1024);
  await input.fill('1025');
  await section.getByRole('button', { name: 'Save import limit', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('50 MB to 1024 MB');
  expect(await (await request.get(key)).json()).toBe(1024);
  const backup = await (await request.get('/api/v1/workspace/export')).json();
  expect(
    backup.settings.some((setting: { key: string }) => setting.key === 'import-file-limit-mb'),
  ).toBe(false);
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.setViewportSize({ width: 320, height: 740 });
  modal = await settings(page);
  await expect(input).toHaveValue('1024');
  await expect(section.getByRole('note')).toBeVisible();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const metrics = await section.evaluate((element) => {
    const field = element.querySelector('.field')!.getBoundingClientRect();
    const paragraphs = [...element.querySelectorAll('p')];
    return {
      fieldGap: paragraphs[0].getBoundingClientRect().top - field.bottom,
      lineHeight: Number.parseFloat(getComputedStyle(paragraphs[0]).lineHeight),
    };
  });
  expect(metrics.fieldGap).toBeGreaterThanOrEqual(11);
  expect(metrics.lineHeight).toBeGreaterThanOrEqual(19);
  await section.scrollIntoViewIfNeeded();
  await modal.screenshot({ path: testInfo.outputPath('settings-phone.png') });
  await input.fill('50');
  await section.getByRole('button', { name: 'Save import limit', exact: true }).click();
  await expect(section.getByRole('note')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
});

test('a real file above 50 MB is refused at the default and imports locally after raising the ceiling', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150000);
  const before = await (await request.get('/api/v1/diagrams')).json();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    const prefix = '<mxGraphModel><!--';
    const suffix =
      '--><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Large file object" vertex="1" parent="1"><mxGeometry x="40" y="40" width="200" height="90" as="geometry"/></mxCell></root></mxGraphModel>';
    data.items.add(
      new File([prefix, 'x'.repeat(50 * 1024 * 1024 + 1024), suffix], 'large.drawio', {
        type: 'application/xml',
      }),
    );
    return data;
  });
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(
    page.getByText(/Import failed: Import file exceeds the configured 50 MB/),
  ).toBeVisible();
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  let modal = await settings(page);
  const section = page.getByRole('region', { name: 'Import settings', exact: true });
  await page.getByLabel('Maximum import file size (MB)', { exact: true }).fill('60');
  await section.getByRole('button', { name: 'Save import limit', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('saved for this browser');
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  modal = page.getByRole('dialog', { name: 'Import diagram file', exact: true });
  await expect(modal.getByRole('note')).toContainText('Only imports up to 50 MB');
  await expect(modal.getByLabel('Diagram page', { exact: true })).toBeVisible({ timeout: 40000 });
  await expect(modal).toContainText('1 objects, 0 connections');
  await page.getByLabel('Imported diagram name', { exact: true }).fill('Experimental large import');
  await modal.screenshot({ path: testInfo.outputPath('large-import-warning.png') });
  await modal.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  await expect(page.locator('.canvas-shell')).toContainText('Large file object');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find(
    (diagram: { name: string }) => diagram.name === 'Experimental large import',
  ).id;
  const graph = await (await request.get(`/api/v1/diagrams/${id}`)).json();
  expect(graph.nodes).toHaveLength(1);
  expect(JSON.stringify(graph).length).toBeLessThan(10000);
  await page.reload();
  await expect(page.locator('.canvas-shell')).toContainText('Large file object');
  expect(await (await request.get(key)).json()).toBe(60);
  await transfer.dispose();
});

test('source refresh and SQL diagnostics keep text and controls separated on a phone', async ({
  page,
  request,
}, testInfo) => {
  const response = await request.post('/api/v1/sql/diagrams', {
    data: { sql: 'CREATE TABLE customers (id INT PRIMARY KEY);', name: 'Spacing review' },
  });
  expect(response.status()).toBe(201);
  await expect(page.locator('.project-title-button')).toHaveText('Spacing review');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel('More tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh source', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Refresh source', exact: true });
  await expect(modal.getByLabel('Source to refresh', { exact: true })).toBeVisible();
  expect(
    await modal.evaluate((element) => {
      const intro = element.querySelector('.source-refresh-intro')!.getBoundingClientRect();
      const field = element.querySelector('.source-refresh > .field')!.getBoundingClientRect();
      return field.top - intro.bottom;
    }),
  ).toBeGreaterThanOrEqual(15);
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath('source-refresh-phone.png') });
  await modal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('More tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Data quality', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Data quality', exact: true });
  const section = page.getByRole('region', { name: 'SQL quality checks', exact: true });
  await expect(section).toBeVisible();
  expect(
    await section.evaluate((element) => {
      const paragraphs = element.querySelectorAll('p');
      return (
        paragraphs[1].getBoundingClientRect().top - paragraphs[0].getBoundingClientRect().bottom
      );
    }),
  ).toBeGreaterThanOrEqual(11);
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath('sql-quality-phone.png') });
});
