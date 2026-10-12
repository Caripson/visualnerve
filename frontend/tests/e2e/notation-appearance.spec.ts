import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';

const symbols = [
  ['hipo', 'display'],
  ['dfd-yourdon', 'process'],
  ['dfd-gane-sarson', 'process'],
  ['dfd-gane-sarson', 'data-store'],
  ['uml', 'use-case'],
  ['bpmn', 'task'],
  ['uml', 'template-classifier'],
] as const;

async function appearance(page: Page, id: string) {
  return page.locator(`.canvas-shell [data-node-id="${id}"]`).evaluate((node) => {
    const style = getComputedStyle(node);
    const outline = getComputedStyle(node.querySelector('.notation-outline')!);
    return {
      wrapper: style.backgroundColor,
      fill: outline.fill,
      text: style.color,
      themeFill: getComputedStyle(document.documentElement).getPropertyValue('--node-bg').trim(),
      themeText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
    };
  });
}

test('PNG export paints only the rounded contour and keeps an open DFD store empty', async ({
  page,
  request,
}, info) => {
  expect((await request.put('/api/v1/settings/theme', { data: { value: 'dark' } })).ok()).toBe(
    true,
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Contour export', type: 'freeform' } })
  ).json();
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: ['process', 'data-store'].map((symbol, index) => ({
        title: index === 0 ? 'Receive order' : 'Orders',
        x: 0,
        y: index * 200,
        width: 240,
        height: 140,
        color: '#47766b',
        backgroundColor: '#E4EEE9',
        notation: { collection: 'dfd-gane-sarson', symbol },
      })),
    },
  });
  expect(populated.status(), await populated.text()).toBe(200);
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.locator('.canvas-shell .notation-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('png');
  await page.getByLabel('Export area').selectOption('complete');
  await page.getByLabel('Export resolution').selectOption('1');
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading;
  const bytes = await readFile((await download.path())!);
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    const titleRegion = context.getImageData(120, 250, 140, 50).data;
    let readableTitlePixels = 0;
    for (let i = 0; i < titleRegion.length; i += 4)
      if (titleRegion[i] > 180 && titleRegion[i + 1] > 180 && titleRegion[i + 2] > 180)
        readableTitlePixels++;
    return {
      width: image.width,
      height: image.height,
      corner: pixel(42, 42),
      interior: pixel(240, 140),
      openStore: pixel(240, 340),
      readableTitlePixels,
    };
  }, bytes.toString('base64'));
  expect(pixels).toMatchObject({
    width: 320,
    height: 420,
    corner: [23, 28, 25, 255],
    interior: [228, 238, 233, 255],
    openStore: [23, 28, 25, 255],
  });
  expect(pixels.readableTitlePixels).toBeGreaterThan(20);
  await info.attach('rounded-and-open-contours.png', { body: bytes, contentType: 'image/png' });
});

