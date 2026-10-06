import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getSpatialView, type SpatialCamera, type SpatialPoint } from '../../src/spatial/types';
import { browserLaunchOptions } from '../../playwright.config';

// Keep software WebGL confined to the graphics acceptance cases.
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

async function stored(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function ready(page: Page) {
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-face-source', '2d-node', {
    timeout: 45000,
  });
  await expect(page.getByTestId('spatial-navigation-gizmo')).toBeVisible();
}
function vectorDifference(a: SpatialPoint, b: SpatialPoint): SpatialPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function length(value: SpatialPoint): number {
  return Math.hypot(value.x, value.y, value.z);
}
function distance(camera: SpatialCamera): number {
  return length(vectorDifference(camera.position, camera.target));
}
function expectPoint(actual: SpatialPoint, expected: SpatialPoint) {
  for (const axis of ['x', 'y', 'z'] as const) expect(actual[axis]).toBeCloseTo(expected[axis], 4);
}
function canonicalRecords<T extends { id: string }>(records: T[]): T[] {
  return (JSON.parse(JSON.stringify(records)) as T[]).sort((a, b) => a.id.localeCompare(b.id));
}
async function camera(request: APIRequestContext, id: string): Promise<SpatialCamera> {
  const value = getSpatialView(await stored(request, id)).camera;
  expect(value).toBeDefined();
  return value!;
}
async function savedFront(page: Page, request: APIRequestContext, id: string) {
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  const canvas = page.getByTestId('spatial-canvas');
  const position = JSON.parse((await canvas.getAttribute('data-camera-position'))!);
  const target = JSON.parse((await canvas.getAttribute('data-camera-target'))!);
  await expect
    .poll(async () => {
      const value = await camera(request, id);
      return { position: value.position, target: value.target };
    })
    .toEqual({ position, target });
  await saved(page);
  return camera(request, id);
}
async function changedCamera(
  page: Page,
  request: APIRequestContext,
  id: string,
  before: SpatialCamera,
) {
  await expect.poll(async () => camera(request, id)).not.toEqual(before);
  await saved(page);
  return camera(request, id);
}
async function mode(page: Page, name: 'Move' | 'Rotate' | 'Scale') {
  const selected = page.getByRole('button', { name: `${name} view`, exact: true });
  await selected.click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('spatial-navigation-gizmo')).toHaveAttribute(
    'data-mode',
    name.toLowerCase(),
  );
}
async function dragHandle(page: Page, axis: 'x' | 'y' | 'z' | 'free', dx: number, dy: number) {
  const handle = page.getByTestId(`spatial-gizmo-grab-${axis}`);
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
}

