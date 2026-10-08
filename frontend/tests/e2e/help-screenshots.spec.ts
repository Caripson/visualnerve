import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { createKioskModel } from '../../src/simulation/examples';
import { captureAppearancePair } from './capture-appearance';

// Opt in explicitly: normal CI validates the guide without rewriting checked-in images.
test.skip(
  process.env.VN_CAPTURE_HELP !== '1',
  'Set VN_CAPTURE_HELP=1 to refresh real UI screenshots.',
);
test.use({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

const output = resolve('../hugo/static/help/images');
async function screenshot(page: Page, name: string, locator?: ReturnType<Page['locator']>) {
  await captureAppearancePair(locator ?? page, output, name);
}
const saved = (page: Page) =>
  expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
async function open(page: Page, name: string) {
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(name);
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400); // Let the actual fit animation settle before capturing it.
}
async function current(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function workflow(request: APIRequestContext, name = 'Customer onboarding') {
  const response = await request.post('/api/v1/diagrams', { data: { name, type: 'process' } });
  expect(response.ok()).toBeTruthy();
  const diagram = await response.json();
  const nodes = [
    {
      externalId: 'request',
      title: 'Customer request',
      description: 'Capture the request and confirm who owns the next step.',
      nodeType: 'input',
      status: 'done',
      tags: ['Discovery'],
      x: 40,
      y: 80,
      color: '#397356',
    },
    {
      externalId: 'review',
      title: 'Review requirements',
      description: 'Review the requirements with the customer before planning delivery.',
      nodeType: 'decision',
      status: 'in-progress',
      tags: ['Discovery'],
      x: 370,
      y: 80,
      color: '#946426',
    },
    {
      externalId: 'prepare',
      title: 'Prepare delivery',
      description: 'Assign the team, confirm capacity and prepare the delivery checklist.',
      nodeType: 'process',
      status: 'planned',
      tags: ['Delivery'],
      x: 370,
      y: 290,
      color: '#397356',
    },
    {
      externalId: 'deliver',
      title: 'Deliver and verify',
      description: 'Deliver the service, verify the outcome and collect feedback.',
      nodeType: 'output',
      status: 'planned',
      tags: ['Delivery'],
      x: 40,
      y: 290,
      color: '#397356',
    },
  ].map((node) => ({
    ...node,
    width: 240,
    height: 120,
    metadata: { visualNerve: { icon: 'work' } },
  }));
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes,
      edges: [
        { sourceExternalId: 'request', targetExternalId: 'review', label: 'Ready for review' },
        { sourceExternalId: 'review', targetExternalId: 'prepare', label: 'Approved' },
        { sourceExternalId: 'prepare', targetExternalId: 'deliver', label: 'Ready to deliver' },
      ],
    },
  });
  expect(populated.ok()).toBeTruthy();
  return current(request, diagram.id);
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}
async function tool(page: Page, name: string) {
  await page.getByLabel('Explore data', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog', { name, exact: true });
}

test('capture workspace, navigation, spatial view and walkthrough', async ({ page, request }) => {
  test.setTimeout(180000);
  await page.getByRole('button', { name: /^New diagram/ }).click();
  await page.getByLabel('New diagram name').fill('My next workflow');
  await screenshot(page, 'new-diagram', page.getByRole('dialog'));
  await close(page);
  const graph = await workflow(request);
  await open(page, graph.diagram.name);
  await page
    .locator(
      `[data-node-id="${graph.nodes.find((node) => node.externalId === 'review')!.id}"] .node-title`,
    )
    .click();
  await expect(page.getByLabel('Node title')).toHaveValue('Review requirements');
  await screenshot(page, 'editor');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'mobile-editor');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Layout direction').selectOption('DOWN');
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'layouts');
  await page.getByLabel('Layout direction').selectOption('RIGHT');
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-face-source', '2d-node', {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true }).click();
  await screenshot(page, 'spatial');
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  const overview = page.getByTestId('overview-controls');
  await overview.locator('summary').click();
  await overview.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Expand overview group Tags', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(2);
  await screenshot(page, 'overview');
  await overview.getByRole('button', { name: 'Details', exact: true }).click();
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 20 } });
  await overview.locator('summary').click();
  await page.getByRole('button', { name: 'Understand', exact: true }).click();
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = page.getByRole('dialog');
  await history.getByLabel('Snapshot name', { exact: true }).fill('Before customer review');
  await history.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await expect(history.getByRole('status')).toHaveText('Named snapshot saved locally.');
  await screenshot(page, 'history', history);
  await close(page);
  await saved(page);
  const latest = await current(request, graph.diagram.id);
  expect(
    (
      await request.put(`/api/v1/diagrams/${graph.diagram.id}/presentation`, {
        data: {
          baseVersion: latest.diagram.version,
          presentation: {
            version: 1,
            nodeIds: ['request', 'review', 'prepare', 'deliver'].map(
              (id) => latest.nodes.find((node) => node.externalId === id)!.id,
            ),
            secondsPerNode: 30,
            transitionMs: 500,
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/v1/presentation/open', { data: { diagramId: graph.diagram.id } })
    ).ok(),
  ).toBeTruthy();
  const player = page.getByRole('region', { name: 'Diagram player' });
  expect(
    (await request.patch('/api/v1/presentation', { data: { audio: false, subtitles: true } })).ok(),
  ).toBeTruthy();
  await player.getByRole('button', { name: 'Play presentation', exact: true }).click();
  await expect(player.getByLabel('Walkthrough subtitles')).toContainText('Capture the request');
  await player.getByRole('button', { name: 'Pause presentation', exact: true }).click();
  await screenshot(page, 'player');
  await player.getByRole('button', { name: 'Minimize player', exact: true }).click();
  await expect(page.locator('.presentation-subtitles-overlay')).toBeVisible();
  await screenshot(page, 'player-compact');
  await player.getByRole('button', { name: 'Expand player', exact: true }).click();
  await player.getByRole('button', { name: 'Order', exact: true }).click();
  await player.getByRole('button', { name: 'Storyboard scenes', exact: true }).click();
  const storyboard = player.getByLabel('Storyboard editor');
  await storyboard
    .getByRole('button', { name: 'Add numbered nodes as scenes', exact: true })
    .click();
  await storyboard.getByRole('button', { name: 'Customer request', exact: true }).click();
  await storyboard.getByLabel('Scene name').fill('Discovery and delivery');
  await storyboard
    .getByLabel('Scene narration')
    .fill('Follow the customer request from review through delivery.');
  await screenshot(page, 'storyboard', player);
  await player.getByRole('button', { name: 'Close diagram player', exact: true }).click();
});

test('capture export, app handoff and local settings', async ({ page, request }) => {
  const graph = await workflow(request, 'Invoice approval workflow');
  await open(page, graph.diagram.name);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('pdf');
  await screenshot(page, 'export', page.getByRole('dialog', { name: 'Export diagram' }));
  await page.getByLabel('Export format').selectOption('svg');
  await screenshot(page, 'export-svg', page.getByRole('dialog', { name: 'Export diagram' }));
  await close(page);
  await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
  const brief = page.getByRole('dialog', { name: 'Build with Lovable' });
  await brief
    .getByLabel('App instructions', { exact: true })
    .fill(
      'Build a clear invoice approval app for a small team. Include assignment, review, delivery and a visible audit trail.',
    );
  await screenshot(page, 'lovable', brief);
  await close(page);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await screenshot(page, 'settings', settings);
  await settings.getByText('Storage details', { exact: true }).click();
  await screenshot(page, 'backup', settings);
  await settings.getByText('Local connection details', { exact: true }).click();
  await settings.getByLabel('Local bridge address').scrollIntoViewIfNeeded();
  await screenshot(page, 'mcp-settings', settings);
});

test('capture CSV grouping, evidence, cleanup, source refresh and linked data', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const csvText =
    'ID;Company;Region;Amount\n1;310293-AAA Studio;North;1200,50\n2;921885-AAA Studio;North;850,25\n3;BBB Logistics;South;bad\n4;CCC Services;South;425,00\n5;CCC Services;South;1,234';
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'Customer revenue.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvText),
  });
  const csv = page.getByRole('dialog', { name: /^(Import|Explore) CSV data$/ });
  await csv.getByLabel('CSV diagram name').fill('Customer revenue');
  await csv.getByLabel('Grouping level 1', { exact: true }).selectOption('c1');
  await csv.getByRole('button', { name: 'Add column cleanup', exact: true }).click();
  await csv.getByLabel('Cleanup column 1').selectOption('c1');
  await csv.getByLabel('Cleanup regex 1').fill('^\\d+-');
  await csv.getByLabel('Measure 1', { exact: true }).selectOption('sum');
  await csv.getByLabel('Measure column 1', { exact: true }).selectOption('c3');
  await screenshot(page, 'csv-import', csv);
  await csv.getByRole('button', { name: 'Create data diagram', exact: true }).click();
  await expect(csv).toBeHidden();
  await saved(page);
  await page.getByRole('button', { name: /^Search/ }).click();
  await page.getByLabel('Global search').fill('AAA Studio');
  await page
    .locator('.search-results button')
    .filter({ has: page.getByText('AAA Studio', { exact: true }) })
    .click();
  await expect(page.getByLabel('Node title')).toHaveValue('AAA Studio');
  await page.getByRole('button', { name: 'Explain Sum · Amount', exact: true }).click();
  const evidence = page.getByRole('dialog', { name: 'Explain measure' });
  await expect(evidence.getByRole('table', { name: 'Evidence rows' })).toContainText('1200');
  await screenshot(page, 'csv-evidence', evidence);
  await close(page);
  const quality = await tool(page, 'Data quality');
  await quality.getByRole('button', { name: /different originals merged by cleanup/ }).click();
  await quality.getByLabel('Show original cells', { exact: true }).check();
  await screenshot(page, 'data-quality', quality);
  await close(page);
  const refresh = await tool(page, 'Refresh source');
  await refresh.getByLabel('Replacement source file').setInputFiles({
    name: 'Customer revenue refreshed.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvText.replace('425,00', '600,00') + '\n6;DDD Retail;East;300,00'),
  });
  await refresh.getByLabel('Identity key ID').check();
  await refresh.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await expect(refresh.getByLabel('Source changes preview')).toBeVisible();
  await screenshot(page, 'source-refresh', refresh);
  await close(page);
  const sources = await tool(page, 'Data sources');
  await sources.getByLabel('Add CSV sources').setInputFiles({
    name: 'Orders.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Customer ID,Order,Amount\n1,O-101,1200\n2,O-102,850\n4,O-103,425'),
  });
  await sources.getByRole('button', { name: 'Match columns', exact: true }).click();
  await sources
    .getByLabel('Relationship source', { exact: true })
    .selectOption({ label: 'Orders' });
  await sources.getByLabel('Source matching column', { exact: true }).selectOption('c0');
  await sources.getByLabel('Target matching column', { exact: true }).selectOption('c0');
  await sources.getByRole('button', { name: 'Preview match', exact: true }).click();
  await expect(sources.locator('.data-match-preview')).toBeVisible();
  await screenshot(page, 'connected-data', sources);
});

