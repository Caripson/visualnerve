import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import type {
  SimulationModel,
  SimulationResult,
  SimulationState,
} from '../../src/simulation/types';
import { createBasicModel } from '../../src/simulation/examples';
import { runSimulation } from '../../src/simulation/engine';
import { parallelModel } from '../helpers/parallel-model';

async function semantic<T>(
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
  const result = envelope.result.structuredContent;
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(envelope.result.isError).toBe(status >= 400);
  return result.body as T;
}
async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function graphFor(request: APIRequestContext, name: string) {
  const diagrams = await semantic<{ id: string; name: string }[]>(
    request,
    '/diagrams?type=process-simulator',
  );
  const diagram = diagrams.find((entry) => entry.name === name);
  expect(diagram).toBeDefined();
  return semantic<Graph>(request, `/diagrams/${diagram!.id}`);
}
async function create(request: APIRequestContext, name: string, model: SimulationModel) {
  const diagram = await semantic<{ id: string; version: number }>(
    request,
    '/diagrams',
    'POST',
    { name, type: 'process-simulator' },
    201,
  );
  return semantic<Graph>(request, `/diagrams/${diagram.id}/simulation`, 'PUT', {
    baseVersion: diagram.version,
    model,
  });
}
async function open(page: Page, request: APIRequestContext, graph: Graph) {
  await page.locator(`button[data-diagram-id="${graph.diagram.id}"]`).click();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const current = await semantic<Graph>(request, `/diagrams/${graph.diagram.id}`);
      return (
        !!current.diagram.settings.viewport &&
        (await page.locator('.document-actions .save-status').textContent()) === 'Saved'
      );
    })
    .toBe(true);
}
async function newRun(request: APIRequestContext, graph: Graph, previous: Set<string>) {
  let id = '';
  await expect
    .poll(async () => {
      const runs = await semantic<{ id: string }[]>(
        request,
        `/diagrams/${graph.diagram.id}/simulation/runs`,
      );
      id = runs.find((run) => !previous.has(run.id))?.id ?? '';
      return !!id;
    })
    .toBe(true);
  return id;
}
async function completedResult(request: APIRequestContext, graph: Graph, id: string) {
  const path = `/diagrams/${graph.diagram.id}/simulation/runs/${id}`;
  await expect
    .poll(
      async () => {
        const run = await semantic<{ status: string; error?: string }>(request, path);
        if (run.status === 'failed') throw new Error(run.error ?? 'Parallel simulation failed.');
        return run.status;
      },
      { timeout: 30000 },
    )
    .toBe('completed');
  return semantic<SimulationResult>(request, `${path}/result`);
}
async function headless(request: APIRequestContext, graph: Graph, options: object = {}) {
  const run = await semantic<{ id: string }>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs`,
    'POST',
    {
      animated: false,
      seed: graph.simulation!.defaults.seed,
      durationSeconds: graph.simulation!.defaults.durationSeconds,
      ...options,
    },
    201,
  );
  return { id: run.id, result: await completedResult(request, graph, run.id) };
}
function compare(ui: SimulationResult, other: SimulationResult) {
  expect(ui.metrics).toEqual(other.metrics);
  expect(ui.nodes).toEqual(other.nodes);
  expect(ui.resources).toEqual(other.resources);
  expect(ui.processes).toEqual(other.processes);
  expect(ui.events).toEqual(other.events);
  expect(ui.parallel).toEqual(other.parallel);
  expect(ui.finalCapacities).toEqual(other.finalCapacities);
}
async function showAll(page: Page) {
  const all = page.getByRole('button', { name: 'Show all steps', exact: true });
  if (await all.isVisible()) await all.click();
}
async function captureWaitingGuide(page: Page, graph: Graph, joinId: string) {
  if (process.env.VN_CAPTURE_PARALLEL !== '1') return;
  const directory = resolve('../docs/acceptance');
  await mkdir(directory, { recursive: true });
  // The genuine process drilldown keeps task and join labels legible at normal zoom.
  // The full topology remains tested above; documentation focuses on its live readiness scope.
  const root = graph.simulation!.processes!.find((process) => !process.parentId)!;
  const readiness = graph.simulation!.processes!.find((process) => process.parentId === root.id)!;
  const hideMetrics = page.getByRole('button', { name: 'Hide simulation metrics', exact: true });
  if (await hideMetrics.isVisible()) await hideMetrics.click();
  await page.getByRole('button', { name: 'Process overview', exact: true }).click();
  await page.getByLabel('Open main process', { exact: true }).selectOption(root.id);
  await page.getByLabel('Open subprocess', { exact: true }).selectOption(readiness.id);
  for (const [name, width, height] of [
    ['desktop', 1920, 1600],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.locator(`.react-flow__node[data-id="${joinId}"]`).click();
    if (name === 'mobile') {
      const properties = page.getByRole('dialog', { name: 'Properties', exact: true });
      if (await properties.isVisible()) await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Canvas options', exact: true }).click();
      await page.getByRole('button', { name: 'Center selection', exact: true }).click();
      await page.keyboard.press('Escape');
    }
    const join = page.locator(`.react-flow__node[data-id="${joinId}"]`);
    await expect(join.locator('[data-join-waiting]')).toBeVisible();
    const bounds = (await join.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(170);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      await page.screenshot({
        path: resolve(directory, `parallel-delivery-${name}${theme === 'dark' ? '-dark' : ''}.png`),
      });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 980 });
}

test('parallel delivery template runs real required branches with identical UI, REST and MCP business results', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const creation = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await creation.getByRole('button', { name: /^Parallel SD-WAN delivery/ }).click();
  await creation.getByLabel('New diagram name').fill('Required SD-WAN delivery');
  await creation.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const graph = await graphFor(request, 'Required SD-WAN delivery');
  expect(graph.diagram.type).toBe('process-simulator');
  expect(graph.simulation).toMatchObject({ type: 'process-simulator', schemaVersion: 1 });
  const fork = graph.simulation!.nodes.find((node) => node.type === 'fork')!;
  if (fork.type !== 'fork') throw new Error('Missing template fork');
  expect(fork.fork.branchEdgeIds).toHaveLength(3);
  const joinId = fork.fork.joinNodeId;
  const targetNames = fork.fork.branchEdgeIds.map((id) => {
    const edge = graph.simulation!.edges.find((entry) => entry.id === id)!;
    return graph.simulation!.nodes.find((node) => node.id === edge.targetNodeId)!.name;
  });
  expect(targetNames).toEqual(['Access provisioning', 'Equipment preparation', 'Site readiness']);
  const capabilities = await semantic<{
    nodeTypes: string[];
    parallel: { mode: string; limits: { branches: number; nesting: number } };
  }>(request, '/simulation/capabilities');
  expect(capabilities.nodeTypes).toContain('fork');
  expect(capabilities.nodeTypes).toContain('join');
  expect(capabilities.parallel).toMatchObject({
    mode: 'all-mandatory',
    limits: { branches: 64, nesting: 16 },
  });
  const expected = runSimulation(graph.simulation!, { seed: 42 });
  const baseline = await headless(request, graph);
  compare(baseline.result, expected);
  expect(baseline.result.metrics).toMatchObject({
    created: 8,
    completed: 8,
    realizedRevenue: 96000,
    abandoned: 0,
  });
  expect(baseline.result.parallel).toMatchObject({
    createdBranches: 24,
    joinedBranches: 24,
    activeGroups: 0,
  });
  await showAll(page);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  const animatedId = await newRun(request, graph, new Set([baseline.id]));
  const animatedPath = `/diagrams/${graph.diagram.id}/simulation/runs/${animatedId}`;
  await expect
    .poll(
      async () =>
        (await semantic<SimulationState>(request, `${animatedPath}/state`)).nodes[joinId].join!
          .waitingGroups,
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  const waiting = await semantic<SimulationState>(request, `${animatedPath}/state`);
  expect(waiting.parallel!.activeGroups).toBeGreaterThan(0);
  expect(waiting.nodes[joinId].join!.arrivedBranches).toBeLessThan(
    waiting.nodes[joinId].join!.expectedBranches,
  );
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator(`.react-flow__node[data-id="${joinId}"]`).click();
  const summary = page.locator(`[data-simulation-node="${joinId}"]`);
  await expect(summary).toHaveAttribute('data-queue', String(waiting.nodes[joinId].queue.current));
  await expect(summary.locator('[data-join-waiting]')).toHaveAttribute(
    'data-join-waiting',
    String(waiting.nodes[joinId].join!.waitingGroups),
  );
  await expect(summary).toContainText(
    `Ready tasks: ${waiting.nodes[joinId].join!.arrivedBranches}/${waiting.nodes[joinId].join!.expectedBranches}`,
  );
  await captureWaitingGuide(page, graph, joinId);
  await page.getByRole('button', { name: 'Stop simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('stopped');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  const uiId = await newRun(request, graph, new Set([baseline.id, animatedId]));
  const ui = await completedResult(request, graph, uiId);
  compare(ui, baseline.result);
  const rest = await request.get(
    `/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${uiId}/result`,
  );
  expect(rest.ok()).toBe(true);
  expect(await rest.json()).toEqual(ui);
  const scenarioId = graph.simulation!.scenarios.find(
    (entry) => entry.name === 'Two additional engineers',
  )!.id;
  const intervention = await headless(request, graph, { scenarioId });
  expect(intervention.result.metrics.completed).toBe(8);
  expect(intervention.result.metrics.realizedRevenue).toBe(96000);
  expect(intervention.result.metrics.resourceCost).toBeGreaterThan(ui.metrics.resourceCost);
  expect(intervention.result.metrics.ttr.average).toBeLessThan(ui.metrics.ttr.average!);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  expect(await semantic(request, `/diagrams/${graph.diagram.id}/simulation`)).toEqual(
    graph.simulation,
  );
});

test('actual worker joins and work queues match MCP, and pause freezes time and branch movement', async ({
  page,
  request,
}) => {
  const model = parallelModel({ particles: 3, durations: [1, 60] });
  model.nodes = model.nodes.map((node) =>
    node.type === 'work' ? { ...node, work: { ...node.work, capacity: 1 } } : node,
  );
  model.defaults.durationSeconds = 240;
  const graph = await create(request, 'Live parallel branch queues', model);
  const joinId = graph.simulation!.nodes.find((node) => node.type === 'join')!.id;
  const slowId = graph.simulation!.nodes.find((node) => node.name === 'Work 1')!.id;
  await open(page, request, graph);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
  await page.getByLabel('Simulation duration hours').fill(String(240 / 3600));
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  // The UI publishes running only after its run is saved and registered. Read
  // that authoritative run once, rather than nesting a valid bridge request
  // (20-second HTTP deadline) inside a shorter eventual-assertion deadline.
  await expect(page.locator('.simulation-run-status')).toHaveText('running');
  const runs = await semantic<{ id: string }[]>(
    request,
    `/diagrams/${graph.diagram.id}/simulation/runs`,
  );
  expect(runs).toHaveLength(1);
  const id = runs[0].id;
  const path = `/diagrams/${graph.diagram.id}/simulation/runs/${id}`;
  await expect
    .poll(
      async () =>
        (await semantic<SimulationState>(request, `${path}/state`)).nodes[joinId].join!
          .arrivedBranches,
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  const state = await semantic<SimulationState>(request, `${path}/state`);
  expect(state.metrics).toMatchObject({
    created: 3,
    completed: 0,
    inSystem: 3,
    realizedRevenue: 0,
  });
  expect(state.nodes[slowId].queue.current).toBe(2);
  expect(state.nodes[joinId].join!.arrivedBranches).toBeGreaterThan(0);
  expect(state.parallel!.activeBranches).toBe(6);
  const actual = await request.get(`/api/v1${path}/state`);
  expect(await actual.json()).toEqual(state);
  await expect(page.locator(`[data-simulation-node="${joinId}"]`)).toHaveAttribute(
    'data-queue',
    String(state.nodes[joinId].queue.current),
  );
  await expect(page.locator(`[data-simulation-node="${slowId}"]`)).toHaveAttribute(
    'data-queue',
    '2',
  );
  expect(
    state.particles.filter(
      (particle) => particle.status === 'waiting' && particle.nodeId === joinId,
    ),
  ).toHaveLength(state.nodes[joinId].queue.current);
  const canvas = page.getByTestId('simulation-particles');
  await expect(canvas).toHaveAttribute('data-simulated-time', String(state.timeSeconds));
  const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  // Wait across the actual browser worker's animation clock; a paused run must stay frozen.
  await page.waitForTimeout(600);
  expect((await semantic<SimulationState>(request, `${path}/state`)).timeSeconds).toBe(
    state.timeSeconds,
  );
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(
    before,
  );
  await semantic(request, `${path}/stop`, 'POST', {});
});

test('quick add creates an editable paired block, scenarios stay isolated and explicit block removal reconnects the case route', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Parallel block editing', createBasicModel({ particles: 2 }));
  const path = `/diagrams/${graph.diagram.id}/simulation`;
  const originalWorkId = graph.simulation!.nodes.find((node) => node.type === 'work')!.id;
  const originalOutcomeId = graph.simulation!.nodes.find((node) => node.type === 'outcome')!.id;
  await open(page, request, graph);
  await page.locator(`.react-flow__node[data-id="${originalWorkId}"]`).click();
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  await page.getByRole('button', { name: 'Parallel work', exact: true }).click();
  await saved(page);
  const added = await semantic<SimulationModel>(request, path);
  const fork = added.nodes.find((node) => node.type === 'fork')!;
  expect(fork.type).toBe('fork');
  if (fork.type !== 'fork') throw new Error('Missing fork');
  const join = added.nodes.find((node) => node.id === fork.fork.joinNodeId)!;
  expect(join).toMatchObject({ type: 'join', join: { forkNodeId: fork.id } });
  expect(added.nodes).toHaveLength(7);
  expect(fork.fork.branchEdgeIds).toHaveLength(2);
  const branch = added.nodes.find((node) => node.type === 'work' && node.id !== originalWorkId)!;
  page.once('dialog', async (dialog) => {
    await dialog.accept('Parallel capacity intervention');
  });
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await saved(page);
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: 'Process Simulator settings', exact: true });
  await settings.getByLabel('Simulation node', { exact: true }).selectOption(branch.id);
  await settings.getByLabel('Work capacity', { exact: true }).fill('3');
  await settings.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await saved(page);
  const changed = await semantic<SimulationModel>(request, path);
  const scenario = changed.scenarios.find(
    (entry) => entry.name === 'Parallel capacity intervention',
  )!;
  expect(scenario.overrides.nodes?.[branch.id]).toMatchObject({ work: { capacity: 3 } });
  expect(changed.nodes.find((node) => node.id === branch.id)).toMatchObject({
    work: { capacity: 1 },
  });
  expect(changed.nodes.find((node) => node.id === fork.id)).toEqual(fork);
  await page.getByLabel('Simulation scenario', { exact: true }).selectOption('');
  await page
    .getByRole('button', { name: 'Assumptions: configure simulation', exact: true })
    .click();
  await settings.getByLabel('Simulation node', { exact: true }).selectOption(join.id);
  await expect(settings.getByRole('region', { name: 'Wait for all', exact: true })).toContainText(
    'whole case ends once',
  );
  await settings
    .getByRole('button', { name: 'Remove parallel block and all its tasks', exact: true })
    .click();
  await settings.getByRole('button', { name: 'Apply assumptions', exact: true }).click();
  await saved(page);
  const removed = await semantic<SimulationModel>(request, path);
  expect(removed.nodes.map((node) => node.id).sort()).toEqual(
    graph.simulation!.nodes.map((node) => node.id).sort(),
  );
  expect(
    removed.edges.some(
      (edge) => edge.sourceNodeId === originalWorkId && edge.targetNodeId === originalOutcomeId,
    ),
  ).toBe(true);
  expect(
    removed.scenarios.find((entry) => entry.id === scenario.id)?.overrides.nodes?.[branch.id],
  ).toBeUndefined();
  expect((await headless(request, { ...graph, simulation: removed })).result.metrics).toMatchObject(
    { created: 2, completed: 2, realizedRevenue: 200 },
  );
});

test('invalid fork/join edits and single-pair deletion reject atomically without changing the persisted semantic model', async ({
  page,
  request,
}) => {
  const graph = await create(request, 'Validated parallel contracts', parallelModel());
  await open(page, request, graph);
  await saved(page);
  const current = await semantic<Graph>(request, `/diagrams/${graph.diagram.id}`);
  const path = `/diagrams/${graph.diagram.id}/simulation`;
  const invalid = structuredClone(current.simulation!);
  const fork = invalid.nodes.find((node) => node.type === 'fork')!;
  if (fork.type !== 'fork') throw new Error('Missing fork');
  fork.fork.branchEdgeIds = fork.fork.branchEdgeIds.slice(0, 1);
  const rejected = await semantic<{ code: string; issues: unknown[] }>(
    request,
    path,
    'PUT',
    { baseVersion: current.diagram.version, model: invalid },
    422,
  );
  expect(rejected.code).toBeDefined();
  expect(rejected.issues.length).toBeGreaterThan(0);
  await semantic(
    request,
    `${path}/nodes/${fork.id}?baseVersion=${current.diagram.version}`,
    'DELETE',
    undefined,
    422,
  );
  const unchanged = await semantic<Graph>(request, `/diagrams/${graph.diagram.id}`);
  expect(unchanged.diagram.version).toBe(current.diagram.version);
  expect(unchanged.simulation).toEqual(current.simulation);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  expect(await semantic(request, path)).toEqual(current.simulation);
});