async function emptyRegionPixels(page: Page, nodes: Graph['nodes']) {
  const shell = page.locator('.canvas-shell');
  const bounds = (await shell.boundingBox())!;
  const points = [];
  for (const node of nodes) {
    if (!['dfd-yourdon', 'dfd-gane-sarson', 'uml', 'bpmn'].includes(node.notation!.collection))
      continue;
    const box = (await page.locator(`.canvas-shell [data-node-id="${node.id}"]`).boundingBox())!;
    const open = node.notation!.symbol === 'data-store';
    points.push({
      name: node.title,
      x: Math.round(box.x - bounds.x + box.width * (open ? 0.8 : 0.01)),
      y: Math.round(box.y - bounds.y + box.height * (open ? 0.8 : 0.01)),
    });
  }
  const bytes = await shell.screenshot({ animations: 'disabled' });
  return page.evaluate(
    async ({ encoded, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return points.map(({ name, x, y }) => ({
        name,
        rgba: [...context.getImageData(x, y, 1, 1).data],
      }));
    },
    { encoded: bytes.toString('base64'), points },
  );
}

for (const width of [390, 1440])
  test(`all notation families keep theme-aware glyph fills and transparent wrappers at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await request.post('/api/v1/diagrams', {
      data: { name: 'Notation appearance regression', type: 'freeform' },
    });
    expect(created.status()).toBe(201);
    const diagram = await created.json();
    const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: symbols.map(([collection, symbol], index) => ({
          title: `${collection} ${symbol}`,
          externalId: `shape-${index}`,
          x: (index % 2) * 290,
          y: Math.floor(index / 2) * 190,
          width: 240,
          height: 140,
          color: '#47766b',
          notation: {
            collection,
            symbol,
            ...(symbol === 'template-classifier'
              ? { compartments: [{ id: 'parameters', lines: ['T: Item'] }] }
              : {}),
          },
        })),
      },
    });
    expect(populated.status(), await populated.text()).toBe(200);
    const graph = (await populated.json()) as Graph;
    if (width < 900) await page.getByRole('button', { name: 'Open projects', exact: true }).click();
    await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
    await expect(page.locator('.canvas-shell .notation-node')).toHaveCount(symbols.length);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    for (const theme of ['light', 'dark'] as const) {
      expect((await request.put('/api/v1/settings/theme', { data: { value: theme } })).ok()).toBe(
        true,
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Inline editing may focus/pan the selected object; refit before sampling the next theme.
      await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
      for (const node of graph.nodes) {
        const values = await appearance(page, node.id);
        expect(values.wrapper, `${node.title} must not paint a rectangle`).toBe('rgba(0, 0, 0, 0)');
        if (node.notation?.symbol === 'data-store') expect(values.fill).toBe('none');
        else expect(values.fill).toBe(theme === 'dark' ? 'rgb(36, 45, 39)' : 'rgb(255, 255, 255)');
        expect(values.text).toBe(theme === 'dark' ? 'rgb(225, 231, 225)' : 'rgb(31, 45, 40)');
      }
      // A saved color must survive a theme change without filling the glyph's empty corners.
      for (const fill of ['#E4EEE9', '#172d55']) {
        for (const node of graph.nodes) {
          const current = (await (
            await request.get(`/api/v1/diagrams/${diagram.id}`)
          ).json()) as Graph;
          const version = current.nodes.find((entry) => entry.id === node.id)!.version;
          const changed = await request.patch(`/api/v1/nodes/${node.id}`, {
            data: { version, backgroundColor: fill },
          });
          expect(changed.status()).toBe(200);
          const values = await appearance(page, node.id);
          expect(values.wrapper).toBe('rgba(0, 0, 0, 0)');
          expect(values.fill).toBe(
            node.notation?.symbol === 'data-store'
              ? 'none'
              : fill === '#E4EEE9'
                ? 'rgb(228, 238, 233)'
                : 'rgb(23, 45, 85)',
          );
          expect(values.text).toBe(
            node.notation?.symbol === 'data-store'
              ? theme === 'dark'
                ? 'rgb(225, 231, 225)'
                : 'rgb(31, 45, 40)'
              : fill === '#E4EEE9'
                ? 'rgb(0, 0, 0)'
                : 'rgb(255, 255, 255)',
          );
          if (node.notation?.symbol === 'template-classifier') {
            const shape = page.locator(`.canvas-shell [data-node-id="${node.id}"]`);
            await expect(shape.locator('.notation-background')).toHaveCSS('fill', values.fill);
            await expect(shape.locator('.notation-fixed-section')).toHaveCSS('color', values.text);
          }
        }
        if (theme === 'dark' && fill === '#E4EEE9')
          for (const pixel of await emptyRegionPixels(page, graph.nodes)) {
            // Dark canvas/grid pixels remain dark outside the real contour, even for a pale fill.
            expect(Math.max(...pixel.rgba.slice(0, 3)), `${pixel.name} empty region`).toBeLessThan(
              90,
            );
            expect(pixel.rgba[3]).toBe(255);
          }
      }
      const current = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
      const reset = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          upsert: true,
          baseVersion: current.diagram.version,
          nodes: current.nodes.map((node) => ({
            externalId: node.externalId,
            backgroundColor: null,
          })),
        },
      });
      expect(reset.status(), await reset.text()).toBe(200);
      for (const node of graph.nodes)
        expect((await appearance(page, node.id)).wrapper).toBe('rgba(0, 0, 0, 0)');
      const store = graph.nodes.find((node) => node.notation?.symbol === 'data-store')!;
      await page.locator(`.canvas-shell [data-node-id="${store.id}"] .node-title`).click();
      await page.keyboard.press('F2');
      const input = page.locator('.canvas-shell .node-title-input');
      await expect(input).toBeVisible();
      await expect(input).toHaveCSS(
        'color',
        theme === 'dark' ? 'rgb(225, 231, 225)' : 'rgb(31, 45, 40)',
      );
      await expect(input).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(32, 37, 34)' : 'rgb(253, 253, 251)',
      );
      await input.press('Escape');
      await info.attach(`notation-${width}-${theme}.png`, {
        body: await page.locator('.canvas-shell').screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
    }
  });
