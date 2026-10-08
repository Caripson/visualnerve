import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Graph } from '../../src/model/types';
import type { SimulationModel } from '../../src/simulation/types';

async function downloadSVG(page: Page, scope = 'complete') {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('svg');
  await expect(page.getByLabel('Export resolution')).toHaveCount(0);
  await page.getByLabel('Export area', { exact: true }).selectOption(scope);
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  return readFile((await download.path())!, 'utf8');
}
async function inspect(page: Page, xml: string) {
  return page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    return {
      invalid: !!doc.querySelector('parsererror'),
      unsafe: !!doc.querySelector('image,foreignObject,script,a,[href],[onclick]'),
      text: Array.from(doc.querySelectorAll('text'))
        .map((node) => node.textContent)
        .join(''),
      paths: Array.from(doc.querySelectorAll('path')).map((path) => path.getAttribute('d')),
      arrows: doc.querySelectorAll('marker').length,
      icons: doc.querySelectorAll('svg path,svg circle').length,
      pen: doc.querySelectorAll('[data-drawing-stroke-id]').length,
      nodes: [
        ...new Set(
          Array.from(doc.querySelectorAll('[data-node-id]')).map((node) =>
            node.getAttribute('data-node-id'),
          ),
        ),
      ],
      metadata: JSON.parse(doc.querySelector('metadata')!.textContent!),
      viewBox: doc.documentElement.getAttribute('viewBox'),
    };
  }, xml);
}
async function apiSVG(request: APIRequestContext, diagramId: string, extra = {}) {
  const response = await request.post('/api/v1/export', {
    data: { diagramId, format: 'svg', ...extra },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<string>;
}
async function rasterize(page: Page, xml: string) {
  return page.evaluate(async (xml) => {
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      let dark = 0,
        ink = 0;
      for (let index = 0; index < rgba.length; index += 4) {
        if (rgba[index] < 180 && rgba[index + 1] < 180 && rgba[index + 2] < 180) dark++;
        if (rgba[index] > 180 && rgba[index + 1] < 80 && rgba[index + 2] > 80) ink++;
      }
      return { dark, ink, png: canvas.toDataURL('image/png').split(',')[1] };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, xml);
}
test('SVG download and read-only REST/MCP retain native vectors, escaping, status, arrows and pen; 3D uses identical 2D geometry', async ({
  page,
  request,
}, info) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Native SVG', type: 'mindmap' } })
  ).json();
  let graph = (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          {
            externalId: 'root',
            title: 'Plan & <script>safe</script>',
            x: 0,
            y: 0,
            color: '#267044',
            status: 'done',
            metadata: { visualNerve: { icon: 'work' } },
          },
          { externalId: 'ship', title: 'Ship', x: 380, y: 90, color: '#a24e38' },
        ],
        edges: [
          {
            sourceExternalId: 'root',
            targetExternalId: 'ship',
            label: 'Ready & approved',
            direction: 'both',
            style: 'dashed',
          },
        ],
      },
    })
  ).json()) as Graph;
  await request.patch(`/api/v1/diagrams/${diagram.id}`, {
    data: {
      version: graph.diagram.version,
      settings: {
        ...graph.diagram.settings,
        drawing: {
          version: 1,
          visible: true,
          strokes: [
            {
              id: crypto.randomUUID(),
              color: '#ff0088',
              width: 6,
              points: [
                [0, -40],
                [500, -40],
              ],
            },
          ],
        },
      },
    },
  });
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
  const icon = page.locator(
    `.canvas-shell [data-node-id="${graph.nodes[0].id}"] svg.lucide-briefcase-business`,
  );
  await expect(icon).toHaveCount(1);
  const iconPaths = await icon
    .locator('path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
  const xml = await downloadSVG(page);
  const scene = await inspect(page, xml);
  expect(scene.invalid).toBe(false);
  expect(scene.unsafe).toBe(false);
  expect(scene.text).toContain('Plan & <script>safe</script>');
  expect(scene.text).toContain('Done');
  expect(scene.text).toContain('Ready & approved');
  expect(scene.paths.length).toBeGreaterThan(5);
  expect(scene.arrows).toBeGreaterThan(0);
  expect(scene.icons).toBeGreaterThan(0);
  expect(scene.paths).toEqual(expect.arrayContaining(iconPaths));
  expect(scene.pen).toBe(1);
  expect(scene.metadata).toMatchObject({
    format: 'visual-nerve-svg',
    scope: 'complete',
    view: '2d',
  });
  const image = await rasterize(page, xml);
  expect(image.dark).toBeGreaterThan(100);
  expect(image.ink).toBeGreaterThan(500);
  await info.attach('native-svg.svg', { body: xml, contentType: 'image/svg+xml' });
  await info.attach('native-svg-preview.png', {
    body: Buffer.from(image.png, 'base64'),
    contentType: 'image/png',
  });
  graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  await request.patch(`/api/v1/diagrams/${diagram.id}`, {
    data: {
      version: graph.diagram.version,
      settings: { ...graph.diagram.settings, spatialView: { version: 1, mode: '3d' } },
    },
  });
  const spatial = await inspect(page, await apiSVG(request, diagram.id));
  expect(spatial.viewBox).toBe(scene.viewBox);
  expect(spatial.nodes).toEqual(scene.nodes);
  expect(spatial.paths).toEqual(scene.paths);
  expect(spatial.text).toBe(scene.text);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  const rest = await apiSVG(request, diagram.id, {
    scope: 'selected',
    nodeIds: [graph.nodes[0].id],
  });
  expect((await inspect(page, rest)).nodes).toEqual([graph.nodes[0].id]);
  const mcp = await (
    await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 'svg-read',
        method: 'tools/call',
        params: {
          name: 'visual_nerve_request',
          arguments: {
            path: '/export',
            method: 'POST',
            data: { diagramId: diagram.id, format: 'svg' },
          },
        },
      },
    })
  ).json();
  expect(mcp.result.isError).toBe(false);
  expect(mcp.result.structuredContent.status).toBe(200);
  expect((await inspect(page, mcp.result.structuredContent.body)).nodes).toEqual(scene.nodes);
  expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
});
test('saved viewport SVG scales text, border and geometry at 0.5 and 2 without changing the crop', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name: 'SVG zoom', type: 'process' } })
  ).json();
  const node = await (
    await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
      data: { title: 'Zoom label', x: 50, y: 50, width: 200, height: 100 },
    })
  ).json();
  for (const zoom of [0.5, 2]) {
    const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
    await request.patch(`/api/v1/diagrams/${diagram.id}`, {
      data: {
        version: graph.diagram.version,
        settings: { ...graph.diagram.settings, viewport: { x: 40, y: 30, zoom } },
      },
    });
    const xml = await apiSVG(request, diagram.id, { scope: 'viewport' });
    const dimensions = await page.evaluate(
      ({ xml, id }) => {
        const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
        const group = doc.querySelector(`g[data-node-id="${id}"]`)!;
        const label = Array.from(group.querySelectorAll('text')).find(
          (text) => text.textContent === 'Zoom label',
        )!;
        return {
          x: Number(label.getAttribute('x')),
          font: parseFloat(label.getAttribute('font-size')!),
          border: Number(group.querySelector('path')?.getAttribute('stroke-width')),
          viewBox: doc.documentElement.getAttribute('viewBox'),
        };
      },
      { xml, id: node.id },
    );
    expect(dimensions.font).toBe(12 * zoom);
    expect(dimensions.border).toBe(zoom);
    expect(dimensions.x).toBeGreaterThan(40 + 50 * zoom);
    expect((await rasterize(page, xml)).dark).toBeGreaterThan(30);
    expect(dimensions.viewBox).toMatch(/^0 0 \d+ \d+$/);
  }
});
test('SVG exports drawing-only diagrams and all native Process Simulator capacity cards', async ({
  page,
  request,
}) => {
  const drawing = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Only SVG ink',
        settings: {
          drawing: {
            version: 1,
            visible: true,
            strokes: [
              {
                id: crypto.randomUUID(),
                color: '#ff0088',
                width: 8,
                points: [
                  [10, 20],
                  [100, 80],
                ],
              },
            ],
          },
        },
      },
    })
  ).json();
  const ink = await apiSVG(request, drawing.id);
  const scene = await inspect(page, ink);
  expect(scene.nodes).toHaveLength(0);
  expect(scene.pen).toBe(1);
  expect((await rasterize(page, ink)).ink).toBeGreaterThan(100);
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Vector capacity', type: 'process-simulator' },
    })
  ).json();
  const model = (await (
    await request.get(`/api/v1/diagrams/${diagram.id}/simulation`)
  ).json()) as SimulationModel;
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type !== 'work') throw new Error('Expected default work bank');
  work.work.capacity = 3;
  const graph = (await (
    await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
      data: { baseVersion: diagram.version, model },
    })
  ).json()) as Graph;
  const xml = await apiSVG(request, diagram.id);
  const capacity = await inspect(page, xml);
  const card = graph.nodes.find((node) => node.id === work.id)!;
  expect(capacity.nodes).toContain(card.id);
  expect(capacity.nodes).toContain(`simulation-capacity:${card.id}:2`);
  expect(capacity.nodes).toContain(`simulation-capacity:${card.id}:3`);
  expect(capacity.text).toContain(work.name);
  expect(capacity.text).toContain('Capacity 3');
  expect(capacity.text).toContain('Unit 2 of 3');
  expect(capacity.text).toContain('Unit 3 of 3');
  expect(capacity.unsafe).toBe(false);
  expect((await rasterize(page, xml)).dark).toBeGreaterThan(100);

  const otherSimulator = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Unrelated simulator', type: 'process-simulator' },
    })
  ).json();
  const saved = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  for (const openId of [drawing.id, otherSimulator.id]) {
    const openButton = page.locator(`button[data-diagram-id="${openId}"]`);
    await openButton.click();
    await expect(openButton).toHaveClass(/active/);
    const isolated = await inspect(page, await apiSVG(request, diagram.id));
    expect(isolated.text).toContain('Capacity 3');
    expect(isolated.text).toContain('Unit 2 of 3');
    expect(isolated.text).toContain('Unit 3 of 3');
    expect(isolated.nodes).toContain(card.id);
    await expect(openButton).toHaveClass(/active/);
    expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(saved);
  }
});
