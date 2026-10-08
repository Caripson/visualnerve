import { expect, test, type APIRequestContext } from './fixtures';
import type { Graph } from '../../src/model/types';
import type { SimulationModel, SimulationResult } from '../../src/simulation/types';
import { captureProcessGuide } from './capture-process';
import type { Locator } from '@playwright/test';

async function expectContainedTemplateSelector(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  const dialogBounds = (await dialog.boundingBox())!;
  const field = (await dialog.getByLabel('New diagram name').boundingBox())!;
  expect(field.x - dialogBounds.x).toBeGreaterThanOrEqual(12);
  expect(dialogBounds.x + dialogBounds.width - field.x - field.width).toBeGreaterThanOrEqual(12);
}

async function mcp<T>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
): Promise<T> {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path, method, ...(data === undefined ? {} : { data }) },
      },
    },
  });
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  expect(
    envelope.result.structuredContent.status,
    JSON.stringify(envelope.result.structuredContent.body),
  ).toBe(status);
  return envelope.result.structuredContent.body as T;
}

test('hierarchical wizard configures independent subprocess values and survives drilldown on mobile', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const create = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await expectContainedTemplateSelector(create);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectContainedTemplateSelector(create);
  await page.setViewportSize({ width: 1440, height: 980 });
  await create.getByRole('button', { name: /^Process Simulator/ }).click();
  await create.getByLabel('New diagram name').fill('Guided hierarchy');
  await create.getByRole('button', { name: 'Create diagram', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Set up your process' });
  await wizard.getByRole('button', { name: /A fixed batch/ }).click();
  await wizard.getByLabel('Batch size (items)').fill('1');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await wizard.getByRole('button', { name: /Main process and subprocesses/ }).click();
  await wizard.getByLabel('Main process name').fill('Order to delivery');
  await wizard.getByLabel('Subprocess 2 processing minutes').fill('7');
  await wizard.getByLabel('Subprocess 2 capacity').fill('3');
  await page.setViewportSize({ width: 390, height: 844 });
  await wizard.getByLabel('Subprocess 3 name').fill('Customer delivery');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(wizard.getByRole('button', { name: 'Continue' })).toBeVisible();
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await expect(wizard.getByRole('heading', { name: 'What is the business impact?' })).toBeFocused();
  expect(await wizard.evaluate((element) => element.scrollTop)).toBe(0);
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await expect(wizard).toContainText('3 subprocesses');
  await expect(wizard).toContainText('7 min/item · 3 slots');
  await page.setViewportSize({ width: 1440, height: 980 });
  await captureProcessGuide(wizard, 'process-subprocess-setup');
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const diagram = diagrams.find((entry: { name: string }) => entry.name === 'Guided hierarchy');
  const path = `/diagrams/${diagram.id}/simulation`;
  let model = await mcp<SimulationModel>(request, path);
  expect(model.processes).toHaveLength(4);
  const prepare = model.nodes.find((node) => node.name === 'Pick and pack order')!;
  expect(prepare).toMatchObject({ work: { processingSeconds: 420, capacity: 3 } });
  await page.getByRole('button', { name: 'Open process Order to delivery', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open process Warehouse preparation', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Open subprocess', { exact: true }).selectOption(prepare.processId!);
  await expect(page.locator(`[data-simulation-node="${prepare.id}"]`)).toBeVisible();
  // Quick insertion inherits the current process scope.
  await page.locator(`.react-flow__node[data-id="${prepare.id}"]`).click();
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  await page.getByRole('button', { name: 'Insert work step', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  model = await mcp<SimulationModel>(request, path);
  expect(
    model.nodes.filter((node) => node.processId === prepare.processId && node.type === 'work'),
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'Process overview', exact: true }).click();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const runs = await mcp<{ id: string }[]>(request, `${path}/runs`);
  const result = await mcp<SimulationResult>(request, `${path}/runs/${runs[0].id}/result`);
  expect(result.metrics.completed).toBe(1);
  const root = model.processes!.find((process) => !process.parentId)!;
  expect(result.processes![root.id].completed).toBe(1);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open process Order to delivery', exact: true }),
  ).toBeVisible();
  expect(await mcp<SimulationModel>(request, path)).toEqual(model);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open process Order to delivery', exact: true }).click();
  const deliveryScope = model.processes!.find((process) => process.name === 'Customer delivery')!;
  await page.getByLabel('Open subprocess', { exact: true }).selectOption(deliveryScope.id);
  const navigation = page.getByRole('navigation', { name: 'Process navigation' });
  await expect(
    navigation.getByRole('button', { name: 'Customer delivery', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const deliveryWork = model.nodes.find(
    (node) => node.type === 'work' && node.processId === deliveryScope.id,
  )!;
  await expect
    .poll(
      async () =>
        (await page.locator(`.react-flow__node[data-id="${deliveryWork.id}"]`).boundingBox())
          ?.width,
    )
    .toBeGreaterThanOrEqual(170);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/visualnerve-process-hierarchy-mobile.png' });
});

test('complex example exposes real root and nested bottlenecks identically through UI and MCP', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const create = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await create.getByRole('button', { name: /^Delivery network \+ returns/ }).click();
  await create.getByLabel('New diagram name').fill('Delivery network operations');
  await create.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const diagram = diagrams.find(
    (entry: { name: string }) => entry.name === 'Delivery network operations',
  );
  const path = `/diagrams/${diagram.id}/simulation`;
  const model = await mcp<SimulationModel>(request, path);
  expect(model.processes).toHaveLength(11);
  const hierarchy = await mcp<{ rootProcessIds: string[] }>(request, `${path}/hierarchy`);
  expect(hierarchy.rootProcessIds).toEqual(['fulfilment', 'returns']);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const runs = await mcp<{ id: string }[]>(request, `${path}/runs`);
  const result = await mcp<SimulationResult>(request, `${path}/runs/${runs[0].id}/result`);
  const root = page.locator('[data-simulation-process="fulfilment"]');
  await expect(root).toHaveAttribute(
    'data-queue',
    String(result.processes!.fulfilment.queue.current),
  );
  await expect(root).toContainText('Constraint:');
  const constraint = result.processes!.fulfilment.currentBottleneck!;
  await expect(root).toContainText((result.nodes[constraint] ?? result.resources[constraint]).name);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.getByRole('button', { name: 'Hide simulation metrics', exact: true }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await captureProcessGuide(page.locator('.canvas-shell'), 'process-hierarchy');
  await page.getByRole('button', { name: 'Open process Order fulfilment', exact: true }).click();
  await page.getByLabel('Open subprocess', { exact: true }).selectOption('warehouse');
  const warehouse = await mcp<NonNullable<SimulationResult['processes']>[string]>(
    request,
    `${path}/runs/${runs[0].id}/processes/warehouse`,
  );
  expect(warehouse).toEqual(result.processes!.warehouse);
  const pick = model.nodes.find((node) => node.name === 'Pick equipment')!;
  await expect(page.locator(`[data-simulation-node="${pick.id}"]`)).toHaveAttribute(
    'data-queue',
    String(result.nodes[pick.id].queue.current),
  );
  await captureProcessGuide(page.locator('.canvas-shell'), 'process-drilldown');
  // Programmatic change edits the same step subsequently inspected through the UI.
  const graph = await mcp<Graph>(request, `/diagrams/${diagram.id}`);
  await mcp(request, `${path}/nodes/${pick.id}`, 'PATCH', {
    baseVersion: graph.diagram.version,
    value: { work: { capacity: 4 } },
  });
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(pick.id);
  await expect(page.getByLabel('Work capacity', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Show all steps', exact: true }).click();
  await expect(page.locator('[data-simulation-process-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  // React Flow virtualizes off-screen cards; wait for the fitted view to render every logical step.
  // Capacity replicas must not mask a missing original node.
  await expect
    .poll(async () => {
      const rendered = new Set(
        await page
          .locator('.canvas-shell [data-testid="graph-node"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-node-id')),
          ),
      );
      return model.nodes.filter((node) => !rendered.has(node.id)).map((node) => node.name);
    })
    .toEqual([]);
  // Projection cards never become extra logical work or persist as diagram objects.
  const saved = await mcp<Graph>(request, `/diagrams/${diagram.id}`);
  expect(saved.nodes).toHaveLength(23);
  expect(saved.simulation!.nodes).toHaveLength(23);
});

test('MCP builds nested groups and shared work with UI/headless deterministic parity', async ({
  page,
  request,
}) => {
  const diagram = await mcp<{ id: string; version: number }>(
    request,
    '/diagrams',
    'POST',
    { name: 'Agent-built hierarchy', type: 'process-simulator' },
    201,
  );
  const base = `/diagrams/${diagram.id}/simulation`;
  let graph = await mcp<Graph>(request, base, 'PUT', {
    baseVersion: diagram.version,
    model: {
      type: 'process-simulator',
      schemaVersion: 1,
      currency: 'SEK',
      nodes: [],
      edges: [],
      particleTypes: [],
      resources: [],
      improvements: [],
      scenarios: [],
      defaults: { durationSeconds: 3600, seed: 12345 },
    },
  });
  async function add(collection: string, value: unknown) {
    graph = await mcp<Graph>(
      request,
      `${base}/${collection}`,
      'POST',
      { baseVersion: graph.diagram.version, value },
      201,
    );
  }
  await add('processes', { id: 'main', name: 'Delivery business' });
  await add('processes', { id: 'child', name: 'Order assembly', parentId: 'main' });
  await add('particle-types', {
    id: 'order',
    name: 'Order',
    revenue: 100,
    color: '#2563eb',
    priority: 1,
    complexity: { min: 1, max: 1 },
  });
  await add('resources', {
    id: 'staff',
    name: 'Shared staff',
    capacity: 1,
    unit: 'employee',
    costPerHour: 180,
  });
  await add('nodes', {
    id: 'source',
    name: 'Arrivals',
    type: 'source',
    source: { particleTypeId: 'order', burst: 2, maxCount: 2 },
  });
  await add('nodes', {
    id: 'assembly',
    name: 'Assembly',
    processId: 'child',
    type: 'work',
    work: {
      capacity: 2,
      processingSeconds: 60,
      resourceRequirements: [{ resourceId: 'staff', units: 1 }],
    },
  });
  await add('nodes', {
    id: 'outcome',
    name: 'Paid',
    processId: 'child',
    type: 'outcome',
    outcome: { status: 'completed', revenue: true },
  });
  const id = (name: string) => graph.simulation!.nodes.find((node) => node.name === name)!.id;
  await add('edges', {
    id: 'arrival',
    sourceNodeId: id('Arrivals'),
    targetNodeId: id('Assembly'),
    travelSeconds: 0,
  });
  await add('edges', {
    id: 'complete',
    sourceNodeId: id('Assembly'),
    targetNodeId: id('Paid'),
    travelSeconds: 0,
  });
  const info = await mcp<{ id: string }>(
    request,
    `${base}/runs`,
    'POST',
    { seed: 12345, durationSeconds: 3600, untilComplete: true, animated: false },
    201,
  );
  await expect
    .poll(async () => (await mcp<{ status: string }>(request, `${base}/runs/${info.id}`)).status)
    .toBe('completed');
  const headless = await mcp<SimulationResult>(request, `${base}/runs/${info.id}/result`);
  expect(headless.completedAtSeconds).toBe(120);
  expect(headless.metrics).toMatchObject({ completed: 2, realizedRevenue: 200, resourceCost: 6 });
  expect(headless.processes!.main.queue.maximum).toBe(1);
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await page.getByRole('button', { name: 'Open process Delivery business', exact: true }).click();
  await page.getByRole('button', { name: 'Open process Order assembly', exact: true }).click();
  await expect(page.locator(`[data-simulation-node="${id('Assembly')}"]`)).toBeVisible();
  await page.getByLabel('Simulation duration preset').selectOption('3600');
  await page.getByLabel('Simulation random seed').fill('12345');
  await page.getByLabel('Finish all generated work').check();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const runs = await mcp<{ id: string }[]>(request, `${base}/runs`);
  const uiRun = runs.find((run) => run.id !== info.id)!;
  const ui = await mcp<SimulationResult>(request, `${base}/runs/${uiRun.id}/result`);
  expect(ui.metrics).toEqual(headless.metrics);
  expect(ui.processes).toEqual(headless.processes);
  expect(ui.events).toEqual(headless.events);
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(id('Assembly'));
  await page.getByLabel('Work capacity', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  const edited = await mcp<SimulationModel>(request, base);
  expect(edited.nodes.find((node) => node.id === id('Assembly'))).toMatchObject({
    processId: 'child',
    work: { capacity: 4 },
  });
});