test('uses visible axis gizmos to rotate, pan and zoom the same styled diagram, saves roll and preserves every 2D node and relationship', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240000);
  const name = 'Release workflow with navigation controls';
  const created = await request.post('/api/v1/diagrams', {
    data: { name, type: 'process' },
  });
  expect(created.status()).toBe(201);
  const diagram = (await created.json()) as Graph['diagram'];
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'plan',
          title: 'Plan the release',
          x: 100,
          y: 110,
          width: 300,
          height: 90,
          color: '#5c9fe5',
          nodeType: 'process',
          metadata: { visualNerve: { icon: 'launch' } },
        },
        {
          externalId: 'build',
          title: 'Build the version',
          x: 660,
          y: 150,
          width: 240,
          height: 120,
          color: '#79ba8b',
          nodeType: 'process',
          status: 'done',
          metadata: { visualNerve: { icon: 'technology' } },
        },
        {
          externalId: 'ship',
          title: 'Ship the release',
          x: 340,
          y: 440,
          width: 280,
          height: 110,
          color: '#e6b74f',
          nodeType: 'process',
        },
      ],
      edges: [
        {
          sourceExternalId: 'plan',
          targetExternalId: 'build',
          label: 'Ready',
          direction: 'forward',
        },
        {
          sourceExternalId: 'build',
          targetExternalId: 'ship',
          label: 'Verified',
          direction: 'forward',
        },
      ],
    },
  });
  expect(populated.ok()).toBe(true);
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
  const before = await stored(request, diagram.id);
  expect(before.nodes).toHaveLength(3);
  expect(before.edges).toHaveLength(2);
  expect(before.nodes.every((node) => node.metadata.spatial === undefined)).toBe(true);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await ready(page);
  const front = await savedFront(page, request, diagram.id);

  await mode(page, 'Rotate');
  await dragHandle(page, 'y', 38, 0);
  const rotated = await changedCamera(page, request, diagram.id, front);
  expect(length(vectorDifference(rotated.position, front.position))).toBeGreaterThan(0.01);
  expectPoint(rotated.target, front.target);
  expect(distance(rotated)).toBeCloseTo(distance(front), 3);

  await mode(page, 'Move');
  await dragHandle(page, 'x', 34, 0);
  const moved = await changedCamera(page, request, diagram.id, rotated);
  const positionOffset = vectorDifference(moved.position, rotated.position);
  const targetOffset = vectorDifference(moved.target, rotated.target);
  expect(length(targetOffset)).toBeGreaterThan(0.01);
  expectPoint(positionOffset, targetOffset);
  expect(distance(moved)).toBeCloseTo(distance(rotated), 3);

  await mode(page, 'Scale');
  await dragHandle(page, 'free', 0, -36);
  const scaled = await changedCamera(page, request, diagram.id, moved);
  expectPoint(scaled.target, moved.target);
  expect(Math.abs(distance(scaled) - distance(moved))).toBeGreaterThan(0.01);
  const scaleDirection = vectorDifference(scaled.position, scaled.target);
  const originalDirection = vectorDifference(moved.position, moved.target);
  for (const axis of ['x', 'y', 'z'] as const)
    expect(scaleDirection[axis] / distance(scaled)).toBeCloseTo(
      originalDirection[axis] / distance(moved),
      4,
    );

  // Z rotation changes the viewing frame instead of changing the diagram records.
  const unrolled = await savedFront(page, request, diagram.id);
  await mode(page, 'Rotate');
  await dragHandle(page, 'z', 30, 0);
  const rolled = await changedCamera(page, request, diagram.id, unrolled);
  expectPoint(rolled.position, unrolled.position);
  expectPoint(rolled.target, unrolled.target);
  expect(rolled.up).toBeDefined();
  expect(length(vectorDifference(rolled.up!, unrolled.up ?? { x: 0, y: 1, z: 0 }))).toBeGreaterThan(
    0.01,
  );
  expect(length(rolled.up!)).toBeCloseTo(1, 4);
  await page.reload();
  await ready(page);
  await saved(page);
  expect(await camera(request, diagram.id)).toEqual(rolled);
  const canvas = page.getByTestId('spatial-canvas');
  expectPoint(JSON.parse((await canvas.getAttribute('data-camera-position'))!), rolled.position);
  expectPoint(JSON.parse((await canvas.getAttribute('data-camera-target'))!), rolled.target);
  expectPoint(JSON.parse((await canvas.getAttribute('data-camera-up'))!), rolled.up!);

  // The same axis controls also work without a pointer.
  const keyboardBefore = await camera(request, diagram.id);
  const rotateX = page.getByRole('button', { name: 'Rotate view around X axis', exact: true });
  await rotateX.focus();
  await rotateX.press('ArrowRight');
  const keyboardAfter = await changedCamera(page, request, diagram.id, keyboardBefore);
  expect(length(vectorDifference(keyboardAfter.position, keyboardBefore.position))).toBeGreaterThan(
    0.01,
  );
  expectPoint(keyboardAfter.target, keyboardBefore.target);

  await page.getByRole('button', { name: 'Fit 3D diagram', exact: true }).click();
  await savedFront(page, request, diagram.id);
  await page.getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true }).click();
  await ready(page);
  await saved(page);
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-face-captures', '3');
  await page.screenshot({ path: '/tmp/visualnerve-3d-navigation-gizmo.png', timeout: 45000 });
  await testInfo.attach('same-diagram-with-3d-navigation-controls.png', {
    path: '/tmp/visualnerve-3d-navigation-gizmo.png',
    contentType: 'image/png',
  });

  const in3D = await stored(request, diagram.id);
  expect(canonicalRecords(in3D.nodes)).toEqual(canonicalRecords(before.nodes));
  expect(canonicalRecords(in3D.edges)).toEqual(canonicalRecords(before.edges));
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await saved(page);
  await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
  const after = await stored(request, diagram.id);
  expect(getSpatialView(after).mode).toBe('2d');
  expect(canonicalRecords(after.nodes)).toEqual(canonicalRecords(before.nodes));
  expect(canonicalRecords(after.edges)).toEqual(canonicalRecords(before.edges));
});
