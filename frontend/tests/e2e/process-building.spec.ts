import { expect, test, type Page } from './fixtures';
import { createBasicModel } from '../../src/simulation/examples';
import type { Graph } from '../../src/model/types';
import { captureProcessGuide } from './capture-process';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

test('a selected flowchart node adds a connected next step with atomic undo and redo', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Quick connected flow', type: 'flowchart' },
    })
  ).json();
  const node = await (
    await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
      data: { title: 'Receive order', x: 80, y: 80 },
    })
  ).json();
  await page.locator('.diagram-item').filter({ hasText: 'Quick connected flow' }).click();
  await saved(page);
  await page.locator(`.react-flow__node[data-id="${node.id}"]`).click();
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  await captureProcessGuide(
    page.getByRole('dialog', { name: 'Add next menu', exact: true }),
    'node-quick-add',
  );
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await saved(page);
  const read = async () =>
    (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  const added = await read();
  expect(added.nodes).toHaveLength(2);
  expect(added.edges).toHaveLength(1);
  expect(added.edges[0].sourceNodeId).toBe(node.id);
  expect(added.edges[0].targetNodeId).toBe(added.nodes.find((entry) => entry.id !== node.id)!.id);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await saved(page);
  expect((await read()).nodes).toHaveLength(1);
  expect((await read()).edges).toHaveLength(0);
  await page.getByRole('button', { name: /^Redo/ }).click();
  await saved(page);
  expect((await read()).edges).toHaveLength(1);
});

test('adding a work step inserts it into the semantic simulation path and preserves workload', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Build the process locally', type: 'process-simulator' },
    })
  ).json();
  const model = createBasicModel({ particles: 10, processingSeconds: 60 });
  const response = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(response.ok()).toBeTruthy();
  const initial = (await response.json()) as Graph;
  const work = initial.simulation!.nodes.find((entry) => entry.type === 'work')!;
  await page.locator('.diagram-item').filter({ hasText: 'Build the process locally' }).click();
  await saved(page);
  await page.locator(`.react-flow__node[data-id="${work.id}"]`).click();
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  await page.getByRole('button', { name: 'Insert work step', exact: true }).click();
  await saved(page);
  const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(graph.simulation!.nodes).toHaveLength(4);
  expect(graph.simulation!.edges).toHaveLength(3);
  const inserted = graph.simulation!.nodes.find(
    (entry) => entry.type === 'work' && entry.id !== work.id,
  )!;
  expect(inserted).toMatchObject({ work: { capacity: 1, processingSeconds: 60 } });
  expect(
    graph.simulation!.edges.find((entry) => entry.sourceNodeId === work.id)!.targetNodeId,
  ).toBe(inserted.id);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByLabel('Finish all generated work', { exact: true }).check();
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await expect(page.locator('[data-metric="Completed"]')).toHaveText('10');
  const runs = await (await request.get(`/api/v1/diagrams/${diagram.id}/simulation/runs`)).json();
  const result = await (
    await request.get(`/api/v1/diagrams/${diagram.id}/simulation/runs/${runs[0].id}/result`)
  ).json();
  expect(result.metrics).toMatchObject({
    created: 10,
    completed: 10,
    abandoned: 0,
    realizedRevenue: 1000,
  });
  expect(result.completedAtSeconds).toBeGreaterThanOrEqual(660);
});

test('actual transfers move along traffic paths and pause freezes the rendered canvas', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Traffic map inspection', type: 'process-simulator' },
    })
  ).json();
  const model = createBasicModel({ particles: 20, processingSeconds: 60 });
  model.edges.forEach((edge) => {
    edge.travelSeconds = 5;
  });
  const response = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(response.ok()).toBeTruthy();
  const graph = (await response.json()) as Graph;
  const work = graph.simulation!.nodes.find((entry) => entry.type === 'work')!;
  await page.locator('.diagram-item').filter({ hasText: 'Traffic map inspection' }).click();
  await saved(page);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  const canvas = page.getByTestId('simulation-particles');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-transit-particles')))
    .toBe(20);
  const earlier = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect
    .poll(async () => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL()))
    .not.toBe(earlier);
  expect(Number(await canvas.getAttribute('data-rendered-time'))).toBeLessThanOrEqual(
    Number(await canvas.getAttribute('data-simulated-time')),
  );
  const summary = page.locator(`[data-simulation-node="${work.id}"]`);
  await expect(summary).toHaveAttribute('data-queue', '19');
  await expect(summary).toHaveAttribute('data-traffic', 'congested');
  await expect(summary).toContainText('Queue 19');
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  await expect
    .poll(async () =>
      page.locator('.react-flow__node').evaluateAll((nodes) => {
        const canvas = document.querySelector('.react-flow')!.getBoundingClientRect();
        return nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top >= canvas.top && rect.bottom <= canvas.bottom;
        });
      }),
    )
    .toBe(true);
  const paused = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const pausedTime = await canvas.getAttribute('data-rendered-time');
  await page.waitForTimeout(300);
  expect(await canvas.getAttribute('data-rendered-time')).toBe(pausedTime);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(paused);
  await page.getByRole('button', { name: 'Hide simulation metrics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Simulation metrics', exact: true })).toHaveCount(
    0,
  );
  expect(await canvas.getAttribute('data-simulated-time')).toBe(pausedTime);
  await expect(summary).toHaveAttribute('data-queue', '19');
  await page.getByRole('button', { name: 'Show simulation metrics', exact: true }).click();
  await expect(page.locator('[data-metric="Current queue"]')).toHaveText('19');
  await page.screenshot({ path: '/tmp/visualnerve-process-traffic-light.png' });
  await captureProcessGuide(page, 'simulation-traffic');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '/tmp/visualnerve-process-traffic-dark.png' });
});
