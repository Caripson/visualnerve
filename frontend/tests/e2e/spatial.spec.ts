import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { blankGraph, newEdge, newNode, type Graph } from '../../src/model/types';
import { getSpatialView } from '../../src/spatial/types';
import { spatialPositions } from '../../src/spatial/layout';
import { browserLaunchOptions } from '../../playwright.config';

// Keep GPU-less WebGL testing local to these cases; ordinary editor tests use their normal driver.
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

async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function stored(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function ready(page: Page) {
  // A fresh headless WebGL context can compile shaders after a reload.
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(page.getByTestId('spatial-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '3D view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}
async function create(request: APIRequestContext, name: string, type?: Graph['diagram']['type']) {
  const response = await request.post('/api/v1/spatial-diagrams', {
    data: { name, ...(type ? { type } : {}) },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Graph>;
}
async function mcp(
  request: APIRequestContext,
  id: number,
  path: string,
  method: string,
  data: unknown,
  status: number,
) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'visual_nerve_request', arguments: { path, method, data } },
    },
  });
  const result = (await response.json()).result;
  expect(result.isError).toBe(false);
  expect(result.structuredContent.status).toBe(status);
  return result.structuredContent.body as Graph;
}
function exampleGraph(name: string): Graph {
  const graph = blankGraph(name, 'mindmap');
  const root = newNode(graph.diagram.id, {
    title: 'Project',
    x: 40,
    y: 230,
    width: 220,
    height: 110,
    color: '#d7e7ec',
    metadata: { spatial: { version: 1, position: { x: 0, y: 0, z: 0 } } },
  });
  graph.nodes.push(root);
  const topics = ['Discovery', 'Design', 'Implementation', 'Review', 'Launch', 'Next steps'];
  for (const [index, title] of topics.entries()) {
    const node = newNode(graph.diagram.id, {
      title,
      parentId: root.id,
      x: 390 + Math.floor(index / 3) * 380,
      y: 40 + (index % 3) * 200,
      width: 300,
      height: 130,
      color: ['#5c9fe5', '#e6b74f', '#79ba8b', '#b793dc', '#e29077', '#71bdbd'][index],
      status: index < 2 ? 'done' : undefined,
      metadata: {
        spatial: {
          version: 1,
          position: {
            x: Math.cos((index * Math.PI) / 3) * 3,
            y: Math.sin((index * Math.PI) / 3) * 2,
            z: index % 2 ? 1.2 : -1.2,
          },
        },
      },
    });
    graph.nodes.push(node);
    graph.edges.push(
      newEdge(graph.diagram.id, root.id, node.id, {
        edgeType: 'hierarchy',
        label: 'work area',
        direction: 'none',
      }),
    );
  }
  return graph;
}
async function populateExample(
  request: APIRequestContext,
  initial: Graph,
  throughMcp = false,
): Promise<Graph> {
  const source = exampleGraph(initial.diagram.name);
  const external = new Map(source.nodes.map((node, index) => [node.id, `example:${index}`]));
  const data = {
    nodes: source.nodes.map((node) => ({
      externalId: external.get(node.id),
      parentExternalId: node.parentId ? external.get(node.parentId) : undefined,
      title: node.title,
      description: node.description,
      notes: node.notes,
      nodeType: node.nodeType,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      color: node.color,
      status: node.status,
      metadata: node.metadata,
    })),
    edges: source.edges.map((edge) => ({
      sourceExternalId: external.get(edge.sourceNodeId),
      targetExternalId: external.get(edge.targetNodeId),
      label: edge.label,
      edgeType: edge.edgeType,
      direction: edge.direction,
    })),
  };
  if (throughMcp) await mcp(request, 3, `/diagrams/${initial.diagram.id}/bulk`, 'POST', data, 200);
  else
    expect((await request.post(`/api/v1/diagrams/${initial.diagram.id}/bulk`, { data })).ok()).toBe(
      true,
    );
  return stored(request, initial.diagram.id);
}
async function createExampleThroughMcp(request: APIRequestContext, name: string): Promise<Graph> {
  const initialized = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Spatial browser test', version: '1' },
      },
    },
  });
  expect((await initialized.json()).result.protocolVersion).toBe('2025-06-18');
  const initial = await mcp(request, 2, '/spatial-diagrams', 'POST', { name }, 201);
  expect(initial.diagram.type).toBe('mindmap');
  expect(initial.nodes).toEqual([]);
  expect(initial.edges).toEqual([]);
  expect(getSpatialView(initial)).toEqual({ version: 1, mode: '3d' });
  return populateExample(request, initial, true);
}
function geometry(graph: Graph) {
  return graph.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
}
function canonicalRecords<T extends { id: string }>(records: T[]): T[] {
  // JSON API payloads omit undefined fields and order records canonically;
  // IndexedDB's index traversal instead orders equal keys by primary ID.
  const values = JSON.parse(JSON.stringify(records)) as T[];
  return values.sort((a, b) => a.id.localeCompare(b.id));
}
async function objects(page: Page) {
  const summary = page.locator('.spatial-object-list > summary');
  if (
    !(await page
      .getByRole('button', { name: /^Select object / })
      .first()
      .isVisible())
  )
    await summary.click();
}
async function exportFile(
  page: Page,
  format: 'json' | 'png' | 'pdf' | 'workspace',
  scope = 'complete',
) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export diagram', exact: true });
  if (format === 'workspace')
    await page.getByLabel('Export target', { exact: true }).selectOption('workspace');
  else {
    await dialog.getByLabel('Export format', { exact: true }).selectOption(format);
    if (format !== 'json') {
      await expect(dialog).toContainText('PNG and PDF use the 2D diagram');
      await dialog.getByLabel('Export area', { exact: true }).selectOption(scope);
      await dialog.getByLabel('Export resolution', { exact: true }).selectOption('1');
      if (scope === 'viewport')
        await expect(dialog.getByLabel('Export area').locator('option:checked')).toHaveText(
          'Saved 2D viewport',
        );
    }
  }
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: format === 'workspace' ? 'Export all data' : 'Export',
      exact: true,
    })
    .click();
  const result = await pending;
  const buffer = await readFile((await result.path())!);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return buffer;
}
async function pixels(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let magenta = 0,
      colorful = 0,
      transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 255) transparent++;
      if (data[i] > 220 && data[i + 1] < 80 && data[i + 2] > 110) magenta++;
      if (
        Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) >
        40
      )
        colorful++;
    }
    return { width: image.width, height: image.height, magenta, colorful, transparent };
  }, png.toString('base64'));
}
async function databaseGraph(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visual-nerve-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    try {
      const tx = db.transaction(['diagrams', 'nodes', 'edges'], 'readonly');
      const [diagram, nodes, edges] = await Promise.all([
        read(tx.objectStore('diagrams').get(id)),
        read(tx.objectStore('nodes').index('diagramId').getAll(id)),
        read(tx.objectStore('edges').index('diagramId').getAll(id)),
      ]);
      return { diagram, nodes, edges };
    } finally {
      db.close();
    }
  }, id);
}

