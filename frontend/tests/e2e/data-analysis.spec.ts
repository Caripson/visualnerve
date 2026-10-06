import { expect, test, type APIRequestContext, type Page } from './fixtures';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function select(page: Page, title: string, request: APIRequestContext) {
  await expect(page.locator('.csv-import-progress')).toBeHidden();
  await page.keyboard.press('Control+f');
  await page.getByLabel('Global search').fill(title);
  await page
    .locator('.search-results button')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  await expect(page.getByLabel('Node title')).toHaveValue(title);
  // Search animates the camera and saves its final viewport. Wait for that
  // navigation before starting analysis against a captured graph revision.
  await expect
    .poll(async () => {
      const name = await page.locator('.project-title-button').textContent();
      const diagrams = await (await request.get('/api/v1/diagrams')).json();
      const viewport = diagrams.find((diagram: { name: string }) => diagram.name === name)?.settings
        ?.viewport;
      if (!viewport) return false;
      return page.evaluate((viewport: { x: number; y: number; zoom: number }) => {
        const flow = document.querySelector('.canvas-shell .react-flow');
        const selected = flow?.querySelector('.react-flow__node.selected');
        const surface = flow?.querySelector('.react-flow__viewport');
        if (!flow || !selected || !surface) return false;
        const canvas = flow.getBoundingClientRect(),
          node = selected.getBoundingClientRect();
        const transform = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
        return (
          Math.abs((node.left + node.right - canvas.left - canvas.right) / 2) < 1 &&
          Math.abs((node.top + node.bottom - canvas.top - canvas.bottom) / 2) < 1 &&
          Math.abs(transform.e - viewport.x) < 0.0001 &&
          Math.abs(transform.f - viewport.y) < 0.0001 &&
          Math.abs(transform.a - viewport.zoom) < 0.0001
        );
      }, viewport);
    })
    .toBe(true);
}
async function dataTool(page: Page, name: string) {
  await page.getByLabel('Explore data', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function relatedScope(
  request: APIRequestContext,
  path: { columnId: string; value: string }[] | null,
) {
  // Saved can still describe the previous view while the analysis worker runs.
  // Wait for the requested committed scope before search reopens its graph.
  await expect
    .poll(async () => {
      const diagrams = await (await request.get('/api/v1/diagrams')).json();
      return (
        diagrams.find((diagram: { name: string }) => diagram.name === 'Connected orders')?.settings
          ?.csvEntityFocus?.path ?? null
      );
    })
    .toEqual(path);
}

test('connects 100,000 orders, explores related entities and explains native totals without duplicate inflation', async ({
  page,
  request,
}) => {
  const customers = `Id,Company\n${Array.from({ length: 2000 }, (_, index) => `K${index},AAA customer ${String(index).padStart(4, '0')}`).join('\n')}\nK0,AAA customer 0000`;
  const orders = `Customer,Amount\n${Array.from({ length: 100000 }, (_, index) => `${index === 99999 ? 'UNKNOWN' : `K${index % 2000}`},10.50`).join('\n')}`;
  await page.evaluate(
    ({ customers, orders }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([customers], 'customers.csv', { type: 'text/csv' }));
      transfer.items.add(new File([orders], 'orders.csv', { type: 'text/csv' }));
      window.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { customers, orders },
  );
  const csv = page.getByRole('dialog', { name: /^(Import|Explore) CSV data$/ });
  await expect(csv).toBeVisible();
  await csv.getByLabel('CSV diagram name').fill('Connected orders');
  await csv.getByLabel('Grouping level 1', { exact: true }).selectOption('c1');
  await csv.getByRole('button', { name: 'Create data diagram', exact: true }).click();
  const sources = page.getByRole('dialog', { name: 'Data sources' });
  await expect(sources).toBeVisible();
  await expect(sources).toContainText('100,000 rows');
  await sources.getByRole('button', { name: 'Match columns', exact: true }).click();
  await sources
    .getByLabel('Relationship source', { exact: true })
    .selectOption({ label: 'orders' });
  await sources.getByLabel('Source matching column', { exact: true }).selectOption('c0');
  await sources.getByLabel('Target matching column', { exact: true }).selectOption('c0');
  await sources.getByRole('button', { name: 'Preview match', exact: true }).click();
  await expect(sources.locator('.data-match-preview')).toContainText('99,999 / 100,000');
  await expect(sources.locator('.data-match-preview')).toContainText('many-to-many');
  await sources.getByRole('button', { name: 'Add this relationship', exact: true }).click();
  await sources.getByRole('button', { name: 'Apply data model', exact: true }).click();
  await expect(sources).toBeHidden();
  await saved(page);

  await select(page, 'orders', request);
  await page.getByRole('button', { name: 'Change grouping and measures', exact: true }).click();
  await csv.getByLabel('Measure 1', { exact: true }).selectOption('sum');
  await csv.getByLabel('Measure column 1', { exact: true }).selectOption('c1');
  await csv.getByRole('button', { name: 'Apply data view', exact: true }).click();
  await expect(csv).toBeHidden();
  await saved(page);
  await select(page, 'orders', request);
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Explain measure' });
  await expect(explanation.getByRole('heading', { name: /Sum · Amount: 1,050,000/ })).toBeVisible();
  await expect(explanation).toContainText('100,000 matching rows');
  await explanation.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await dataTool(page, 'Data quality');
  const quality = page.getByRole('dialog', { name: 'Data quality' });
  await quality.getByLabel('Quality source').selectOption({ label: 'orders' });
  await quality.getByRole('button', { name: /missing referenced keys/ }).click();
  await expect(quality.getByRole('table', { name: 'Evidence rows' })).toContainText('UNKNOWN');
  await expect(quality.getByRole('table', { name: 'Evidence rows' })).toContainText('100000');
  await quality.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await select(page, 'AAA customer 0000', request);
  await page.getByRole('button', { name: 'Explore this group', exact: true }).click();
  await relatedScope(request, [{ columnId: 'c1', value: 'AAA customer 0000' }]);
  await saved(page);
  await select(page, 'orders', request);
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  await expect(explanation.getByRole('heading', { name: /Sum · Amount: 525/ })).toBeVisible();
  await expect(explanation).toContainText('50 matching rows');
  const table = explanation.getByRole('table', { name: 'Evidence rows' });
  await expect(table.locator('tbody tr')).toHaveCount(50);
  await expect(table.locator('tbody tr').nth(1).locator('th')).toHaveText('2001');
  await explanation.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.screenshot({ path: '/tmp/visualnerve-connected-data.png' });

  await page.reload();
  await saved(page);
  await select(page, 'orders', request);
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  await expect(explanation.getByRole('heading', { name: /Sum · Amount: 525/ })).toBeVisible();
  await explanation.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'All data', exact: true }).click();
  await relatedScope(request, null);
  await saved(page);
  await select(page, 'orders', request);
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  await expect(explanation.getByRole('heading', { name: /Sum · Amount: 1,050,000/ })).toBeVisible();
});

