import { expect, test, type Page } from './fixtures';
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

async function cardStyles(page: Page) {
  return page
    .getByTestId('canvas')
    .getByTestId('graph-node')
    .evaluateAll((cards) =>
      cards
        .map((card) => {
          const style = getComputedStyle(card);
          const wrapper = card.closest('.react-flow__node')!;
          return {
            id: (card as HTMLElement).dataset.nodeId,
            shape: card.className,
            transform: style.transform,
            rotate: style.rotate,
            perspective: style.perspective,
            inlineStyle: (card as HTMLElement).getAttribute('style'),
            wrapperTransform: (wrapper as HTMLElement).style.transform,
            titleTransform: getComputedStyle(card.querySelector('.node-title')!).transform,
          };
        })
        .sort((a, b) => a.id!.localeCompare(b.id!)),
    );
}

test('keeps every 2D card transform after rotated 3D views and cancelled face captures', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  // Keep rasterization pending long enough to exercise returning while faces load.
  await page.evaluate(() => {
    const originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.startsWith('data:image/svg+xml'))
        await new Promise((resolve) => setTimeout(resolve, 400));
      return originalDecode.call(this);
    };
  });
  const name = 'Card transform isolation';
  const created = await request.post('/api/v1/diagrams', { data: { name, type: 'process' } });
  expect(created.status()).toBe(201);
  const diagram = (await created.json()) as Graph['diagram'];
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'box',
          title: 'Always flat',
          nodeType: 'process',
          x: 100,
          y: 100,
          width: 260,
          height: 100,
        },
        {
          externalId: 'input',
          title: 'Styled input',
          nodeType: 'input',
          x: 500,
          y: 100,
          width: 260,
          height: 100,
        },
        {
          externalId: 'database',
          title: 'Rounded database',
          nodeType: 'database',
          x: 260,
          y: 330,
          width: 260,
          height: 100,
        },
      ],
      edges: [{ sourceExternalId: 'input', targetExternalId: 'box' }],
    },
  });
  expect(populated.ok()).toBe(true);
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('canvas').getByTestId('graph-node')).toHaveCount(3);
  const before = await cardStyles(page);
  const geometry = ((await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph)
    .nodes;
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '3D view', exact: true }).click();
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
      timeout: 30000,
    });
    if (cycle) {
      await expect(page.getByTestId('spatial-canvas')).toHaveAttribute(
        'data-face-source',
        '2d-node',
        { timeout: 30000 },
      );
      await page
        .getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true })
        .click();
    }
    await page.getByRole('button', { name: 'Return to 2D', exact: true }).click();
    await expect(page.getByTestId('canvas').getByTestId('graph-node')).toHaveCount(3);
    await expect(page.locator('.spatial-face-capture')).toHaveCount(0);
    await expect.poll(() => cardStyles(page)).toEqual(before);
  }
  const after = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(after.nodes).toEqual(geometry);
});
