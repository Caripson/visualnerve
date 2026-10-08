import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { createBasicModel } from '../../src/simulation/examples';
import { runSimulation } from '../../src/simulation/engine';
import type { Graph } from '../../src/model/types';
import type { SimulationModel, SimulationResult } from '../../src/simulation/types';
import type { SimulationRunInfo } from '../../src/simulation/service';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function create(
  page: Page,
  request: APIRequestContext,
  name: string,
  model: SimulationModel,
) {
  const response = await request.post('/api/v1/diagrams', {
    data: { name, type: 'process-simulator' },
  });
  expect(response.status()).toBe(201);
  const diagram = (await response.json()) as { id: string; version: number };
  const update = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(update.ok()).toBeTruthy();
  const graph = (await update.json()) as Graph;
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  return graph;
}

async function runs(request: APIRequestContext, id: string) {
  return read<{ id: string; status: string; scenarioName: string; currency: string }[]>(
    request,
    `/diagrams/${id}/simulation/runs`,
  );
}

async function resultsPanel(page: Page) {
  const select = page.getByLabel('Replay run', { exact: true });
  if (!(await select.isVisible())) await page.getByText(/^Replay and compare runs/).click();
  await expect(select).toBeVisible();
  return select;
}

async function expectDetached(page: Page) {
  await expect(
    page.getByRole('status').filter({ hasText: 'The process structure has changed.' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Simulation metrics', exact: true })).toHaveCount(
    0,
  );
  // Inspect actual pixels: stale diagnostic data attributes alone do not prove the overlay cleared.
  await expect
    .poll(async () =>
      page.getByTestId('simulation-particles').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 3 && value !== 0);
      }),
    )
    .toBe(false);
}

test('UI run keeps compatible assumptions and geometry, then detaches changed topology with its saved partial result', async ({
  page,
  request,
}) => {
  const graph = await create(
    page,
    request,
    'UI topology lifecycle audit',
    createBasicModel({ particles: 20, processingSeconds: 1200 }),
  );
  const prefix = `/diagrams/${graph.diagram.id}/simulation`;
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  const card = page.locator(`.react-flow__node[data-id="${work.id}"]`);
  const summary = card.locator('[data-simulation-node]');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(summary).toHaveAttribute('data-queue', '19');
  const [original] = await runs(request, graph.diagram.id);

  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(work.id);
  await page.getByLabel('Work capacity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await saved(page);
  await expect(summary).toContainText('Capacity 1');
  await expect(summary).toHaveAttribute('data-queue', '19');
  await expect(page.getByText('The assumptions have changed.', { exact: false })).toBeVisible();
  let current = await read<Graph>(request, `/diagrams/${graph.diagram.id}`);
  expect(current.simulation!.nodes.find((node) => node.id === work.id)).toMatchObject({
    work: { capacity: 2 },
  });
  const native = current.nodes.find((node) => node.id === work.id)!;
  const move = await request.patch(`/api/v1/nodes/${work.id}`, {
    data: { version: native.version, x: native.x + 40, width: native.width + 30 },
  });
  expect(move.ok()).toBeTruthy();
  await saved(page);
  await expect(summary).toHaveAttribute('data-queue', '19');
  await expect(page.locator('.simulation-run-status')).toHaveText('running');
  expect(await runs(request, graph.diagram.id)).toHaveLength(1);

  await card.click();
  const addNext = page.getByRole('button', { name: 'Add next', exact: true });
  // A visible trigger must also be reachable above floating tools on this short canvas.
  await expect
    .poll(() =>
      addNext.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return !!hit && element.contains(hit);
      }),
    )
    .toBe(true);
  await addNext.click();
  await page.getByRole('button', { name: 'Insert work step', exact: true }).click();
  await saved(page);
  await expectDetached(page);
  await expect
    .poll(
      async () => (await read<SimulationRunInfo>(request, `${prefix}/runs/${original.id}`)).status,
    )
    .toBe('stopped');
  const stopped = await read<SimulationResult>(request, `${prefix}/runs/${original.id}/result`);
  expect(stopped.metrics).toMatchObject({ created: 20, completed: 0, inSystem: 20 });
  const captured = await read<SimulationRunInfo>(request, `${prefix}/runs/${original.id}`);
  expect(captured.model.nodes.find((node) => node.id === work.id)).toMatchObject({
    work: { capacity: 1 },
  });
  current = await read<Graph>(request, `/diagrams/${graph.diagram.id}`);
  expect(current.simulation!.nodes).toHaveLength(4);
  const select = await resultsPanel(page);
  await expect(select).toHaveValue(original.id);
  await select.selectOption(original.id);
  await expectDetached(page);
  const moment = Math.min(1, stopped.timeSeconds);
  await page.getByLabel('Replay simulated time', { exact: true }).fill(String(moment));
  await page.getByRole('button', { name: 'Inspect this moment', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await read<{ timeSeconds: number }>(request, `${prefix}/runs/${original.id}/state`))
          .timeSeconds,
    )
    .toBe(moment);
  await expectDetached(page);
  expect(await read<SimulationResult>(request, `${prefix}/runs/${original.id}/result`)).toEqual(
    stopped,
  );
});

