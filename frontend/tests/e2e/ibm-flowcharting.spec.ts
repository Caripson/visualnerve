import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { browserLaunchOptions } from '../../playwright.config';
import type { Graph, GraphNode } from '../../src/model/types';
import { ibmSymbols } from '../../src/flowchart/ibm-symbols';
import { captureAppearancePair } from './capture-appearance';
import templateManifest from '../../src/templates/manifest.json' with { type: 'json' };

// IBM shapes use actual WebGL relief. Keep software rendering scoped to this suite.
test.use({
  actionTimeout: 45000,
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
async function stored(request: APIRequestContext, id: string): Promise<Graph> {
  const response = await request.get(`/api/v1/diagrams/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function open(page: Page, name: string) {
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(name);
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
}
async function create(request: APIRequestContext, name: string): Promise<Graph> {
  const response = await request.post('/api/v1/diagrams', {
    data: { name, template: 'ibm-flowcharting' },
  });
  expect(response.status()).toBe(201);
  return stored(request, (await response.json()).id);
}
async function node(request: APIRequestContext, id: string): Promise<GraphNode> {
  const response = await request.get(`/api/v1/nodes/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function mcp(request: APIRequestContext, path: string, method = 'GET', data?: unknown) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path, method, ...(data ? { data } : {}) },
      },
    },
  });
  expect(response.status()).toBe(200);
  const result = (await response.json()).result;
  expect(result.isError).toBe(false);
  return result.structuredContent;
}

