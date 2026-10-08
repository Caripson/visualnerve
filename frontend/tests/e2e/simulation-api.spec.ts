import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import type {
  SimulationModel,
  SimulationResult,
  SimulationState,
} from '../../src/simulation/types';

async function mcp<T = unknown>(
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
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  expect(
    envelope.result.structuredContent.status,
    JSON.stringify(envelope.result.structuredContent.body),
  ).toBe(status);
  expect(envelope.result.isError).toBe(status >= 400);
  return envelope.result.structuredContent.body as T;
}
function basicModel(particles = 10): SimulationModel {
  return {
    type: 'process-simulator',
    schemaVersion: 1,
    currency: 'SEK',
    particleTypes: [
      {
        id: 'customer',
        name: 'Customer',
        color: '#2563eb',
        revenue: 100,
        complexity: { min: 1, max: 1 },
        priority: 1,
      },
    ],
    nodes: [
      {
        id: 'source',
        name: 'Arrivals',
        type: 'source',
        source: { particleTypeId: 'customer', burst: particles, maxCount: particles },
      },
      {
        id: 'work',
        name: 'Assembly',
        type: 'work',
        work: { capacity: 1, processingSeconds: 60, queueDiscipline: 'fifo' },
      },
      {
        id: 'outcome',
        name: 'Revenue',
        type: 'outcome',
        outcome: { status: 'completed', revenue: true },
      },
    ],
    edges: [
      { id: 'arrivals', sourceNodeId: 'source', targetNodeId: 'work', travelSeconds: 0 },
      { id: 'complete', sourceNodeId: 'work', targetNodeId: 'outcome', travelSeconds: 0 },
    ],
    resources: [],
    improvements: [],
    scenarios: [{ id: 'baseline', name: 'Baseline', overrides: {} }],
    defaults: { durationSeconds: 86400, seed: 12345 },
    retention: { particles: 50, events: 2000, checkpoints: 20 },
  };
}
async function create(
  request: APIRequestContext,
  name: string,
  model = basicModel(),
): Promise<Graph> {
  const diagram = await mcp<{ id: string; version: number }>(
    request,
    '/diagrams',
    'POST',
    { name, type: 'process-simulator' },
    201,
  );
  return mcp<Graph>(request, `/diagrams/${diagram.id}/simulation`, 'PUT', {
    baseVersion: diagram.version,
    model,
  });
}
async function run(request: APIRequestContext, graph: Graph, options: unknown = {}) {
  const info = await mcp<{ id: string; status: string }>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs`,
    'POST',
    {
      seed: 12345,
      durationSeconds: 86400,
      animated: false,
      ...(options as object),
    },
    201,
  );
  await expect
    .poll(
      async () => {
        const current = await mcp<{ status: string; error?: string }>(
          request,
          `/diagrams/${graph.diagram.id}/simulation/runs/${info.id}`,
        );
        if (current.status === 'failed') throw new Error(current.error ?? 'Simulation failed.');
        return current.status;
      },
      { timeout: 30000 },
    )
    .toBe('completed');
  const result = await mcp<SimulationResult>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs/${info.id}/result`,
  );
  return { info, result };
}
async function open(page: Page, request: APIRequestContext, graph: Graph) {
  await page.locator(`button[data-diagram-id="${graph.diagram.id}"]`).click();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  // Initial fit is an actual asynchronous geometry save; wait for its acknowledgement.
  await expect
    .poll(async () => {
      const saved = await mcp<Graph>(request, `/diagrams/${graph.diagram.id}`);
      const viewport = saved.diagram.settings.viewport;
      if (!viewport) return false;
      const actual = await page.locator('.react-flow__viewport').evaluate((element) => {
        const m = new DOMMatrix(getComputedStyle(element).transform);
        return { x: m.e, y: m.f, zoom: m.a };
      });
      return (
        Math.abs(viewport.x - actual.x) < 0.001 &&
        Math.abs(viewport.y - actual.y) < 0.001 &&
        Math.abs(viewport.zoom - actual.zoom) < 0.001 &&
        (await page.locator('.document-actions .save-status').textContent()) === 'Saved'
      );
    })
    .toBe(true);
}
async function waitForNewRun(
  request: APIRequestContext,
  graph: Graph,
  previousId: string,
): Promise<string> {
  const path = `/diagrams/${graph.diagram.id}/simulation/runs`;
  let newId: string | undefined;
  await expect
    .poll(async () => {
      const runs = await mcp<{ id: string }[]>(request, path);
      newId = runs.find((entry) => entry.id !== previousId)?.id;
      return newId !== undefined;
    })
    .toBe(true);
  await expect
    .poll(async () => (await mcp<{ status: string }>(request, `${path}/${newId}`)).status, {
      timeout: 30000,
    })
    .toBe('completed');
  return newId!;
}

