import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acknowledge, expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getSqlRelationship, getSqlTable } from '../../src/sql/schema';

const sql = `
CREATE TABLE app.customers (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  manager_id BIGINT REFERENCES app.customers(id)
);
CREATE TABLE app.orders (
  id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  private_note TEXT DEFAULT 'EXCLUDED-DEFAULT-VALUE'
);
ALTER TABLE app.orders ADD CONSTRAINT fk_customer
  FOREIGN KEY (customer_id) REFERENCES app.customers(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE app.lines (
  order_id BIGINT NOT NULL,
  line_no INTEGER NOT NULL,
  product TEXT,
  PRIMARY KEY (order_id, line_no),
  FOREIGN KEY (order_id) REFERENCES app.orders(id) ON DELETE CASCADE
);
INSERT INTO app.orders VALUES (1, 2, 42, 'EXCLUDED-INSERT-VALUE');
`;

async function stored(page: Page, name: string): Promise<Graph> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visual-nerve-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const all = await Promise.all(
        ['diagrams', 'nodes', 'edges'].map(
          (table) =>
            new Promise<any[]>((resolve, reject) => {
              const request = database.transaction(table).objectStore(table).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      const diagram = all[0].find((diagram) => diagram.name === name);
      return {
        format: 'visual-nerve' as const,
        formatVersion: 1 as const,
        diagram,
        nodes: all[1].filter((node) => node.diagramId === diagram?.id),
        edges: all[2].filter((edge) => edge.diagramId === diagram?.id),
        owners: [],
      };
    } finally {
      database.close();
    }
  }, name);
}
async function saved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Saved');
}
const card = (page: Page, id: string) =>
  page.locator(`.canvas-shell [data-testid="graph-node"][data-node-id="${id}"]`);

