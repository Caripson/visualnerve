import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import type { DrawingLayer, Graph } from '../../src/model/types';
import type { WorkspaceBackup } from '../../src/storage/database';

type Point = [number, number];
const magenta = '#ff00aa';
const blue = '#2563eb';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function readGraph(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
const drawing = (graph: Graph): DrawingLayer => graph.diagram.settings.drawing!;
const shape = (page: Page, id: string) =>
  page.getByTestId('drawing-layer').locator(`[data-drawing-stroke-id="${id}"]`);

// Compare the existing graph independently of diagram revisions and viewport saves.
function graphContent(graph: Graph) {
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  return {
    nodes: graph.nodes.map(({ title, x, y, width, height, metadata }) => ({
      title,
      x,
      y,
      width,
      height,
      metadata,
    })),
    edges: graph.edges.map(({ sourceNodeId, targetNodeId, label, direction, style, metadata }) => ({
      source: titles.get(sourceNodeId),
      target: titles.get(targetNodeId),
      label,
      direction,
      style,
      metadata,
    })),
  };
}

async function open(page: Page, name: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.getByRole('button', { name: 'Open projects', exact: true }).click();
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
  await viewSettled(page);
}
async function viewSettled(page: Page) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const current = (await page
          .locator('.canvas-shell .react-flow__viewport')
          .getAttribute('style'))!;
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [100] },
    )
    .toBe(true);
}
async function screenPoints(page: Page, points: Point[]) {
  return page.evaluate((points) => {
    const flow = document.querySelector<HTMLElement>('.canvas-shell .react-flow')!;
    const viewport = flow.querySelector<HTMLElement>('.react-flow__viewport')!;
    const rect = flow.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return points.map(([x, y]) => ({
      x: rect.left + matrix.e + x * matrix.a,
      y: rect.top + matrix.f + y * matrix.d,
    }));
  }, points);
}
async function drawMouse(page: Page, points: Point[]) {
  await expect(page.getByTestId('drawing-surface')).toBeVisible();
  const screen = await screenPoints(page, points);
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for (const point of screen.slice(1)) await page.mouse.move(point.x, point.y, { steps: 5 });
  await page.mouse.up();
  await saved(page);
}
async function setPen(page: Page, color: string, width: string) {
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  // Native color dialogs cannot be filled by Playwright. Dispatch the same input/change
  // events as that dialog, without accessing editor state or the drawing implementation.
  await page.getByLabel('Drawing color', { exact: true }).evaluate((input, color) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
  await expect(page.getByLabel('Drawing color', { exact: true })).toHaveValue(color);
  await page.getByLabel('Drawing width', { exact: true }).focus();
  await page.getByLabel('Drawing width', { exact: true }).selectOption(width);
}
async function finishDrawing(page: Page) {
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  await expect(page.getByTestId('drawing-surface')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Draw on diagram', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
}
async function download(
  page: Page,
  format: 'json' | 'png' | 'pdf' | 'workspace',
  scope = 'complete',
) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  if (format === 'workspace') await page.getByLabel('Export target').selectOption('workspace');
  else {
    await page.getByLabel('Export format').selectOption(format);
    if (format !== 'json') {
      await page.getByLabel('Export area', { exact: true }).selectOption(scope);
      await page.getByLabel('Export resolution').selectOption('1');
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
async function magentaPixels(page: Page, png: Buffer, around?: { x: number; y: number }) {
  return (await imagePixels(page, png, around)).magenta;
}
async function imagePixels(page: Page, png: Buffer, around?: { x: number; y: number }) {
  return page.evaluate(
    async ({ data, around }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const x = around ? Math.max(0, Math.round(around.x) - 5) : 0;
      const y = around ? Math.max(0, Math.round(around.y) - 5) : 0;
      const rgba = context.getImageData(
        x,
        y,
        around ? 11 : image.width,
        around ? 11 : image.height,
      ).data;
      let count = 0;
      let opaque = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 255) opaque++;
        if (
          rgba[i] > 240 &&
          rgba[i + 1] < 40 &&
          rgba[i + 2] > 140 &&
          rgba[i + 2] < 200 &&
          rgba[i + 3] > 200
        )
          count++;
      }
      return { magenta: count, opaque };
    },
    { data: png.toString('base64'), around },
  );
}

async function seed(request: APIRequestContext, name: string, mobile = false) {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name,
        type: 'flowchart',
        settings: {
          viewport: { x: mobile ? 20 : 40, y: 60, zoom: mobile ? 0.65 : 1 },
          viewportDevice: mobile ? 'touch' : 'desktop',
        },
      },
    })
  ).json();
  return (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          {
            title: 'Source',
            externalId: 'source',
            x: 70,
            y: 90,
            width: 180,
            height: 90,
            metadata: { source: 'preserve' },
          },
          { title: 'Review', externalId: 'review', x: 420, y: 160, width: 180, height: 90 },
          {
            title: 'Delivery',
            externalId: 'delivery',
            x: mobile ? 180 : 420,
            y: 350,
            width: 180,
            height: 90,
          },
        ],
        edges: [
          {
            sourceExternalId: 'source',
            targetExternalId: 'review',
            label: 'Review relation',
            direction: 'both',
            style: 'dashed',
            metadata: { relation: 'preserve' },
          },
        ],
      },
    })
  ).json()) as Graph;
}