test('AT-18,21,22: MCP discovery and headless/UI runs share the complete seeded result', async ({
  page,
  request,
}) => {
  const capabilities = await mcp<{
    type: string;
    schemaVersion: number;
    execution: { animationRequired: boolean };
    visualCapacity: {
      primaryEditable: boolean;
      additionalCardsReadOnly: boolean;
      compactHierarchyReadOnly: boolean;
    };
  }>(request, '/simulation/capabilities');
  expect(capabilities.type).toBe('process-simulator');
  expect(capabilities.schemaVersion).toBe(1);
  expect(capabilities.execution.animationRequired).toBe(false);
  expect(capabilities.visualCapacity).toMatchObject({
    primaryEditable: true,
    additionalCardsReadOnly: true,
    compactHierarchyReadOnly: true,
  });
  const restCapabilities = await request.get('/api/v1/simulation/capabilities');
  expect(restCapabilities.ok()).toBe(true);
  expect(await restCapabilities.json()).toEqual(capabilities);
  const graph = await create(request, 'Seeded UI and MCP parity', basicModel(100));
  const documents = await mcp<{ id: string; type: string }[]>(
    request,
    '/diagrams?type=process-simulator',
  );
  expect(
    documents.some(
      (document) => document.id === graph.diagram.id && document.type === 'process-simulator',
    ),
  ).toBe(true);
  expect(await mcp(request, `/diagrams/${graph.diagram.id}/simulation`)).toEqual(graph.simulation);
  // Correctness needs no selected document/canvas animation.
  await expect(page.locator('.simulation-feature')).toHaveCount(0);
  const headless = await run(request, graph, { scenarioId: 'baseline' });
  expect(headless.result.metrics).toMatchObject({
    created: 100,
    completed: 100,
    abandoned: 0,
    realizedRevenue: 10000,
  });
  expect(headless.result.metrics.queue.current).toBe(0);
  expect(headless.result.completedAtSeconds).toBe(6000);
  await open(page, request, graph);
  await page.getByLabel('Simulation duration preset').selectOption('86400');
  await page.getByLabel('Simulation random seed').fill('12345');
  await page.getByLabel('Simulation scenario', { exact: true }).selectOption('baseline');
  // A full-day UI run uses MAX; a separate acceptance checks animated parity.
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  const uiId = await waitForNewRun(request, graph, headless.info.id);
  await expect(page.locator('.simulation-run-status')).toHaveText('completed', { timeout: 30000 });
  const runs = await mcp<{ id: string }[]>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs`,
  );
  expect(runs).toHaveLength(2);
  const ui = await mcp<SimulationResult>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs/${uiId}/result`,
  );
  expect(ui.metrics).toEqual(headless.result.metrics);
  expect(ui.finalCapacities).toEqual(headless.result.finalCapacities);
  expect(ui.nodes).toEqual(headless.result.nodes);
  expect(ui.resources).toEqual(headless.result.resources);
  expect(ui.events).toEqual(headless.result.events);
  await expect(page.locator('[data-metric="Completed"]')).toHaveText('100');
  await expect(page.locator('[data-metric="Revenue"]')).toContainText('10,000');
});

