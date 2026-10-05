import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function newMap(request: APIRequestContext, name: string) {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name, type: 'mindmap' },
    })
  ).json();
  const root = await (
    await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
      data: {
        title: 'Our project',
        x: 0,
        y: 0,
        width: 220,
        height: 112,
        metadata: { integration: { key: 'retained' } },
      },
    })
  ).json();
  return { diagram, root };
}
async function graph(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
async function open(page: Page, name: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.getByRole('button', { name: 'Open projects' }).click();
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
}

test('quick project renaming, colors, domain icons, duplication and reversible deletion', async ({
  page,
  request,
}) => {
  const { diagram, root } = await newMap(request, 'Quick work');
  await open(page, 'Quick work');
  await expect(page.getByRole('link', { name: 'Visual Nerve on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/Caripson/visualnerve',
  );
  await page.getByRole('button', { name: 'Rename project' }).click();
  await page.getByLabel('Project name', { exact: true }).fill('A clearer project name');
  await page.getByLabel('Project name', { exact: true }).press('Enter');
  await saved(page);
  expect((await graph(request, diagram.id)).diagram.name).toBe('A clearer project name');
  await page.keyboard.press('F2');
  await page.getByLabel('Project name', { exact: true }).fill('Discarded name');
  await page.getByLabel('Project name', { exact: true }).press('Escape');
  await expect(
    page.getByRole('heading', { name: 'A clearer project name', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByLabel('Project icon', { exact: true }).click();
  await page
    .locator('.project-icon-picker')
    .getByRole('button', { name: 'Icon: Work', exact: true })
    .click();
  const topic = page.locator(`[data-node-id="${root.id}"]`);
  await topic.click();
  await page.getByLabel('Choose color', { exact: true }).click();
  await page.getByRole('button', { name: 'Color: Forest', exact: true }).click();
  await page.getByLabel('Choose icon', { exact: true }).click();
  await page
    .locator('.selection-tools')
    .getByRole('button', { name: 'Icon: Nature', exact: true })
    .click();
  await expect(topic.locator('[data-area-icon="nature"]')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click();
  await saved(page);
  let current = await graph(request, diagram.id);
  expect(current.nodes).toHaveLength(2);
  expect(current.nodes[1].metadata).toEqual({
    integration: { key: 'retained' },
    visualNerve: { icon: 'nature' },
  });
  await page
    .locator('.selection-tools')
    .getByRole('button', { name: 'Delete selection', exact: true })
    .click();
  await saved(page);
  expect((await graph(request, diagram.id)).nodes).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await graph(request, diagram.id)).nodes).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A clearer project name', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(topic.locator('[data-area-icon="nature"]')).toBeVisible();
  current = await graph(request, diagram.id);
  expect(current.diagram.metadata.visualNerve).toEqual({ icon: 'work' });
  expect(current.nodes[0].color).toBe('#23664d');
  await page.goto('/license/');
  await expect(page.getByRole('heading', { name: 'MIT License', exact: true })).toBeVisible();
  await expect(page.locator('.help-page')).toContainText('2026 Johan Caripson');
});

test('eight topic levels stay visible while typing and retain backgrounds, colors and hierarchy', async ({
  page,
  request,
}) => {
  const { diagram, root } = await newMap(request, 'Deep mind map');
  await open(page, 'Deep mind map');
  await page.locator(`[data-node-id="${root.id}"]`).click();
  await page.keyboard.press('Tab');
  for (let depth = 1; depth <= 8; depth++) {
    const editor = page.getByLabel('Edit topic', { exact: true });
    await expect(editor).toBeFocused();
    // CSS transforms can round a fully visible intersection to just below 1.
    await expect(editor).toBeInViewport({ ratio: 0.999 });
    await editor.fill(`Level ${depth}`);
    await editor.press(depth < 8 ? 'Tab' : 'Enter');
  }
  await saved(page);
  const created = await graph(request, diagram.id);
  expect(created.nodes).toHaveLength(9);
  for (let depth = 1; depth <= 8; depth++) {
    const node = created.nodes.find((node) => node.title === `Level ${depth}`)!;
    expect(node.parentId).toBe(
      depth === 1
        ? root.id
        : created.nodes.find((parent) => parent.title === `Level ${depth - 1}`)!.id,
    );
  }
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await page.getByRole('button', { name: 'Focus map', exact: true }).click();
  await saved(page);
  await expect(page.locator('.mindmap-topic')).toHaveCount(9);
  for (let depth = 0; depth <= 8; depth++) {
    const topic = page.locator(`.mindmap-topic[data-topic-depth="${depth}"]`);
    await expect(topic).toBeVisible();
    const style = await topic.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        background: css.backgroundColor,
        border: css.borderTopStyle,
        color: css.getPropertyValue('--branch-color'),
      };
    });
    expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.background).not.toBe('transparent');
    if (depth > 1) expect(style.border).toBe('solid');
    if (depth > 0) expect(style.color.trim()).toBe('#23664d');
  }
  await page.screenshot({ path: '../docs/acceptance/mindmap-many-levels.png' });
  const first = created.nodes.find((node) => node.title === 'Level 1')!;
  const firstTopic = page.locator(`[data-node-id="${first.id}"]`);
  await firstTopic.getByRole('button', { name: 'Collapse branch', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(2);
  await firstTopic.getByRole('button', { name: 'Expand branch', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(9);
  await firstTopic.click();
  await page.getByRole('button', { name: 'Delete branch', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const restored = await graph(request, diagram.id);
  expect(restored.nodes.map((node) => [node.id, node.title, node.parentId])).toEqual(
    created.nodes.map((node) => [node.id, node.title, node.parentId]),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(9);
  await expect(page.locator('.mindmap-topic[data-topic-depth="8"]')).toHaveCSS(
    'border-top-style',
    'solid',
  );
});

test.describe('phone workspace', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('projects, properties, icon and color pickers, touch pan and quick deletion fit a phone', async ({
    page,
    request,
  }) => {
    const { diagram, root } = await newMap(request, 'Phone project');
    await open(page, 'Phone project', true);
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.canvas-shell')).toHaveCSS('width', '390px');
    const topic = page.locator(`[data-node-id="${root.id}"]`);
    await expect(topic).toBeInViewport({ ratio: 1 });
    const box = (await topic.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(175);
    await topic.tap();
    await page.getByLabel('Choose color', { exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Color: Teal', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.getByRole('button', { name: 'Color: Teal', exact: true }).tap();
    await page.getByLabel('Choose icon', { exact: true }).tap();
    await expect(page.locator('.selection-tools .icon-picker')).toBeInViewport({ ratio: 1 });
    await page
      .locator('.selection-tools')
      .getByRole('button', { name: 'Icon: Learning', exact: true })
      .tap();
    await expect(topic.locator('[data-area-icon="learning"]')).toBeVisible();
    await page.getByRole('button', { name: 'Edit selected item', exact: true }).tap();
    await expect(page.getByLabel('Node title', { exact: true })).toBeVisible();
    await page.getByLabel('Node title', { exact: true }).fill('Learning on my phone');
    await page.screenshot({ path: '../docs/acceptance/mobile-properties.png' });
    await page.getByRole('button', { name: 'Close properties', exact: true }).tap();
    await expect(page.locator('.properties-shell')).toBeHidden();
    await page.getByRole('button', { name: 'Rename project', exact: true }).tap();
    await page.getByLabel('Project name', { exact: true }).fill('My phone workspace');
    await page.getByLabel('Project name', { exact: true }).press('Enter');
    await saved(page);
    await page.screenshot({ path: '../docs/acceptance/mobile-workspace.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    // Real touch input on empty canvas pans instead of starting desktop box selection.
    const canvas = (await page.locator('.canvas-shell').boundingBox())!;
    const before = await page.locator('.react-flow__viewport').getAttribute('style');
    const session = await page.context().newCDPSession(page);
    const x = canvas.x + 35,
      y = canvas.y + 70;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 70, y: y + 50 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
      .not.toBe(before);
    await session.detach();
    await topic.tap();
    await page
      .locator('.selection-tools')
      .getByRole('button', { name: 'Delete selection', exact: true })
      .tap();
    await expect(page.locator('.mindmap-topic')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await saved(page);
    const persisted = await graph(request, diagram.id);
    expect(persisted.diagram.name).toBe('My phone workspace');
    expect(persisted.nodes[0].title).toBe('Learning on my phone');
    expect(persisted.nodes[0].color).toBe('#226d72');
    expect(persisted.nodes[0].metadata).toEqual({
      integration: { key: 'retained' },
      visualNerve: { icon: 'learning' },
    });
    await topic.tap();
    await page.getByRole('button', { name: 'Add subtopic', exact: true }).tap();
    await expect(page.getByLabel('Edit topic', { exact: true })).toBeFocused();
    await page.getByLabel('Edit topic', { exact: true }).fill('Phone branch');
    await page.getByLabel('Edit topic', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Add subtopic', exact: true }).tap();
    await expect(page.getByLabel('Edit topic', { exact: true })).toBeInViewport({ ratio: 0.999 });
    await page.getByLabel('Edit topic', { exact: true }).fill('A deeper mobile topic');
    await page.getByLabel('Edit topic', { exact: true }).press('Enter');
    await saved(page);
    const children = await graph(request, diagram.id);
    expect(children.nodes).toHaveLength(3);
    expect(children.nodes[2].parentId).toBe(children.nodes[1].id);
    await expect(page.locator('.mindmap-topic[data-topic-depth="2"]')).toHaveCSS(
      'border-top-style',
      'solid',
    );
    await page.screenshot({ path: '../docs/acceptance/mobile-mindmap-editing.png' });
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    const beforePinch = await page.locator('.react-flow__viewport').getAttribute('style');
    const pinch = await page.context().newCDPSession(page);
    await pinch.send('Input.synthesizePinchGesture', {
      x: canvas.x + canvas.width / 2,
      y: canvas.y + canvas.height / 2,
      scaleFactor: 1.3,
      gestureSourceType: 'touch',
    });
    await expect
      .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
      .not.toBe(beforePinch);
    await pinch.detach();
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(page.getByRole('button', { name: 'Fit diagram', exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    await page.getByLabel('More tools', { exact: true }).tap();
    await expect(
      page.locator('.mobile-tool-menu').getByRole('button', { name: 'Auto layout', exact: true }),
    ).toBeVisible();
    await page
      .locator('.mobile-tool-menu')
      .getByRole('button', { name: 'Settings', exact: true })
      .tap();
    await expect(page.getByRole('dialog')).toContainText('Johan Caripson');
    await expect(page.getByRole('dialog')).toContainText('MIT License');
  });
});
