import { readFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { blankGraph, newNode, type Graph, type GraphNode } from '../../src/model/types';
import { expect, test, type Page } from './fixtures';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Point = { x: number; y: number };

function center(node: GraphNode, side: Side): Point {
  return {
    x: node.x + node.width * (side === 'left' ? 0 : side === 'right' ? 1 : 0.5),
    y: node.y + node.height * (side === 'top' ? 0 : side === 'bottom' ? 1 : 0.5),
  };
}

async function drag(page: Page, source: Locator, target: Locator) {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 18 });
  await page.mouse.up();
}

function pathEnds(path: SVGPathElement) {
  const start = path.getPointAtLength(0);
  const end = path.getPointAtLength(path.getTotalLength());
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
  ];
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function assertSvg(page: Page, svg: string, start: Point, end: Point) {
  const paths = await page.evaluate((xml) => {
    const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
    const container = document.createElement('div');
    container.hidden = true;
    container.append(document.importNode(root, true));
    document.body.append(container);
    try {
      return [...container.querySelectorAll<SVGPathElement>('path[marker-end]')].map((path) => {
        const first = path.getPointAtLength(0);
        const last = path.getPointAtLength(path.getTotalLength());
        return [
          { x: first.x, y: first.y },
          { x: last.x, y: last.y },
        ];
      });
    } finally {
      container.remove();
    }
  }, svg);
  expect(paths.some(([a, b]) => distance(a, start) < 5 && distance(b, end) < 5)).toBe(true);
}

for (const type of ['blank', 'mindmap'] as const) {
  test(`${type} connections honor all four sides through undo, reload and SVG`, async ({
    page,
    request,
  }) => {
    const fixture = blankGraph(`Connection ports: ${type}`, type);
    const node = (title: string, x: number, y: number) =>
      newNode(fixture.diagram.id, { title, x, y, width: 140, height: 72 });
    const hub = node('Hub', 320, 240);
    const above = node('Above', 320, 40);
    const below = node('Below', 320, 440);
    const left = node('Left', 40, 240);
    const right = node('Right', 600, 240);
    if (type === 'mindmap') left.parentId = hub.id;
    fixture.nodes = [hub, above, below, left, right];
    const response = await request.post('/api/v1/import', {
      data: { format: 'json', data: fixture },
    });
    expect(response.status(), await response.text()).toBe(201);
    const graph: Graph = await response.json();
    const card = (title: string) => graph.nodes.find((node) => node.title === title)!;
    const hubCard = card('Hub');
    await page.locator(`button[data-diagram-id="${graph.diagram.id}"]`).click();
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();

    const port = (node: GraphNode, role: 'source' | 'target', side: Side) =>
      page.locator(
        `.react-flow__node[data-id="${node.id}"] .react-flow__handle.${role}[data-handlepos="${side}"]`,
      );
    const stored = async (): Promise<Graph> => {
      const response = await request.get(`/api/v1/diagrams/${graph.diagram.id}`);
      expect(response.status()).toBe(200);
      return response.json();
    };
    const edgeView = (id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);
    const assertPath = async (id: string, start: Point, end: Point) => {
      const path = edgeView(id).locator('.react-flow__edge-path');
      await expect(path).toBeAttached();
      const [first, last] = await path.evaluate(pathEnds);
      expect(distance(first, start)).toBeLessThan(5);
      expect(distance(last, end)).toBeLessThan(5);
    };

    for (const [sourceSide, targetTitle, targetSide] of [
      ['top', 'Above', 'bottom'],
      ['bottom', 'Below', 'top'],
      ['left', 'Left', 'right'],
      ['right', 'Right', 'left'],
    ] as const) {
      const target = card(targetTitle);
      await drag(page, port(hubCard, 'source', sourceSide), port(target, 'target', targetSide));
      await expect
        .poll(async () => (await stored()).edges.some((edge) => edge.targetNodeId === target.id))
        .toBe(true);
      const edge = (await stored()).edges.find(
        (candidate) => candidate.targetNodeId === target.id,
      )!;
      expect(edge.sourceNodeId).toBe(hubCard.id);
      await assertPath(edge.id, center(hubCard, sourceSide), center(target, targetSide));
    }

    const vertical = (await stored()).edges.find((edge) => edge.targetNodeId === card('Below').id)!;
    const reconnectSource = edgeView(vertical.id).locator('.react-flow__edgeupdater-source');
    await drag(page, reconnectSource, port(hubCard, 'source', 'left'));
    await assertPath(vertical.id, center(hubCard, 'left'), center(card('Below'), 'top'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await assertPath(vertical.id, center(hubCard, 'bottom'), center(card('Below'), 'top'));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const start = center(hubCard, 'left');
    await assertPath(vertical.id, start, center(card('Below'), 'top'));
    await drag(
      page,
      edgeView(vertical.id).locator('.react-flow__edgeupdater-target'),
      port(card('Below'), 'target', 'right'),
    );
    const end = center(card('Below'), 'right');
    await assertPath(vertical.id, start, end);
    await expect(page.locator('.save-status')).toHaveText('Saved');
    await page.reload();
    await assertPath(vertical.id, start, end);
    if (type === 'mindmap') {
      await assertPath(
        `hierarchy:${card('Left').id}`,
        center(hubCard, 'left'),
        center(card('Left'), 'right'),
      );
    }

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByLabel('Export format').selectOption('svg');
    const downloading = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
    await assertSvg(page, await readFile((await (await downloading).path())!, 'utf8'), start, end);

    const job = await request.post('/api/v1/exports/svg', {
      data: { diagramId: graph.diagram.id },
    });
    expect(job.status(), await job.text()).toBe(201);
    const jobPath = `/api/v1/exports/svg/${(await job.json()).jobId}`;
    await expect
      .poll(async () => (await (await request.get(jobPath)).json()).state)
      .toBe('succeeded');
    const result = await request.get(`${jobPath}/result`);
    expect(result.status()).toBe(200);
    const svg = await result.json();
    expect(svg.complete).toBe(true);
    await assertSvg(page, svg.text, start, end);
  });
}