test('drops a SQL file into editable connected schema objects and preserves only schema through reload and export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await acknowledge(page);
  const transfer = await page.evaluateHandle((text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], 'Sales.sql', { type: 'application/sql' }));
    return data;
  }, sql);
  try {
    await page.locator('.application').dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(page.getByText('Drop a file to create a diagram', { exact: true })).toBeVisible();
    await page.locator('.application').dispatchEvent('drop', { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
  const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await expect(dialog.getByLabel('SQL diagram name')).toHaveValue('Sales');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'SQL schema preview' });
  await expect(
    preview.locator('.sql-preview-counts > div').filter({ hasText: /^Tables3$/ }),
  ).toBeVisible();
  await expect(
    preview.locator('.sql-preview-counts > div').filter({ hasText: /^Relationships3$/ }),
  ).toBeVisible();
  expect((await stored(page, 'Sales')).diagram).toBeUndefined();
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  let graph = await stored(page, 'Sales');
  expect(graph.nodes).toHaveLength(3);
  expect(graph.edges).toHaveLength(3);
  const orders = graph.nodes.find((node) => getSqlTable(node)?.name === 'orders')!;
  const customers = graph.nodes.find((node) => getSqlTable(node)?.name === 'customers')!;
  const lines = graph.nodes.find((node) => getSqlTable(node)?.name === 'lines')!;
  expect(getSqlTable(lines)?.primaryKey).toEqual(['order_id', 'line_no']);
  expect(getSqlTable(orders)?.columns.find((column) => column.name === 'amount')?.dataType).toMatch(
    /DECIMAL\(12,\s*2\)/i,
  );
  expect(JSON.stringify(graph)).not.toContain('EXCLUDED-');
  const relation = graph.edges.find((edge) => edge.sourceNodeId === orders.id)!;
  expect(relation.targetNodeId).toBe(customers.id);
  expect(getSqlRelationship(relation)).toMatchObject({
    columns: ['customer_id'],
    referencedColumns: ['id'],
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  const selfReference = graph.edges.find((edge) => edge.sourceNodeId === edge.targetNodeId)!;
  const loopPath = page.locator(
    `.react-flow__edge[data-id="${selfReference.id}"] .react-flow__edge-path`,
  );
  await expect
    .poll(async () => {
      const loop = (await loopPath.boundingBox())!;
      const node = (await card(page, customers.id).boundingBox())!;
      return Math.max(
        node.x - loop.x,
        node.y - loop.y,
        loop.x + loop.width - node.x - node.width,
        loop.y + loop.height - node.y - node.height,
      );
    })
    .toBeGreaterThan(8);
  await card(page, orders.id).locator('.node-title').click();
  await expect(
    card(page, orders.id)
      .getByRole('table', { name: 'SQL table columns', exact: true })
      .getByRole('rowheader', { name: 'customer_id', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'SQL table schema' })
      .getByRole('rowheader', { name: 'private_note', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark selected objects done', exact: true }).click();
  await saved(page);
  await expect(card(page, orders.id)).toHaveAttribute('data-node-status', 'done');
  await page.locator(`.react-flow__edge[data-id="${relation.id}"]`).click();
  await expect(page.getByRole('region', { name: 'SQL foreign key' })).toContainText('RESTRICT');
  await page.getByLabel('Connection label', { exact: true }).fill('Customer places order');
  await page.getByLabel('Connection style', { exact: true }).selectOption('dashed');
  await saved(page);
  await page.screenshot({ path: '../docs/acceptance/sql-schema.png' });
  await page.reload();
  await saved(page);
  graph = await stored(page, 'Sales');
  expect(graph.nodes.find((node) => node.id === orders.id)?.status).toBe('done');
  expect(graph.edges.find((edge) => edge.id === relation.id)).toMatchObject({
    label: 'Customer places order',
    style: 'dashed',
    metadata: relation.metadata,
  });
  await page.locator(`.react-flow__edge[data-id="${relation.id}"]`).click();
  await page.getByLabel('Connection target', { exact: true }).selectOption(lines.id);
  await saved(page);
  await expect(page.getByRole('region', { name: 'SQL foreign key' })).toBeHidden();
  expect(
    getSqlRelationship(
      (await stored(page, 'Sales')).edges.find((edge) => edge.id === relation.id)!,
    ),
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await stored(page, 'Sales')).edges.find((edge) => edge.id === relation.id)).toMatchObject(
    {
      targetNodeId: customers.id,
      metadata: relation.metadata,
    },
  );
  await page.locator(`.react-flow__edge[data-id="${relation.id}"]`).click();
  await expect(page.getByRole('region', { name: 'SQL foreign key' })).toContainText('RESTRICT');
  await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
  const brief = page.getByRole('dialog', { name: 'Build with Lovable', exact: true });
  const prompt = await brief.getByLabel('Lovable build prompt', { exact: true }).inputValue();
  expect(prompt).toContain('"sqlTable"');
  expect(prompt).toContain('"sqlForeignKey"');
  expect(prompt).toContain('Customer places order');
  expect(prompt).not.toContain('EXCLUDED-');
  await brief.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export diagram', exact: true });
  await exportDialog.getByLabel('Export format').selectOption('png');
  await exportDialog.getByLabel('Export resolution').selectOption('1');
  const downloadingImage = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
  const png = await readFile((await (await downloadingImage).path())!);
  const loopPixels = await page.evaluate(
    async ({ imageData, node, left, top }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${imageData}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const x = Math.round(40 + node.x - left + node.width / 2 - 60);
      const bands = [40 + node.y - top - 36, 40 + node.y - top + node.height + 24];
      let dark = 0;
      for (const y of bands) {
        const pixels = context.getImageData(x, Math.round(y), 120, 16).data;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200 && pixels[i + 3] > 0)
            dark++;
      }
      return dark;
    },
    {
      imageData: png.toString('base64'),
      node: customers,
      left: Math.min(...graph.nodes.map((node) => node.x)),
      top: Math.min(...graph.nodes.map((node) => node.y)),
    },
  );
  expect(loopPixels).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await exportDialog.getByLabel('Export format').selectOption('json');
  const downloading = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as Graph;
  const nodes = (graph: Graph) =>
    [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(getSqlTable);
  const edges = (graph: Graph) =>
    [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)).map(getSqlRelationship);
  expect(nodes(exported)).toEqual(nodes(graph));
  expect(edges(exported)).toEqual(edges(graph));
  expect(JSON.stringify(exported)).not.toContain('EXCLUDED-');
  expect(errors).toEqual([]);
});

test('pastes SQL on a 320 px phone, shows missing-definition warnings and rejects unsupported or malformed scripts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/app/');
  await acknowledge(page);
  await page.getByRole('button', { name: 'Import SQL script', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await dialog.getByLabel('SQL diagram name').fill('Phone schema');
  await dialog.getByLabel('SQL script', { exact: true }).fill('UPDATE customers SET active = 1;');
  await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('CREATE TABLE');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  await dialog
    .getByLabel('SQL script', { exact: true })
    .fill('CREATE TABLE unfinished (id INTEGER');
  await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const columns = Array.from({ length: 18 }, (_, i) => `field_${i} VARCHAR(100)`).join(', ');
  await dialog
    .getByLabel('SQL script', { exact: true })
    .fill(
      `CREATE TABLE entries (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES outside_accounts, ${columns}); DROP TABLE entries;`,
    );
  await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'SQL schema preview' })).toContainText(
    'Referenced table not defined',
  );
  await expect(dialog.getByRole('region', { name: 'SQL schema preview' })).toContainText('DROP');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const graph = await stored(page, 'Phone schema');
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(1);
  const entries = graph.nodes.find((node) => getSqlTable(node)?.name === 'entries')!;
  expect(getSqlRelationship(graph.edges[0])?.unresolved).toBe(true);
  await card(page, entries.id).locator('.node-title').click();
  await page.getByRole('button', { name: 'Open properties', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'SQL table schema' })
      .getByRole('rowheader', { name: 'field_17', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('reads a 100,000-row SQL dump offline in a worker and saves its schema without row data', async ({
  page,
  context,
}) => {
  await page.goto('/app/');
  await acknowledge(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  const file = join(tmpdir(), `visualnerve-sql-${crypto.randomUUID()}.sql`);
  const dump = `CREATE TABLE imported_records (id BIGINT PRIMARY KEY, value TEXT);\nINSERT INTO imported_records VALUES\n${Array.from({ length: 100_000 }, (_, i) => `(${i}, 'EXCLUDED-DUMP-ROW-${i}')`).join(',\n')};`;
  await writeFile(file, dump);
  try {
    await page.getByLabel('Import file', { exact: true }).setInputFiles(file);
    const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
    await dialog.getByLabel('SQL diagram name').fill('Large SQL dump');
    await page.evaluate(() => {
      (window as any).sqlFrames = 0;
      (window as any).sqlMeasuring = true;
      const frame = () => {
        if (!(window as any).sqlMeasuring) return;
        (window as any).sqlFrames++;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await dialog.getByRole('button', { name: 'Preview schema', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeEnabled();
    const frames = await page.evaluate(() => {
      (window as any).sqlMeasuring = false;
      return (window as any).sqlFrames as number;
    });
    expect(frames).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await saved(page);
    const graph = await stored(page, 'Large SQL dump');
    expect(graph.nodes).toHaveLength(1);
    expect(getSqlTable(graph.nodes[0])?.columns).toHaveLength(2);
    expect(JSON.stringify(graph)).not.toContain('EXCLUDED-');
    expect(JSON.stringify(graph).length).toBeLessThan(10_000);
  } finally {
    await unlink(file);
  }
});