test('capture SQL, source code and diagram import', async ({ page, request }) => {
  test.setTimeout(150000);
  for (const [name, sql, preview] of [
    [
      'Order database',
      'CREATE TABLE customers(id INT PRIMARY KEY, name VARCHAR(200)); CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), amount DECIMAL(12,2)); CREATE TABLE order_lines(id INT PRIMARY KEY, order_id INT REFERENCES orders(id), product VARCHAR(200));',
      'Preview schema',
    ],
    [
      'Revenue by customer',
      'SELECT c.name AS customer, SUM(o.amount) AS revenue, COUNT(o.id) AS orders FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.amount > 0 GROUP BY c.name;',
      'Preview query',
    ],
  ]) {
    await page.getByLabel('Import file', { exact: true }).setInputFiles({
      name: `${name}.sql`,
      mimeType: 'application/sql',
      buffer: Buffer.from(sql),
    });
    const dialog = page.getByRole('dialog', { name: 'Import SQL', exact: true });
    await dialog.getByRole('button', { name: preview, exact: true }).click();
    await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await expect(dialog).toBeHidden();
    await saved(page);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.waitForTimeout(400);
    await screenshot(page, preview === 'Preview schema' ? 'sql-schema' : 'sql-query');
  }
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  let code = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await code
    .getByLabel('Load source files')
    .setInputFiles(resolve('tests/fixtures/cobol-payroll.cbl'));
  await code.getByLabel('Code diagram name').fill('COBOL payroll dependencies');
  await code.getByRole('button', { name: 'Preview code', exact: true }).click();
  await code.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(code).toBeHidden();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'code-cobol');
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  code = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await code.getByLabel('Load source files').setInputFiles([
    {
      name: 'service.py',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'from pricing import calculate_total\n\ndef create_order():\n    return calculate_total()',
      ),
    },
    {
      name: 'pricing.py',
      mimeType: 'text/plain',
      buffer: Buffer.from('def calculate_total():\n    return 42'),
    },
  ]);
  await code.getByLabel('Code diagram name').fill('Order service dependencies');
  await code.getByLabel('Code diagram detail').selectOption('files');
  await code.getByRole('button', { name: 'Preview code', exact: true }).click();
  await code.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(code).toBeHidden();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'code-project');
  const drawio =
    '<mxfile><diagram id="onboarding" name="Customer onboarding"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Customer request" vertex="1" parent="1" style="fillColor=#d5e8d4;"><mxGeometry x="40" y="40" width="180" height="80" as="geometry"/></mxCell><mxCell id="b" value="Review requirements" vertex="1" parent="1" style="rhombus;"><mxGeometry x="350" y="40" width="180" height="100" as="geometry"/></mxCell><mxCell id="edge" value="Review" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'Customer onboarding.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(drawio),
  });
  const diagram = page.getByRole('dialog', { name: 'Import diagram file' });
  await expect(diagram).toContainText('Customer request');
  await screenshot(page, 'diagram-import', diagram);
});

