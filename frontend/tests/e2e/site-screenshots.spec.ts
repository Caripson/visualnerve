import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Graph, GraphNode } from '../../src/model/types';
import { captureAppearancePair } from './capture-appearance';

test.skip(process.env.VN_CAPTURE_SITE !== '1', 'Opt in to regenerate real device screenshots.');
test.use({ colorScheme: 'light' });

const siteImages = resolve('../hugo/static/site/images');
const colors = {
  sage: { backgroundColor: '#DDEBE2', color: '#426E58' },
  sand: { backgroundColor: '#F4E7CB', color: '#8B692D' },
  blue: { backgroundColor: '#DCE8F0', color: '#41647D' },
  rose: { backgroundColor: '#EFDDD7', color: '#8A5F56' },
  violet: { backgroundColor: '#E6E0EE', color: '#6F6383' },
} as const;
type CaptureNode = Pick<
  GraphNode,
  'title' | 'nodeType' | 'flowchartSymbol' | 'x' | 'y' | 'width' | 'height'
> & {
  externalId: string;
  tone: keyof typeof colors;
};
type CaptureEdge = {
  sourceExternalId: string;
  targetExternalId: string;
  label?: string;
  metadata?: { sourceHandle: string; targetHandle: string };
};
const down = { sourceHandle: 'out-bottom', targetHandle: 'in-top' };
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved');

async function workflow(
  request: APIRequestContext,
  name: string,
  description: string,
  nodes: CaptureNode[],
  edges: CaptureEdge[],
): Promise<Graph> {
  // A blank diagram demonstrates that the stencil template is optional.
  const created = await request.post('/api/v1/diagrams', { data: { name, type: 'blank' } });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      baseVersion: diagram.version,
      nodes: nodes.map(({ tone, ...node }) => ({ ...node, ...colors[tone] })),
      edges: edges.map((edge, index) => ({ ...edge, externalId: `connection-${index}` })),
    },
  });
  expect(populated.status()).toBe(200);
  const read = await request.get(`/api/v1/diagrams/${diagram.id}`);
  expect(read.status()).toBe(200);
  const graph: Graph = await read.json();
  graph.diagram.description = description;
  const replaced = await request.put(`/api/v1/diagrams/${diagram.id}/graph`, {
    data: { baseVersion: graph.diagram.version, graph },
  });
  expect(replaced.status()).toBe(200);
  const result: Graph = await replaced.json();
  expect(result.nodes).toHaveLength(nodes.length);
  expect(result.edges).toHaveLength(edges.length);
  for (const original of nodes) {
    const stored = result.nodes.find((node) => node.externalId === original.externalId)!;
    expect(stored.flowchartSymbol).toBe(original.flowchartSymbol);
    expect(stored.backgroundColor).toBe(colors[original.tone].backgroundColor);
  }
  return result;
}