test('drawing covers the graph, follows zoom and pan, and survives history, storage and exports', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const original = await seed(request, 'Annotated workflow');
  await writeFile('/tmp/visualnerve-drawing-original.json', JSON.stringify(original, null, 2));
  const originalPath = testInfo.outputPath('original-graph.json');
  await writeFile(originalPath, JSON.stringify(original, null, 2));
  await testInfo.attach('original-graph', { path: originalPath, contentType: 'application/json' });
  const id = original.diagram.id;
  const content = graphContent(original);
  await open(page, original.diagram.name);
  const crossing = (await page
    .locator(`.react-flow__edge[data-id="${original.edges[0].id}"] .react-flow__edge-path`)
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      return [point.x, point.y];
    })) as Point;
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw on diagram', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await setPen(page, magenta, '8');
  const points: Point[] = [[90, 125], [190, 125], [275, 155], crossing, [365, 185], [525, 205]];
  await drawMouse(page, points);
  let graph = await readGraph(request, id);
  expect(graphContent(graph)).toEqual(content);
  expect(graph.nodes.map((node) => node.id)).toEqual(original.nodes.map((node) => node.id));
  expect(graph.edges.map((edge) => edge.id)).toEqual(original.edges.map((edge) => edge.id));
  expect(drawing(graph).strokes).toHaveLength(1);
  const first = drawing(graph).strokes[0];
  expect(first).toMatchObject({ color: magenta, width: 8 });
  expect(first.points.length).toBeGreaterThan(5);
  expect(first.points[0][0]).toBeCloseTo(points[0][0], 0);
  expect(first.points[0][1]).toBeCloseTo(points[0][1], 0);
  await expect(shape(page, first.id)).toHaveAttribute('stroke', magenta);
  await expect(shape(page, first.id)).toHaveAttribute('stroke-width', '8');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  await setPen(page, blue, '3');
  await drawMouse(page, [
    [95, 35],
    [165, 50],
    [235, 35],
  ]);
  graph = await readGraph(request, id);
  expect(drawing(graph).strokes).toHaveLength(2);
  const strokes = drawing(graph).strokes;
  expect(strokes[1]).toMatchObject({ color: blue, width: 3 });
  // Selecting a pen width must not keep keyboard shortcuts trapped in that control
  // after a real pointer gesture starts drawing on the canvas.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => drawing(await readGraph(request, id)).strokes.length).toBe(1);
  await saved(page);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => drawing(await readGraph(request, id)).strokes.length).toBe(2);
  await saved(page);
  expect(drawing(await readGraph(request, id)).strokes).toEqual(strokes);
  await finishDrawing(page);

  const viewport = page.locator('.canvas-shell .react-flow__viewport');
  const beforeZoom = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforeZoom);
  await viewSettled(page);
  const beforePan = await viewport.getAttribute('style');
  const flow = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
  await page.mouse.move(flow.x + 100, flow.y + flow.height - 150);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(flow.x + 160, flow.y + flow.height - 115, { steps: 10 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforePan);
  await viewSettled(page);
  await saved(page);
  const expectedScreen = (await screenPoints(page, [first.points[0]]))[0];
  const actualScreen = await shape(page, first.id).evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(0);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  expect(actualScreen.x).toBeCloseTo(expectedScreen.x, 0);
  expect(actualScreen.y).toBeCloseTo(expectedScreen.y, 0);
  expect(drawing(await readGraph(request, id)).strokes).toEqual(strokes);

  await page.reload();
  await saved(page);
  await viewSettled(page);
  graph = await readGraph(request, id);
  expect(drawing(graph).strokes).toEqual(strokes);
  expect(graphContent(graph)).toEqual(content);
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  const eraseAt = (
    await screenPoints(page, [first.points[Math.floor(first.points.length / 2)]])
  )[0];
  await page.mouse.click(eraseAt.x, eraseAt.y);
  await saved(page);
  expect(drawing(await readGraph(request, id)).strokes).toEqual([strokes[1]]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect(drawing(await readGraph(request, id)).strokes).toEqual(strokes);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  expect(drawing(await readGraph(request, id)).strokes).toEqual([strokes[1]]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Drawing tools', exact: true })
    .getByRole('button', { name: 'Hide drawing', exact: true })
    .click();
  await saved(page);
  expect(drawing(await readGraph(request, id))).toEqual({ version: 1, visible: false, strokes });
  await expect(page.getByTestId('drawing-layer')).toBeHidden();
  await expect(page.getByTestId('drawing-surface')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Draw on diagram', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const hiddenPNG = await download(page, 'png');
  const hiddenPixels = await imagePixels(page, hiddenPNG);
  expect(hiddenPixels.magenta).toBe(0);
  expect(hiddenPixels.opaque).toBe(hiddenPNG.readUInt32BE(16) * hiddenPNG.readUInt32BE(20));
  await page.getByRole('button', { name: 'Show drawing', exact: true }).click();
  await saved(page);

  const complete = await download(page, 'png');
  await writeFile('/tmp/visualnerve-drawing-complete.png', complete);
  const completePath = testInfo.outputPath('complete.png');
  await writeFile(completePath, complete);
  const sourceJSON = JSON.stringify(await readGraph(request, id), null, 2);
  await writeFile('/tmp/visualnerve-drawing-source.json', sourceJSON);
  const sourcePath = testInfo.outputPath('source-graph.json');
  await writeFile(sourcePath, sourceJSON);
  await testInfo.attach('source-graph', { path: sourcePath, contentType: 'application/json' });
  await testInfo.attach('annotated-workflow.png', { path: completePath, contentType: 'image/png' });
  expect(await magentaPixels(page, complete)).toBeGreaterThan(500);
  expect(complete.readUInt32BE(20)).toBeGreaterThan(hiddenPNG.readUInt32BE(20));
  const viewportPNG = await download(page, 'png', 'viewport');
  await testInfo.attach('annotated-workflow-viewport.png', {
    body: viewportPNG,
    contentType: 'image/png',
  });
  const sample = (await screenPoints(page, [[140, 125]]))[0];
  const canvas = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
  const sourceNode = (await page
    .locator(`[data-node-id="${original.nodes[0].id}"]`)
    .boundingBox())!;
  expect(sample.x).toBeGreaterThan(sourceNode.x);
  expect(sample.x).toBeLessThan(sourceNode.x + sourceNode.width);
  expect(sample.y).toBeGreaterThan(sourceNode.y);
  expect(sample.y).toBeLessThan(sourceNode.y + sourceNode.height);
  expect(
    await magentaPixels(page, viewportPNG, { x: sample.x - canvas.x, y: sample.y - canvas.y }),
  ).toBeGreaterThan(30);
  const edgeSample = (await screenPoints(page, [crossing]))[0];
  expect(
    await magentaPixels(page, viewportPNG, {
      x: edgeSample.x - canvas.x,
      y: edgeSample.y - canvas.y,
    }),
  ).toBeGreaterThan(30);
  await page
    .locator(`[data-node-id="${original.nodes[0].id}"]`)
    .click({ position: { x: 15, y: 15 } });
  const selectedPNG = await download(page, 'png', 'selected');
  await testInfo.attach('annotated-workflow-selected.png', {
    body: selectedPNG,
    contentType: 'image/png',
  });
  expect(await magentaPixels(page, selectedPNG)).toBeGreaterThan(100);
  const pdf = await download(page, 'pdf');
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  await testInfo.attach('annotated-workflow.pdf', { body: pdf, contentType: 'application/pdf' });
  await page.screenshot({ path: '/tmp/visualnerve-drawing-desktop.png' });
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await page.screenshot({ path: '/tmp/visualnerve-drawing-tools.png' });
  await finishDrawing(page);

  const json = await download(page, 'json');
  const exported = JSON.parse(json.toString()) as Graph;
  expect(graphContent(exported)).toEqual(content);
  expect(drawing(exported)).toEqual({ version: 1, visible: true, strokes });
  const backup = JSON.parse((await download(page, 'workspace')).toString()) as WorkspaceBackup;
  expect(backup.diagrams.find((diagram) => diagram.id === id)?.settings.drawing).toEqual(
    drawing(exported),
  );
  expect(backup.nodes.filter((node) => node.diagramId === id)).toHaveLength(3);
  expect(backup.edges.filter((edge) => edge.diagramId === id)).toHaveLength(1);
  await page
    .getByLabel('Import file')
    .setInputFiles({ name: 'annotated-workflow.json', mimeType: 'application/json', buffer: json });
  await saved(page);
  const diagrams = (await (await request.get('/api/v1/diagrams')).json()) as Graph['diagram'][];
  expect(diagrams).toHaveLength(2);
  const imported = await readGraph(request, diagrams.find((diagram) => diagram.id !== id)!.id);
  expect(graphContent(imported)).toEqual(content);
  expect(drawing(imported)).toEqual(drawing(exported));
  expect(imported.nodes.map((node) => node.id)).not.toEqual(original.nodes.map((node) => node.id));

  // After leaving the pen tool, a real handle drag must create a normal relationship.
  const source = page.locator(`[data-node-id="${imported.nodes[0].id}"] .react-flow__handle-right`);
  const target = page.locator(`[data-node-id="${imported.nodes[2].id}"] .react-flow__handle-left`);
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  const connected = await readGraph(request, imported.diagram.id);
  expect(connected.edges).toHaveLength(2);
  expect(
    connected.edges.some(
      (edge) =>
        edge.sourceNodeId === imported.nodes[0].id && edge.targetNodeId === imported.nodes[2].id,
    ),
  ).toBe(true);
  expect(graphContent(connected).nodes).toEqual(content.nodes);
  expect(connected.nodes.map((node) => node.id)).toEqual(imported.nodes.map((node) => node.id));
  expect(drawing(connected)).toEqual(drawing(imported));
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Clear drawing', exact: true }).click();
  await saved(page);
  expect(drawing(await readGraph(request, imported.diagram.id)).strokes).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const restored = await readGraph(request, imported.diagram.id);
  expect(drawing(restored)).toEqual(drawing(imported));
  expect(graphContent(restored)).toEqual(graphContent(connected));
  const cancelled = await screenPoints(page, [
    [300, 320],
    [340, 330],
  ]);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.move(cancelled[0].x, cancelled[0].y);
  await page.mouse.down();
  await page.mouse.move(cancelled[1].x, cancelled[1].y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drawing-surface')).toBeHidden();
  expect(drawing(await readGraph(request, imported.diagram.id))).toEqual(drawing(imported));
  expect(errors).toEqual([]);
});

test.describe('phone drawing', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('touch and stylus draw on objects and leaving the pen restores canvas pan', async ({
    page,
    request,
  }) => {
    const original = await seed(request, 'Phone annotations', true);
    const content = graphContent(original);
    await open(page, original.diagram.name, true);
    await page.getByRole('button', { name: 'Draw on diagram', exact: true }).tap();
    await expect(page.getByTestId('drawing-surface')).toBeVisible();
    await expect(page.getByLabel('Drawing color', { exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    await expect(page.getByLabel('Drawing width', { exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    const before = await page.locator('.react-flow__viewport').getAttribute('style');
    const points = await screenPoints(page, [
      [90, 125],
      [140, 145],
      [210, 175],
    ]);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...points[0], id: 1 }],
    });
    for (const point of points.slice(1))
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...point, id: 1 }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await saved(page);
    const touched = await readGraph(request, original.diagram.id);
    expect(drawing(touched).strokes).toHaveLength(1);
    expect(drawing(touched).strokes[0].points.length).toBeGreaterThan(1);
    expect(graphContent(touched)).toEqual(content);
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
    await setPen(page, blue, '3');
    const pen = await screenPoints(page, [
      [90, 190],
      [145, 205],
      [220, 225],
    ]);
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...pen[0],
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'pen',
      force: 0.5,
    });
    for (const point of pen.slice(1))
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...point,
        button: 'left',
        buttons: 1,
        pointerType: 'pen',
        force: 0.5,
      });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...pen.at(-1)!,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'pen',
    });
    await saved(page);
    const annotated = await readGraph(request, original.diagram.id);
    expect(drawing(annotated).strokes).toHaveLength(2);
    expect(drawing(annotated).strokes[1]).toMatchObject({ color: blue, width: 3 });
    expect(graphContent(annotated)).toEqual(content);
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(page.getByRole('button', { name: 'Done drawing', exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    await page.screenshot({ path: '/tmp/visualnerve-drawing-mobile.png' });
    await finishDrawing(page);
    const viewport = page.locator('.react-flow__viewport');
    const beforePan = await viewport.getAttribute('style');
    const flow = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
    const x = flow.x + 60,
      y = flow.y + flow.height - 150;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 45, y: y - 35, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforePan);
    await session.detach();
    await saved(page);
    expect(drawing(await readGraph(request, original.diagram.id))).toEqual(drawing(annotated));
    await page.reload();
    await saved(page);
    await expect(shape(page, drawing(annotated).strokes[0].id)).toBeVisible();
    expect(graphContent(await readGraph(request, original.diagram.id))).toEqual(content);
  });
});

