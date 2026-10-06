import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../../src/data/csv';
import { newEdge, type Graph } from '../../src/model/types';
import { parseSql } from '../../src/sql/parser';
import { getSqlRelationship, getSqlTable } from '../../src/sql/schema';

async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function importGraph(page: Page, graph: Graph) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'analysis-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await expect(page.locator('.project-title-button')).toHaveText(graph.diagram.name);
  await saved(page);
}
async function stored(
  page: Page,
  id: string,
): Promise<Graph & { sourceCounts: Record<string, number> }> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visual-nerve-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['diagrams', 'nodes', 'edges', 'datasets'], 'readonly');
    const result = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    try {
      const [diagram, nodes, edges, sources] = await Promise.all([
        result(tx.objectStore('diagrams').get(id)),
        result(tx.objectStore('nodes').index('diagramId').getAll(id)),
        result(tx.objectStore('edges').index('diagramId').getAll(id)),
        result(tx.objectStore('datasets').index('diagramId').getAll(id)),
      ]);
      const order = diagram.settings.csvDatasetOrder ?? sources.map((source) => source.id);
      const ordered = order
        .map((sourceId: string) => sources.find((source) => source.id === sourceId))
        .filter(Boolean);
      return {
        format: 'visual-nerve' as const,
        formatVersion: 1 as const,
        diagram,
        nodes,
        edges,
        owners: [],
        dataset: ordered[0] && { ...ordered[0], rows: ordered[0].rows.slice(0, 2) },
        datasets: ordered
          .slice(1)
          .map((source: Graph['dataset']) => ({ ...source, rows: source!.rows.slice(0, 2) })),
        sourceCounts: Object.fromEntries(sources.map((source) => [source.id, source.rows.length])),
      };
    } finally {
      db.close();
    }
  }, id);
}
async function dataTool(page: Page, name: string, mobile = false) {
  await page.getByLabel(mobile ? 'More tools' : 'Explore data', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog', { name, exact: true });
}
async function views(page: Page) {
  await page.getByRole('button', { name: 'Explore relationships and views', exact: true }).click();
  return page.getByRole('dialog', { name: 'Relationships and analysis views' });
}
const card = (page: Page, id: string) =>
  page.locator(`.canvas-shell [data-testid="graph-node"][data-node-id="${id}"]`);
const previewCount = (dialog: ReturnType<Page['getByRole']>, label: string) =>
  dialog.getByText(label, { exact: true }).locator('..').locator('dd');

test('reviews a responsive 100,000-row keyed refresh and preserves annotations, connections and saved views across undo/reload', async ({
  page,
  request,
}, testInfo) => {
  void request;
  const rows = Array.from({ length: 100000 }, (_, index) => [
    String(index),
    `Customer ${String(index % 2000).padStart(4, '0')}`,
    String(index % 20),
  ]);
  const dataset = parseCsv(
    `ID,Customer,Amount\n${rows.map((row) => row.join(',')).join('\n')}`,
    'customers.csv',
  );
  const analysis = defaultAnalysis(dataset);
  analysis.levels = ['c1'];
  analysis.limit = 10;
  analysis.sortBy = 'label';
  analysis.sortDirection = 'asc';
  analysis.metrics = [
    { id: 'count', operation: 'count' },
    { id: 'sum', operation: 'sum', columnId: 'c2' },
  ];
  const graph = csvGraph(dataset, analysis);
  graph.diagram.name = 'Customer source review';
  const customer = (name: string) =>
    graph.nodes.find((node) => getCsvNode(node)?.path.at(-1)?.value === name)!;
  const ada = customer('Customer 0000'),
    ben = customer('Customer 0001'),
    removed = customer('Customer 0003');
  Object.assign(ada, { status: 'done', description: 'Keep the renewal note.', x: 200, y: 180 });
  const manual = newEdge(graph.diagram.id, ada.id, ben.id, {
    label: 'Collaborates',
    direction: 'both',
  });
  const affected = newEdge(graph.diagram.id, removed.id, ben.id, {
    label: 'Historical collaboration',
  });
  graph.edges.push(manual, affected);
  graph.diagram.settings.drawing = {
    version: 1,
    visible: true,
    strokes: [
      {
        id: crypto.randomUUID(),
        color: '#e85d3f',
        width: 3,
        points: [
          [50, 20],
          [300, 20],
        ],
      },
    ],
  };
  await importGraph(page, graph);
  const viewDialog = await views(page);
  await viewDialog.getByLabel('Analysis view name').fill('Customer overview');
  await viewDialog.getByRole('button', { name: 'Save current view' }).click();
  await viewDialog.getByLabel('Close dialog').click();
  await saved(page);
  const replacement = rows
    .filter((row) => row[1] !== 'Customer 0003')
    .map((row) => (row[1] === 'Customer 0000' ? [row[0], 'Renewed customer', '99'] : row));
  replacement.push(['100000', 'New customer', '40']);
  const replacementPath = testInfo.outputPath('customers-refresh.csv');
  await writeFile(
    replacementPath,
    `Key,Name,Revenue\n${replacement.map((row) => row.join(',')).join('\n')}`,
  );
  const dialog = await dataTool(page, 'Refresh source');
  await dialog.getByLabel('Replacement source file').setInputFiles(replacementPath);
  await expect(dialog.getByLabel('Replacement column for ID', { exact: true })).toBeVisible();
  await dialog.getByLabel('Identity key ID').check();
  for (const [old, value] of [
    ['ID', 'c0'],
    ['Customer', 'c1'],
    ['Amount', 'c2'],
  ])
    await dialog.getByLabel(`Replacement column for ${old}`).selectOption(value);
  await page.evaluate(() => {
    const state = { running: true, frames: 0, maxGap: 0, last: performance.now() };
    (window as unknown as { refreshFrames: typeof state }).refreshFrames = state;
    const tick = (now: number) => {
      state.maxGap = Math.max(state.maxGap, now - state.last);
      state.last = now;
      state.frames++;
      if (state.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const began = Date.now();
  await dialog.getByRole('button', { name: 'Preview changes' }).click();
  await expect(dialog.getByLabel('Source changes preview')).toBeVisible();
  const reviewMs = Date.now() - began;
  const timing = await page.evaluate(() => {
    const value = (
      window as unknown as { refreshFrames: { running: boolean; frames: number; maxGap: number } }
    ).refreshFrames;
    value.running = false;
    return { frames: value.frames, maxGap: value.maxGap };
  });
  expect(timing.frames).toBeGreaterThan(5);
  expect(timing.maxGap).toBeLessThan(1000);
  for (const [label, count] of [
    ['Rows added', '1'],
    ['Rows changed', '50'],
    ['Rows removed', '50'],
    ['Unchanged', '99,900'],
    ['Annotations retained', '1'],
    ['Manual connections affected', '1'],
  ])
    await expect(previewCount(dialog, label)).toHaveText(count);
  await dialog.screenshot({ path: '/tmp/visualnerve-source-refresh.png' });
  expect((await stored(page, graph.diagram.id)).sourceCounts[dataset.id]).toBe(100000);
  await dialog.getByRole('button', { name: 'Apply source refresh' }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  const current = await stored(page, graph.diagram.id);
  const refreshed = current.nodes.find((node) => node.id === ada.id)!;
  expect(refreshed).toMatchObject({
    title: 'Renewed customer',
    status: 'done',
    description: ada.description,
    x: 200,
    y: 180,
  });
  expect(getCsvNode(refreshed)?.measures.find((value) => value.id === 'sum')?.value).toBe(4950);
  expect(current.sourceCounts[dataset.id]).toBe(99951);
  expect(current.nodes.find((node) => node.id === removed.id)?.metadata.csv).toBeUndefined();
  for (const edge of [manual, affected])
    expect(current.edges.find((item) => item.id === edge.id)).toMatchObject({ ...edge });
  expect(current.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await stored(page, graph.diagram.id)).sourceCounts[dataset.id]).toBe(100000);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  await page.reload();
  await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).click();
  await saved(page);
  const reopened = await views(page);
  await reopened
    .getByLabel('Saved analysis view', { exact: true })
    .selectOption({ label: 'Customer overview' });
  await reopened.getByRole('button', { name: 'Load view', exact: true }).click();
  await expect(
    reopened.getByText(
      'View loaded. Notes, statuses, drawing marks and manual connections were preserved.',
      { exact: true },
    ),
  ).toBeVisible();
  await reopened.getByLabel('Close dialog').click();
  await saved(page);
  const durable = await stored(page, graph.diagram.id);
  expect(durable.sourceCounts[dataset.id]).toBe(99951);
  expect(durable.nodes.find((node) => node.id === ada.id)?.status).toBe('done');
  expect(durable.edges.find((edge) => edge.id === manual.id)?.direction).toBe('both');
  await writeFile(
    '/tmp/visualnerve-source-refresh-timings.json',
    JSON.stringify({ ...timing, reviewMs, rowCount: 100000 }, null, 2),
  );
});

test('refreshes SQL definitions after review without losing schema notes, relationship identity or local undo', async ({
  page,
  request,
}) => {
  void request;
  const graph = parseSql(
    'CREATE TABLE customers(id INT PRIMARY KEY, name TEXT); CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT customer_fk FOREIGN KEY(customer_id) REFERENCES customers(id)); CREATE TABLE obsolete(id INT);',
    'Order schema',
  ).graph;
  const customers = graph.nodes.find((node) => getSqlTable(node)?.name === 'customers')!;
  Object.assign(customers, {
    status: 'done',
    description: 'Keep the architecture note.',
    x: 160,
    y: 180,
  });
  const fk = graph.edges[0];
  fk.label = 'Customers place orders';
  await importGraph(page, graph);
  const dialog = await dataTool(page, 'Refresh source');
  await dialog
    .getByLabel('Replacement SQL script')
    .fill(
      "CREATE TABLE customers(id INT PRIMARY KEY, email TEXT DEFAULT 'PRIVATE_DEFAULT'); CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT customer_fk FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE); INSERT INTO customers VALUES(1,'PRIVATE_ROW');",
    );
  await expect(dialog.getByRole('button', { name: 'Apply source refresh' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview changes' }).click();
  await expect(previewCount(dialog, 'Tables removed')).toHaveText('1');
  await expect(previewCount(dialog, 'Relationships changed')).toHaveText('1');
  await expect(previewCount(dialog, 'Annotations retained')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Apply source refresh' }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  const refreshed = await stored(page, graph.diagram.id);
  expect(refreshed.nodes.find((node) => node.id === customers.id)).toMatchObject({
    status: 'done',
    description: customers.description,
    x: 160,
    y: 180,
  });
  expect(getSqlRelationship(refreshed.edges.find((edge) => edge.id === fk.id)!)?.onDelete).toBe(
    'CASCADE',
  );
  expect(refreshed.edges.find((edge) => edge.id === fk.id)?.label).toBe(fk.label);
  expect(JSON.stringify(refreshed)).not.toContain('PRIVATE_');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect(
    getSqlTable(
      (await stored(page, graph.diagram.id)).nodes.find((node) => node.id === customers.id)!,
    )?.columns.map((column) => column.name),
  ).toEqual(['id', 'name']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  await page.reload();
  await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).click();
  await saved(page);
  expect(
    getSqlRelationship(
      (await stored(page, graph.diagram.id)).edges.find((edge) => edge.id === fk.id)!,
    )?.onDelete,
  ).toBe('CASCADE');
});

test('links separate CSV sources explicitly and restores a named view while current annotations remain intact', async ({
  page,
  request,
}, testInfo) => {
  void request;
  const dataset = parseCsv('Customer,Name,Revenue\n1,Ada,10\n2,Ben,20', 'customers.csv');
  const analysis = defaultAnalysis(dataset);
  analysis.levels = ['c0'];
  analysis.metrics.push({ id: 'sum', operation: 'sum', columnId: 'c2' });
  const graph = csvGraph(dataset, analysis);
  graph.diagram.name = 'Customer and order model';
  await importGraph(page, graph);
  const sources = await dataTool(page, 'Data sources');
  const orderPath = testInfo.outputPath('orders.csv');
  await writeFile(orderPath, 'Customer,Order,Amount\n1,A,5\n1,B,15\n2,C,20');
  await sources.getByLabel('Add CSV sources').setInputFiles(orderPath);
  await expect(sources.getByText('orders', { exact: true })).toBeVisible();
  await sources.getByRole('button', { name: 'Match columns' }).click();
  await sources.getByRole('button', { name: 'Preview match' }).click();
  await expect(sources.getByText('one-to-many', { exact: true })).toBeVisible();
  await sources.getByRole('button', { name: 'Add this relationship' }).click();
  await sources.getByRole('button', { name: 'Apply data model' }).click();
  await expect(sources).toBeHidden();
  await saved(page);
  const linked = await stored(page, graph.diagram.id);
  expect(Object.values(linked.sourceCounts).sort()).toEqual([2, 3]);
  expect(linked.diagram.settings.csvRelationships).toHaveLength(1);
  expect(
    linked.edges.filter(
      (edge) => edge.metadata.csvModelGenerated === true && edge.metadata.csvModelVisible !== false,
    ),
  ).toHaveLength(2);
  const root = linked.nodes.find(
    (node) => getCsvNode(node)?.datasetId === dataset.id && getCsvNode(node)?.path.length === 0,
  )!;
  expect(getCsvNode(root)?.measures.find((value) => value.id === 'sum')?.value).toBe(30);
  const dialog = await views(page);
  await dialog.getByLabel('Analysis view name').fill('Linked customer review');
  await dialog.getByRole('button', { name: 'Save current view' }).click();
  await dialog.getByLabel('Close dialog').click();
  await saved(page);
  const ada = linked.nodes.find(
    (node) =>
      getCsvNode(node)?.datasetId === dataset.id && getCsvNode(node)?.path.at(-1)?.value === '1',
  )!;
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await card(page, ada.id).click();
  await page.getByRole('button', { name: 'Mark selected objects done', exact: true }).click();
  await page.getByLabel('Node description', { exact: true }).fill('Keep this current annotation.');
  await saved(page);
  const reopen = await views(page);
  await reopen
    .getByLabel('Saved analysis view', { exact: true })
    .selectOption({ label: 'Linked customer review' });
  await reopen.getByRole('button', { name: 'Load view', exact: true }).click();
  await expect(
    reopen.getByText(
      'View loaded. Notes, statuses, drawing marks and manual connections were preserved.',
      { exact: true },
    ),
  ).toBeVisible();
  await reopen.getByLabel('Close dialog').click();
  await saved(page);
  const current = await stored(page, graph.diagram.id);
  expect(current.nodes.find((node) => node.id === ada.id)).toMatchObject({
    status: 'done',
    description: 'Keep this current annotation.',
  });
  expect(current.diagram.settings.csvRelationships).toHaveLength(1);
  expect(Object.values(current.sourceCounts).sort()).toEqual([2, 3]);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export diagram' });
  await exporting.getByLabel('Export format').selectOption('json');
  await exporting.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = JSON.parse(
    (await readFile((await (await downloading).path())!)).toString(),
  ) as Graph;
  expect(downloaded.datasets?.[0].rows).toHaveLength(3);
  expect(downloaded.diagram.settings.csvRelationships).toHaveLength(1);
});
