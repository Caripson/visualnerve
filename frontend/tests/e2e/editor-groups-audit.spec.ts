import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph, GraphNode } from '../../src/model/types';

const readGraph = async (request: APIRequestContext, id: string): Promise<Graph> => {
  const response = await request.get(`/api/v1/diagrams/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
};
const saved = async (page: Page) => {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
};
const card = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);

async function setup(page: Page, request: APIRequestContext, name: string) {
  const created = await request.post('/api/v1/diagrams', {
    data: {
      name,
      type: 'flowchart',
      settings: {
        viewport: { x: 20, y: 40, zoom: 0.9 },
        viewportDevice: 'desktop',
        snap: false,
      },
    },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const response = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          title: 'Outer group',
          externalId: 'outer',
          nodeType: 'group',
          x: 80,
          y: 60,
          width: 650,
          height: 540,
        },
        {
          title: 'Inner group',
          externalId: 'inner',
          parentExternalId: 'outer',
          nodeType: 'group',
          x: 130,
          y: 140,
          width: 320,
          height: 340,
        },
        {
          title: 'Nested work',
          externalId: 'nested',
          parentExternalId: 'inner',
          x: 160,
          y: 220,
          width: 180,
          height: 90,
          color: '#126783',
          description: 'Retained process evidence',
          metadata: { groupAudit: { evidence: 'retained' } },
        },
        {
          title: 'Sibling work',
          externalId: 'sibling',
          parentExternalId: 'outer',
          x: 480,
          y: 290,
          width: 180,
          height: 90,
        },
        { title: 'Outside work', externalId: 'outside', x: 800, y: 240, width: 180, height: 90 },
      ],
      edges: [
        {
          sourceExternalId: 'nested',
          targetExternalId: 'sibling',
          label: 'Internal evidence',
          direction: 'backward',
          style: 'dashed',
        },
        { sourceExternalId: 'outside', targetExternalId: 'nested', label: 'External dependency' },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const original = (await response.json()) as Graph;
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(card(page, original.nodes[0].id)).toBeVisible();
  await expect
    .poll(async () => {
      const current = await readGraph(request, diagram.id);
      const viewport = current.diagram.settings.viewport;
      const actual = await page.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
      return (
        !!viewport &&
        Math.abs(viewport.x - actual.x) < 0.001 &&
        Math.abs(viewport.y - actual.y) < 0.001 &&
        Math.abs(viewport.zoom - actual.zoom) < 0.001 &&
        (await page.locator('.document-actions .save-status').textContent()) === 'Saved'
      );
    })
    .toBe(true);
  const node = (externalId: string) =>
    original.nodes.find((entry) => entry.externalId === externalId)!;
  return {
    original,
    outer: node('outer'),
    inner: node('inner'),
    nested: node('nested'),
    sibling: node('sibling'),
    outside: node('outside'),
  };
}

test('duplicating a collapsed native group preserves its entire nested subtree and only its internal edges through undo, redo and reload', async ({
  page,
  request,
}) => {
  const { original, outer, inner, nested, sibling, outside } = await setup(
    page,
    request,
    'Group subtree duplication audit',
  );
  await card(page, outer.id).locator('.node-title').click();
  await page.getByLabel('Collapse branch / group', { exact: true }).check();
  await saved(page);
  await expect(card(page, nested.id)).toBeHidden();
  const collapsed = await readGraph(request, original.diagram.id);
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click();
  await saved(page);
  const duplicated = await readGraph(request, original.diagram.id);
  const originalIds = new Set(original.nodes.map((node) => node.id));
  const copies = duplicated.nodes.filter((node) => !originalIds.has(node.id));
  expect(copies).toHaveLength(4);
  expect(duplicated.nodes).toHaveLength(9);
  expect(duplicated.edges).toHaveLength(3);
  const byTitle = new Map(copies.map((node) => [node.title, node]));
  const copiedOuter = byTitle.get(outer.title)!,
    copiedInner = byTitle.get(inner.title)!,
    copiedNested = byTitle.get(nested.title)!,
    copiedSibling = byTitle.get(sibling.title)!;
  expect(copiedOuter.collapsed).toBe(true);
  expect(copiedInner.parentId).toBe(copiedOuter.id);
  expect(copiedNested.parentId).toBe(copiedInner.id);
  expect(copiedSibling.parentId).toBe(copiedOuter.id);
  for (const source of [outer, inner, nested, sibling]) {
    const copy = byTitle.get(source.title)!;
    expect(copy.x - source.x).toBe(40);
    expect(copy.y - source.y).toBe(40);
    expect(copy.width).toBe(source.width);
    expect(copy.height).toBe(source.height);
  }
  expect(copiedNested).toMatchObject({
    color: nested.color,
    description: nested.description,
    metadata: nested.metadata,
  });
  const internalCopy = duplicated.edges.find((edge) => edge.sourceNodeId === copiedNested.id)!;
  expect(internalCopy).toMatchObject({
    targetNodeId: copiedSibling.id,
    label: 'Internal evidence',
    direction: 'backward',
    style: 'dashed',
  });
  expect(duplicated.edges.filter((edge) => edge.sourceNodeId === outside.id)).toHaveLength(1);
  expect(copies.some((node) => node.title === outside.title)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const undone = await readGraph(request, original.diagram.id);
  expect(undone.nodes.map((node) => [node.id, node.parentId, node.collapsed])).toEqual(
    collapsed.nodes.map((node) => [node.id, node.parentId, node.collapsed]),
  );
  expect(undone.edges.map((edge) => edge.id)).toEqual(collapsed.edges.map((edge) => edge.id));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  expect((await readGraph(request, original.diagram.id)).nodes.map((node) => node.id)).toEqual(
    duplicated.nodes.map((node) => node.id),
  );
  await card(page, copiedOuter.id).locator('.node-title').click();
  await page.getByLabel('Collapse branch / group', { exact: true }).uncheck();
  await saved(page);
  await expect(card(page, copiedNested.id)).toBeVisible();
  await expect(card(page, copiedSibling.id)).toBeVisible();
  await page.reload();
  await expect(card(page, copiedNested.id)).toBeVisible();
  const restored = await readGraph(request, original.diagram.id);
  expect(restored.nodes.find((node) => node.id === copiedNested.id)?.parentId).toBe(copiedInner.id);
  expect(restored.edges.find((edge) => edge.id === internalCopy.id)?.targetNodeId).toBe(
    copiedSibling.id,
  );
});

test('dragging a nested group commits absolute positions exactly once and ungroup/Undo preserves the same visible contents', async ({
  page,
  request,
}) => {
  const { original, outer, inner, nested, sibling } = await setup(
    page,
    request,
    'Nested coordinate and ungroup audit',
  );
  await card(page, inner.id).locator('.node-title').click();
  const beforeGroup = (await card(page, inner.id).boundingBox())!;
  const beforeChild = (await card(page, nested.id).boundingBox())!;
  const title = (await card(page, inner.id).locator('.node-title').boundingBox())!;
  await page.mouse.move(title.x + 25, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 109, title.y + title.height / 2 + 56, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  const moved = await readGraph(request, original.diagram.id);
  const movedGroup = moved.nodes.find((node) => node.id === inner.id)!;
  const movedChild = moved.nodes.find((node) => node.id === nested.id)!;
  const dx = movedGroup.x - inner.x,
    dy = movedGroup.y - inner.y;
  expect(dx).toBeGreaterThan(20);
  expect(dy).toBeGreaterThan(20);
  expect(movedChild.x - nested.x).toBeCloseTo(dx, 4);
  expect(movedChild.y - nested.y).toBeCloseTo(dy, 4);
  for (const fixed of [outer, sibling]) {
    expect(moved.nodes.find((node) => node.id === fixed.id)).toMatchObject({
      x: fixed.x,
      y: fixed.y,
    });
  }
  const afterGroup = (await card(page, inner.id).boundingBox())!;
  const afterChild = (await card(page, nested.id).boundingBox())!;
  expect(afterChild.x - beforeChild.x).toBeCloseTo(afterGroup.x - beforeGroup.x, 0);
  expect(afterChild.y - beforeChild.y).toBeCloseTo(afterGroup.y - beforeGroup.y, 0);
  expect(afterChild.x - afterGroup.x).toBeCloseTo(beforeChild.x - beforeGroup.x, 0);
  expect(afterChild.y - afterGroup.y).toBeCloseTo(beforeChild.y - beforeGroup.y, 0);
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await saved(page);
  const ungrouped = await readGraph(request, original.diagram.id);
  expect(ungrouped.nodes.some((node) => node.id === inner.id)).toBe(false);
  expect(ungrouped.nodes.find((node) => node.id === nested.id)).toMatchObject({
    parentId: outer.id,
    x: movedChild.x,
    y: movedChild.y,
  });
  expect(ungrouped.edges.map((edge) => edge.id)).toEqual(moved.edges.map((edge) => edge.id));
  await expect(card(page, inner.id)).toHaveCount(0);
  const ungroupedChild = (await card(page, nested.id).boundingBox())!;
  expect(ungroupedChild.x).toBeCloseTo(afterChild.x, 0);
  expect(ungroupedChild.y).toBeCloseTo(afterChild.y, 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const restored = await readGraph(request, original.diagram.id);
  const geometry = (nodes: GraphNode[]) =>
    nodes.map((node) => [node.id, node.parentId, node.x, node.y]);
  expect(geometry(restored.nodes)).toEqual(geometry(moved.nodes));
  await expect(card(page, inner.id)).toBeVisible();
  const restoredChild = (await card(page, nested.id).boundingBox())!;
  expect(restoredChild.x).toBeCloseTo(afterChild.x, 0);
  expect(restoredChild.y).toBeCloseTo(afterChild.y, 0);
  await page.reload();
  await expect(card(page, inner.id)).toBeVisible();
  expect(geometry((await readGraph(request, original.diagram.id)).nodes)).toEqual(
    geometry(moved.nodes),
  );
});
