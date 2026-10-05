import { expect, test, type Page } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import type { CsvAnalysis, CsvNodeData, MetricOperation } from '../../src/data/types';
import type { Graph, GraphEdge, GraphNode } from '../../src/model/types';

type StoredView = {
  diagram: Graph['diagram'];
  nodes: GraphNode[];
  edges: GraphEdge[];
  source?: { rowCount: number; firstRow: string[]; lastRow: string[] };
};
const csvData = (node: GraphNode) => node.metadata.csv as CsvNodeData | undefined;
const activeRoot = (view: StoredView) =>
  view.nodes.find((node) => csvData(node)?.visible !== false && !node.parentId)!;
const analysis = (view: StoredView) => view.diagram.settings.csvAnalysis as CsvAnalysis;
const measure = (node: GraphNode, operation: MetricOperation) =>
  csvData(node)!.measures.find((entry) => entry.operation === operation)!.value;

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

// Read committed records directly: the large source stays in the browser and the
// assertions verify durable IndexedDB data independently of the rendered canvas.
async function storedView(page: Page, id: string, includeSource = false): Promise<StoredView> {
  return page.evaluate(
    async ({ id, includeSource }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open('visual-nerve-cache');
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      const tx = db.transaction(['diagrams', 'nodes', 'edges', 'datasets'], 'readonly');
      const result = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      try {
        const [diagram, nodes, edges, dataset] = await Promise.all([
          result(tx.objectStore('diagrams').get(id)),
          result(tx.objectStore('nodes').index('diagramId').getAll(id)),
          result(tx.objectStore('edges').index('diagramId').getAll(id)),
          includeSource
            ? result(tx.objectStore('datasets').index('diagramId').get(id))
            : Promise.resolve(undefined),
        ]);
        return {
          diagram,
          nodes,
          edges,
          ...(dataset
            ? {
                source: {
                  rowCount: dataset.rows.length,
                  firstRow: dataset.rows[0],
                  lastRow: dataset.rows.at(-1),
                },
              }
            : {}),
        };
      } finally {
        db.close();
      }
    },
    { id, includeSource },
  );
}

async function selectNode(page: Page, title: string) {
  await page.keyboard.press('Control+f');
  await page.getByLabel('Global search').fill(title);
  await page
    .locator('.search-results button')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  await expect(page.getByLabel('Node title')).toHaveValue(title);
}

async function editView(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 18, y: 40 } });
  await page.getByRole('button', { name: 'Change grouping and measures' }).click();
  return page.getByRole('dialog', { name: 'Explore CSV data' });
}

async function viewSettled(page: Page) {
  let previousTransform = '';
  await expect
    .poll(
      async () => {
        const transform = await page
          .locator('.canvas-shell .react-flow__viewport')
          .getAttribute('style');
        const stable = transform === previousTransform;
        previousTransform = transform ?? '';
        return stable;
      },
      { intervals: [100] },
    )
    .toBeTruthy();
}