async function edgeEndpoints(page: Page, id: string) {
  const path = await page
    .locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`)
    .getAttribute('d');
  const points = (path?.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  expect(points.length).toBeGreaterThanOrEqual(4);
  return { start: points.slice(0, 2), end: points.slice(-2) };
}

async function assertContourConnections(page: Page, request: APIRequestContext, graph: Graph) {
  const process = graph.nodes.find((value) => value.title === 'Validate records')!,
    side = graph.edges.find((edge) => edge.sourceNodeId === process.id)!,
    card = page.locator(`[data-node-id="${process.id}"]`);
  await card.locator('.node-title').click();
  for (const [symbol, ratio] of [
    ['ibm-process', 1],
    ['ibm-input-output', 0.925],
    ['ibm-manual-operation', 0.88],
    ['ibm-process', 1],
  ] as const) {
    await page.getByLabel('IBM flowchart symbol', { exact: true }).selectOption(symbol);
    await saved(page);
    const changed = await node(request, process.id);
    expect(changed.width).toBe(process.width);
    expect(changed.height).toBe(process.height);
    expect(changed.nodeType).toBe(process.nodeType);
    await expect
      .poll(async () =>
        Math.abs(
          (await edgeEndpoints(page, side.id)).start[0] - (process.x + ratio * process.width),
        ),
      )
      .toBeLessThan(1);
    const bounds = (await card.boundingBox())!,
      handle = (await card.locator('.react-flow__handle-right').boundingBox())!;
    // ReactFlow routes to the visible handle's outside edge, not its center.
    expect((handle.x + handle.width - bounds.x) / bounds.width).toBeCloseTo(ratio, 2);
  }
  const no = graph.edges.find((edge) => edge.label === 'No')!,
    report = graph.nodes.find((value) => value.title === 'Print batch report')!,
    end = graph.edges.find((edge) => edge.sourceNodeId === report.id)!;
  for (const [edge, sourceRatioY] of [
    [no, 1],
    [end, 0.91],
  ] as const) {
    expect(edge.metadata).toMatchObject({ sourceHandle: 'out-bottom', targetHandle: 'in-top' });
    const source = graph.nodes.find((value) => value.id === edge.sourceNodeId)!,
      target = graph.nodes.find((value) => value.id === edge.targetNodeId)!;
    const actual = await edgeEndpoints(page, edge.id);
    expect(Math.abs(actual.start[0] - (source.x + source.width / 2))).toBeLessThan(1);
    expect(Math.abs(actual.start[1] - (source.y + sourceRatioY * source.height))).toBeLessThan(1);
    expect(Math.abs(actual.end[0] - (target.x + target.width / 2))).toBeLessThan(1);
    expect(Math.abs(actual.end[1] - target.y)).toBeLessThan(1);
  }
}

async function capture(page: Page, name: string) {
  // Theme changes can rebuild native WebGL textures after the canvas is ready.
  const stable = new Proxy(page, {
    get(target, key) {
      if (key === 'screenshot')
        return async (...args: Parameters<Page['screenshot']>) => {
          await expect(
            page.getByText('Preparing the original node appearance…', { exact: true }),
          ).toBeHidden({ timeout: 30000 });
          return target.screenshot(...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await captureAppearancePair(stable, resolve('../hugo/static/help/images'), name);
}

// Derive an editable, readable workflow from the real template's connected example.
async function batch(request: APIRequestContext, name: string): Promise<Graph> {
  const graph = await create(request, name);
  const positions: Record<string, [number, number]> = {
    'Begin batch': [0, 50],
    'Read input records': [350, 0],
    'Validate records': [700, 0],
    'Records valid?': [1050, 0],
    'Store accepted records': [700, 350],
    'Print batch report': [350, 350],
    'Batch complete': [0, 600],
    'Correct rejected records': [1050, 450],
  };
  graph.nodes = graph.nodes.filter((value) => value.tags.includes('batch-example'));
  expect(graph.nodes).toHaveLength(8);
  graph.nodes = graph.nodes.map((value) => ({
    ...value,
    x: positions[value.title][0],
    y: positions[value.title][1],
    description: undefined,
    tags: [],
  }));
  const ids = new Set(graph.nodes.map((value) => value.id));
  graph.edges = graph.edges.filter(
    (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
  );
  graph.edges = graph.edges.map((edge) =>
    edge.label === 'Yes'
      ? {
          ...edge,
          metadata: { ...edge.metadata, sourceHandle: 'out-bottom', targetHandle: 'in-top' },
        }
      : edge,
  );
  expect(graph.edges).toHaveLength(8);
  const response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/graph`, {
    data: { baseVersion: graph.diagram.version, graph },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function appearanceExamples(request: APIRequestContext): Promise<Graph> {
  const graph = await create(request, 'Readable object titles and backgrounds');
  const ids = ['ibm-merge', 'ibm-connector', 'ibm-decision', 'ibm-process'] as const;
  graph.nodes = ids.map((id, index) => {
    const value = graph.nodes.find(
      (item) => item.flowchartSymbol === id && !item.tags.includes('batch-example'),
    )!;
    return {
      ...value,
      title: ['Combine inputs', 'Continue here', 'Records valid?', 'Ordinary processing card'][
        index
      ],
      flowchartSymbol: index === 3 ? undefined : id,
      x: index * 400,
      y: 0,
      width: 320,
      height: 400,
      color: '#345678',
      status: undefined,
      description: undefined,
      tags: [],
    };
  });
  graph.edges = [];
  const response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/graph`, {
    data: { baseVersion: graph.diagram.version, graph },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test('ordinary and IBM titles rename in place, undo, and save independent backgrounds', async ({
  page,
  request,
}) => {
  const graph = await appearanceExamples(request);
  await open(page, graph.diagram.name);
  for (const value of graph.nodes.filter((item) => item.flowchartSymbol)) {
    const card = page.locator(`[data-node-id="${value.id}"]`);
    await card.locator('.node-title').click();
    await expect(card).toHaveClass(/is-selected/);
    const content = (await card.locator('.ibm-node-content').boundingBox())!;
    for (const selector of ['.node-title', '.node-topline > svg']) {
      const element = card.locator(selector);
      await expect(element).toBeVisible();
      const bounds = (await element.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(content.x - 1);
      expect(bounds.y).toBeGreaterThanOrEqual(content.y - 1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(content.x + content.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(content.y + content.height + 1);
    }
    expect(
      await card.locator('.node-title').evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('14px');
  }
  const triangle = graph.nodes[0],
    triangleCard = page.locator(`[data-node-id="${triangle.id}"]`);
  await triangleCard.locator('.node-title').click();
  await page.keyboard.press('F2');
  const editor = page.locator('.node-title-input');
  await expect(editor).toBeFocused();
  await editor.fill('Combine accepted inputs');
  if (process.env.VN_CAPTURE_IBM === '1')
    await page.screenshot({ path: '/tmp/ibm-flowcharting-inline-rename.png' });
  await editor.press('Enter');
  await saved(page);
  expect((await node(request, triangle.id)).title).toBe('Combine accepted inputs');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await node(request, triangle.id)).title).toBe(triangle.title);
  await triangleCard.locator('.node-title').dblclick();
  await editor.fill('Discard this draft');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  const unchanged = await node(request, triangle.id);
  expect(unchanged.title).toBe(triangle.title);

  const ordinary = graph.nodes[3],
    ordinaryCard = page.locator(`[data-node-id="${ordinary.id}"]`);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await ordinaryCard.locator('.node-title').dblclick();
  await editor.fill('Ordinary card renamed directly');
  await editor.press('Enter');
  await saved(page);
  expect((await node(request, ordinary.id)).title).toBe('Ordinary card renamed directly');
  await ordinaryCard.locator('.node-title').click();
  await page.keyboard.press('F2');
  await editor.fill('Rename saved by moving focus');
  await editor.press('Tab');
  await saved(page);
  expect((await node(request, ordinary.id)).title).toBe('Rename saved by moving focus');

  for (const value of [ordinary, triangle]) {
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    const card = page.locator(`[data-node-id="${value.id}"]`);
    await card.locator('.node-title').click();
    await page.getByLabel('Node background color', { exact: true }).fill('#f5e7cc');
    await saved(page);
    const changed = await node(request, value.id);
    expect(changed.backgroundColor).toBe('#f5e7cc');
    expect(changed.color).toBe(value.color);
    await expect(card).toHaveAttribute('data-node-background', '#f5e7cc');
    if (value.flowchartSymbol) {
      expect(
        await card
          .locator('.ibm-node-shape .ibm-symbol-outline')
          .evaluate((element) => [
            getComputedStyle(element).fill,
            getComputedStyle(element).stroke,
          ]),
      ).toEqual(['rgb(245, 231, 204)', 'rgb(52, 86, 120)']);
    }
  }
  await page.reload();
  await saved(page);
  expect((await node(request, ordinary.id)).title).toBe('Rename saved by moving focus');
  expect((await node(request, triangle.id)).backgroundColor).toBe('#f5e7cc');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator(`[data-node-id="${triangle.id}"] .node-title`).click();
  await page.getByRole('button', { name: 'Use theme background', exact: true }).click();
  await saved(page);
  expect(await node(request, triangle.id)).not.toHaveProperty('backgroundColor');
  expect((await node(request, triangle.id)).color).toBe(triangle.color);
});

test('IBM template, glyph selector and palette persist native editable symbols', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await expect(dialog.locator('.template-option')).toHaveCount(templateManifest.length);
  await expect(dialog.getByText('SD-WAN', { exact: false })).toHaveCount(0);
  await dialog.getByRole('button', { name: /Classic Flowcharting/ }).click();
  await dialog.getByLabel('New diagram name').fill('Editable IBM template');
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  let graph = await stored(
    request,
    diagrams.find((value: { name: string }) => value.name === 'Editable IBM template').id,
  );
  expect(graph.diagram.type).toBe('flowchart');
  expect(graph.nodes).toHaveLength(ibmSymbols.length + 8);
  expect(graph.edges).toHaveLength(8);
  expect(new Set(graph.nodes.map((value) => value.flowchartSymbol))).toEqual(
    new Set(ibmSymbols.map((value) => value.id)),
  );
  const process = graph.nodes.find(
    (value) => value.flowchartSymbol === 'ibm-process' && value.tags.includes('stencil-cutout'),
  )!;
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator(`[data-node-id="${process.id}"] .node-title`).click();
  const selector = page.getByLabel('IBM flowchart symbol', { exact: true });
  await selector.selectOption('ibm-magnetic-disk');
  await page.getByRole('button', { name: 'Use stencil proportions', exact: true }).click();
  await saved(page);
  let value = await node(request, process.id);
  expect(value.flowchartSymbol).toBe('ibm-magnetic-disk');
  expect(value.nodeType).toBe('process');
  expect(value.width).toBe(220);
  expect(value.height).toBe(270);
  await expect(
    page.locator(`[data-node-id="${process.id}"] .ibm-node-shape .ibm-symbol-detail`),
  ).toHaveCount(2);
  await page.reload();
  await saved(page);
  graph = await stored(request, graph.diagram.id);
  expect(graph.nodes.find((item) => item.id === process.id)?.flowchartSymbol).toBe(
    'ibm-magnetic-disk',
  );
  await page.locator(`[data-node-id="${process.id}"] .node-title`).click();
  await expect(selector).toHaveValue('ibm-magnetic-disk');
  await selector.selectOption('');
  await saved(page);
  value = await node(request, process.id);
  expect(value).not.toHaveProperty('flowchartSymbol');
  await expect(page.locator(`[data-node-id="${process.id}"] .ibm-node-shape`)).toHaveCount(0);
  await page.getByRole('button', { name: 'IBM symbols', exact: true }).click();
  await page.getByRole('button', { name: 'Add IBM Predefined Process', exact: true }).click();
  await saved(page);
  graph = await stored(request, graph.diagram.id);
  expect(graph.nodes).toHaveLength(ibmSymbols.length + 9);
  const added = graph.nodes.find(
    (item) => item.title === 'Predefined Process' && !item.metadata.ibmFlowchart,
  )!;
  expect(added.flowchartSymbol).toBe('ibm-predefined-process');
  expect(added.nodeType).toBe('process');
  await expect(
    page.locator(`[data-node-id="${added.id}"] .ibm-node-shape .ibm-symbol-detail`),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('HTTP and MCP discover the same catalog and validate versioned glyph edits', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/v1/flowchart/symbols');
  expect(response.status()).toBe(200);
  const catalog = await response.json();
  expect(catalog.map((value: { id: string }) => value.id)).toEqual(
    ibmSymbols.map((value) => value.id),
  );
  expect(catalog.filter((value: { physicalCutout: boolean }) => value.physicalCutout)).toHaveLength(
    26,
  );
  expect(catalog.filter((value: { category: string }) => value.category === 'symbol')).toHaveLength(
    32,
  );
  expect(catalog.filter((value: { category: string }) => value.category === 'legacy')).toHaveLength(
    5,
  );
  const initialized = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'IBM browser acceptance', version: '1' },
      },
    },
  });
  expect((await initialized.json()).result.protocolVersion).toBe('2025-06-18');
  expect((await mcp(request, '/flowchart/symbols')).body).toEqual(catalog);
  const stencilResponse = await request.get('/api/v1/flowchart/stencils');
  expect(stencilResponse.status()).toBe(200);
  const stencils = await stencilResponse.json();
  expect(stencils.map((value: { revision: string }) => value.revision)).toEqual([
    'GX20-8020',
    'GX20-8020-1',
    'GX20-8020-2',
  ]);
  expect(
    stencils.map(
      (value: { physicalCutoutSymbolIds: string[] }) => value.physicalCutoutSymbolIds.length,
    ),
  ).toEqual([25, 26, 26]);
  expect((await mcp(request, '/flowchart/stencils')).body).toEqual(stencils);
  const created = await mcp(request, '/diagrams', 'POST', {
    name: 'IBM through MCP',
    template: 'ibm-flowcharting',
  });
  expect(created.status).toBe(201);
  const graph = await stored(request, created.body.id);
  const original = graph.nodes.find((value) => value.flowchartSymbol === 'ibm-document')!;
  const invalid = await request.patch(`/api/v1/nodes/${original.id}`, {
    data: { version: original.version, flowchartSymbol: 'ibm-invented-symbol' },
  });
  expect(invalid.status()).toBe(422);
  expect(await node(request, original.id)).toEqual(original);
  const changed = await mcp(request, `/nodes/${original.id}`, 'PATCH', {
    version: original.version,
    flowchartSymbol: 'ibm-core',
  });
  expect(changed.status).toBe(200);
  expect(changed.body.flowchartSymbol).toBe('ibm-core');
  expect(changed.body.nodeType).toBe(original.nodeType);
  const removed = await request.patch(`/api/v1/nodes/${original.id}`, {
    data: { version: changed.body.version, flowchartSymbol: null },
  });
  expect(removed.status()).toBe(200);
  expect(await removed.json()).not.toHaveProperty('flowchartSymbol');
  let appearance = await node(request, original.id);
  const filled = await mcp(request, `/nodes/${original.id}`, 'PATCH', {
    version: appearance.version,
    title: 'Background set through MCP',
    backgroundColor: '#e8f5ee',
  });
  expect(filled.status).toBe(200);
  expect(filled.body.backgroundColor).toBe('#e8f5ee');
  expect(filled.body.color).toBe(original.color);
  expect(filled.body.title).toBe('Background set through MCP');
  appearance = await node(request, original.id);
  for (const invalidColor of ['red', '#fff', '#12345678', '', 123]) {
    const invalid = await request.patch(`/api/v1/nodes/${original.id}`, {
      data: {
        version: appearance.version,
        title: 'Invalid color must not rename this object',
        backgroundColor: invalidColor,
      },
    });
    expect(invalid.status()).toBe(422);
    expect(await node(request, original.id)).toEqual(appearance);
  }
  const preserved = await request.patch(`/api/v1/nodes/${original.id}`, {
    data: { version: appearance.version, title: 'Fill survives an ordinary title edit' },
  });
  expect(preserved.status()).toBe(200);
  appearance = await preserved.json();
  expect(appearance.backgroundColor).toBe('#e8f5ee');
  const cleared = await mcp(request, `/nodes/${original.id}`, 'PATCH', {
    version: appearance.version,
    backgroundColor: null,
  });
  expect(cleared.status).toBe(200);
  expect(cleared.body).not.toHaveProperty('backgroundColor');
  expect(cleared.body.color).toBe(original.color);
  expect(
    (
      await request.post('/api/v1/diagrams', {
        data: { name: 'Invalid IBM mode', template: 'ibm-flowcharting', mode: 'example' },
      })
    ).status(),
  ).toBe(422);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await request.get('/api/v1/flowchart/symbols')).status()).toBe(200);
  expect(
    (
      await request.post('/api/v1/diagrams', {
        data: { name: 'Denied IBM creation', template: 'ibm-flowcharting' },
      })
    ).status(),
  ).toBe(403);
});

test('readable IBM workflow keeps its actual glyph profiles in 2D and front/back 3D', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const graph = await batch(request, 'IBM batch processing');
  await open(page, graph.diagram.name);
  await assertContourConnections(page, request, graph);
  const disk = graph.nodes.find((value) => value.flowchartSymbol === 'ibm-magnetic-disk')!;
  await page.locator(`[data-node-id="${disk.id}"] .node-title`).click();
  await expect(page.getByLabel('IBM flowchart symbol', { exact: true })).toHaveValue(
    'ibm-magnetic-disk',
  );
  await page.getByLabel('IBM flowchart symbol', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  if (process.env.VN_CAPTURE_IBM === '1') await capture(page, 'ibm-flowcharting-2d');
  const svg = await request.post('/api/v1/export', {
    data: { diagramId: graph.diagram.id, format: 'svg' },
  });
  expect(svg.status()).toBe(200);
  const xml = await svg.json();
  const paths = await page.evaluate(
    ({ xml, id }) => {
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
      const shape = document.querySelector(`[data-node-id="${id}"] svg`);
      return Array.from(shape?.querySelectorAll('path') ?? []).map((path) =>
        path.getAttribute('d'),
      );
    },
    { xml, id: disk.id },
  );
  const diskSymbol = ibmSymbols.find((symbol) => symbol.id === 'ibm-magnetic-disk')!;
  expect(paths).toEqual([diskSymbol.outlinePath, ...diskSymbol.detailPaths]);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  const view = page.getByTestId('spatial-view'),
    canvas = page.getByTestId('spatial-canvas');
  await expect(view).toHaveAttribute('data-renderer', 'ready', { timeout: 30000 });
  await expect(canvas).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await page.getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true }).click();
  await page.getByRole('button', { name: 'Hide 3D help', exact: true }).click();
  await saved(page);
  const faces = async () =>
    JSON.parse((await canvas.getAttribute('data-face-projections')) || '[]') as {
      id: string;
      flowchartSymbol: string;
      side: string;
      depth: number;
      labelBillboard: boolean;
      source: string;
      center: [number, number];
      textCorners: [number, number][];
    }[];
  await expect
    .poll(async () => (await faces()).filter((face) => face.flowchartSymbol).length)
    .toBe(8);
  for (const face of await faces()) {
    expect(face.flowchartSymbol).toBe(
      graph.nodes.find((value) => value.id === face.id)?.flowchartSymbol,
    );
    expect(face.depth).toBeGreaterThan(0);
    expect(face.labelBillboard).toBe(false);
  }
  const bounds = (await canvas.boundingBox())!,
    diskFace = (await faces()).find((face) => face.id === disk.id)!;
  const beforeRename = await node(request, disk.id);
  await page.mouse.dblclick(bounds.x + diskFace.center[0], bounds.y + diskFace.center[1]);
  const spatialEditor = page.locator('.spatial-title-editor .node-title-input');
  await expect(spatialEditor).toBeFocused();
  await spatialEditor.fill('Store verified records in 3D');
  if (process.env.VN_CAPTURE_IBM === '1')
    await page.screenshot({ path: '/tmp/ibm-flowcharting-inline-rename-3d.png' });
  await spatialEditor.press('Enter');
  await saved(page);
  const renamed = await node(request, disk.id);
  expect(renamed.title).toBe('Store verified records in 3D');
  expect(renamed.version).toBeGreaterThan(beforeRename.version);
  expect(renamed.flowchartSymbol).toBe(beforeRename.flowchartSymbol);
  await page.keyboard.press('F2');
  await expect(spatialEditor).toBeFocused();
  await spatialEditor.fill('Discard this spatial draft');
  await spatialEditor.press('Escape');
  expect(await node(request, disk.id)).toEqual(renamed);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const afterUndo = (await faces()).find((face) => face.id === disk.id)!;
  await page.mouse.click(bounds.x + afterUndo.center[0], bounds.y + afterUndo.center[1]);
  await page.getByLabel('Node background color', { exact: true }).fill('#f5e7cc');
  await saved(page);
  const filled = await node(request, disk.id);
  expect(filled.backgroundColor).toBe('#f5e7cc');
  expect(filled.color).toBe(disk.color);
  expect(filled.flowchartSymbol).toBe(disk.flowchartSymbol);
  await page.getByRole('button', { name: 'Use theme background', exact: true }).click();
  await saved(page);
  const restored = await node(request, disk.id);
  expect(restored).not.toHaveProperty('backgroundColor');
  expect(restored.title).toBe(disk.title);
  const versionBeforeViewChange = restored.version;
  await page.getByLabel('IBM flowchart symbol', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Fit 3D diagram', exact: true }).click();
  await expect(
    page.getByText('Preparing the original node appearance…', { exact: true }),
  ).toBeHidden({ timeout: 30000 });
  if (process.env.VN_CAPTURE_IBM === '1') await capture(page, 'ibm-flowcharting-3d');
  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  await expect.poll(async () => (await faces()).every((face) => face.side === 'back')).toBe(true);
  await expect
    .poll(async () => (await faces()).every((face) => face.source === '2d-node'), {
      timeout: 30000,
    })
    .toBe(true);
  for (const face of await faces()) {
    expect(face.source).toBe('2d-node');
    expect(face.flowchartSymbol).toBe(
      graph.nodes.find((value) => value.id === face.id)?.flowchartSymbol,
    );
    expect(face.textCorners).toHaveLength(4);
    // The back raster is captured for a real back face: text still reads left to right.
    expect(face.textCorners[0][0]).toBeLessThan(face.textCorners[1][0]);
    expect(face.textCorners[0][1]).toBeLessThan(face.textCorners[3][1]);
  }
  await page.screenshot({ path: '/tmp/ibm-flowcharting-back.png' });
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await saved(page);
  expect((await node(request, disk.id)).version).toBe(versionBeforeViewChange);
  await expect(page.locator(`[data-node-id="${disk.id}"] .node-title`)).toHaveText(disk.title);
  expect(
    (await stored(request, graph.diagram.id)).nodes.map((value) => [
      value.id,
      value.flowchartSymbol,
    ]),
  ).toEqual(graph.nodes.map((value) => [value.id, value.flowchartSymbol]));
});

test.describe('390px touch properties', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('IBM symbol selector and proportions remain reachable and save on a phone', async ({
    page,
    request,
  }) => {
    test.setTimeout(180000);
    const graph = await batch(request, 'IBM on a phone');
    await page.getByRole('button', { name: 'Open projects', exact: true }).tap();
    await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).tap();
    await saved(page);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    const first = graph.nodes.find((value) => value.flowchartSymbol === 'ibm-terminal')!;
    const title = page.locator(`[data-node-id="${first.id}"] .node-title`);
    await expect(title).toBeVisible();
    await title.scrollIntoViewIfNeeded();
    const titleBounds = (await title.boundingBox())!,
      titleX = titleBounds.x + titleBounds.width / 2,
      titleY = titleBounds.y + titleBounds.height / 2;
    // Keep two real touch taps within the 350 ms gesture window without locator waits.
    await page.touchscreen.tap(titleX, titleY);
    await page.touchscreen.tap(titleX, titleY);
    const editor = page.locator('.node-title-input');
    await expect(editor).toBeFocused();
    await editor.fill('Begin phone batch');
    if (process.env.VN_CAPTURE_IBM === '1')
      await page.screenshot({ path: '/tmp/ibm-flowcharting-mobile-inline-rename.png' });
    await editor.press('Enter');
    await saved(page);
    expect((await node(request, first.id)).title).toBe('Begin phone batch');
    await page.getByRole('button', { name: 'Open properties', exact: true }).tap();
    const properties = page.getByRole('dialog', { name: 'Properties', exact: true });
    await expect(properties).toBeVisible();
    await properties
      .getByLabel('IBM flowchart symbol', { exact: true })
      .selectOption('ibm-display');
    await properties.getByRole('button', { name: 'Use stencil proportions', exact: true }).tap();
    await properties.getByLabel('Node background color', { exact: true }).fill('#d9edf5');
    await properties.getByLabel('IBM flowchart symbol', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/ibm-flowcharting-mobile-properties.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await properties.getByRole('button', { name: 'Close properties', exact: true }).tap();
    await saved(page);
    const value = await node(request, first.id);
    expect(value.flowchartSymbol).toBe('ibm-display');
    expect(value.nodeType).toBe('start');
    expect(value.backgroundColor).toBe('#d9edf5');
    await page.reload();
    await saved(page);
    expect((await node(request, first.id)).flowchartSymbol).toBe('ibm-display');
    expect((await node(request, first.id)).title).toBe('Begin phone batch');
    expect((await node(request, first.id)).backgroundColor).toBe('#d9edf5');
    await page.getByRole('button', { name: '3D view', exact: true }).tap();
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
      timeout: 30000,
    });
    const canvas = page.getByTestId('spatial-canvas');
    await expect(canvas).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
    await page.getByRole('button', { name: '3D tools', exact: true }).tap();
    await page.getByRole('button', { name: 'Move objects', exact: true }).tap();
    const bounds = (await canvas.boundingBox())!;
    await expect
      .poll(
        async () => JSON.parse((await canvas.getAttribute('data-face-projections')) || '[]').length,
      )
      .toBe(8);
    const faces = JSON.parse((await canvas.getAttribute('data-face-projections')) || '[]') as {
      id: string;
      center: [number, number];
    }[];
    // Pick a genuinely visible face rather than tapping through a mobile HUD panel.
    const reachable = await page.evaluate(
      ({ faces, bounds }) =>
        faces.find((face) => {
          const x = bounds.x + face.center[0],
            y = bounds.y + face.center[1];
          return (
            x >= bounds.x &&
            y >= bounds.y &&
            x < bounds.x + bounds.width &&
            y < bounds.y + bounds.height &&
            document.elementFromPoint(x, y) ===
              document.querySelector('[data-testid="spatial-canvas"]')
          );
        }),
      { faces, bounds },
    );
    expect(reachable).toBeDefined();
    const before = await node(request, reachable!.id);
    await page.touchscreen.tap(bounds.x + reachable!.center[0], bounds.y + reachable!.center[1]);
    await page.touchscreen.tap(bounds.x + reachable!.center[0], bounds.y + reachable!.center[1]);
    const spatialEditor = page.locator('.spatial-title-editor .node-title-input');
    await expect(spatialEditor).toBeFocused();
    await spatialEditor.fill('Renamed by touch in Move objects');
    await spatialEditor.press('Enter');
    await saved(page);
    const renamed = await node(request, reachable!.id);
    expect(renamed.title).toBe('Renamed by touch in Move objects');
    expect(renamed.metadata.spatial).toEqual(before.metadata.spatial);
    expect([renamed.x, renamed.y]).toEqual([before.x, before.y]);
    const version = renamed.version;
    await page.getByRole('button', { name: '2D view', exact: true }).tap();
    await saved(page);
    expect((await node(request, reachable!.id)).version).toBe(version);
  });
});