test('AT-10,26: UI, REST and MCP economics agree for animated and MAX/headless runs', async ({
  page,
  request,
}) => {
  const model = basicModel(10);
  model.defaults.durationSeconds = 60;
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type === 'work') {
    work.work.processingSeconds = 1;
    work.work.costPerParticle = 40;
  }
  const graph = await create(request, 'Animated and headless parity', model);
  const headless = await run(request, graph, { durationSeconds: 60, scenarioId: 'baseline' });
  expect(headless.result.metrics).toMatchObject({
    realizedRevenue: 1000,
    cost: 400,
    contribution: 600,
  });
  await open(page, request, graph);
  await page.getByLabel('Simulation duration hours').fill(String(60 / 3600));
  await page.getByLabel('Simulation random seed').fill('12345');
  await page.getByLabel('Simulation scenario', { exact: true }).selectOption('baseline');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  const animatedId = await waitForNewRun(request, graph, headless.info.id);
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const animated = await mcp<SimulationResult>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs/${animatedId}/result`,
  );
  expect(animated.metrics).toEqual(headless.result.metrics);
  expect(animated.events).toEqual(headless.result.events);
  expect(animated.finalCapacities).toEqual(headless.result.finalCapacities);
  expect(animated.completedAtSeconds).toBe(10);
  const rest = await request.get(
    `/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${animatedId}/metrics`,
  );
  expect(rest.ok()).toBe(true);
  expect(await rest.json()).toEqual(animated.metrics);
  await expect(page.locator('[data-metric="Revenue"]')).toContainText('1,000');
  await expect(page.locator('[data-metric="Cost"]')).toContainText('400');
  await expect(page.locator('[data-metric="Contribution"]')).toContainText('600');
});

test('AT-19,20: MCP inspects actual queue/resource state, pause freezes it and capacity edits reach the UI', async ({
  page,
  request,
}) => {
  const model = basicModel(100);
  model.resources.push({
    id: 'staff',
    name: 'Shared staff',
    capacity: 1,
    maxCapacity: 5,
    unit: 'employee',
    costPerHour: 180,
  });
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type === 'work') work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
  const graph = await create(request, 'Live semantic queue', model);
  await open(page, request, graph);
  const id = graph.simulation!.nodes.find((node) => node.name === 'Assembly')!.id;
  const info = await mcp<{ id: string }>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs`,
    'POST',
    { durationSeconds: 7200, seed: 42, speed: 100, animated: true },
    201,
  );
  const base = `/diagrams/${graph.diagram.id}/simulation/runs/${info.id}`;
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1${base}/state`);
      if (response.status() === 409) return 0;
      expect(response.ok()).toBe(true);
      return ((await response.json()) as SimulationState).nodes[id].queue.current;
    })
    .toBeGreaterThan(20);
  await mcp(request, `${base}/pause`, 'POST', {});
  await expect
    .poll(async () => (await mcp<SimulationState>(request, `${base}/state`)).status)
    .toBe('paused');
  const paused = await mcp<SimulationState>(request, `${base}/state`);
  const node = await mcp<SimulationState['nodes'][string]>(request, `${base}/nodes/${id}`);
  const staff = await mcp<SimulationState['resources'][string]>(request, `${base}/resources/staff`);
  expect(node.queue.current).toBe(paused.nodes[id].queue.current);
  expect(staff.busy).toBe(1);
  expect(node.resourceUsage.staff).toBe(1);
  await expect(page.locator(`[data-simulation-node="${id}"]`)).toHaveAttribute(
    'data-queue',
    String(node.queue.current),
  );
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  // Read after actual UI interactions, with no fixed sleep and no advancing clock.
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(id);
  await expect(page.getByLabel('Work capacity', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await mcp<SimulationState>(request, `${base}/state`)).timeSeconds).toBe(
    paused.timeSeconds,
  );
  await mcp(request, `${base}/stop`, 'POST', {});
  let saved = await mcp<Graph>(request, `/diagrams/${graph.diagram.id}`);
  saved = await mcp<Graph>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/nodes/${id}`,
    'PATCH',
    { baseVersion: saved.diagram.version, value: { work: { capacity: 3 } } },
  );
  saved = await mcp<Graph>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/resources/staff`,
    'PATCH',
    { baseVersion: saved.diagram.version, value: { capacity: 3 } },
  );
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(id);
  await expect(page.getByLabel('Work capacity', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const increased = await run(request, saved, { durationSeconds: 7200, seed: 42 });
  expect(increased.result.finalCapacities[id]).toBe(3);
  expect(increased.result.finalCapacities.staff).toBe(3);
  expect(increased.result.metrics.completed).toBe(100);
  expect(increased.result.completedAtSeconds).toBe(2040);
});

test('AT-23: MCP completes a six-step demand stress test with separate comparable results', async ({
  request,
}) => {
  const model = basicModel(100);
  model.particleTypes[0].patienceSeconds = 300;
  const source = model.nodes.find((node) => node.type === 'source')!;
  if (source.type === 'source')
    source.source = {
      particleTypeId: 'customer',
      ratePerHour: 120,
      maxCount: 2880,
      distribution: 'regular',
    };
  const graph = await create(request, 'MCP demand stress', model);
  const runs = [];
  for (const multiplier of [1, 1.1, 1.2, 1.3, 1.4, 1.5]) {
    const completed = await run(request, graph, {
      scenarioId: 'baseline',
      demandMultiplier: multiplier,
    });
    expect(completed.result.demandMultiplier).toBe(multiplier);
    expect(completed.result.seed).toBe(12345);
    expect(completed.result.durationSeconds).toBe(86400);
    expect(completed.result.metrics.created).toBeGreaterThan(0);
    expect(completed.result.metrics.queue.maximum).toBeGreaterThan(0);
    expect(completed.result.metrics.queue.wait.average).toBeGreaterThan(0);
    expect(completed.result.metrics.ttr.count).toBeGreaterThan(0);
    expect(completed.result.metrics.abandoned).toBeGreaterThan(0);
    expect(Number.isFinite(completed.result.metrics.contribution)).toBe(true);
    runs.push(completed);
  }
  const ids = runs.map((entry) => entry.info.id);
  expect(new Set(ids).size).toBe(6);
  const comparison = await mcp<{
    comparisons: { baseline: unknown; scenario: unknown; delta: unknown }[];
  }>(request, `/diagrams/${graph.diagram.id}/simulation/compare`, 'POST', { runIds: ids });
  expect(comparison.comparisons).toHaveLength(5);
  for (const compared of comparison.comparisons) {
    expect(compared.baseline).toEqual(runs[0].result.metrics);
    expect(compared.scenario).toHaveProperty('throughputPerHour');
    expect(compared.delta).toHaveProperty('averageTtrSeconds');
    expect(compared.delta).toHaveProperty('contribution');
    expect(compared.delta).toHaveProperty('maximumQueue');
  }
  expect(
    (await mcp<{ id: string }[]>(request, `/diagrams/${graph.diagram.id}/simulation/runs`))
      .map((entry) => entry.id)
      .sort(),
  ).toEqual(ids.sort());
});

test('AT-17,30,31,32: programmatic semantic round trip includes every concept and preserves UI edits', async ({
  page,
  request,
}) => {
  const empty = basicModel(0);
  empty.nodes = [];
  empty.edges = [];
  empty.particleTypes = [];
  empty.scenarios = [];
  let graph = await create(request, 'Complete semantic round trip', empty);
  const base = `/diagrams/${graph.diagram.id}/simulation`;
  async function add(collection: string, value: unknown) {
    graph = await mcp<Graph>(
      request,
      `${base}/${collection}`,
      'POST',
      { baseVersion: graph.diagram.version, value },
      201,
    );
  }
  for (const [id, name, revenue, complexity] of [
    ['standard', 'Standard', 100, 1],
    ['complex', 'Complex', 200, 2],
  ] as const)
    await add('particle-types', {
      id,
      name,
      color: '#2563eb',
      shape: 'circle',
      revenue,
      complexity: { min: complexity, max: complexity },
      priority: 1,
    });
  await add('resources', {
    id: 'staff',
    name: 'Staff',
    unit: 'employee',
    capacity: 5,
    minCapacity: 1,
    maxCapacity: 10,
    costPerHour: 180,
  });
  await add('resources', {
    id: 'counter',
    name: 'Counter',
    unit: 'counter',
    capacity: 5,
    minCapacity: 1,
    maxCapacity: 10,
    costPerHour: 20,
  });
  await add('nodes', {
    id: 'source',
    name: 'Orders',
    type: 'source',
    source: { particleTypeId: 'standard', burst: 10, maxCount: 10 },
  });
  for (const name of ['Assembly', 'Quality', 'Delivery'])
    await add('nodes', {
      id: name.toLowerCase(),
      name,
      type: 'work',
      work: {
        capacity: 5,
        processingSeconds: 720,
        costPerHour: 500,
        queueDiscipline: 'priority',
        resourceRequirements: [
          { resourceId: 'staff', units: 1 },
          { resourceId: 'counter', units: 1 },
        ],
        scaling: {
          minCapacity: 1,
          maxCapacity: 10,
          queueAbove: 20,
          increment: 1,
          additionalCostPerHour: 320,
        },
      },
    });
  await add('nodes', {
    id: 'decision',
    name: 'Route by capacity',
    type: 'router',
    router: { mode: 'least-queue' },
  });
  await add('nodes', {
    id: 'outcome',
    name: 'Paid',
    type: 'outcome',
    outcome: { status: 'completed', revenue: true },
  });
  await add('nodes', {
    id: 'staff-shape',
    name: 'Shared staff',
    type: 'resource',
    resourceId: 'staff',
  });
  const id = (name: string) => graph.simulation!.nodes.find((node) => node.name === name)!.id;
  for (const [from, to] of [
    ['Orders', 'Assembly'],
    ['Assembly', 'Route by capacity'],
    ['Route by capacity', 'Quality'],
    ['Quality', 'Delivery'],
    ['Delivery', 'Paid'],
  ])
    await add('edges', {
      id: `${from}-${to}`,
      sourceNodeId: id(from),
      targetNodeId: id(to),
      travelSeconds: 2,
    });
  await add('improvements', {
    id: 'automation',
    name: 'Automation',
    enabled: false,
    nodeId: id('Assembly'),
    investmentCost: 100000,
    processingTimeMultiplier: 0.65,
    operatingCostPerHour: 10,
  });
  await add('scenarios', { id: 'baseline', name: 'Baseline', overrides: {} });
  await add('scenarios', {
    id: 'more-capacity',
    name: 'Scenario A',
    overrides: { nodes: { [id('Assembly')]: { work: { capacity: 8 } } } },
  });
  graph = await mcp<Graph>(request, `${base}/economics`, 'PUT', {
    baseVersion: graph.diagram.version,
    value: { maximumBudget: 500000 },
  });
  const semantic = await mcp<SimulationModel>(request, base);
  expect(semantic).toEqual(graph.simulation);
  expect(semantic.particleTypes).toHaveLength(2);
  expect(semantic.nodes.filter((node) => node.type === 'work')).toHaveLength(3);
  expect(semantic.nodes.some((node) => node.type === 'router')).toBe(true);
  expect(semantic.resources).toHaveLength(2);
  expect(semantic.improvements[0]).toMatchObject({
    investmentCost: 100000,
    processingTimeMultiplier: 0.65,
  });
  expect(semantic.scenarios).toHaveLength(2);
  expect(semantic.economics!.maximumBudget).toBe(500000);
  await open(page, request, graph);
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(id('Assembly'));
  await expect(page.getByLabel('Work capacity', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Processing time (minutes)', { exact: true })).toHaveValue('12');
  await expect(page.getByLabel('Work cost / hour', { exact: true })).toHaveValue('500');
  await page.getByLabel('Work capacity', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await expect
    .poll(async () => {
      const model = await mcp<SimulationModel>(request, base);
      const work = model.nodes.find((node) => node.id === id('Assembly'))!;
      return work.type === 'work' ? work.work.capacity : 0;
    })
    .toBe(8);
  graph = await mcp<Graph>(request, `/diagrams/${graph.diagram.id}`);
  const before = JSON.stringify(graph.simulation);
  const invalid = await mcp<{ code: string; issues: unknown[] }>(
    request,
    `${base}/nodes/${id('Assembly')}`,
    'PATCH',
    { baseVersion: graph.diagram.version, value: { work: { capacity: -1 } } },
    422,
  );
  expect(invalid.code).toBe('SIMULATION_INVALID_MODEL');
  expect(invalid.issues).not.toHaveLength(0);
  expect(JSON.stringify(await mcp(request, base))).toBe(before);
  const result = await run(request, graph);
  expect(result.result.metrics.completed).toBe(10);
  expect(result.result.metrics.realizedRevenue).toBe(1000);
  expect(result.result.resources.staff.cost).toBeGreaterThan(0);
  expect(result.result.metrics.cost).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  expect(await mcp(request, base)).toEqual(graph.simulation);
});
