import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { browserLaunchOptions } from '../../playwright.config';
import type { Graph } from '../../src/model/types';
import { getIbmSymbol } from '../../src/flowchart/ibm-symbols';

test.use({
  launchOptions: {
    ...browserLaunchOptions,
    args: [
      ...browserLaunchOptions.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});

const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved');
const stored = async (request: APIRequestContext, id: string): Promise<Graph> => {
  const response = await request.get(`/api/v1/diagrams/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
};
async function blank(page: Page, request: APIRequestContext, name: string) {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByRole('button', { name: /^Blank\b/ }).click();
  await dialog.getByLabel('New diagram name').fill(name);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const graph = await stored(
    request,
    diagrams.find((value: { name: string }) => value.name === name).id,
  );
  expect(graph.diagram.type).toBe('blank');
  expect(graph.nodes).toEqual([]);
  return graph;
}

test('an empty Blank diagram supports palette and property symbols without becoming an IBM template', async ({
  page,
  request,
}) => {
  const graph = await blank(page, request, 'Build a flowchart from scratch');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const selector = page.getByLabel('IBM flowchart symbol', { exact: true });
  await selector.selectOption('ibm-document');
  await page.getByRole('button', { name: 'Use stencil proportions', exact: true }).click();
  await page.getByLabel('Node background color', { exact: true }).fill('#d9edf5');
  await saved(page);
  const changed = await stored(request, graph.diagram.id);
  const node = changed.nodes[0];
  expect(changed.diagram.type).toBe('blank');
  expect(node).toMatchObject({
    flowchartSymbol: 'ibm-document',
    nodeType: 'generic',
    backgroundColor: '#d9edf5',
  });
  await expect(page.locator(`[data-node-id="${node.id}"]`)).toHaveAttribute(
    'data-flowchart-symbol',
    'ibm-document',
  );
  await page.getByRole('button', { name: 'IBM symbols', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Classic Flowcharting' })).toBeVisible();
  await page.getByRole('button', { name: 'Add IBM Decision', exact: true }).click();
  await saved(page);
  expect((await stored(request, graph.diagram.id)).nodes).toHaveLength(2);
  await page.reload();
  await saved(page);
  await expect(page.locator(`[data-node-id="${node.id}"]`)).toHaveAttribute(
    'data-flowchart-symbol',
    'ibm-document',
  );
});

test('a phone can add and restyle IBM symbols in an ordinary blank diagram', async ({
  page,
  request,
}) => {
  const graph = await blank(page, request, 'Phone flowchart');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'IBM symbols', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'IBM symbols menu', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add IBM Terminal / Interrupt', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Open properties', exact: true }).click();
  const properties = page.getByRole('dialog', { name: 'Properties', exact: true });
  await properties.getByLabel('IBM flowchart symbol', { exact: true }).selectOption('ibm-display');
  await properties.getByLabel('Node background color', { exact: true }).fill('#e8ddf5');
  await properties.getByRole('button', { name: 'Close properties', exact: true }).click();
  await saved(page);
  const changed = await stored(request, graph.diagram.id);
  expect(changed.diagram.type).toBe('blank');
  expect(changed.nodes[0]).toMatchObject({
    flowchartSymbol: 'ibm-display',
    nodeType: 'start',
    backgroundColor: '#e8ddf5',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('mind-map symbols retain hierarchy and branches across 2D, 3D, SVG and reload', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/v1/diagrams', {
    data: { name: 'Ideas with flowchart symbols', type: 'mindmap' },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'root',
          title: 'Launch plan',
          nodeType: 'generic',
          x: 0,
          y: 100,
          width: 240,
          height: 120,
        },
        {
          externalId: 'right',
          parentExternalId: 'root',
          title: 'Customer review',
          nodeType: 'generic',
          x: 500,
          y: 100,
          width: 300,
          height: 200,
        },
        {
          externalId: 'left',
          parentExternalId: 'root',
          title: 'Research',
          nodeType: 'generic',
          x: -500,
          y: 100,
          width: 300,
          height: 200,
        },
      ],
      edges: [
        { sourceExternalId: 'root', targetExternalId: 'right' },
        { sourceExternalId: 'root', targetExternalId: 'left' },
      ],
    },
  });
  expect(populated.status()).toBe(200);
  const original = await stored(request, diagram.id);
  await page.locator('.diagram-item').filter({ hasText: diagram.name }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const right = original.nodes.find((node) => node.externalId === 'right')!;
  await page.locator(`[data-node-id="${right.id}"] .node-title`).click();
  await page.getByLabel('IBM flowchart symbol', { exact: true }).selectOption('ibm-input-output');
  await page.getByLabel('Node background color', { exact: true }).fill('#fff2c7');
  await saved(page);
  const card = page.locator(`[data-node-id="${right.id}"]`);
  await expect(card).toHaveAttribute('data-flowchart-symbol', 'ibm-input-output');
  await expect(page.locator('.mindmap-topic')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge-mindmap-branch')).toHaveCount(2);
  await expect(card.locator('.react-flow__handle[data-handleid="target-left"]')).toHaveCount(1);
  await expect(card.locator('.react-flow__handle[data-handleid="source-right"]')).toHaveCount(1);
  await card.locator('.node-title').click();
  await page.keyboard.press('F2');
  const editor = card.getByRole('textbox', { name: 'Node title', exact: true });
  await editor.fill('Reviewed customer needs');
  await editor.press('Enter');
  await saved(page);
  const changed = await stored(request, diagram.id);
  expect(changed.diagram.type).toBe('mindmap');
  expect(changed.edges).toEqual(original.edges);
  expect(changed.nodes.find((node) => node.id === right.id)).toMatchObject({
    title: 'Reviewed customer needs',
    parentId: right.parentId,
    nodeType: 'generic',
    flowchartSymbol: 'ibm-input-output',
  });

  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  const canvas = page.getByTestId('spatial-canvas');
  await expect(canvas).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
  await expect
    .poll(
      async () =>
        (
          JSON.parse((await canvas.getAttribute('data-face-projections')) || '[]') as {
            id: string;
            flowchartSymbol?: string;
          }[]
        ).find((face) => face.id === right.id)?.flowchartSymbol,
    )
    .toBe('ibm-input-output');
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await saved(page);
  const exported = await request.post('/api/v1/export', {
    data: { diagramId: diagram.id, format: 'svg' },
  });
  expect(exported.status()).toBe(200);
  const output = await exported.json();
  const paths = await page.evaluate(
    ({ xml, id }) => {
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
      return Array.from(
        document.querySelector(`[data-node-id="${id}"] svg`)?.querySelectorAll('path') ?? [],
      ).map((path) => path.getAttribute('d'));
    },
    { xml: output, id: right.id },
  );
  expect(paths).toEqual([getIbmSymbol('ibm-input-output')!.outlinePath]);
  expect(output).toContain('Reviewed customer needs');
  await page.reload();
  await saved(page);
  await expect(card).toHaveAttribute('data-flowchart-symbol', 'ibm-input-output');
  await card.locator('.node-title').click();
  await page.getByLabel('IBM flowchart symbol', { exact: true }).selectOption('');
  await saved(page);
  await expect(card).toHaveClass(/\bmindmap-topic\b/);
  // Reload preserves the title-editing viewport; fit before counting virtualized topics.
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge-mindmap-branch')).toHaveCount(2);
});