test('a pen dot in an empty diagram exports as a rendered image and PDF', async ({
  page,
  request,
}, testInfo) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Drawing without nodes', type: 'freeform' },
    })
  ).json();
  await open(page, diagram.name);
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await setPen(page, magenta, '12');
  const flow = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
  await page.mouse.click(flow.x + 250, flow.y + 200);
  await saved(page);
  const graph = await readGraph(request, diagram.id);
  expect(graph.nodes).toHaveLength(0);
  expect(graph.edges).toHaveLength(0);
  expect(drawing(graph).strokes).toHaveLength(1);
  expect(drawing(graph).strokes[0].points).toHaveLength(1);
  await finishDrawing(page);
  const expectCentered = async () => {
    await expect
      .poll(async () => {
        const ink = (await shape(page, drawing(graph).strokes[0].id).boundingBox())!;
        const canvas = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
        return Math.hypot(
          ink.x + ink.width / 2 - (canvas.x + canvas.width / 2),
          ink.y + ink.height / 2 - (canvas.y + canvas.height / 2),
        );
      })
      .toBeLessThan(1);
  };
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expectCentered();
  const beforePan = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.mouse.move(flow.x + 40, flow.y + 100);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(flow.x + 100, flow.y + 135, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
    .not.toBe(beforePan);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await expectCentered();
  const png = await download(page, 'png');
  await testInfo.attach('drawing-only-dot.png', { body: png, contentType: 'image/png' });
  expect(await magentaPixels(page, png)).toBeGreaterThan(50);
  expect(png.readUInt32BE(16)).toBeLessThan(200);
  expect(png.readUInt32BE(20)).toBeLessThan(200);
  const pdf = await download(page, 'pdf');
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  const distant = JSON.parse((await download(page, 'json')).toString()) as Graph;
  distant.diagram.name = 'Imported distant drawing';
  delete distant.diagram.settings.viewport;
  delete distant.diagram.settings.viewportDevice;
  drawing(distant).strokes[0].points = drawing(distant).strokes[0].points.map(
    ([x, y]): Point => [x + 50000, y + 75000],
  );
  await page.getByLabel('Import file').setInputFiles({
    name: 'distant-drawing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(distant)),
  });
  await expect(
    page.getByRole('heading', { name: distant.diagram.name, exact: true, level: 1 }),
  ).toBeVisible();
  await saved(page);
  await viewSettled(page);
  await expect(shape(page, drawing(distant).strokes[0].id)).toBeInViewport({ ratio: 0.999 });
  await expectCentered();
  const diagrams = (await (await request.get('/api/v1/diagrams')).json()) as Graph['diagram'][];
  const imported = await readGraph(
    request,
    diagrams.find((entry) => entry.name === distant.diagram.name)!.id,
  );
  expect(imported.nodes).toHaveLength(0);
  expect(imported.edges).toHaveLength(0);
  expect(drawing(imported)).toEqual(drawing(distant));
  await page.reload();
  await saved(page);
  await viewSettled(page);
  await expectCentered();
});

