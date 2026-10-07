import { readFile } from 'node:fs/promises';
import { acknowledge, expect, test, type Page } from './fixtures';
import { base, blankGraph, newEdge, newNode, type Graph } from '../../src/model/types';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../../src/data/csv';

async function importGraph(page: Page, graph: Graph) {
  await page.goto('/');
  await acknowledge(page);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'lovable-workflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await expect(page.locator('.project-title-button')).toHaveText(graph.diagram.name);
  await saved(page);
}
async function saved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Saved');
}
async function openBrief(page: Page, mobile = false) {
  if (mobile) await page.getByLabel('Diagram actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
  return page.getByRole('dialog', { name: 'Build with Lovable', exact: true });
}
function objectRecords(text: string) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((record) => /^n\d+$/.test(record.ref ?? ''));
}

test('hands off an exact unsent workflow brief and preserves local instructions and selection scope', async ({
  page,
  context,
}) => {
  const externalRequests: string[] = [];
  context.on('request', (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).hostname === 'lovable.dev')
      externalRequests.push(request.url());
  });
  // Fulfill the navigation locally: no fixture text reaches Lovable and no real project is built.
  await context.route('https://lovable.dev/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Mock Lovable</title>' }),
  );
  const graph = blankGraph('Invoice approval app', 'flowchart');
  const reviewer = {
    ...base(),
    name: 'Accounts team',
    kind: 'team' as const,
    role: 'Invoice reviewer',
    email: 'EXCLUDED-EMAIL@example.test',
    color: '#23664d',
    metadata: { token: 'EXCLUDED-OWNER-TOKEN' },
  };
  graph.owners = [reviewer];
  const review = newNode(graph.diagram.id, {
    title: 'Review',
    nodeType: 'decision',
    status: 'done',
    collapsed: true,
    ownerIds: [reviewer.id],
    metadata: { token: 'EXCLUDED-NODE-TOKEN' },
  });
  const approval = newNode(graph.diagram.id, {
    title: 'Review',
    parentId: review.id,
    description: 'Confirm payment without losing the audit trail.',
    x: 260,
  });
  const correction = newNode(graph.diagram.id, { title: 'Request correction', x: 520 });
  graph.nodes = [review, approval, correction];
  graph.edges = [
    newEdge(graph.diagram.id, review.id, approval.id, { label: 'Within budget' }),
    newEdge(graph.diagram.id, review.id, correction.id, {
      direction: 'backward',
      label: 'Missing details return for review',
    }),
    newEdge(graph.diagram.id, correction.id, correction.id, { label: 'Retry' }),
  ];
  await importGraph(page, graph);
  let dialog = await openBrief(page);
  const instructions = 'Build a Swedish invoice app for café staff.\nUse roles & an audit trail.';
  await dialog.getByLabel('App instructions', { exact: true }).fill(instructions);
  await saved(page);
  let prompt = await dialog.getByLabel('Lovable build prompt', { exact: true }).inputValue();
  expect(objectRecords(prompt)).toHaveLength(3);
  expect(objectRecords(prompt).filter((node) => node.title === 'Review')).toHaveLength(2);
  expect(prompt).toContain('Missing details return for review');
  expect(prompt).toContain('"direction":"backward"');
  const objects = objectRecords(prompt);
  const reviewerRef = objects.find((node) => node.status === 'done')!.ref;
  const correctionRef = objects.find((node) => node.title === 'Request correction')!.ref;
  expect(prompt).toContain(`"flow":"${correctionRef} -> ${reviewerRef}"`);
  expect(prompt).toContain('"loop":true');
  expect(prompt).toContain('Done is not permission to omit it');
  expect(prompt).toContain('Invoice reviewer');
  expect(prompt).not.toContain('EXCLUDED-');
  expect(externalRequests).toEqual([]);
  const downloadable = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download build brief', exact: true }).click();
  expect(await readFile((await (await downloadable).path())!, 'utf8')).toBe(prompt);
  await page.screenshot({ path: '../docs/acceptance/lovable-handoff.png' });
  const popupPromise = page.waitForEvent('popup');
  await dialog.getByRole('link', { name: 'Open in Lovable', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`https://lovable.dev/#prompt=${encodeURIComponent(prompt)}`);
  expect(new URL(popup.url()).search).toBe('');
  expect([...new URLSearchParams(new URL(popup.url()).hash.slice(1)).keys()]).toEqual(['prompt']);
  await popup.close();
  expect(externalRequests).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator(`.canvas-shell [data-node-id="${review.id}"]`).click();
  dialog = await openBrief(page);
  await dialog.getByLabel('Lovable scope', { exact: true }).selectOption('selected');
  await saved(page);
  prompt = await dialog.getByLabel('Lovable build prompt', { exact: true }).inputValue();
  expect(objectRecords(prompt)).toHaveLength(1);
  expect(prompt).toContain('Explicit boundary relationships:');
  expect(prompt).toContain('Missing details return for review');
  await page.reload();
  dialog = await openBrief(page);
  await expect(dialog.getByLabel('App instructions', { exact: true })).toHaveValue(instructions);
  // Selection is transient; a persisted selected scope becomes active again after selecting an object.
  await expect(dialog.getByLabel('Lovable scope', { exact: true })).toHaveValue('diagram');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator(`.canvas-shell [data-node-id="${review.id}"]`).click();
  dialog = await openBrief(page);
  await expect(dialog.getByLabel('Lovable scope', { exact: true })).toHaveValue('selected');
  expect(objectRecords(await dialog.getByLabel('Lovable build prompt').inputValue())).toHaveLength(
    1,
  );
});