test('capture truthful kiosk simulation, assumptions and comparison', async ({ page, request }) => {
  test.setTimeout(150000);
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Kiosk and package pickup', type: 'process-simulator' },
    })
  ).json();
  const model = createKioskModel();
  expect(
    (
      await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
        data: { baseVersion: diagram.version, model },
      })
    ).ok(),
  ).toBeTruthy();
  await open(page, 'Kiosk and package pickup');
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation duration hours').fill('24');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Hide simulation metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'simulation');
  page.once('dialog', (dialog) => dialog.accept('Package demand ×100'));
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page
    .getByLabel('Simulation node', { exact: true })
    .selectOption({ label: 'Package arrivals (source)' });
  await page.getByLabel('Arrivals / opening day', { exact: true }).fill('1000');
  const assumptions = page.getByRole('dialog');
  await screenshot(page, 'simulation-assumptions', assumptions);
  await page.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Show simulation metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByText(/Replay and compare runs/).click();
  const runs = page.getByRole('checkbox', { name: /^Compare run / });
  await expect(runs).toHaveCount(2);
  await runs.nth(0).check();
  await runs.nth(1).check();
  await page.getByRole('button', { name: 'Compare selected runs', exact: true }).click();
  await expect(page.getByText(/contribution change/)).toBeVisible();
  await screenshot(page, 'simulation-compare');
});

