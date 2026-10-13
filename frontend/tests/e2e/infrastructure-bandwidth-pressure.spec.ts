import { expect, test } from './fixtures';
import type { Diagram, Graph } from '../../src/model/types';
import { createBasicModel } from '../../src/simulation/examples';
import type { SimulationResult } from '../../src/simulation/types';

test('an actual transfer without bandwidth is constrained on the canvas, dashboard and MCP result', async ({
  page,
  request,
}) => {
  const create = await request.post('/api/v1/diagrams', {
    data: { name: 'Unavailable WAN boundary', type: 'process-simulator' },
  });
  expect(create.status()).toBe(201);
  const diagram = (await create.json()) as Diagram;
  const model = createBasicModel({ particles: 1, processingSeconds: 1 });
  model.schemaVersion = 2;
  model.infrastructure = { schemaVersion: 1 };
  model.resources = [
    {
      id: 'wan',
      name: 'Unavailable WAN',
      capacity: 0,
      unit: 'Mbps',
      infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
    },
  ];
  model.nodes.push({
    id: 'wan-view',
    name: 'Unavailable WAN',
    type: 'resource',
    resourceId: 'wan',
  });
  model.edges[0].infrastructure = { transfer: { resourceId: 'wan', bytes: 1_000_000 } };
  const update = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(update.status()).toBe(200);
  const graph = (await update.json()) as Graph;
  const pool = graph.simulation!.nodes.find(
    (node) => node.type === 'resource' && node.resourceId === 'wan',
  )!;
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation duration hours').fill(String(3 / 3600));
  await page.getByLabel('Simulation random seed').fill('42');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');

  const card = page.locator(`[data-testid="graph-node"][data-node-id="${pool.id}"]`);
  await expect(card.locator('[data-traffic]')).toHaveAttribute('data-traffic', 'congested');
  await expect(card).toContainText(/no currently available bandwidth/);
  await expect(page.locator('.simulation-bottleneck')).toContainText('Unavailable WAN');
  const metrics = page.getByRole('region', { name: 'Infrastructure capacity metrics' });
  await expect(metrics).toBeVisible();
  await expect(metrics.locator('[data-infrastructure-pressure]')).toHaveAttribute(
    'data-infrastructure-pressure',
    'congested',
  );
  await expect(metrics.locator('[data-infrastructure-metric="wan:Active transfers"]')).toHaveText(
    '1 transfers',
  );
  await expect(metrics.locator('[data-infrastructure-metric="wan:Used now"]')).toHaveText('0 Mbps');

  const list = await request.get(`/api/v1/diagrams/${diagram.id}/simulation/runs`);
  expect(list.status()).toBe(200);
  const runs = (await list.json()) as { id: string }[];
  const rpc = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: `/diagrams/${diagram.id}/simulation/runs/${runs[0].id}/result`,
          method: 'GET',
        },
      },
    },
  });
  expect(rpc.ok()).toBe(true);
  const response = await rpc.json();
  expect(response.error).toBeUndefined();
  expect(response.result.structuredContent.status).toBe(200);
  const result = response.result.structuredContent.body as SimulationResult;
  expect(result.infrastructure!.bandwidth.wan).toMatchObject({
    activeTransfers: 1,
    usedMbps: 0,
    transferredBytes: 0,
  });
  expect(result.metrics).toMatchObject({ created: 1, completed: 0, inSystem: 1 });
  expect(result.resources.wan.queue.current).toBe(0);
  expect(result.bottlenecks.find((value) => value.id === 'wan')).toMatchObject({
    kind: 'resource',
    methodology: 'bandwidth-unavailable',
    averageQueue: 0,
    averageWaitSeconds: 0,
  });
});