test('rotates and saves a real 3D camera while object edits, statuses and relationships retain independent 2D geometry', async ({
  page,
  request,
}, testInfo) => {
  const initial = await create(request, 'Spatial release plan', 'process');
  const response = await request.post(`/api/v1/diagrams/${initial.diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'plan',
          title: 'Plan release',
          x: 100,
          y: 180,
          width: 240,
          height: 110,
          color: '#5c9fe5',
          metadata: { spatial: { version: 1, position: { x: -2, y: 0, z: 0 } } },
        },
        {
          externalId: 'ship',
          title: 'Ship release',
          x: 480,
          y: 180,
          width: 240,
          height: 110,
          color: '#79ba8b',
          metadata: { spatial: { version: 1, position: { x: 2, y: 0, z: 1 } } },
        },
      ],
      edges: [
        {
          sourceExternalId: 'plan',
          targetExternalId: 'ship',
          label: 'Ready for release',
          direction: 'forward',
          metadata: { manual: true },
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const before = await stored(request, initial.diagram.id);
  await ready(page);
  await saved(page);
  const canvas = page.getByTestId('spatial-canvas');
  const originalCamera = await canvas.getAttribute('data-camera-position');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.82, bounds.y + bounds.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.67, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(() => canvas.getAttribute('data-camera-position')).not.toBe(originalCamera);
  await saved(page);
  await expect
    .poll(async () => getSpatialView(await stored(request, initial.diagram.id)).camera?.position)
    .toBeDefined();
  const rotated = getSpatialView(await stored(request, initial.diagram.id)).camera!;
  await page.reload();
  await ready(page);
  await saved(page);
  const reloaded = JSON.parse((await canvas.getAttribute('data-camera-position'))!);
  for (const coordinate of ['x', 'y', 'z'] as const)
    expect(reloaded[coordinate]).toBeCloseTo(rotated.position[coordinate], 3);
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await saved(page);
  await objects(page);
  await page.getByRole('button', { name: 'Select object Plan release', exact: true }).click();
  await page.getByLabel('Node title', { exact: true }).fill('Reviewed release plan');
  await saved(page);
  await page.getByLabel('Node status', { exact: true }).selectOption('done');
  await saved(page);
  await expect(
    page.getByRole('button', { name: 'Select object Reviewed release plan', exact: true }),
  ).toHaveAttribute('data-node-status', 'done');
  await page
    .locator('.spatial-object-list')
    .getByText(/^Relationships \(\d+\)$/)
    .click();
  await page
    .getByRole('button', {
      name: 'Select relationship Ready for release from Reviewed release plan to Ship release',
      exact: true,
    })
    .click();
  await page.getByLabel('Connection direction', { exact: true }).selectOption('both');
  await saved(page);
  const edited = await stored(request, initial.diagram.id);
  expect(geometry(edited)).toEqual(geometry(before));
  expect(edited.nodes.find((node) => node.externalId === 'plan')).toMatchObject({
    title: 'Reviewed release plan',
    status: 'done',
    metadata: before.nodes.find((node) => node.externalId === 'plan')!.metadata,
  });
  expect(edited.edges[0]).toMatchObject({
    id: before.edges[0].id,
    direction: 'both',
    metadata: { manual: true },
  });
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
  await expect(
    page.locator('.canvas-shell [data-node-id]').filter({ hasText: 'Reviewed release plan' }),
  ).toContainText('Done');
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await ready(page);
  await saved(page);
  expect(geometry(await stored(request, initial.diagram.id))).toEqual(geometry(before));
  await page.screenshot({ path: '/tmp/visualnerve-3d-diagram.png' });
  await testInfo.attach('3d-release-plan.png', {
    path: '/tmp/visualnerve-3d-diagram.png',
    contentType: 'image/png',
  });
  await page.getByLabel('Data tools', { exact: true }).click();
  await page.getByRole('button', { name: 'New 3D truck lifecycle example', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Fit 3D diagram', exact: true }).click();
  await saved(page);
  await expect(page.locator('.canvas-statusbar').last()).toContainText('25 nodes');
  await expect(page.locator('.canvas-statusbar').last()).toContainText('24 connections');
  await objects(page);
  for (const stage of [
    'Truck lifecycle',
    'Manufacturing',
    'Delivery',
    'Operation',
    'Maintenance',
    'Second life',
    'Recycling',
  ])
    await expect(
      page.getByRole('button', { name: `Select object ${stage}`, exact: true }),
    ).toBeVisible();
  await page.locator('.spatial-object-list > summary').click();
  await page.screenshot({ path: '/tmp/visualnerve-3d-truck-lifecycle.png' });
  await testInfo.attach('truck-lifecycle-3d.png', {
    path: '/tmp/visualnerve-3d-truck-lifecycle.png',
    contentType: 'image/png',
  });
});

test('MCP creates and populates a 3D mind map whose objects export nonblank 2D PNG/PDF and survive JSON import', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const source = await createExampleThroughMcp(request, '3D project export proof');
  expect(source.nodes).toHaveLength(7);
  expect(source.edges).toHaveLength(6);
  const root = source.nodes.find((node) => node.title === 'Project')!;
  const strokeId = crypto.randomUUID();
  await ready(page);
  await page.getByRole('button', { name: 'Fit 3D diagram', exact: true }).click();
  await saved(page);
  const current = await stored(request, source.diagram.id);
  const patch = await request.patch(`/api/v1/diagrams/${source.diagram.id}`, {
    data: {
      version: current.diagram.version,
      settings: {
        ...current.diagram.settings,
        viewport: { x: 20, y: 20, zoom: 0.75 },
        viewportDevice: 'desktop',
        drawing: {
          version: 1,
          visible: true,
          strokes: [
            {
              id: strokeId,
              color: '#ff00aa',
              width: 10,
              points: [
                [80, 270],
                [220, 270],
              ],
            },
          ],
        },
      },
    },
  });
  expect(patch.ok()).toBe(true);
  await ready(page);
  await saved(page);
  await expect(page.locator('.canvas-shell .react-flow')).toHaveCount(0);
  const rendered = await pixels(page, await page.getByTestId('spatial-canvas').screenshot());
  expect(rendered.colorful).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  await saved(page);
  const backCamera = getSpatialView(await stored(request, source.diagram.id)).camera!;
  expect(backCamera.position.z).toBeLessThan(backCamera.target.z);
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await saved(page);
  // Project a known ordinary object's position through the public front-view camera,
  // then select its visible object via the real WebGL pointer/raycast path.
  const position = (root.metadata.spatial as { position: { x: number; y: number; z: number } })
    .position;
  const point = await page.getByTestId('spatial-canvas').evaluate((canvas, position) => {
    const box = canvas.getBoundingClientRect();
    const camera = JSON.parse((canvas as HTMLElement).dataset.cameraPosition!);
    const target = JSON.parse((canvas as HTMLElement).dataset.cameraTarget!);
    const halfHeight = (camera.z - position.z) * Math.tan((42 * Math.PI) / 360);
    return {
      x:
        box.x +
        (((position.x - target.x) / (halfHeight * (box.width / box.height)) + 1) * box.width) / 2,
      y: box.y + ((1 - (position.y - target.y) / halfHeight) * box.height) / 2,
    };
  }, position);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Node title', { exact: true })).toHaveValue('Project');
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Keep this project explanation in both views.');
  await saved(page);
  for (const scope of ['complete', 'selected', 'viewport']) {
    const png = await exportFile(page, 'png', scope);
    const image = await pixels(page, png);
    expect(image.magenta).toBeGreaterThan(100);
    expect(image.colorful).toBeGreaterThan(1000);
    expect(image.transparent).toBe(0);
    await testInfo.attach(`mindmap-${scope}-2d.png`, { body: png, contentType: 'image/png' });
    if (scope === 'complete') await writeFile('/tmp/visualnerve-3d-mindmap-2d-export.png', png);
  }
  const pdf = await exportFile(page, 'pdf');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  const json = await exportFile(page, 'json');
  const exported = JSON.parse(json.toString()) as Graph;
  expect(exported.nodes.map((node) => node.metadata.spatial)).toEqual(
    source.nodes.map((node) => node.metadata.spatial),
  );
  expect(exported.diagram.settings.drawing?.strokes[0].id).toBe(strokeId);
  expect(exported.nodes.find((node) => node.id === root.id)?.notes).toBe(
    'Keep this project explanation in both views.',
  );
  await page
    .getByLabel('Import file', { exact: true })
    .setInputFiles({ name: 'mindmap-roundtrip.json', mimeType: 'application/json', buffer: json });
  await ready(page);
  await saved(page);
  const imported = JSON.parse((await exportFile(page, 'json')).toString()) as Graph;
  expect(imported.diagram.id).not.toBe(exported.diagram.id);
  const meanings = (graph: Graph) =>
    graph.nodes
      .map(({ title, x, y, notes, status, metadata }) => ({ title, x, y, notes, status, metadata }))
      .sort((a, b) => a.title.localeCompare(b.title));
  expect(meanings(imported)).toEqual(meanings(exported));
  const relationships = (graph: Graph) => {
    const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
    return graph.edges
      .map((edge) => ({
        source: titles.get(edge.sourceNodeId),
        target: titles.get(edge.targetNodeId),
        label: edge.label,
        direction: edge.direction,
        edgeType: edge.edgeType,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  expect(relationships(imported)).toEqual(relationships(exported));
  await page.screenshot({ path: '/tmp/visualnerve-3d-mindmap.png' });
  await testInfo.attach('mindmap-3d.png', {
    path: '/tmp/visualnerve-3d-mindmap.png',
    contentType: 'image/png',
  });
});

test('3D mind map objects, camera and relationships survive offline reload and full backup restore without a remote upload', async ({
  page,
  request,
  context,
}) => {
  const source = await populateExample(request, await create(request, 'Offline spatial mind map'));
  await ready(page);
  await page.getByRole('button', { name: 'Left view', exact: true }).click();
  await saved(page);
  const before = await stored(request, source.diagram.id);
  const backup = await exportFile(page, 'workspace');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await saved(page);
  const offline = await databaseGraph(page, source.diagram.id);
  expect(offline.diagram.settings.spatialView).toEqual(before.diagram.settings.spatialView);
  expect(canonicalRecords(offline.nodes)).toEqual(canonicalRecords(before.nodes));
  expect(canonicalRecords(offline.edges)).toEqual(canonicalRecords(before.edges));
  await page.getByRole('button', { name: 'Delete diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await page
    .getByLabel('Import file', { exact: true })
    .setInputFiles({ name: 'spatial-backup.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await ready(page);
  await saved(page);
  const restored = await databaseGraph(page, source.diagram.id);
  expect(restored.diagram.settings.spatialView).toEqual(before.diagram.settings.spatialView);
  expect(canonicalRecords(restored.nodes)).toEqual(canonicalRecords(before.nodes));
  expect(canonicalRecords(restored.edges)).toEqual(canonicalRecords(before.edges));
});

test.describe('phone without WebGL', () => {
  test.use({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true });
  test('offers a clickable Return to 2D and a usable mind map example at 320px without losing graph data', async ({
    page,
    request,
  }) => {
    await create(request, 'Phone fallback seed');
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return original.call(this, type as '2d', ...args);
      } as typeof original;
    });
    await page.reload();
    await page.getByLabel('More tools', { exact: true }).click();
    await page.getByRole('button', { name: 'New 3D truck lifecycle example', exact: true }).click();
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'unavailable');
    const button = page.locator('.spatial-return');
    await expect(button).toBeInViewport({ ratio: 0.999 });
    expect(
      await button.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await button.click();
    await saved(page);
    await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
    await expect(page.getByRole('button', { name: '2D view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(
      page.locator('.canvas-shell [data-node-id]').filter({ hasText: 'Recycling' }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/visualnerve-3d-phone-fallback.png' });
  });
});

test.describe('interrupted 3D module download', () => {
  // Let the route exercise a real failed lazy import rather than a cached offline response.
  test.use({ serviceWorkers: 'block' });
  test('returns to the complete saved 2D truck diagram when the 3D module cannot be loaded', async ({
    page,
    request,
  }) => {
    const seed = blankGraph('Open the existing 2D workspace');
    seed.nodes.push(newNode(seed.diagram.id, { title: 'Keep using 2D' }));
    await page.getByLabel('Import file', { exact: true }).setInputFiles({
      name: '2d-workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(seed)),
    });
    await saved(page);
    await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
    let aborted = 0;
    await page.route('**/assets/SpatialCanvas-*.js', async (route) => {
      aborted++;
      await route.abort('failed');
    });
    await page.getByLabel('Data tools', { exact: true }).click();
    await page.getByRole('button', { name: 'New 3D truck lifecycle example', exact: true }).click();
    const failure = page.locator('.canvas-shell').getByRole('status');
    await expect(failure).toContainText('The 3D view could not be loaded');
    expect(aborted).toBeGreaterThan(0);
    await expect(page.getByTestId('spatial-canvas')).toHaveCount(0);
    await saved(page);
    const diagrams = (await (await request.get('/api/v1/diagrams')).json()) as Graph['diagram'][];
    const diagram = diagrams.find((entry) => entry.name === 'Truck lifecycle')!;
    expect(diagram).toBeDefined();
    const before = await stored(request, diagram.id);
    expect(before.nodes).toHaveLength(25);
    expect(before.edges).toHaveLength(24);
    expect(getSpatialView(before).mode).toBe('3d');
    const returnButton = page.getByRole('button', { name: 'Return to 2D', exact: true });
    await expect(returnButton).toBeInViewport({ ratio: 0.999 });
    await returnButton.click();
    await saved(page);
    await expect(page.getByText('The 3D view could not be loaded', { exact: false })).toHaveCount(
      0,
    );
    await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
    await expect(page.getByRole('button', { name: '2D view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(page.locator('.canvas-statusbar').last()).toContainText('25 nodes');
    await expect(page.locator('.canvas-statusbar').last()).toContainText('24 connections');
    await expect(
      page.locator('.canvas-shell [data-node-id]').filter({ hasText: 'Recycling' }),
    ).toBeVisible();
    await saved(page);
    const after = await stored(request, diagram.id);
    expect(getSpatialView(after).mode).toBe('2d');
    expect(canonicalRecords(after.nodes)).toEqual(canonicalRecords(before.nodes));
    expect(canonicalRecords(after.edges)).toEqual(canonicalRecords(before.edges));
    await page.reload();
    await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
    await expect(page.getByRole('button', { name: '2D view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.canvas-statusbar').last()).toContainText('25 nodes');
    await expect(page.locator('.canvas-statusbar').last()).toContainText('24 connections');
  });
});

test('keeps 2,501 ordinary mind map objects and 2,500 links interactive in a complete automatically placed WebGL view', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const initial = await create(request, 'Large truck lifecycle review');
  const nodes: Record<string, unknown>[] = [
    { externalId: 'root', title: 'Truck lifecycle review', x: 40, y: 230, width: 220, height: 110 },
  ];
  const edges: Record<string, unknown>[] = [];
  const stages = [
    'Manufacturing',
    'Delivery',
    'Operation',
    'Maintenance',
    'Second life',
    'Recycling',
  ];
  for (const [index, title] of stages.entries()) {
    nodes.push({
      externalId: `stage-${index}`,
      parentExternalId: 'root',
      title,
      x: index < 3 ? -320 : 400,
      y: (index % 3) * 900,
      width: 240,
      height: 100,
    });
    edges.push({
      sourceExternalId: 'root',
      targetExternalId: `stage-${index}`,
      edgeType: 'hierarchy',
      label: 'lifecycle stage',
      direction: 'none',
    });
  }
  for (let index = 0; index < 2494; index++) {
    const stage = index % stages.length,
      row = Math.floor(index / stages.length);
    nodes.push({
      externalId: `check-${index + 1}`,
      parentExternalId: `stage-${stage}`,
      title: `Truck check ${index + 1}`,
      x: stage < 3 ? -660 - (row % 7) * 250 : 740 + (row % 7) * 250,
      y: (stage % 3) * 900 + Math.floor(row / 7) * 95,
      width: 210,
      height: 70,
      notes: index === 2493 ? 'The last inspection remains editable.' : undefined,
    });
    edges.push({
      sourceExternalId: `stage-${stage}`,
      targetExternalId: `check-${index + 1}`,
      edgeType: 'hierarchy',
      label: 'inspection topic',
      direction: 'none',
    });
  }
  const started = Date.now();
  const response = await request.post(`/api/v1/diagrams/${initial.diagram.id}/bulk`, {
    data: { nodes, edges },
  });
  expect(response.ok()).toBe(true);
  const before = await stored(request, initial.diagram.id);
  expect(before.nodes).toHaveLength(2501);
  expect(before.edges).toHaveLength(2500);
  expect(before.nodes.every((node) => node.metadata.spatial === undefined)).toBe(true);
  await ready(page);
  await page.getByRole('button', { name: 'Fit 3D diagram', exact: true }).click();
  await saved(page);
  const view = page.getByTestId('spatial-view');
  await expect(view).toHaveAttribute('data-rendered-nodes', '2501');
  await expect(view).toHaveAttribute('data-rendered-edges', '2500');
  const canvas = page.getByTestId('spatial-canvas');
  const cameraBefore = await canvas.getAttribute('data-camera-position');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.67, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => canvas.getAttribute('data-camera-position')).not.toBe(cameraBefore);
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await saved(page);
  let camera = getSpatialView(await stored(request, initial.diagram.id)).camera!;
  expect(camera.position.z).toBeGreaterThan(camera.target.z);
  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  await saved(page);
  camera = getSpatialView(await stored(request, initial.diagram.id)).camera!;
  expect(camera.position.z).toBeLessThan(camera.target.z);
  // Let the requested Back frame update label visibility before checking its result.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect
    .poll(async () => Number((await canvas.getAttribute('data-visible-labels')) ?? 0))
    .toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/visualnerve-3d-2501-mindmap.png' });
  await objects(page);
  await page.getByLabel('Find a 3D object', { exact: true }).fill('Truck check 2494');
  await page.getByRole('button', { name: 'Select object Truck check 2494', exact: true }).click();
  await expect(page.getByLabel('Node title', { exact: true })).toHaveValue('Truck check 2494');
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'The last inspection remains editable.',
  );
  await page.getByRole('button', { name: 'Focus selected object', exact: true }).click();
  await saved(page);
  const last = before.nodes.find((node) => node.externalId === 'check-2494')!;
  const expected = spatialPositions(before).get(last.id)!;
  expect(Object.values(expected).every(Number.isFinite)).toBe(true);
  const rounded = {
    x: Number(expected.x.toFixed(5)),
    y: Number(expected.y.toFixed(5)),
    z: Number(expected.z.toFixed(5)),
  };
  await expect
    .poll(async () => JSON.parse((await canvas.getAttribute('data-camera-target'))!))
    .toEqual(rounded);
  await expect(view).toHaveAttribute('data-rendered-nodes', '2501');
  await expect(view).toHaveAttribute('data-rendered-edges', '2500');
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await saved(page);
  await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
  await expect(page.locator('.canvas-statusbar').last()).toContainText('2501 nodes');
  await expect(page.locator('.canvas-statusbar').last()).toContainText('2500 connections');
  const after = await stored(request, initial.diagram.id);
  expect(geometry(after)).toEqual(geometry(before));
  expect(canonicalRecords(after.edges)).toEqual(canonicalRecords(before.edges));
  expect(after.nodes.every((node) => node.metadata.spatial === undefined)).toBe(true);
  await testInfo.attach('large-mindmap-3d.png', {
    path: '/tmp/visualnerve-3d-2501-mindmap.png',
    contentType: 'image/png',
  });
  await testInfo.attach('large-mindmap-interaction.json', {
    body: Buffer.from(
      JSON.stringify({ nodes: 2501, edges: 2500, elapsedMs: Date.now() - started }),
    ),
    contentType: 'application/json',
  });
});
