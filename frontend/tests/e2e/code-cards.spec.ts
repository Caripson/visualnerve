import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph, GraphNode } from '../../src/model/types';
import { getCodeObject, getCodeRelation } from '../../src/code/schema';

const directory = `src/${'employee_payroll_records_'.repeat(5)}`;
const mainPath = `${directory}/monthly_payroll.ts`;
const declarations = Array.from(
  { length: 32 },
  (_, index) => `calculate_employee_${index}_payroll_with_all_retained_source_declarations`,
);

async function readGraph(request: APIRequestContext, diagramId: string) {
  const response = await request.get(`/api/v1/diagrams/${diagramId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Graph;
}

function geometry(node: GraphNode) {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

async function viewport(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

async function savedViewport(page: Page, request: APIRequestContext, diagramId: string) {
  // The initial automatic fit is a real saved camera change. Wait for it before
  // comparing scroll-only gestures or changing history, rather than racing it.
  await expect
    .poll(async () => (await readGraph(request, diagramId)).diagram.settings.viewport)
    .toBeTruthy();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () => {
      const expected = (await readGraph(request, diagramId)).diagram.settings.viewport;
      const actual = await viewport(page);
      return (
        !!expected &&
        Math.abs(actual.x - expected.x) < 0.001 &&
        Math.abs(actual.y - expected.y) < 0.001 &&
        Math.abs(actual.zoom - expected.zoom) < 0.001
      );
    })
    .toBe(true);
}

async function createCards(page: Page, request: APIRequestContext, name: string) {
  const response = await request.post('/api/v1/code/diagrams', {
    data: {
      name,
      mode: 'files',
      files: [
        {
          path: mainPath,
          content: [
            'import { calculateTax } from "./tax_rules";',
            ...declarations.map((name) => `export function ${name}() { return 42; }`),
          ].join('\n'),
        },
        {
          path: `${directory}/tax_rules.ts`,
          content: 'export function calculateTax() { return 42; }',
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const graph = (await response.json()) as Graph;
  const main = graph.nodes.find((node) => getCodeObject(node)?.path === mainPath)!;
  expect(main).toBeTruthy();
  expect(getCodeObject(main)?.summary).toEqual(declarations);
  expect(graph.edges).toHaveLength(1);
  expect(getCodeRelation(graph.edges[0])?.kind).toBe('imports');
  const card = page.locator(`.react-flow__node[data-id="${main.id}"] .code-node`);
  await expect(card).toBeVisible();
  await savedViewport(page, request, graph.diagram.id);
  return { graph, main, card };
}

test('code card scroll stays inside the node and corner resizing persists through history and reload', async ({
  page,
  request,
}, testInfo) => {
  const { graph, main, card } = await createCards(page, request, 'Scrollable code cards');
  await card.locator('.node-title').click();
  const body = card.getByRole('region', { name: `Code details for ${main.title}`, exact: true });
  await expect(body.getByRole('list', { name: 'Declarations' }).getByRole('listitem')).toHaveCount(
    declarations.length,
  );
  await expect(body.locator('.code-object-path')).toHaveText(mainPath);
  expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(await body.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await body.evaluate((element) => element.clientHeight),
  );
  await body.focus();
  const before = geometry(
    (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
  );
  const camera = await viewport(page);
  await body.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await viewport(page)).toEqual(camera);
  expect(
    geometry(
      (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
    ),
  ).toEqual(before);

  await body.evaluate((element) => {
    element.scrollTop = 0;
  });
  for (let index = 0; index < 4; index++) await body.press('ArrowDown');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await viewport(page)).toEqual(camera);
  expect(
    geometry(
      (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
    ),
  ).toEqual(before);
  await body.press('End');
  const last = body.getByRole('listitem').last();
  await expect(last).toHaveText(declarations.at(-1)!);
  await expect
    .poll(async () => {
      const row = (await last.boundingBox())!;
      const bounds = (await body.boundingBox())!;
      return row.y >= bounds.y - 1 && row.y + row.height <= bounds.y + bounds.height + 1;
    })
    .toBe(true);
  expect(await viewport(page)).toEqual(camera);

  const edge = page.locator(
    `.react-flow__edge[data-id="${graph.edges[0].id}"] .react-flow__edge-path`,
  );
  const previousPath = await edge.getAttribute('d');
  const corner = card.locator('.code-resize-handle.bottom.right');
  await expect(corner).toBeVisible();
  const handle = (await corner.boundingBox())!;
  expect(handle.width).toBeGreaterThanOrEqual(23.5);
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 110, start.y + 110, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const node = (await readGraph(request, graph.diagram.id)).nodes.find(
        (node) => node.id === main.id,
      )!;
      return node.width > before.width + 40 && node.height > before.height + 40;
    })
    .toBe(true);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const enlargedGraph = await readGraph(request, graph.diagram.id);
  const enlarged = geometry(enlargedGraph.nodes.find((node) => node.id === main.id)!);
  expect(enlargedGraph.edges).toEqual(graph.edges);
  await expect(edge).not.toHaveAttribute('d', previousPath!);
  await page.screenshot({ path: testInfo.outputPath('code-card-desktop.png') });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () =>
      geometry(
        (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
      ),
    )
    .toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(async () =>
      geometry(
        (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
      ),
    )
    .toEqual(enlarged);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const title = (await card.locator('.node-title').boundingBox())!;
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width / 2 + 60, title.y + title.height / 2 + 40, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const current = (await readGraph(request, graph.diagram.id)).nodes.find(
        (node) => node.id === main.id,
      )!;
      return current.x > enlarged.x + 20 && current.y > enlarged.y + 10;
    })
    .toBe(true);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const moved = geometry(
    (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
  );
  expect({ width: moved.width, height: moved.height }).toEqual({
    width: enlarged.width,
    height: enlarged.height,
  });
  await page.reload();
  await expect(card).toBeVisible();
  await savedViewport(page, request, graph.diagram.id);
  const restored = await readGraph(request, graph.diagram.id);
  expect(geometry(restored.nodes.find((node) => node.id === main.id)!)).toEqual(moved);
  expect(restored.edges).toEqual(graph.edges);
  await expect(body.getByRole('listitem')).toHaveCount(declarations.length);
  expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
});

test.describe('phone code cards', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('touch scrolling reads the card without panning the canvas and keeps resize affordances visible', async ({
    page,
    request,
  }, testInfo) => {
    const { graph, main, card } = await createCards(page, request, 'Phone code cards');
    await card.locator('.node-title').tap();
    const body = card.getByRole('region', { name: `Code details for ${main.title}`, exact: true });
    const camera = await viewport(page);
    const before = geometry(
      (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
    );
    const bounds = (await body.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height * 0.85;
    const distance = bounds.height * 0.65;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: startY }],
      });
      for (let index = 1; index <= 8; index++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: startY - (distance * index) / 8 }],
        });
        await page.waitForTimeout(20);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await viewport(page)).toEqual(camera);
    expect(
      geometry(
        (await readGraph(request, graph.diagram.id)).nodes.find((node) => node.id === main.id)!,
      ),
    ).toEqual(before);
    // IntersectionObserver rounds fractional zoomed bounds; allow subpixel error.
    await expect(card.locator('.code-resize-handle.bottom.right')).toBeInViewport({ ratio: 0.999 });
    const corner = (await card.locator('.code-resize-handle.bottom.right').boundingBox())!;
    expect(corner.width).toBeGreaterThanOrEqual(31.5);
    expect(corner.height).toBeGreaterThanOrEqual(31.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath('code-card-mobile.png') });
  });
});