test('ink stays above a selected outer group with three nested group levels', async ({
  page,
  request,
}, testInfo) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Nested annotations',
        type: 'freeform',
        settings: { viewport: { x: 40, y: 60, zoom: 1 }, viewportDevice: 'desktop' },
      },
    })
  ).json();
  const original = (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          {
            title: 'Outer group',
            externalId: 'outer',
            nodeType: 'group',
            x: 40,
            y: 40,
            width: 720,
            height: 520,
          },
          {
            title: 'Middle group',
            externalId: 'middle',
            parentExternalId: 'outer',
            nodeType: 'group',
            x: 100,
            y: 110,
            width: 570,
            height: 400,
          },
          {
            title: 'Inner group',
            externalId: 'inner',
            parentExternalId: 'middle',
            nodeType: 'group',
            x: 160,
            y: 180,
            width: 400,
            height: 260,
          },
          {
            title: 'Deep concept',
            parentExternalId: 'inner',
            x: 220,
            y: 240,
            width: 180,
            height: 90,
            metadata: { annotationTest: 'preserved' },
          },
        ],
      },
    })
  ).json()) as Graph;
  await open(page, original.diagram.name);
  await page.getByRole('button', { name: 'Draw on diagram', exact: true }).click();
  await setPen(page, magenta, '8');
  await drawMouse(page, [
    [240, 280],
    [310, 280],
    [380, 280],
  ]);
  await finishDrawing(page);
  await page
    .locator(`[data-node-id="${original.nodes[0].id}"]`)
    .click({ position: { x: 20, y: 20 } });
  await expect(page.locator(`.react-flow__node[data-id="${original.nodes[0].id}"]`)).toHaveClass(
    /selected/,
  );
  const sample = (await screenPoints(page, [[310, 280]]))[0];
  const flow = page.locator('.canvas-shell .react-flow');
  const rect = (await flow.boundingBox())!;
  const around = { x: sample.x - rect.x, y: sample.y - rect.y };
  const livePNG = await flow.screenshot();
  expect(await magentaPixels(page, livePNG, around)).toBeGreaterThan(30);
  const exported = await download(page, 'png', 'viewport');
  expect(await magentaPixels(page, exported, around)).toBeGreaterThan(30);
  const graph = await readGraph(request, diagram.id);
  expect(graphContent(graph)).toEqual(graphContent(original));
  expect(graph.nodes.map(({ id, parentId }) => ({ id, parentId }))).toEqual(
    original.nodes.map(({ id, parentId }) => ({ id, parentId })),
  );
  expect(drawing(graph).strokes).toHaveLength(1);
  await page.screenshot({ path: '/tmp/visualnerve-drawing-nested-groups.png' });
  await testInfo.attach('selected-nested-group.png', { body: livePNG, contentType: 'image/png' });
});
