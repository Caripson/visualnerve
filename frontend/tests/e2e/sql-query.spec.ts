import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { acknowledge, expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import {
  getSqlQueryRelationship,
  getSqlQueryResult,
  getSqlQuerySource,
} from '../../src/sql/query-schema';

const sql = readFileSync(new URL('../fixtures/sql-query.sql', import.meta.url), 'utf8');
const card = (page: Page, id: string) =>
  page.locator(`.canvas-shell [data-testid="graph-node"][data-node-id="${id}"]`);

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
      const diagram = all[0].find((entry) => entry.name === name);
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
async function selectObject(page: Page, title: string) {
  await page.getByRole('button', { name: /^Search/ }).click();
  const search = page.getByRole('dialog', { name: 'Search your workspace' });
  await search.getByLabel('Global search').fill(title);
  await search
    .locator('.search-results button')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()
    .click();
  await expect(search).toBeHidden();
}
async function exportImage(page: Page, format: 'png' | 'pdf') {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export diagram', exact: true });
  await dialog.getByLabel('Export format').selectOption(format);
  await dialog.getByLabel('Export area', { exact: true }).selectOption('selected');
  await dialog.getByLabel('Export resolution').selectOption('1');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  return readFile((await (await downloading).path())!);
}

test('imports boolean SELECT operands and their complete column lineage through preview, rendering and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const expressions = [
    'NOT is_deleted',
    'active AND verified',
    'amount BETWEEN minimum AND maximum',
    'name LIKE pattern',
    'active OR verified valid_flag',
  ];
  await page.goto('/');
  await acknowledge(page);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'Boolean query.sql',
    mimeType: 'application/sql',
    buffer: Buffer.from(`SELECT ${expressions.join(', ')} FROM records`),
  });
  const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await dialog.getByRole('button', { name: 'Preview query', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'SQL query preview' })).toContainText('records');
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  const check = async () => {
    const graph = await stored(page, 'Boolean query');
    const block = graph.nodes.map(getSqlQueryResult).find(Boolean)!;
    expect(block.columns.map((column) => column.expression)).toEqual([
      ...expressions.slice(0, 4),
      'active OR verified',
    ]);
    expect(block.columns.map((column) => column.alias)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'valid_flag',
    ]);
    expect(
      block.columns.map((column) => column.references.map((reference) => reference.column)),
    ).toEqual([
      ['is_deleted'],
      ['active', 'verified'],
      ['amount', 'minimum', 'maximum'],
      ['name', 'pattern'],
      ['active', 'verified'],
    ]);
    expect(
      graph.edges.map(getSqlQueryRelationship).find((edge) => edge?.kind === 'lineage')
        ?.outputOrdinals,
    ).toEqual([1, 2, 3, 4, 5]);
    await selectObject(page, 'SELECT q1');
    const table = page.getByRole('table', { name: 'All SQL query output', exact: true });
    await expect(table).toContainText('NOT is_deleted');
    await expect(table).toContainText('records.maximum');
    await expect(table).toContainText('records.pattern');
  };
  await check();
  await page.reload();
  await saved(page);
  await check();
  expect(errors).toEqual([]);
});