test('quality checks expose original collisions and excluded numbers in the browser', async ({
  page,
  request,
}) => {
  await page.getByLabel('Import file').setInputFiles({
    name: 'quality.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Id;Company;Amount\n1;123-AAA;10,50\n2;456-AAA;bad\n2;BBB;1,234'),
  });
  const csv = page.getByRole('dialog', { name: /^(Import|Explore) CSV data$/ });
  await csv.getByLabel('Grouping level 1', { exact: true }).selectOption('c1');
  await csv.getByRole('button', { name: 'Add column cleanup', exact: true }).click();
  await csv.getByLabel('Cleanup column 1', { exact: true }).selectOption('c1');
  await csv.getByLabel('Cleanup regex 1', { exact: true }).fill('^\\d+-');
  await csv.getByLabel('Measure 1', { exact: true }).selectOption('sum');
  await csv.getByLabel('Measure column 1', { exact: true }).selectOption('c2');
  await csv.getByRole('button', { name: 'Create data diagram', exact: true }).click();
  await expect(csv).toBeHidden();
  await saved(page);
  await dataTool(page, 'Data quality');
  const quality = page.getByRole('dialog', { name: 'Data quality' });
  await quality.getByRole('button', { name: /different originals merged by cleanup/ }).click();
  await quality.getByLabel('Show original cells', { exact: true }).check();
  await expect(quality.getByRole('table', { name: 'Evidence rows' })).toContainText('123-AAA');
  await expect(quality.getByRole('table', { name: 'Evidence rows' })).toContainText('456-AAA');
  await quality.getByRole('button', { name: /ambiguous decimal/ }).click();
  await expect(quality.getByRole('table', { name: 'Evidence rows' })).toContainText('1,234');
  await quality.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await select(page, 'AAA', request);
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Explain measure' });
  await expect(explanation.getByRole('heading', { name: /Sum · Amount: 10.5/ })).toBeVisible();
  await explanation.getByLabel('Measure evidence rows', { exact: true }).selectOption('excluded');
  await expect(explanation.getByRole('table', { name: 'Evidence rows' })).toContainText('bad');
  await expect(explanation.getByRole('table', { name: 'Evidence rows' })).toContainText('invalid');
});