async function connect(
  page: Page,
  diagramId: string,
  source: string,
  target: string,
  label: string,
) {
  await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect nodes' });
  await dialog.getByLabel('Connection from').selectOption(source);
  await dialog.getByLabel('Connection to').selectOption(target);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await saved(page);
  const stored = await storedView(page, diagramId);
  const relation = stored.edges.find(
    (edge) =>
      edge.sourceNodeId === source &&
      edge.targetNodeId === target &&
      edge.metadata.csvGenerated !== true,
  )!;
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  // Sample the real curved stroke and avoid parts covered by node cards or controls.
  const path = page.locator(
    `.react-flow__edge[data-id="${relation.id}"] .react-flow__edge-interaction`,
  );
  await expect(path).toBeAttached();
  let previousTransform = '';
  await expect
    .poll(
      async () => {
        const box = await path.boundingBox();
        const transform = await page
          .locator('.canvas-shell .react-flow__viewport')
          .getAttribute('style');
        const settled = transform === previousTransform;
        previousTransform = transform ?? '';
        return settled && box && box.x >= 0 && box.y >= 0;
      },
      { intervals: [100] },
    )
    .toBeTruthy();
  const point = await path.evaluate((element, edgeId) => {
    const curve = element as SVGPathElement;
    for (const fraction of [0.5, 0.25, 0.75, 0.12, 0.88, 0.08, 0.92]) {
      const p = curve.getPointAtLength(curve.getTotalLength() * fraction);
      const point = new DOMPoint(p.x, p.y).matrixTransform(curve.getScreenCTM()!);
      const hit = document.elementFromPoint(point.x, point.y)?.closest('.react-flow__edge');
      if (hit?.getAttribute('data-id') === edgeId) return { x: point.x, y: point.y };
    }
    return null;
  }, relation.id);
  expect(
    point,
    'The relation has a visible, clickable stroke outside the node cards',
  ).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await expect(page.getByLabel('Connection direction')).toBeVisible();
  await page.getByLabel('Connection label').fill(label);
  await page.getByLabel('Connection direction').selectOption('both');
  await page.getByLabel('Connection style').selectOption('dashed');
  await saved(page);
}