async function open(page: Page, graph: Graph) {
  if (!(await page.locator('.sidebar').isVisible()))
    await page.getByRole('button', { name: 'Open projects', exact: true }).click();
  await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(graph.diagram.name);
  await saved(page);
  if (await page.locator('.react-flow__minimap').isVisible())
    await page.getByRole('button', { name: 'Toggle minimap', exact: true }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  // Return the scrollable toolbar to its first control after fitting the canvas.
  const nodeType = page.getByRole('combobox', { name: 'New node type', exact: true });
  if (await nodeType.isVisible()) await nodeType.scrollIntoViewIfNeeded();
  await page.waitForTimeout(450);
}

async function save(page: Page, graph: Graph, name: string) {
  const nodes = page.locator('.canvas-shell [data-testid="graph-node"]');
  await expect(nodes).toHaveCount(graph.nodes.length);
  for (const node of await nodes.all()) {
    await expect(node).toBeInViewport({ ratio: 0.999 });
    expect((await node.boundingBox())!.width).toBeGreaterThanOrEqual(180);
    await expect(node.locator('.ibm-node-shape')).toHaveCount(1);
    const typography = await node.evaluate((element) => {
      const title = element.querySelector<HTMLElement>('.node-title')!;
      const fill = element.querySelector<SVGPathElement>('.ibm-node-shape .ibm-symbol-outline')!;
      const scale = element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth;
      const luminance = (color: string) => {
        const values = (color.match(/[\d.]+/g) || [])
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const textLight = luminance(getComputedStyle(title).color);
      const fillLight = luminance(getComputedStyle(fill).fill);
      return {
        displayedFontSize: parseFloat(getComputedStyle(title).fontSize) * scale,
        contrast: (Math.max(textLight, fillLight) + 0.05) / (Math.min(textLight, fillLight) + 0.05),
      };
    });
    expect(typography.displayedFontSize).toBeGreaterThanOrEqual(10);
    expect(typography.contrast).toBeGreaterThanOrEqual(4.5);
  }
  expect(new Set(graph.nodes.map((node) => node.backgroundColor)).size).toBeGreaterThanOrEqual(3);
  await captureAppearancePair(page, siteImages, name);
}

test('capture four distinct colored flowcharts at device viewport sizes', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const desktop = await workflow(
    request,
    'Customer delivery',
    'Follow a customer request through review, delivery and confirmation.',
    [
      {
        externalId: 'start',
        title: 'Request received',
        nodeType: 'start',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 50,
        width: 300,
        height: 120,
        tone: 'sage',
      },
      {
        externalId: 'read',
        title: 'Capture order details',
        nodeType: 'input',
        flowchartSymbol: 'ibm-input-output',
        x: 400,
        y: 10,
        width: 300,
        height: 200,
        tone: 'blue',
      },
      {
        externalId: 'decide',
        title: 'Details complete?',
        nodeType: 'decision',
        flowchartSymbol: 'ibm-decision',
        x: 800,
        y: 0,
        width: 310,
        height: 220,
        tone: 'sand',
      },
      {
        externalId: 'returned',
        title: 'Request returned',
        nodeType: 'end',
        flowchartSymbol: 'ibm-terminal',
        x: 800,
        y: 380,
        width: 300,
        height: 120,
        tone: 'rose',
      },
      {
        externalId: 'prepare',
        title: 'Prepare delivery',
        nodeType: 'process',
        flowchartSymbol: 'ibm-predefined-process',
        x: 0,
        y: 340,
        width: 300,
        height: 200,
        tone: 'violet',
      },
      {
        externalId: 'store',
        title: 'Store approved order',
        nodeType: 'database',
        flowchartSymbol: 'ibm-magnetic-disk',
        x: 400,
        y: 320,
        width: 300,
        height: 240,
        tone: 'blue',
      },
      {
        externalId: 'report',
        title: 'Create delivery note',
        nodeType: 'document',
        flowchartSymbol: 'ibm-document',
        x: 0,
        y: 650,
        width: 300,
        height: 200,
        tone: 'sand',
      },
      {
        externalId: 'deliver',
        title: 'Deliver the order',
        nodeType: 'output',
        flowchartSymbol: 'ibm-input-output',
        x: 400,
        y: 650,
        width: 300,
        height: 200,
        tone: 'sage',
      },
      {
        externalId: 'end',
        title: 'Delivery confirmed',
        nodeType: 'end',
        flowchartSymbol: 'ibm-terminal',
        x: 800,
        y: 690,
        width: 300,
        height: 120,
        tone: 'sage',
      },
    ],
    [
      { sourceExternalId: 'start', targetExternalId: 'read' },
      { sourceExternalId: 'read', targetExternalId: 'decide' },
      { sourceExternalId: 'decide', targetExternalId: 'prepare', label: 'Yes', metadata: down },
      { sourceExternalId: 'decide', targetExternalId: 'returned', label: 'No', metadata: down },
      { sourceExternalId: 'prepare', targetExternalId: 'store' },
      { sourceExternalId: 'store', targetExternalId: 'report', metadata: down },
      { sourceExternalId: 'report', targetExternalId: 'deliver' },
      { sourceExternalId: 'deliver', targetExternalId: 'end' },
    ],
  );
  await open(page, desktop);
  await page
    .locator(
      `[data-node-id="${desktop.nodes.find((node) => node.externalId === 'decide')!.id}"] .node-title`,
    )
    .click();
  await expect(page.getByLabel('IBM flowchart symbol', { exact: true })).toHaveValue(
    'ibm-decision',
  );
  await page.getByLabel('IBM flowchart symbol', { exact: true }).scrollIntoViewIfNeeded();
  await save(page, desktop, 'desktop');
  // Derive the social preview from the genuine light viewport, using the established native pipeline.
  execFileSync('dwebp', [
    resolve(siteImages, 'desktop.webp'),
    '-o',
    '/tmp/visual-nerve-social.png',
  ]);
  execFileSync('cwebp', [
    '-resize',
    '1200',
    '675',
    '-q',
    '85',
    '-m',
    '6',
    '-quiet',
    '/tmp/visual-nerve-social.png',
    '-o',
    resolve(siteImages, 'social.webp'),
  ]);

  await page.setViewportSize({ width: 1440, height: 900 });
  const laptop = await workflow(
    request,
    'Invoice approval',
    'Review an invoice, approve the payment and keep its record.',
    [
      {
        externalId: 'received',
        title: 'Invoice received',
        nodeType: 'start',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 30,
        width: 300,
        height: 120,
        tone: 'sage',
      },
      {
        externalId: 'check',
        title: 'Check invoice details',
        nodeType: 'process',
        flowchartSymbol: 'ibm-process',
        x: 400,
        y: 0,
        width: 300,
        height: 180,
        tone: 'blue',
      },
      {
        externalId: 'approve',
        title: 'Approve payment',
        nodeType: 'process',
        flowchartSymbol: 'ibm-manual-operation',
        x: 0,
        y: 260,
        width: 300,
        height: 190,
        tone: 'sand',
      },
      {
        externalId: 'pay',
        title: 'Schedule payment',
        nodeType: 'process',
        flowchartSymbol: 'ibm-predefined-process',
        x: 400,
        y: 260,
        width: 300,
        height: 190,
        tone: 'violet',
      },
      {
        externalId: 'archive',
        title: 'Archive paid invoice',
        nodeType: 'document',
        flowchartSymbol: 'ibm-document',
        x: 0,
        y: 520,
        width: 300,
        height: 190,
        tone: 'blue',
      },
      {
        externalId: 'complete',
        title: 'Payment complete',
        nodeType: 'end',
        flowchartSymbol: 'ibm-terminal',
        x: 400,
        y: 555,
        width: 300,
        height: 120,
        tone: 'sage',
      },
    ],
    [
      { sourceExternalId: 'received', targetExternalId: 'check' },
      { sourceExternalId: 'check', targetExternalId: 'approve', metadata: down },
      { sourceExternalId: 'approve', targetExternalId: 'pay' },
      { sourceExternalId: 'pay', targetExternalId: 'archive', metadata: down },
      { sourceExternalId: 'archive', targetExternalId: 'complete' },
    ],
  );
  await open(page, laptop);
  await save(page, laptop, 'laptop');

  await page.setViewportSize({ width: 1024, height: 1366 });
  const tablet = await workflow(
    request,
    'New colleague onboarding',
    'A portrait flowchart of the first steps for a new colleague.',
    [
      {
        externalId: 'start',
        title: 'Colleague joins',
        nodeType: 'start',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 0,
        width: 310,
        height: 120,
        tone: 'sage',
      },
      {
        externalId: 'prepare',
        title: 'Prepare workspace',
        nodeType: 'process',
        flowchartSymbol: 'ibm-preparation',
        x: 0,
        y: 210,
        width: 310,
        height: 180,
        tone: 'sand',
      },
      {
        externalId: 'access',
        title: 'Set up account access',
        nodeType: 'process',
        flowchartSymbol: 'ibm-predefined-process',
        x: 0,
        y: 480,
        width: 310,
        height: 190,
        tone: 'blue',
      },
      {
        externalId: 'welcome',
        title: 'Share welcome guide',
        nodeType: 'document',
        flowchartSymbol: 'ibm-document',
        x: 0,
        y: 760,
        width: 310,
        height: 190,
        tone: 'violet',
      },
      {
        externalId: 'ready',
        title: 'Ready for the first day',
        nodeType: 'end',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 1040,
        width: 310,
        height: 120,
        tone: 'sage',
      },
    ],
    [
      { sourceExternalId: 'start', targetExternalId: 'prepare', metadata: down },
      { sourceExternalId: 'prepare', targetExternalId: 'access', metadata: down },
      { sourceExternalId: 'access', targetExternalId: 'welcome', metadata: down },
      { sourceExternalId: 'welcome', targetExternalId: 'ready', metadata: down },
    ],
  );
  await open(page, tablet);
  await save(page, tablet, 'tablet');

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await workflow(
    request,
    'Service request',
    'A compact three-step flowchart for reviewing a request.',
    [
      {
        externalId: 'start',
        title: 'Request received',
        nodeType: 'start',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 0,
        width: 280,
        height: 105,
        tone: 'blue',
      },
      {
        externalId: 'review',
        title: 'Review request',
        nodeType: 'process',
        flowchartSymbol: 'ibm-process',
        x: 0,
        y: 190,
        width: 280,
        height: 165,
        tone: 'sand',
      },
      {
        externalId: 'ready',
        title: 'Ready to deliver',
        nodeType: 'end',
        flowchartSymbol: 'ibm-terminal',
        x: 0,
        y: 440,
        width: 280,
        height: 105,
        tone: 'sage',
      },
    ],
    [
      { sourceExternalId: 'start', targetExternalId: 'review', metadata: down },
      { sourceExternalId: 'review', targetExternalId: 'ready', metadata: down },
    ],
  );
  await open(page, phone);
  await save(page, phone, 'phone');
});

test('capture the renamed template gallery in both appearances', async ({ page, request }) => {
  // The connected fixture supplies the same real appearance observer as the device captures.
  expect((await request.get('/api/v1/health')).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByLabel('New diagram name').fill('My next workflow');
  await expect(dialog.locator('.template-option')).toHaveCount(14);
  await expect(dialog.getByRole('button', { name: /Classic Flowcharting/ })).toBeVisible();
  await expect(
    dialog.getByText('Based on the IBM GX20-8020 stencil', { exact: false }),
  ).toBeVisible();
  for (const option of await dialog.locator('.template-option').all())
    await expect(option).toBeInViewport({ ratio: 0.999 });
  await captureAppearancePair(dialog, resolve('../hugo/static/help/images'), 'new-diagram');
});