test('capture readable mind-map, code details and backup confirmation', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await page.getByRole('button', { name: /^New diagram/ }).click();
  await page.getByLabel('New diagram name').fill('Product launch mind map');
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  await expect(page.getByLabel('Layout direction')).toHaveValue('BALANCED');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'layouts');

  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const pending = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export all data', exact: true }).click();
  const file = await pending;
  const bytes = await readFile((await file.path())!);
  await settings
    .getByLabel('Restore backup file', { exact: true })
    .setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  const restore = page.getByRole('dialog', { name: 'Import Visual Nerve backup' });
  await restore.getByLabel('Replace all local data', { exact: true }).check();
  await expect(restore.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled();
  await screenshot(page, 'backup', restore);
  await restore.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const code = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await code
    .getByLabel('Load source files')
    .setInputFiles(resolve('tests/fixtures/cobol-payroll.cbl'));
  await code.getByLabel('Code diagram name').fill('COBOL payroll details');
  await code.getByRole('button', { name: 'Preview code', exact: true }).click();
  await code.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(code).toBeHidden();
  await saved(page);
  await page.keyboard.press('Control+f');
  await page.getByLabel('Global search').fill('cobol-payroll.cbl');
  await page
    .locator('.search-results button')
    .filter({ has: page.getByText('cobol-payroll.cbl', { exact: true }) })
    .click();
  await expect(page.getByRole('region', { name: 'Code object details' })).toContainText(
    '100-INITIALIZE',
  );
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const diagram = diagrams.find(
    (entry: { name: string }) => entry.name === 'COBOL payroll details',
  );
  const graph = await current(request, diagram.id);
  const fileNode = graph.nodes.find((node) => node.title === 'cobol-payroll.cbl')!;
  const handle = page.locator(
    `.react-flow__node[data-id="${fileNode.id}"] .react-flow__resize-control.bottom.right`,
  );
  const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 45, corner.y + corner.height / 2 + 75, {
    steps: 12,
  });
  await page.mouse.up();
  await saved(page);
  await screenshot(page, 'code-cobol');
});