test('large CSV data remains explorable, durable and connected through filters and regrouping', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const lines = ['Company,Customer,Amount,Country'];
  for (let customer = 0; customer < 2000; customer++) {
    const name = `Customer ${String(customer).padStart(4, '0')}`;
    const original = `${String(customer + 1).padStart(4, '0')} - ${name}`;
    for (let row = 0; row < 50; row++)
      lines.push(
        `${customer % 2 ? 'BBB Company' : 'AAA Company'},${original},${row % 2 ? '"2,50"' : '1.5'},${row % 2 ? 'Norway' : 'Sweden'}`,
      );
  }
  const csvPath = testInfo.outputPath('customers.csv');
  await writeFile(csvPath, lines.join('\n'));
  const started = Date.now();
  const heartbeat = await page.evaluateHandle(() => {
    const state = {
      frames: 0,
      frame: 0,
      started: performance.now(),
      last: performance.now(),
      maxGap: 0,
    };
    const tick = (time: number) => {
      state.frames++;
      state.maxGap = Math.max(state.maxGap, time - state.last);
      state.last = time;
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
    return state;
  });
  await page.getByLabel('Import file').setInputFiles(csvPath);
  const importing = page.getByRole('dialog', { name: 'Import CSV data' });
  await expect(importing).toBeVisible();
  const importMs = Date.now() - started;
  const pulse = await heartbeat.evaluate((state) => {
    cancelAnimationFrame(state.frame);
    return {
      frames: state.frames,
      elapsedMs: performance.now() - state.started,
      maxGapMs: state.maxGap,
    };
  });
  await heartbeat.dispose();
  expect(pulse.frames).toBeGreaterThan(1);
  const configuring = Date.now();
  await expect(importing).toContainText('100,000 rows');
  await importing.getByLabel('CSV diagram name').fill('CSV customer ledger');
  await importing.getByRole('button', { name: 'Add column cleanup' }).click();
  await importing.getByLabel('Cleanup column 1').selectOption({ label: 'Customer' });
  await importing.getByLabel('Cleanup regex 1').fill('^\\d+\\s*-\\s*');
  await importing
    .getByLabel('Grouping level 1', { exact: true })
    .selectOption({ label: 'Customer' });
  await importing.getByLabel('Groups per level').selectOption('20');
  await importing.getByLabel('Sort groups by').selectOption('label');
  await importing.getByLabel('Group sort order').selectOption('asc');
  for (const [index, operation] of (
    ['sum', 'avg', 'median', 'min', 'max', 'distinct'] as const
  ).entries()) {
    await importing.getByRole('button', { name: 'Add measure', exact: true }).click();
    await importing.getByLabel(`Measure ${index + 2}`, { exact: true }).selectOption(operation);
    await importing.getByLabel(`Measure column ${index + 2}`, { exact: true }).selectOption({
      label: operation === 'distinct' ? 'Customer' : 'Amount',
    });
  }
  const preview = importing.getByLabel('CSV analysis preview');
  await expect(importing.getByRole('button', { name: 'Create data diagram' })).toBeEnabled();
  await expect(preview).toContainText('20 of 2,000 top-level groups shown');
  await expect(
    preview
      .locator('dt')
      .filter({ hasText: /^Sum · Amount$/ })
      .locator('..')
      .locator('dd'),
  ).toHaveText('200,000');
  await expect(
    preview
      .locator('dt')
      .filter({ hasText: /^Average · Amount$/ })
      .locator('..')
      .locator('dd'),
  ).toHaveText('2');
  await expect(
    preview
      .locator('dt')
      .filter({ hasText: /^Median · Amount$/ })
      .locator('..')
      .locator('dd'),
  ).toHaveText('2');
  const applying = Date.now();
  await importing.getByRole('button', { name: 'Create data diagram' }).click();
  await expect(importing.locator('form')).toHaveJSProperty('inert', true);
  await expect(importing).toBeHidden();
  await saved(page);
  await writeFile(
    '/tmp/visualnerve-csv-timings.json',
    Buffer.from(
      JSON.stringify(
        { importMs, configureMs: applying - configuring, applyMs: Date.now() - applying, ...pulse },
        null,
        2,
      ),
    ),
  );
  await testInfo.attach('CSV processing timings', {
    path: '/tmp/visualnerve-csv-timings.json',
    contentType: 'application/json',
  });
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find((entry: { name: string }) => entry.name === 'CSV customer ledger').id;
  let view = await storedView(page, id, true);
  const root = activeRoot(view);
  expect(csvData(root)!.rowCount).toBe(100000);
  expect(csvData(root)!.totalChildren).toBe(2000);
  expect(csvData(root)!.hiddenChildren).toBe(1980);
  expect(measure(root, 'count')).toBe(100000);
  expect(measure(root, 'sum')).toBe(200000);
  expect(measure(root, 'avg')).toBe(2);
  expect(measure(root, 'median')).toBe(2);
  expect(measure(root, 'min')).toBe(1.5);
  expect(measure(root, 'max')).toBe(2.5);
  expect(measure(root, 'distinct')).toBe(2000);
  expect(view.source!.rowCount).toBe(100000);
  expect(view.source!.firstRow[1]).toBe('0001 - Customer 0000');

  await selectNode(page, root.title);
  await page.getByText('Source rows (100,000)', { exact: true }).click();
  const sourceRows = page.getByRole('table', { name: 'Source rows' });
  await expect(sourceRows.locator('tbody tr')).toHaveCount(100);
  await expect(page.getByText(/Showing 100 of 100,000 rows/)).toBeVisible();
  await expect(sourceRows.getByText('Customer 0000', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Original values', { exact: true }).check();
  await expect(sourceRows.getByText('0001 - Customer 0000', { exact: true }).first()).toBeVisible();

  const first = view.nodes.find((node) => node.title === 'Customer 0000')!;
  const second = view.nodes.find((node) => node.title === 'Customer 0001')!;
  await connect(page, id, first.id, second.id, 'Customer partnership');
  view = await storedView(page, id);
  const relation = view.edges.find((edge) => edge.label === 'Customer partnership')!;
  expect(relation).toMatchObject({
    sourceNodeId: first.id,
    targetNodeId: second.id,
    direction: 'both',
    style: 'dashed',
  });
  expect(relation.metadata.csvGenerated).toBeUndefined();
  const retainedRelation = {
    id: relation.id,
    sourceNodeId: relation.sourceNodeId,
    targetNodeId: relation.targetNodeId,
    label: relation.label,
    direction: relation.direction,
    style: relation.style,
    metadata: relation.metadata,
  };
  const visibleRelation = page.locator(`.react-flow__edge[data-id="${relation.id}"]`);
  await expect(visibleRelation).toHaveClass(/react-flow__edge-default/);
  await expect(visibleRelation.locator('.react-flow__edge-path')).toHaveAttribute(
    'marker-start',
    /url/,
  );
  await expect(visibleRelation.locator('.react-flow__edge-path')).toHaveAttribute(
    'marker-end',
    /url/,
  );

  await selectNode(page, first.title);
  await page.getByLabel('Show Median · Amount').uncheck();
  await page.getByText('Source rows (50)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Source rows' }).locator('tbody tr')).toHaveCount(
    50,
  );
  await page.getByText('Columns shown (4)', { exact: true }).click();
  await page.getByLabel('Show source column Country').uncheck();
  await saved(page);

  const filtering = await editView(page);
  await filtering.getByRole('button', { name: 'Add filter', exact: true }).click();
  await filtering.getByLabel('Filter column 1').selectOption({ label: 'Company' });
  await filtering.getByLabel('Filter operator 1').selectOption('startsWith');
  await filtering.getByLabel('Filter value 1').fill('AAA');
  await expect(filtering.getByRole('button', { name: 'Apply data view' })).toBeEnabled();
  await expect(filtering.getByLabel('CSV analysis preview')).toContainText('50,000');
  await filtering.getByRole('button', { name: 'Apply data view' }).click();
  await expect(filtering).toBeHidden();
  await saved(page);
  view = await storedView(page, id);
  expect(measure(activeRoot(view), 'sum')).toBe(100000);
  expect(csvData(activeRoot(view))!.rowCount).toBe(50000);
  expect(csvData(view.nodes.find((node) => node.id === second.id)!)!.visible).toBe(false);
  expect(view.edges.find((edge) => edge.id === relation.id)).toMatchObject(retainedRelation);
  await expect(visibleRelation).toHaveCount(0);

  await selectNode(page, first.title);
  await expect(page.getByLabel('Show Median · Amount')).not.toBeChecked();
  await page.getByRole('button', { name: 'Explore this group', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change grouping and measures' })).toBeVisible();
  await saved(page);
  view = await storedView(page, id);
  expect(analysis(view).focusPath).toEqual([{ columnId: 'c1', value: 'Customer 0000' }]);
  expect(activeRoot(view).id).toBe(first.id);
  expect(measure(activeRoot(view), 'count')).toBe(50);
  expect(measure(activeRoot(view), 'sum')).toBe(100);
  expect(view.edges.find((edge) => edge.id === relation.id)).toMatchObject(retainedRelation);
  await page.getByRole('button', { name: 'All data', exact: true }).click();
  await expect(page.locator('.csv-import-progress')).toBeHidden();
  await saved(page);
  const clearing = await editView(page);
  await clearing.getByLabel('Remove filter 1').click();
  await expect(clearing.getByRole('button', { name: 'Apply data view' })).toBeEnabled();
  await clearing.getByRole('button', { name: 'Apply data view' }).click();
  await expect(clearing).toBeHidden();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(visibleRelation).toBeVisible();

  await page.reload();
  await page.locator('.diagram-item').filter({ hasText: 'CSV customer ledger' }).click();
  await saved(page);
  view = await storedView(page, id, true);
  expect(analysis(view).columnRules[0].pattern).toBe('^\\d+\\s*-\\s*');
  expect(view.source!.rowCount).toBe(100000);
  expect(view.source!.firstRow[1]).toBe('0001 - Customer 0000');
  expect(view.edges.find((edge) => edge.id === relation.id)).toMatchObject(retainedRelation);
  await selectNode(page, first.title);
  await expect(page.getByLabel('Show Median · Amount')).not.toBeChecked();
  await page.getByText('Source rows (50)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Source rows' })).toBeVisible();
  await expect(page.getByLabel('Show source column Country')).not.toBeChecked();
  await expect(
    page.getByRole('table', { name: 'Source rows' }).getByRole('columnheader', { name: 'Country' }),
  ).toHaveCount(0);

  const regrouping = await editView(page);
  await regrouping
    .getByLabel('Grouping level 1', { exact: true })
    .selectOption({ label: 'Company' });
  await expect(regrouping.getByRole('button', { name: 'Apply data view' })).toBeEnabled();
  await regrouping.getByRole('button', { name: 'Apply data view' }).click();
  await expect(regrouping).toBeHidden();
  await saved(page);
  view = await storedView(page, id);
  expect(analysis(view).levels).toEqual(['c0']);
  expect(csvData(activeRoot(view))!.rowCount).toBe(100000);
  expect(view.nodes.filter((node) => csvData(node)?.visible !== false)).toHaveLength(3);
  expect(view.edges.find((edge) => edge.id === relation.id)).toMatchObject(retainedRelation);
  const aaa = view.nodes.find((node) => node.title === 'AAA Company')!;
  const bbb = view.nodes.find((node) => node.title === 'BBB Company')!;
  expect(measure(aaa, 'distinct')).toBe(1000);
  await connect(page, id, aaa.id, bbb.id, 'Company collaboration');
  await selectNode(page, bbb.title);
  let previousTransform = '';
  await expect
    .poll(
      async () => {
        const transform = await page
          .locator('.canvas-shell .react-flow__viewport')
          .getAttribute('style');
        const stable = transform === previousTransform;
        previousTransform = transform ?? '';
        return stable;
      },
      { intervals: [100] },
    )
    .toBeTruthy();
  const title = await page.locator(`[data-node-id="${bbb.id}"] .topic-title`).boundingBox();
  expect(title).not.toBeNull();
  await page.mouse.move(title!.x + 25, title!.y + 10);
  await page.mouse.down();
  await page.mouse.move(title!.x + 25, title!.y + 410, { steps: 16 });
  await page.mouse.up();
  await saved(page);
  const moved = await storedView(page, id);
  expect(moved.nodes.find((node) => node.id === bbb.id)!.y - bbb.y).toBeGreaterThan(250);
  expect(measure(moved.nodes.find((node) => node.id === bbb.id)!, 'sum')).toBe(100000);
  await page.reload();
  await page.locator('.diagram-item').filter({ hasText: 'CSV customer ledger' }).click();
  await saved(page);
  const reopened = await storedView(page, id);
  expect(reopened.nodes.find((node) => node.id === bbb.id)!.y).toBe(
    moved.nodes.find((node) => node.id === bbb.id)!.y,
  );
  expect(reopened.edges.find((edge) => edge.label === 'Company collaboration')).toMatchObject({
    direction: 'both',
    style: 'dashed',
  });
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await selectNode(page, aaa.title);
  await page.getByText('Source rows (50,000)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Source rows' }).locator('tbody tr')).toHaveCount(
    100,
  );
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await viewSettled(page);
  await page.screenshot({ path: '/tmp/visualnerve-csv-explorer.png' });
  await testInfo.attach('CSV explorer', {
    path: '/tmp/visualnerve-csv-explorer.png',
    contentType: 'image/png',
  });
  expect(pageErrors).toEqual([]);
});

