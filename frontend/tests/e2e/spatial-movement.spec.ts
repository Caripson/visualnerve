import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getSpatialNode } from '../../src/spatial/types';
import { projectSpatialGraph } from '../../src/spatial/layout';
import { browserLaunchOptions } from '../../playwright.config';

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
const saved = (page: Page) =>
  expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
async function stored(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function setup(page: Page, request: APIRequestContext, name: string) {
  const initial: Graph = await (
    await request.post('/api/v1/spatial-diagrams', { data: { name } })
  ).json();
  const populated = await request.post(`/api/v1/diagrams/${initial.diagram.id}/bulk`, {
    data: {
      nodes: [-1, 0, 1].map((side, index) => ({
        externalId: `move-${index}`,
        title: ['Before', 'Move this readable card', 'After'][index],
        x: 180 + index * 320,
        y: 340,
        width: 220,
        height: 110,
        notes: 'Retain annotation',
        status: 'planned',
        metadata: {
          spatial: { version: 1, position: { x: side * 3.2, y: 0, z: index === 1 ? 0.8 : 0 } },
          integration: { retain: true },
        },
      })),
      edges: [
        {
          sourceExternalId: 'move-0',
          targetExternalId: 'move-1',
          direction: 'both',
          label: 'Before connection',
        },
        {
          sourceExternalId: 'move-1',
          targetExternalId: 'move-2',
          direction: 'forward',
          label: 'After connection',
        },
      ],
    },
  });
  expect(populated.ok()).toBe(true);
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await saved(page);
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-face-source', '2d-node', {
    timeout: 30000,
  });
  const graph = await stored(request, initial.diagram.id);
  return { graph, node: graph.nodes.find((node) => node.externalId === 'move-1')! };
}
async function center(page: Page, id: string) {
  const canvas = page.getByTestId('spatial-canvas');
  const bounds = (await canvas.boundingBox())!;
  const projections: Array<{ id: string; center: number[]; side: string; corners: number[][] }> =
    JSON.parse((await canvas.getAttribute('data-face-projections'))!);
  const face = projections.find((face) => face.id === id)!;
  return { x: bounds.x + face.center[0], y: bounds.y + face.center[1], face };
}
async function startDrag(page: Page, id: string, dx = 80, dy = 35) {
  const point = await center(page, id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-object-dragging', 'true');
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 10 });
  return point;
}

test('moves a saved 3D card with unchanged depth and 2D geometry, commits once and cancels from either side', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const { graph, node } = await setup(page, request, 'Saved 3D movement');
  const canvas = page.getByTestId('spatial-canvas');
  const camera = await canvas.getAttribute('data-camera-position');
  await expect(page.getByRole('button', { name: 'Move objects', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Move objects', exact: true }).click();
  await startDrag(page, node.id);
  // Rendering a preview never saves a partial placement.
  expect(
    getSpatialNode(
      (await stored(request, graph.diagram.id)).nodes.find((value) => value.id === node.id)!,
    )?.position,
  ).toEqual(getSpatialNode(node)?.position);
  await expect(canvas).toHaveAttribute('data-camera-position', camera!);
  await page.mouse.up();
  await saved(page);
  const moved = await stored(request, graph.diagram.id),
    changed = moved.nodes.find((value) => value.id === node.id)!;
  expect(getSpatialNode(changed)?.position?.x).toBeGreaterThan(0);
  expect(getSpatialNode(changed)?.position?.y).toBeLessThan(0);
  expect(getSpatialNode(changed)?.position?.z).toBe(0.8);
  expect([changed.x, changed.y, changed.width, changed.height]).toEqual([
    node.x,
    node.y,
    node.width,
    node.height,
  ]);
  expect(changed.notes).toBe(node.notes);
  expect(changed.metadata.integration).toEqual(node.metadata.integration);
  expect(moved.edges).toEqual(graph.edges);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect(
    getSpatialNode(
      (await stored(request, graph.diagram.id)).nodes.find((value) => value.id === node.id)!,
    )?.position,
  ).toEqual(getSpatialNode(node)?.position);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  expect(
    getSpatialNode(
      (await stored(request, graph.diagram.id)).nodes.find((value) => value.id === node.id)!,
    )?.position,
  ).toEqual(getSpatialNode(changed)?.position);

  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  await saved(page);
  await expect.poll(async () => (await center(page, node.id)).face.side).toBe('back');
  const back = (await center(page, node.id)).face;
  expect(back.corners[0][0]).toBeLessThan(back.corners[1][0]);
  await expect(canvas).toHaveAttribute('data-face-source', '2d-node');
  const beforeCancel = await stored(request, graph.diagram.id);
  await startDrag(page, node.id, 70, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-object-dragging', 'false');
  expect((await stored(request, graph.diagram.id)).nodes).toEqual(beforeCancel.nodes);
  await startDrag(page, node.id, -60, 15);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-object-dragging', 'false');
  expect((await stored(request, graph.diagram.id)).nodes).toEqual(beforeCancel.nodes);
  await page.getByRole('button', { name: 'Move objects', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-object-mode', 'orbit');
});

test('2D dragging shifts an API-saved 3D placement and retains its depth after switching and reload', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const { graph, node } = await setup(page, request, '2D drag follows 3D');
  const scale = projectSpatialGraph(graph).scale;
  await page.getByRole('button', { name: 'Return to 2D', exact: true }).click();
  await saved(page);
  const card = page.locator(`.canvas-shell [data-testid="graph-node"][data-node-id="${node.id}"]`);
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 20, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  const after = await stored(request, graph.diagram.id),
    changed = after.nodes.find((value) => value.id === node.id)!;
  expect(changed.x).toBeGreaterThan(node.x);
  const explicit = getSpatialNode(changed)?.position!;
  expect(explicit.x).toBeCloseTo(((changed.x - node.x) / 100) * scale);
  expect(explicit.y).toBeCloseTo(-((changed.y - node.y) / 100) * scale);
  expect(explicit.z).toBe(0.8);
  expect(after.edges).toEqual(graph.edges);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready');
  await saved(page);
  await expect(page.getByLabel('3D X', { exact: true })).toHaveValue(String(explicit.x));
  await page.reload();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready');
  expect(
    getSpatialNode(
      (await stored(request, graph.diagram.id)).nodes.find((value) => value.id === node.id)!,
    )?.position,
  ).toEqual(explicit);
});
