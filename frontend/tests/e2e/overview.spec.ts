import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { browserLaunchOptions } from '../../playwright.config';
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

async function graph(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function controls(page: Page) {
  const controls = page.getByTestId('overview-controls');
  if ((await controls.getAttribute('open')) === null) await controls.locator('summary').click();
  return controls;
}
async function create(request: APIRequestContext) {
  const d = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Compact truck lifecycle',
        type: 'process',
        settings: { viewport: { x: 50, y: 100, zoom: 0.55 }, viewportDevice: 'desktop' },
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
        data: {
          nodes: Array.from({ length: 12 }, (_, i) => ({
            externalId: `stage-${i}`,
            nodeType: i % 3 === 0 ? 'database' : i % 3 === 1 ? 'process' : 'decision',
            title: `Truck stage ${i}`,
            description: `Lifecycle description ${i}`,
            tags: [i < 6 ? 'Assembly' : 'Service'],
            status: i % 2 ? 'done' : 'blocked',
            color: i < 6 ? '#397356' : '#7c518d',
            x: 100 + i * 555,
            y: 150 + (i % 3) * 260,
            width: 240,
            height: 140,
            metadata: { visualNerve: { icon: i % 3 === 0 ? 'technology' : 'work' } },
          })),
          edges: [
            {
              sourceExternalId: 'stage-0',
              targetExternalId: 'stage-6',
              edgeType: 'delivers',
              label: 'Handoff',
              direction: 'forward',
            },
            {
              sourceExternalId: 'stage-1',
              targetExternalId: 'stage-7',
              edgeType: 'delivers',
              label: 'Handoff followup',
              direction: 'forward',
            },
            {
              sourceExternalId: 'stage-6',
              targetExternalId: 'stage-0',
              edgeType: 'reports',
              label: 'Service report',
              direction: 'forward',
            },
            {
              sourceExternalId: 'stage-2',
              targetExternalId: 'stage-3',
              edgeType: 'validates',
              direction: 'both',
              style: 'dashed',
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  return graph(request, d.id);
}
async function exportPng(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('png');
  await page.getByLabel('Export area', { exact: true }).selectOption('complete');
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  return readFile((await (await downloading).path())!);
}
test('semantic overview retains counts/directions, native styles, shared 2D/3D export and canonical Details layout', async ({
  page,
  request,
}, testInfo) => {
  const created = await create(request);
  await page.goto('/');
  await page.locator('.diagram-item').filter({ hasText: created.diagram.name }).click();
  await expect(page.locator(`[data-node-id="${created.nodes[0].id}"]`).first()).toBeVisible();
  await saved(page);
  const before = await graph(request, created.diagram.id);
  const beforeStyle = await page
    .locator(`[data-node-id="${created.nodes[0].id}"]`)
    .first()
    .evaluate((node) => ({
      accent: (node as HTMLElement).style.getPropertyValue('--node-accent'),
      icon: node.querySelector('.node-topline svg')?.outerHTML,
    }));
  let box = await controls(page);
  await box.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(1);
  await expect(page.getByTestId('overview-group')).toHaveAttribute('data-overview-count', '12');
  await expect(page.getByTestId('overview-group')).toContainText('Done');
  await expect(page.getByTestId('overview-group')).toContainText('Blocked');
  await page.getByRole('button', { name: 'Expand overview group Tags', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(2);
  await saved(page);
  const ids = await page
    .getByTestId('overview-group')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-node-id')).sort());
  const compact = await (
    await request.get(`/api/v1/diagrams/${before.diagram.id}/overview/projection?zoom=0.1`)
  ).json();
  expect(Object.keys(compact.nodeMap)).toHaveLength(12);
  expect(Object.keys(compact.edgeMap)).toHaveLength(4);
  expect(compact.counts.representedNodes).toBe(2);
  expect(
    compact.relationships.find((r: { edgeType: string }) => r.edgeType === 'delivers').edgeIds,
  ).toHaveLength(2);
  expect(compact.relationships.some((r: { internal: boolean }) => r.internal)).toBe(true);
  await page.getByRole('button', { name: 'Expand overview group Assembly', exact: true }).click();
  await expect(page.locator(`[data-node-id="${before.nodes[0].id}"]`).first()).toBeVisible();
  const expandedStyle = await page
    .locator(`[data-node-id="${before.nodes[0].id}"]`)
    .first()
    .evaluate((node) => ({
      accent: (node as HTMLElement).style.getPropertyValue('--node-accent'),
      icon: node.querySelector('.node-topline svg')?.outerHTML,
    }));
  expect(expandedStyle).toEqual(beforeStyle);
  box = await controls(page);
  await expect(box.getByRole('button', { name: 'Back one level', exact: true })).toBeEnabled();
  await box.getByRole('button', { name: 'Back one level', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(2);
  await saved(page);
  await expect(page.locator('.react-flow__edge').filter({ hasText: 'delivers ×2' })).toHaveCount(1);
  await expect(page.locator('.react-flow__edge').filter({ hasText: 'reports ×1' })).toHaveCount(1);
  await box.locator('summary').click();
  const canvasClip = await page.getByTestId('canvas').boundingBox();
  expect(canvasClip).not.toBeNull();
  await page.screenshot({ path: '/tmp/visualnerve-semantic-overview.png', clip: canvasClip! });
  const compact2d = await exportPng(page);
  expect(compact2d.readUInt32BE(16)).toBeLessThan(1500);
  await testInfo.attach('semantic-overview-2d.png', { body: compact2d, contentType: 'image/png' });
  expect((await graph(request, before.diagram.id)).nodes).toEqual(before.nodes);
  expect((await graph(request, before.diagram.id)).edges).toEqual(before.edges);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-rendered-nodes', '2');
  await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-face-source', '2d-node', {
    timeout: 30000,
  });
  const faces = JSON.parse(
    (await page.getByTestId('spatial-canvas').getAttribute('data-face-projections')) ?? '[]',
  );
  expect(faces.map((f: { id: string }) => f.id).sort()).toEqual(ids);
  await page.getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true }).click();
  await saved(page);
  const compact3d = await exportPng(page);
  expect(compact3d.readUInt32BE(16)).toBe(compact2d.readUInt32BE(16));
  expect(compact3d.readUInt32BE(20)).toBe(compact2d.readUInt32BE(20));
  await testInfo.attach('semantic-overview-planar-export-from-3d.png', {
    body: compact3d,
    contentType: 'image/png',
  });
  const after3d = await graph(request, before.diagram.id);
  expect(after3d.nodes).toEqual(before.nodes);
  expect(after3d.edges).toEqual(before.edges);
  expect(after3d.diagram.settings.spatialView?.camera).toEqual(
    before.diagram.settings.spatialView?.camera,
  );
  await page.getByRole('button', { name: 'Return to 2D', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(2);
  box = await controls(page);
  await box.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByTestId('overview-group')).toHaveCount(0);
  await expect(page.locator(`[data-node-id="${before.nodes[0].id}"]`).first()).toBeVisible();
  await saved(page);
  const after = await graph(request, before.diagram.id);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  expect(after.diagram.settings.viewport).toEqual(before.diagram.settings.viewport);
  const afterStyle = await page
    .locator(`[data-node-id="${before.nodes[0].id}"]`)
    .first()
    .evaluate((node) => ({
      accent: (node as HTMLElement).style.getPropertyValue('--node-accent'),
      icon: node.querySelector('.node-topline svg')?.outerHTML,
    }));
  expect(afterStyle).toEqual(beforeStyle);
});
