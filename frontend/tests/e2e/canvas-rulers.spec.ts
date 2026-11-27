import type { Locator } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';

type Point = { x: number; y: number };

async function drag(page: Page, from: Point, to: Point, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}

function cursorAtCenter(target: Locator) {
  return target.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return hit && element.contains(hit) ? getComputedStyle(hit).cursor : '';
  });
}

test('2D rulers create, move, hide and remove saved diagram guides', async ({ page, request }) => {
  const name = 'Canvas guide editing';
  const viewport = { x: 60, y: 80, zoom: 1.25 };
  const created = await request.post('/api/v1/diagrams', {
    data: { name, type: 'flowchart', settings: { viewport, viewportDevice: 'desktop' } },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: { nodes: [{ externalId: 'reference', title: 'Reference object', x: 30, y: 40 }] },
  });
  expect(populated.ok()).toBe(true);
  const { nodes } = (await populated.json()) as Graph;
  const readGraph = async (): Promise<Graph> =>
    (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  const readSettings = async () => (await readGraph()).diagram.settings;

  await page.locator('.diagram-item').getByText(name, { exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  const flow = page.locator('.canvas-shell .react-flow');
  await expect
    .poll(() =>
      flow.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      }),
    )
    .toEqual(viewport);

  const horizontalRuler = page.getByRole('button', { name: 'Horizontal ruler', exact: true });
  const verticalRuler = page.getByRole('button', { name: 'Vertical ruler', exact: true });
  const toggle = page.getByRole('button', { name: 'Rulers and guides', exact: true });
  const horizontal = page.locator('.canvas-guide[data-axis="horizontal"]');
  const vertical = page.locator('.canvas-guide[data-axis="vertical"]');
  await expect(horizontalRuler).toBeVisible();
  await expect(verticalRuler).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const canvas = (await flow.boundingBox())!;
  const top = (await horizontalRuler.boundingBox())!;
  const left = (await verticalRuler.boundingBox())!;
  const guideX = canvas.x + viewport.x + 280 * viewport.zoom;
  const initialY = canvas.y + viewport.y + 200 * viewport.zoom;
  const movedY = canvas.y + viewport.y + 300 * viewport.zoom;

  await drag(page, { x: guideX, y: top.y + top.height / 2 }, { x: guideX, y: initialY });
  await expect(horizontal).toBeVisible();
  await drag(page, { x: left.x + left.width / 2, y: movedY }, { x: guideX, y: movedY });
  await expect(vertical).toBeVisible();
  const verticalGuide = expect.objectContaining({
    axis: 'vertical',
    position: expect.closeTo(280, 0),
  });
  await expect
    .poll(async () => (await readSettings()).canvasGuides)
    .toEqual([
      expect.objectContaining({ axis: 'horizontal', position: expect.closeTo(200, 0) }),
      verticalGuide,
    ]);

  await drag(page, { x: guideX + 40, y: initialY }, { x: guideX + 40, y: movedY });
  const horizontalGuide = expect.objectContaining({
    axis: 'horizontal',
    position: expect.closeTo(300, 0),
  });
  await expect
    .poll(async () => (await readSettings()).canvasGuides)
    .toEqual([horizontalGuide, verticalGuide]);

  const corner = page.locator('.canvas-ruler-corner');
  const cornerBox = (await corner.boundingBox())!;
  const origin = { x: 152, y: 132 };
  await drag(
    page,
    { x: cornerBox.x + cornerBox.width / 2, y: cornerBox.y + cornerBox.height / 2 },
    {
      x: canvas.x + viewport.x + origin.x * viewport.zoom,
      y: canvas.y + viewport.y + origin.y * viewport.zoom,
    },
  );
  await expect.poll(readSettings).toMatchObject({
    rulerOrigin: { x: expect.closeTo(origin.x, 0), y: expect.closeTo(origin.y, 0) },
    canvasGuides: [horizontalGuide, verticalGuide],
  });
  await corner.dblclick();
  await expect
    .poll(async () => (await readSettings()).rulerOrigin ?? { x: 0, y: 0 })
    .toEqual({ x: 0, y: 0 });

  const pan = { x: canvas.x + canvas.width - 120, y: canvas.y + 155 };
  await drag(page, pan, { x: pan.x + 35, y: pan.y + 25 }, 'middle');
  await expect
    .poll(async () => {
      const bounds = (await horizontal.boundingBox())!;
      return Math.abs(bounds.y + bounds.height / 2 - movedY - 25);
    })
    .toBeLessThan(2);
  expect(await horizontalRuler.boundingBox()).toEqual(top);
  expect(await verticalRuler.boundingBox()).toEqual(left);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(horizontalRuler).toBeHidden();
  await expect(verticalRuler).toBeHidden();
  await expect(horizontal).toBeHidden();
  await expect(vertical).toBeHidden();
  await expect
    .poll(readSettings)
    .toMatchObject({ showRulers: false, canvasGuides: [horizontalGuide, verticalGuide] });
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+r');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(horizontalRuler).toBeVisible();
  await expect(verticalRuler).toBeVisible();
  await expect(horizontal).toBeVisible();
  await expect(vertical).toBeVisible();

  const node = flow.locator(`.react-flow__node[data-id="${nodes[0].id}"]`);
  await node.click();
  await expect(node).toHaveClass(/\bselected\b/);
  await horizontal.press('Delete');
  await expect(horizontal).toHaveCount(0);
  await expect(vertical).toBeVisible();
  await expect.poll(async () => (await readSettings()).canvasGuides).toEqual([verticalGuide]);
  expect((await readGraph()).nodes.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id));
  await page.reload();
  await expect(vertical).toBeVisible();
  await expect(horizontal).toHaveCount(0);

  const line = (await vertical.boundingBox())!;
  const ruler = (await verticalRuler.boundingBox())!;
  const middle = line.y + line.height / 2;
  await drag(
    page,
    { x: line.x + line.width / 2, y: middle },
    { x: ruler.x + ruler.width / 2, y: middle },
  );
  await expect(vertical).toHaveCount(0);
  await expect.poll(async () => (await readSettings()).canvasGuides).toEqual([]);
});

