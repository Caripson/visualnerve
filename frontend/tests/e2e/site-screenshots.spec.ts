import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createKioskModel } from '../../src/simulation/examples';

test.skip(process.env.VN_CAPTURE_SITE !== '1', 'Opt in to regenerate real device screenshots.');
test.use({ colorScheme: 'light' });
async function save(page: Page, name: string) {
  const output = resolve('../hugo/static/site/images');
  await mkdir(output, { recursive: true });
  const bytes = await page.screenshot({ animations: 'disabled' });
  const png = resolve(output, name + '.png');
  await writeFile(png, bytes);
  execFileSync('cwebp', [
    '-lossless',
    '-m',
    '6',
    '-quiet',
    png,
    '-o',
    resolve(output, name + '.webp'),
  ]);
  await unlink(png);
  console.log(name, bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}
async function open(page: Page, name: string) {
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(name);
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(450);
}
async function workflow(request: APIRequestContext) {
  const response = await request.post('/api/v1/diagrams', {
    data: { name: 'Service delivery', type: 'process' },
  });
  expect(response.ok()).toBeTruthy();
  const diagram = await response.json();
  const nodes = [
    {
      externalId: 'request',
      title: 'Customer request',
      description: 'Capture the need and agree on the next step.',
      nodeType: 'input',
      x: 50,
      y: 40,
      status: 'done',
      color: '#397356',
    },
    {
      externalId: 'review',
      title: 'Review requirements',
      description: 'Confirm scope, owners and delivery capacity.',
      nodeType: 'decision',
      x: 50,
      y: 230,
      status: 'in-progress',
      color: '#946426',
    },
    {
      externalId: 'deliver',
      title: 'Deliver and verify',
      description: 'Verify the result together with the customer.',
      nodeType: 'output',
      x: 50,
      y: 420,
      status: 'planned',
      color: '#397356',
    },
  ].map((node) => ({
    ...node,
    width: 230,
    height: 110,
    metadata: { visualNerve: { icon: 'work' } },
  }));
  expect(
    (
      await request.post('/api/v1/diagrams/' + diagram.id + '/bulk', {
        data: {
          nodes,
          edges: [
            { sourceExternalId: 'request', targetExternalId: 'review', label: 'Ready for review' },
            { sourceExternalId: 'review', targetExternalId: 'deliver', label: 'Approved' },
          ],
        },
      })
    ).ok(),
  ).toBeTruthy();
}
async function launchMindMap(request: APIRequestContext) {
  const response = await request.post('/api/v1/diagrams', {
    data: { name: 'Product launch mind map', type: 'mindmap' },
  });
  expect(response.ok()).toBeTruthy();
  const diagram = await response.json();
  const branches = [
    [
      'Research',
      [
        'Customer interviews',
        'Target audiences',
        'Market landscape',
        'Jobs to be done',
        'Pricing signals',
        'Validate demand',
      ],
    ],
    [
      'Product',
      [
        'Core user journey',
        'MVP scope',
        'Prototype review',
        'Accessibility',
        'Release checklist',
        'Quality gates',
      ],
    ],
    [
      'Brand',
      [
        'Value proposition',
        'Product story',
        'Visual identity',
        'Demo script',
        'Website copy',
        'Launch assets',
      ],
    ],
    [
      'Marketing',
      [
        'Channel strategy',
        'Content calendar',
        'Partner outreach',
        'Email sequence',
        'Community launch',
        'Measure response',
      ],
    ],
    [
      'Delivery',
      [
        'Team ownership',
        'Weekly milestones',
        'Support playbook',
        'Operational checks',
        'Customer onboarding',
        'Launch day',
      ],
    ],
    [
      'Learning',
      [
        'Success metrics',
        'Product analytics',
        'Customer feedback',
        'Sales pipeline',
        'Review outcomes',
        'Next experiments',
      ],
    ],
  ] as const;
  const nodes: Record<string, unknown>[] = [
    {
      externalId: 'launch',
      title: 'Product launch',
      nodeType: 'generic',
      description: 'An editable launch plan linking research, delivery and learning.',
      x: 0,
      y: 0,
      width: 192,
      height: 96,
    },
  ];
  const edges: Record<string, unknown>[] = [];
  for (const [index, [title, topics]] of branches.entries()) {
    const branch = `launch-${index}`;
    nodes.push({
      externalId: branch,
      parentExternalId: 'launch',
      title,
      nodeType: 'generic',
      x: 0,
      y: 0,
      width: 172,
      height: 64,
    });
    edges.push({ sourceExternalId: 'launch', targetExternalId: branch });
    for (const [topicIndex, topic] of topics.entries()) {
      const id = `${branch}-${topicIndex}`;
      nodes.push({
        externalId: id,
        parentExternalId: branch,
        title: topic,
        nodeType: 'generic',
        x: 0,
        y: 0,
        width: 172,
        height: 64,
      });
      edges.push({ sourceExternalId: branch, targetExternalId: id });
    }
  }
  expect(
    (await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, { data: { nodes, edges } })).ok(),
  ).toBeTruthy();
}
test('capture four distinct real app views at device viewport sizes', async ({ page, request }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Kiosk and package pickup', type: 'process-simulator' },
    })
  ).json();
  expect(
    (
      await request.put('/api/v1/diagrams/' + diagram.id + '/simulation', {
        data: { baseVersion: diagram.version, model: createKioskModel() },
      })
    ).ok(),
  ).toBeTruthy();
  await open(page, 'Kiosk and package pickup');
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation duration hours').fill('24');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(450);
  const simulationNodes = page.locator('.canvas-shell [data-testid="graph-node"]');
  await expect(simulationNodes).toHaveCount(8);
  for (const node of await simulationNodes.all())
    await expect(node).toBeInViewport({ ratio: 0.999 });
  await save(page, 'imac');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'Customer revenue.sql',
    mimeType: 'application/sql',
    buffer: Buffer.from(
      'SELECT c.name AS customer, SUM(o.amount) AS revenue, COUNT(o.id) AS orders FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_lines ol ON ol.order_id = o.id WHERE o.amount > 0 GROUP BY c.name;',
    ),
  });
  const sql = page.getByRole('dialog', { name: 'Import SQL', exact: true });
  await sql.getByRole('button', { name: 'Preview query', exact: true }).click();
  await sql.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(sql).toBeHidden();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(450);
  await save(page, 'macbook');

  await page.setViewportSize({ width: 1024, height: 1366 });
  await launchMindMap(request);
  await open(page, 'Product launch mind map');
  await page.getByLabel('Layout direction', { exact: true }).selectOption('BALANCED');
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Focus map', exact: true }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: 'Toggle minimap', exact: true }).click();
  await expect(page.locator('.react-flow__minimap')).toBeHidden();
  await expect(page.locator('.mindmap-topic')).toHaveCount(43);
  await expect(page.locator('.react-flow__edge-mindmap-branch')).toHaveCount(42);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.properties')).toBeHidden();
  const canvas = (await page.locator('.canvas-shell').boundingBox())!;
  const extent = await page.locator('.mindmap-topic').evaluateAll((topics) => {
    const boxes = topics.map((topic) => topic.getBoundingClientRect());
    return {
      width: Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left)),
      height:
        Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)),
    };
  });
  expect(extent.width).toBeGreaterThan(canvas.width * 0.7);
  expect(extent.height).toBeGreaterThan(canvas.height * 0.7);
  for (const node of await page.locator('.mindmap-topic').all())
    await expect(node).toBeInViewport({ ratio: 0.999 });
  await save(page, 'ipad');
  await page.getByRole('button', { name: 'Toggle minimap', exact: true }).click();
  await page.getByRole('button', { name: 'Exit map focus', exact: true }).click();

  await workflow(request);
  await open(page, 'Service delivery');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(450);
  await save(page, 'iphone');
});