async function dropCsv(page: Page, name: string, text: string) {
  const transfer = await page.evaluateHandle(
    ({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: 'text/csv' }));
      return data;
    },
    { name, text },
  );
  try {
    await page.locator('.application').dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(page.getByText('Drop a CSV to explore your data', { exact: true })).toBeVisible();
    await page.locator('.application').dispatchEvent('dragover', { dataTransfer: transfer });
    await page.locator('.application').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.getByText('Drop a CSV to explore your data', { exact: true })).toBeHidden();
  } finally {
    await transfer.dispose();
  }
}

test('dropping another CSV replaces the draft and preserves BOM, delimiters, quotes and dates', async ({
  page,
  request,
}) => {
  await dropCsv(
    page,
    'first-draft.csv',
    'Region,Customer,Amount\nWest,Original customer,9\nEast,Another customer,8',
  );
  const importing = page.getByRole('dialog', { name: 'Import CSV data' });
  await expect(importing).toBeVisible();
  await importing.getByLabel('CSV diagram name').fill('Abandoned draft');
  await importing
    .getByLabel('Grouping level 1', { exact: true })
    .selectOption({ label: 'Customer' });

  await dropCsv(
    page,
    'new-data.csv',
    '\uFEFFCompany;Customer;Amount;Date\r\nAAANew;"New; customer";"2,50";2026-10-05\r\nAAASecond;"Quoted ""friend""";1.5;2026-10-06',
  );
  await expect(importing).toContainText('new-data.csv');
  await expect(importing.getByLabel('CSV diagram name')).toHaveValue('new-data');
  await expect(importing.getByLabel('Grouping level 1', { exact: true })).toHaveValue('c0');
  await importing.getByRole('button', { name: 'Add measure', exact: true }).click();
  await importing.getByLabel('Measure 2', { exact: true }).selectOption('sum');
  await importing.getByLabel('Measure column 2').selectOption({ label: 'Amount' });
  await expect(importing.getByRole('button', { name: 'Create data diagram' })).toBeEnabled();
  await expect(importing.getByRole('cell', { name: 'New; customer', exact: true })).toBeVisible();
  await expect(importing.getByRole('cell', { name: 'Quoted "friend"', exact: true })).toBeVisible();
  await expect(importing.getByRole('cell', { name: '2026-10-05', exact: true })).toBeVisible();
  await importing.getByRole('button', { name: 'Create data diagram' }).click();
  await expect(importing).toBeHidden();
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  expect(diagrams.map((entry: { name: string }) => entry.name)).toEqual(['new-data']);
  const view = await storedView(page, diagrams[0].id, true);
  expect(view.source).toEqual({
    rowCount: 2,
    firstRow: ['AAANew', 'New; customer', '2,50', '2026-10-05'],
    lastRow: ['AAASecond', 'Quoted "friend"', '1.5', '2026-10-06'],
  });
  expect(analysis(view).levels).toEqual(['c0']);
  expect(measure(activeRoot(view), 'sum')).toBe(4);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export diagram' });
  await exporting.getByLabel('Export format').selectOption('json');
  const downloading = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = await downloading;
  const buffer = await readFile((await downloaded.path())!);
  const exported = JSON.parse(buffer.toString()) as Graph;
  expect(exported.dataset!.rows).toEqual([view.source!.firstRow, view.source!.lastRow]);
  expect(exported.diagram.settings.csvAnalysis).toMatchObject({ levels: ['c0'] });
  await page
    .getByLabel('Import file')
    .setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer });
  await expect(page.locator('.diagram-item')).toHaveCount(2);
  await saved(page);
  const copies = await (await request.get('/api/v1/diagrams')).json();
  const importedId = copies.find((entry: { id: string }) => entry.id !== diagrams[0].id).id;
  const imported = (await (await request.get(`/api/v1/diagrams/${importedId}`)).json()) as Graph;
  expect(imported.dataset!.id).not.toBe(exported.dataset!.id);
  expect(imported.dataset!.diagramId).toBe(importedId);
  expect(imported.dataset!.rows).toEqual(exported.dataset!.rows);
  expect(imported.diagram.settings.csvAnalysis).toEqual(exported.diagram.settings.csvAnalysis);
  expect(imported.nodes.every((node) => csvData(node)!.datasetId === imported.dataset!.id)).toBe(
    true,
  );
  const nodeIds = new Set(imported.nodes.map((node) => node.id));
  expect(
    imported.nodes.every((node) => !exported.nodes.some((original) => original.id === node.id)),
  ).toBe(true);
  expect(
    imported.edges.every(
      (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    ),
  ).toBe(true);
});