test('canvas editing shortcuts fill and draw while text fields keep ordinary typing', async ({
  page,
  request,
}) => {
  const name = 'Canvas editing shortcuts';
  const created = await request.post('/api/v1/diagrams', {
    data: {
      name,
      type: 'flowchart',
      settings: { viewport: { x: 30, y: 30, zoom: 1 }, viewportDevice: 'desktop' },
    },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const added = await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
    data: { title: 'Original title', x: 60, y: 70 },
  });
  expect(added.status()).toBe(201);
  const { id } = await added.json();
  await page.locator('.diagram-item').getByText(name, { exact: true }).click();

  const canvas = page.getByTestId('canvas');
  const node = canvas.locator(`[data-node-id="${id}"]`);
  const editing = canvas.getByRole('textbox', { name: 'Node title', exact: true });
  const drawing = canvas.getByTestId('drawing-surface');
  const fill = canvas.getByRole('button', { name: 'Fill nodes', exact: true });
  const readGraph = async (): Promise<Graph> =>
    (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();

  await node.click();
  await page.keyboard.press('t');
  await expect(editing).toBeFocused();
  await expect(editing).toHaveValue('Original title');
  await editing.fill('');
  await editing.pressSequentially('begtv');
  await expect(editing).toHaveValue('begtv');
  await expect(drawing).toBeHidden();
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await editing.press('Enter');
  await expect(node).toContainText('begtv');

  const bounds = (await canvas.boundingBox())!;
  const blank = { x: bounds.x + bounds.width * 0.75, y: bounds.y + bounds.height * 0.35 };
  await page.mouse.click(blank.x, blank.y);
  await page.keyboard.press('t');
  await expect(editing).toBeFocused();
  await expect(editing).toHaveValue('Note');
  await editing.fill('Keyboard note');
  await editing.press('Enter');
  await expect
    .poll(async () => (await readGraph()).nodes.map(({ title, nodeType }) => ({ title, nodeType })))
    .toEqual([
      { title: 'begtv', nodeType: 'generic' },
      { title: 'Keyboard note', nodeType: 'note' },
    ]);

  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.mouse.click(blank.x, blank.y);
  await expect(canvas.locator('.react-flow__node.selected')).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas.locator('.react-flow.canvas-fill-active')).toBeVisible();
  const fillColor = canvas.getByLabel('Fill color', { exact: true });
  const backgroundColor = '#4b62a7';
  await expect(fillColor).toHaveAttribute('type', 'color');
  await fillColor.fill(backgroundColor);
  await expect(node).not.toHaveAttribute('data-node-background');

  const cursorURL = /^url\("([^"]+)"\)/;
  const cursorFallback = /,\s*crosshair$/;
  await node.hover();
  const fillCursor = await cursorAtCenter(node);
  expect(fillCursor).toMatch(cursorURL);
  expect(fillCursor).toMatch(cursorFallback);
  const card = (await node.boundingBox())!;
  await drag(
    page,
    { x: card.x + card.width * 0.35, y: card.y + card.height * 0.5 },
    { x: card.x + card.width * 0.65, y: card.y + card.height * 0.5 },
  );
  await expect(node).not.toHaveAttribute('data-node-background');
  await node.click();
  await expect(node).toHaveAttribute('data-node-background', backgroundColor);
  await expect
    .poll(async () => (await readGraph()).nodes.find((item) => item.id === id)?.backgroundColor)
    .toBe(backgroundColor);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(node).not.toHaveAttribute('data-node-background');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(node).toHaveAttribute('data-node-background', backgroundColor);

  await page.mouse.click(blank.x, blank.y);
  await page.keyboard.press('b');
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await drawing.hover();
  const penCursor = await cursorAtCenter(drawing);
  expect(penCursor).toMatch(cursorURL);
  expect(penCursor).toMatch(cursorFallback);
  expect(penCursor.match(cursorURL)?.[1]).not.toBe(fillCursor.match(cursorURL)?.[1]);
  await page.keyboard.press('e');
  await expect(canvas.getByRole('button', { name: 'Eraser', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('v');
  await expect(drawing).toBeHidden();
  await expect(
    canvas.getByRole('button', { name: 'Draw on diagram', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('g');
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await fillColor.focus();
  await page.keyboard.press('v');
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('g');
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(node).toHaveAttribute('data-node-background', backgroundColor);
});