test('shares CSV schema and group summaries while source rows and custom metadata stay local', async ({
  page,
}) => {
  const dataset = parseCsv(
    'Region,Amount,Personal detail\nNorth,10,RAW-NORTH-PERSON\nSouth,20,RAW-SOUTH-PERSON',
    'Invoices.csv',
  );
  const analysis = defaultAnalysis(dataset);
  const whole = csvGraph(dataset, analysis);
  const north = whole.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
  const graph = csvGraph(
    dataset,
    {
      ...analysis,
      filters: [
        { id: 'region', columnId: dataset.columns[0].id, operation: 'equals', value: 'South' },
      ],
    },
    whole,
  );
  const manual = newNode(graph.diagram.id, {
    title: 'Regional dashboard',
    description: 'Compare regional totals and review exceptions.',
    metadata: { privateValue: 'EXCLUDED-CUSTOM-METADATA' },
    y: 350,
  });
  graph.nodes.push(manual);
  graph.edges.push(newEdge(graph.diagram.id, manual.id, north.id, { label: 'Investigate later' }));
  await importGraph(page, graph);
  const dialog = await openBrief(page);
  await expect(dialog.getByLabel('Lovable scope', { exact: true })).toHaveValue('csv-view');
  const prompt = await dialog.getByLabel('Lovable build prompt').inputValue();
  expect(prompt).toContain('CSV schema:');
  expect(prompt).toContain('"matchingRows":1');
  expect(prompt).toContain('"value":"South"');
  expect(prompt).toContain('Investigate later');
  expect(prompt).toContain('Regional dashboard');
  expect(prompt).not.toContain('RAW-');
  expect(prompt).not.toContain('EXCLUDED-');
  expect(objectRecords(prompt)).toHaveLength(graph.nodes.length - 1);
  await dialog.getByLabel('App instructions').fill('Create a dashboard using aggregated data.');
  await saved(page);
  await dialog.getByLabel('Lovable scope').selectOption('diagram');
  expect(objectRecords(await dialog.getByLabel('Lovable build prompt').inputValue())).toHaveLength(
    graph.nodes.length,
  );
  const rows = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visual-nerve-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string[][]>((resolve, reject) => {
        const request = db.transaction('datasets').objectStore('datasets').get(id);
        request.onsuccess = () => resolve(request.result.rows);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, dataset.id);
  expect(rows).toEqual(dataset.rows);
});

test('supports a 320px phone and preserves oversized instructions for download without opening Lovable', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const external: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).hostname === 'lovable.dev') external.push(request.url());
  });
  await context.route('https://lovable.dev/**', (route) => route.abort());
  const graph = blankGraph('Phone workflow');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Create an app' })];
  await importGraph(page, graph);
  const dialog = await openBrief(page, true);
  const instructions = `${'Keep every requirement and make it accessible.\n'.repeat(1200)}FINAL REQUIREMENT`;
  await dialog.getByLabel('App instructions').fill(instructions);
  await saved(page);
  await expect(dialog.getByLabel('App instructions')).toHaveValue(instructions);
  const prompt = await dialog.getByLabel('Lovable build prompt').inputValue();
  expect(prompt).toContain(instructions);
  expect(prompt.length).toBeGreaterThan(50_000);
  await expect(dialog.getByRole('button', { name: 'Open in Lovable', exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('link', { name: 'Open Lovable and paste the prompt' }),
  ).toHaveAttribute('href', 'https://lovable.dev/');
  const downloading = page.waitForEvent('download');
  const button = dialog.getByRole('button', { name: 'Download build brief', exact: true });
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  expect(await readFile((await (await downloading).path())!, 'utf8')).toBe(prompt);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(external).toEqual([]);
});
