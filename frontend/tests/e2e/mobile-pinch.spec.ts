import type { Locator } from '@playwright/test';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getCodeObject } from '../../src/code/schema';
import { open, saved, simulation } from './mobile-fixtures';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

type Point = { id: number; x: number; y: number };

async function camera(page: Page) {
  return page.locator('.canvas-shell .react-flow__viewport').evaluate((element) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: transform.e, y: transform.f, zoom: transform.a };
  });
}

async function read(request: APIRequestContext, diagramId: string) {
  const response = await request.get(`/api/v1/diagrams/${diagramId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Graph;
}

async function settled(page: Page, request: APIRequestContext, diagramId: string) {
  await page.locator('.canvas-shell .react-flow__viewport').evaluate(async (element) => {
    let previous = '',
      stable = 0;
    const deadline = performance.now() + 3000;
    while (stable < 8 && performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = getComputedStyle(element).transform;
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
    if (stable < 8) throw new Error('Canvas camera did not settle.');
  });
  await saved(page);
  await expect
    .poll(async () => {
      const actual = await camera(page);
      const expected = (await read(request, diagramId)).diagram.settings.viewport;
      return (
        !!expected &&
        Math.abs(actual.x - expected.x) < 0.001 &&
        Math.abs(actual.y - expected.y) < 0.001 &&
        Math.abs(actual.zoom - expected.zoom) < 0.001
      );
    })
    .toBe(true);
}

async function touchFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function startPoints(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const bounds = (await target.boundingBox())!;
  const canvas = (await page.locator('.canvas-shell .react-flow').boundingBox())!;
  const left = Math.max(bounds.x, canvas.x + 8);
  const right = Math.min(bounds.x + bounds.width, canvas.x + canvas.width - 8);
  const top = Math.max(bounds.y, canvas.y + 8);
  const bottom = Math.min(bounds.y + bounds.height, canvas.y + canvas.height - 8);
  expect(right - left).toBeGreaterThan(40);
  expect(bottom - top).toBeGreaterThan(12);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const spread = Math.min(24, (right - left) / 5);
  const points: Point[] = [
    { id: 0, x: center.x - spread, y: center.y },
    { id: 1, x: center.x + spread, y: center.y },
  ];
  // Prove both fingers begin on the requested node/content, not empty canvas.
  for (const point of points) {
    expect(
      await target.evaluate((element, point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return !!hit && element.contains(hit);
      }, point),
    ).toBe(true);
  }
  return { center, spread, points };
}

async function pinch(
  page: Page,
  target: Locator,
  options: { factor?: number; staggered?: boolean } = {},
) {
  const { center, spread, points } = await startPoints(page, target);
  const originalCamera = await camera(page);
  const bounds = (await page.locator('.canvas-shell .react-flow__renderer').boundingBox())!;
  const anchor = {
    x: (center.x - bounds.x - originalCamera.x) / originalCamera.zoom,
    y: (center.y - bounds.y - originalCamera.y) / originalCamera.zoom,
  };
  const factor = options.factor ?? 1.7;
  const session = await page.context().newCDPSession(page);
  try {
    if (options.staggered) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [points[0]],
      });
      await touchFrame(page);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    for (let step = 1; step <= 10; step++) {
      const distance = spread * (1 + ((factor - 1) * step) / 10);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { id: 0, x: center.x - distance, y: center.y },
          { id: 1, x: center.x + distance, y: center.y },
        ],
      });
      await touchFrame(page);
    }
    const zoomed = await camera(page);
    const expectedZoom = Math.max(0.05, Math.min(3, originalCamera.zoom * factor));
    expect(Math.abs(zoomed.zoom - expectedZoom)).toBeLessThan(0.001);
    const returnedAnchor = {
      x: (center.x - bounds.x - zoomed.x) / zoomed.zoom,
      y: (center.y - bounds.y - zoomed.y) / zoomed.zoom,
    };
    expect(Math.abs(returnedAnchor.x - anchor.x)).toBeLessThan(0.001);
    expect(Math.abs(returnedAnchor.y - anchor.y)).toBeLessThan(0.001);
    // CDP touchMove omitting an ID does NOT release that finger. End both here;
    // the actual 2-to-1 ownership transition has explicit touchend unit coverage.
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return { originalCamera, zoomed, expectedZoom, anchor, returnedAnchor, points, factor };
  } finally {
    await session
      .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      .catch(() => {});
    await session.detach();
  }
}

async function drag(page: Page, target: Locator, by: { x: number; y: number }) {
  const { center } = await startPoints(page, target);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 0, ...center }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 0, x: center.x + (by.x * step) / 8, y: center.y + (by.y * step) / 8 }],
      });
      await touchFrame(page);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session
      .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      .catch(() => {});
    await session.detach();
  }
}

async function unchanged(request: APIRequestContext, before: Graph) {
  const after = await read(request, before.diagram.id);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  expect(after.simulation).toEqual(before.simulation);
}

async function ordinary(page: Page, request: APIRequestContext, type: 'flowchart' | 'mindmap') {
  const name = `Pinch ${type}`;
  const created = await request.post('/api/v1/diagrams', {
    data: {
      name,
      type,
      settings: { viewport: { x: 60, y: 100, zoom: 1 }, viewportDevice: 'touch' },
    },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const node = await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
    data: { title: 'Two fingers on this node', x: 20, y: 40, width: 240, height: 160 },
  });
  expect(node.status()).toBe(201);
  await open(page, name);
  await settled(page, request, diagram.id);
  const before = await read(request, diagram.id);
  return { before, card: page.locator(`.react-flow__node[data-id="${before.nodes[0].id}"]`) };
}

for (const type of ['flowchart', 'mindmap'] as const) {
  for (const staggered of [false, true]) {
    test(`mobile pinch: ${type} ${staggered ? 'staggered' : 'simultaneous'} fingers on a node zoom without moving it`, async ({
      page,
      request,
    }, testInfo) => {
      const { before, card } = await ordinary(page, request, type);
      const originalCamera = await camera(page);
      const target = card.locator('[data-node-id]').first();
      await page.screenshot({ path: testInfo.outputPath('node-pinch-before.png') });
      if (type === 'flowchart' && !staggered)
        await page.screenshot({ path: '/tmp/visualnerve-mobile-pinch-before.png' });
      const metrics = await pinch(page, target, { staggered });
      await testInfo.attach('node-pinch-geometry', {
        body: Buffer.from(JSON.stringify(metrics, null, 2)),
        contentType: 'application/json',
      });
      await expect
        .poll(async () => (await camera(page)).zoom)
        .toBeGreaterThan(originalCamera.zoom * 1.1);
      await settled(page, request, before.diagram.id);
      await unchanged(request, before);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('node-pinch-after.png') });
      if (type === 'flowchart' && !staggered)
        await page.screenshot({ path: '/tmp/visualnerve-mobile-pinch-after.png' });
      const persistedCamera = await camera(page);
      await page.reload();
      await settled(page, request, before.diagram.id);
      await expect
        .poll(async () => {
          const restored = await camera(page);
          return Math.max(
            Math.abs(restored.x - persistedCamera.x),
            Math.abs(restored.y - persistedCamera.y),
            Math.abs(restored.zoom - persistedCamera.zoom),
          );
        })
        .toBeLessThan(0.001);
      await unchanged(request, before);
      if (type === 'flowchart' && !staggered) {
        await pinch(page, target, { factor: 0.65 });
        await expect
          .poll(async () => (await camera(page)).zoom)
          .toBeLessThan(persistedCamera.zoom * 0.9);
        await settled(page, request, before.diagram.id);
        await unchanged(request, before);
      }
      // Once every finger is up, a new one-finger gesture must still move the node.
      await drag(page, target, { x: 24, y: 24 });
      await saved(page);
      await expect
        .poll(async () => {
          const moved = (await read(request, before.diagram.id)).nodes[0];
          return Math.hypot(moved.x - before.nodes[0].x, moved.y - before.nodes[0].y);
        })
        .toBeGreaterThan(5);
      await card.tap();
      await expect(card).toHaveClass(/selected/);
    });
  }
}

test('mobile pinch: scrollable code content zooms while one-finger reading stays inside the card', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/v1/code/diagrams', {
    data: {
      name: 'Pinch code content',
      mode: 'files',
      files: [
        {
          path: 'mobile.ts',
          content: Array.from(
            { length: 40 },
            (_, i) => `export function retained_function_${i}() { return ${i}; }`,
          ).join('\n'),
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const initial = (await created.json()) as Graph;
  const node = initial.nodes.find((node) => getCodeObject(node)?.path === 'mobile.ts')!;
  const card = page.locator(`.react-flow__node[data-id="${node.id}"]`);
  await expect(card).toBeVisible();
  // Let the initial automatic fit commit before the optimistic camera update.
  await settled(page, request, initial.diagram.id);
  const current = await read(request, initial.diagram.id);
  const updated = await request.patch(`/api/v1/diagrams/${initial.diagram.id}`, {
    data: {
      version: current.diagram.version,
      settings: {
        ...current.diagram.settings,
        viewport: {
          x: (390 - node.width * 0.85) / 2 - node.x * 0.85,
          y: 100 - node.y * 0.85,
          zoom: 0.85,
        },
        viewportDevice: 'touch',
      },
    },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  await page.reload();
  const body = card.locator('.code-object-scroll');
  await settled(page, request, initial.diagram.id);
  const before = await read(request, initial.diagram.id);
  expect(await body.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await body.evaluate((element) => element.clientHeight),
  );
  const originalCamera = await camera(page);
  await drag(page, body, { x: 0, y: -45 });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await camera(page)).toEqual(originalCamera);
  await unchanged(request, before);
  await pinch(page, body, { staggered: true });
  await expect
    .poll(async () => (await camera(page)).zoom)
    .toBeGreaterThan(originalCamera.zoom * 1.1);
  await settled(page, request, initial.diagram.id);
  await unchanged(request, before);
});

test('mobile pinch: simulator card details zoom without changing capacity or processing assumptions', async ({
  page,
  request,
}) => {
  const initial = await simulation(request, 'Pinch simulator details');
  await open(page, initial.diagram.name);
  const work = initial.simulation!.nodes.find((node) => node.type === 'work')!;
  const body = page.locator(`.react-flow__node[data-id="${work.id}"] .simulation-node-details`);
  await expect(body).toBeVisible();
  await settled(page, request, initial.diagram.id);
  const before = await read(request, initial.diagram.id);
  const originalCamera = await camera(page);
  await pinch(page, body);
  await expect
    .poll(async () => (await camera(page)).zoom)
    .toBeGreaterThan(originalCamera.zoom * 1.1);
  await settled(page, request, initial.diagram.id);
  await unchanged(request, before);
});