test('previews and saves a complex SELECT with separate aliases, nested results, full clauses and portable query metadata', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const contentRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/api\/v1\/|\/mcp/.test(request.url())) contentRequests.push(request.url());
  });
  await page.goto('/');
  await acknowledge(page);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'Contract query.sql',
    mimeType: 'application/sql',
    buffer: Buffer.from(sql),
  });
  const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await expect(dialog.getByLabel('SQL diagram name')).toHaveValue('Contract query');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview query', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'SQL query preview' });
  const count = (label: string) =>
    preview
      .locator('.sql-preview-counts > div')
      .filter({ hasText: new RegExp(`^${label}[0-9]+$`) })
      .locator('dd');
  await expect(count('Source aliases')).toHaveText('29');
  await expect(count('Query blocks')).toHaveText('3');
  await expect(count('Result columns')).toHaveText('34');
  await expect(count('Nested output columns')).toHaveText('5');
  await expect(preview.getByRole('list', { name: 'Preview query sources' })).toContainText(
    'invoice_org',
  );
  await expect(preview).toContainText('is repeated at positions');
  expect((await stored(page, 'Contract query')).diagram).toBeUndefined();
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  let graph = await stored(page, 'Contract query');
  expect(graph.nodes).toHaveLength(32);
  const main = graph.nodes.find((node) => {
    const result = getSqlQueryResult(node);
    return result && !result.parentScope;
  })!;
  const query = getSqlQueryResult(main)!;
  expect(query).toMatchObject({ distinct: true });
  expect(query.columns).toHaveLength(34);
  expect(query.columns.find((column) => column.name === 'line_mrc')?.expression).toMatch(
    /CASE.*quarter.*\/\s*3/is,
  );
  expect(query.columns.find((column) => column.name === 'prev_invoice_date')?.expression).toMatch(
    /::\s*string\s*::\s*date/i,
  );
  expect(query.clauses.where).toContain('Enterprise');
  expect(query.clauses.where).toContain('STATUS_CANCELLED');
  const companies = graph.nodes.filter(
    (node) => getSqlQuerySource(node)?.qualifiedName.at(-1) === 'COMPANIES',
  );
  expect(companies.map((node) => getSqlQuerySource(node)!.alias).sort()).toEqual([
    'b',
    'invoice_org',
    'invoice_parent',
    'parent_org',
  ]);
  expect(new Set(companies.map((node) => node.id)).size).toBe(4);
  expect(graph.nodes.filter((node) => getSqlQuerySource(node)?.kind === 'derived')).toHaveLength(2);
  expect(graph.nodes.filter((node) => getSqlQueryResult(node)?.parentScope)).toHaveLength(2);
  expect(graph.edges.filter((edge) => getSqlQueryRelationship(edge)?.kind === 'join')).toHaveLength(
    27,
  );
  expect(JSON.stringify(graph)).not.toContain('Comments must not enter diagram metadata');
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(32);
  await selectObject(page, main.title);
  await expect(page.getByLabel('Node title', { exact: true })).toHaveValue(main.title);
  const details = page.getByRole('region', { name: 'SQL query details' });
  await expect(
    details.getByRole('table', { name: 'All SQL query output' }).getByRole('row'),
  ).toHaveCount(35);
  await expect(details).toContainText('Enterprise');
  await expect(details).toContainText('line_mrc');
  await expect(details).toContainText('duplicate name');
  await page.getByLabel('Node status', { exact: true }).selectOption('done');
  await saved(page);
  await expect(card(page, main.id)).toHaveAttribute('data-node-status', 'done');
  await page.screenshot({ path: '../docs/acceptance/sql-query.png' });
  await page.reload();
  await saved(page);
  graph = await stored(page, 'Contract query');
  expect(graph.nodes.find((node) => node.id === main.id)?.status).toBe('done');
  expect(getSqlQueryResult(graph.nodes.find((node) => node.id === main.id)!)).toEqual(query);
  await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
  const brief = page.getByRole('dialog', { name: 'Build with Lovable', exact: true });
  const prompt = await brief.getByLabel('Lovable build prompt', { exact: true }).inputValue();
  expect(prompt).toContain('"sqlQueryResult"');
  expect(prompt).toContain('"sqlQuerySource"');
  expect(prompt).toContain('"sqlQueryRelationship"');
  expect(prompt).toContain('line_mrc');
  expect(prompt).toContain('Enterprise');
  await brief.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await selectObject(page, main.title);
  const image = await exportImage(page, 'png');
  expect(image.readUInt32BE(16)).toBeGreaterThanOrEqual(main.width);
  expect(image.readUInt32BE(20)).toBeGreaterThanOrEqual(main.height);
  const queryInk = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    // Examine the interior output/WHERE text, excluding the outer border and title.
    const pixels = context.getImageData(70, 120, image.width - 140, image.height - 210).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (
        pixels[index] < 180 &&
        pixels[index + 1] < 180 &&
        pixels[index + 2] < 180 &&
        pixels[index + 3] > 0
      )
        dark++;
    return dark;
  }, image.toString('base64'));
  expect(queryInk).toBeGreaterThan(500);
  await testInfo.attach('sql-query-output.png', { body: image, contentType: 'image/png' });
  const pdf = await exportImage(page, 'pdf');
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  await testInfo.attach('sql-query-output.pdf', { body: pdf, contentType: 'application/pdf' });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export diagram', exact: true });
  await exporting.getByLabel('Export format').selectOption('json');
  const downloading = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as Graph;
  const metadata = (graph: Graph) => ({
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => node.metadata),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)).map((edge) => edge.metadata),
  });
  expect(metadata(exported)).toEqual(metadata(graph));
  expect(contentRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('pastes a WITH query on a 320 px phone and inspects CASE, cast and WHERE without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');
  await acknowledge(page);
  await page.getByRole('button', { name: 'Import SQL script', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await dialog.getByLabel('SQL diagram name').fill('Phone query');
  await dialog
    .getByLabel('SQL script', { exact: true })
    .fill(
      'WITH active AS (SELECT b.id, b.amount FROM demo.business b WHERE b.active = 1) SELECT DISTINCT a.id, CASE WHEN a.amount > 0 THEN a.amount::string::decimal ELSE 0 END AS revenue FROM active a WHERE a.amount > 10 ORDER BY a.id;',
    );
  await dialog.getByRole('button', { name: 'Preview query', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'SQL query preview' })).toContainText('CTE');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const graph = await stored(page, 'Phone query');
  const main = graph.nodes.find((node) => {
    const query = getSqlQueryResult(node);
    return query && !query.parentScope;
  })!;
  await card(page, main.id).locator('.node-title').click();
  await page.getByRole('button', { name: 'Open properties', exact: true }).click();
  const details = page.getByRole('region', { name: 'SQL query details' });
  await expect(details).toContainText('SELECT DISTINCT');
  await expect(details).toContainText('CASE');
  await expect(details).toContainText('decimal');
  await expect(details).toContainText('a.amount > 10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: '../docs/acceptance/sql-query-phone.png' });
});

test('REST and MCP preview SQL without writes in read-only mode and create a saved query with explicit write access', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const sql =
    "SELECT DISTINCT b.id, invoice_org.name AS invoice_name, CASE WHEN b.active = 1 THEN b.amount::string::decimal ELSE 0 END AS revenue FROM demo.business b LEFT JOIN demo.business invoice_org ON b.invoice_id = invoice_org.id WHERE b.country = 'NO';";
  const name = 'MCP SQL query';
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const previewResponse = await request.post('/api/v1/sql/preview', { data: { sql, name } });
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview).toMatchObject({
    kind: 'query',
    queryCount: 1,
    sourceCount: 2,
    outputColumnCount: 3,
  });
  expect((await stored(page, name)).diagram).toBeUndefined();
  const previewCall = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/sql/preview', method: 'POST', data: { sql, name } },
      },
    },
  });
  const call = (await previewCall.json()).result;
  expect(call.isError).toBe(false);
  expect(call.structuredContent.body).toMatchObject({ kind: 'query', sourceCount: 2 });
  expect((await stored(page, name)).diagram).toBeUndefined();
  const forbidden = await request.post('/api/v1/sql/diagrams', { data: { sql, name } });
  expect(forbidden.status()).toBe(403);
  expect((await stored(page, name)).diagram).toBeUndefined();
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const created = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/sql/diagrams', method: 'POST', data: { sql, name } },
      },
    },
  });
  const result = (await created.json()).result;
  expect(result.isError).toBe(false);
  const graph = result.structuredContent.body as Graph;
  expect(graph.nodes).toHaveLength(3);
  await expect(page.locator('.project-title-button')).toHaveText(name);
  await saved(page);
  expect((await stored(page, name)).nodes.map((node) => node.metadata)).toEqual(
    expect.arrayContaining(graph.nodes.map((node) => node.metadata)),
  );
  const join = graph.edges.find((edge) => getSqlQueryRelationship(edge)?.kind === 'join')!;
  await page.locator(`.react-flow__edge[data-id="${join.id}"]`).click();
  await expect(page.getByRole('region', { name: 'SQL join' })).toContainText('LEFT JOIN');
  await expect(page.getByRole('region', { name: 'SQL join' })).toContainText(
    'b.invoice_id = invoice_org.id',
  );
  await page.getByLabel('Connection label', { exact: true }).fill('Invoice company');
  await saved(page);
  await page.reload();
  await saved(page);
  expect((await stored(page, name)).edges.find((edge) => edge.id === join.id)).toMatchObject({
    label: 'Invoice company',
    metadata: join.metadata,
  });
});