test('API execution survives incompatible canvas edits and finishes in MAX without animation', async ({
  page,
  request,
}) => {
  const graph = await create(
    page,
    request,
    'API detached lifecycle audit',
    createBasicModel({ particles: 3, processingSeconds: 60 }),
  );
  const prefix = `/diagrams/${graph.diagram.id}/simulation`;
  const response = await request.post(`/api/v1${prefix}/runs`, {
    data: { durationSeconds: 360, seed: 42, speed: 1, animated: true },
  });
  expect(response.status()).toBe(201);
  const run = (await response.json()) as SimulationRunInfo;
  const work = run.model.nodes.find((node) => node.type === 'work')!;
  await expect(page.locator(`[data-simulation-node="${work.id}"]`)).toHaveAttribute(
    'data-queue',
    '2',
  );
  const current = await read<Graph>(request, `/diagrams/${graph.diagram.id}`);
  const changed = structuredClone(current.simulation!);
  changed.edges[0].targetNodeId = changed.nodes.find((node) => node.type === 'outcome')!.id;
  const update = await request.put(`/api/v1${prefix}`, {
    data: { baseVersion: current.diagram.version, model: changed },
  });
  expect(update.ok()).toBeTruthy();
  await saved(page);
  await expectDetached(page);
  expect((await read<SimulationRunInfo>(request, `${prefix}/runs/${run.id}`)).status).toBe(
    'running',
  );
  const accelerated = await request.post(`/api/v1${prefix}/runs/${run.id}/speed`, {
    data: { speed: 'max' },
  });
  expect(accelerated.ok()).toBeTruthy();
  await expect
    .poll(async () => (await read<SimulationRunInfo>(request, `${prefix}/runs/${run.id}`)).status)
    .toBe('completed');
  const result = await read<SimulationResult>(request, `${prefix}/runs/${run.id}/result`);
  expect(result).toEqual(runSimulation(run.model, run.options));
  expect(result.metrics).toMatchObject({ created: 3, completed: 3, realizedRevenue: 300 });
  await expectDetached(page);
  await expect(await resultsPanel(page)).toHaveValue(run.id);
});

test('saved scenario names and currencies survive edits; UI, REST and MCP reject mixed-currency comparison', async ({
  page,
  request,
}) => {
  const model = createBasicModel({ particles: 3, processingSeconds: 1 });
  model.scenarios = [{ id: 'original-scenario', name: 'Original scenario', overrides: {} }];
  const graph = await create(page, request, 'Captured metadata lifecycle audit', model);
  const prefix = `/diagrams/${graph.diagram.id}/simulation`;
  await page.getByLabel('Simulation scenario', { exact: true }).selectOption('original-scenario');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByLabel('Simulation duration hours', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const [original] = await runs(request, graph.diagram.id);
  expect(original).toMatchObject({ scenarioName: 'Original scenario', currency: 'SEK' });
  await page.getByText('Scenario assumptions: Original scenario', { exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept('Renamed scenario'));
  await page.getByRole('button', { name: 'Rename scenario', exact: true }).click();
  await saved(page);
  await expect(
    page.getByText('Scenario assumptions: Renamed scenario', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete scenario', exact: true }).click();
  await saved(page);
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Simulation settings sections', exact: true })
    .getByRole('button', { name: 'economics', exact: true })
    .click();
  await page.getByLabel('Simulation currency', { exact: true }).fill('EUR');
  await page.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await saved(page);
  await expect(page.locator('[data-metric="Revenue"]')).toHaveText('300 SEK');
  const replay = await resultsPanel(page);
  await expect(replay.locator(`option[value="${original.id}"]`)).toContainText('Original scenario');
  const originalRow = page.getByRole('row').filter({
    has: page.getByRole('checkbox', { name: `Compare run ${original.id}`, exact: true }),
  });
  await expect(originalRow).toContainText('Original scenario');
  await expect(originalRow).toContainText('SEK');
  await expect(originalRow).not.toContainText('Renamed scenario');
  expect((await runs(request, graph.diagram.id))[0]).toMatchObject({
    scenarioName: 'Original scenario',
    currency: 'SEK',
  });
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await runs(request, graph.diagram.id)).filter((run) => run.status === 'completed').length,
    )
    .toBe(2);
  const all = await runs(request, graph.diagram.id);
  const euro = all.find((run) => run.id !== original.id)!;
  expect(euro.currency).toBe('EUR');
  await expect(page.locator('[data-metric="Revenue"]')).toHaveText('300 EUR');
  await page.getByRole('checkbox', { name: `Compare run ${original.id}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `Compare run ${euro.id}`, exact: true }).check();
  await page.getByRole('button', { name: 'Compare selected runs', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('same currency');
  const comparison = await request.post(`/api/v1${prefix}/compare`, {
    data: { runIds: [original.id, euro.id] },
  });
  expect(comparison.status()).toBe(422);
  expect(await comparison.json()).toMatchObject({
    code: 'SIMULATION_CURRENCY_MISMATCH',
    issues: [{ path: 'runIds', code: 'SIMULATION_CURRENCY_MISMATCH' }],
  });
  const mcp = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: `${prefix}/compare`,
          method: 'POST',
          data: { runIds: [original.id, euro.id] },
        },
      },
    },
  });
  expect(mcp.ok()).toBeTruthy();
  const envelope = await mcp.json();
  expect(envelope.result.isError).toBe(true);
  expect(envelope.result.structuredContent).toMatchObject({
    status: 422,
    body: { code: 'SIMULATION_CURRENCY_MISMATCH' },
  });
  await replay.selectOption(original.id);
  await expect(page.locator('[data-metric="Revenue"]')).toHaveText('300 SEK');
  expect(
    await read<SimulationResult>(request, `${prefix}/runs/${original.id}/result`),
  ).toMatchObject({ metrics: { realizedRevenue: 300 } });
});
