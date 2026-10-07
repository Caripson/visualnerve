import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { createBasicModel } from '../../src/simulation/examples';
import type { Graph } from '../../src/model/types';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function basic(request: APIRequestContext, name: string, particles = 10, seconds = 60) {
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name, type: 'process-simulator' } })
  ).json();
  const model = createBasicModel({ particles, processingSeconds: seconds });
  const response = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Graph;
}
async function open(page: Page, name: string) {
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
}
async function configure(page: Page, nodeId: string, capacity: string) {
  await page.getByRole('button', { name: 'Configure simulation' }).click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(nodeId);
  await page.getByLabel('Work capacity', { exact: true }).fill(capacity);
}

test('AT-01/28/29 first-class template survives save/reopen and existing diagrams remain normal', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  await page.getByRole('button', { name: /Process Simulator/ }).click();
  await page.getByLabel('New diagram name').fill('Simulation template UI');
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const item = diagrams.find((entry: { name: string }) => entry.name === 'Simulation template UI');
  const before = (await (await request.get(`/api/v1/diagrams/${item.id}`)).json()) as Graph;
  expect(before.diagram.type).toBe('process-simulator');
  expect(before.simulation?.schemaVersion).toBe(1);
  expect(before.simulation?.resources.length).toBeGreaterThan(1);
  await page.reload();
  await saved(page);
  const after = (await (await request.get(`/api/v1/diagrams/${item.id}`)).json()) as Graph;
  expect(after.simulation).toEqual(before.simulation);
  const ordinary = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Ordinary map still works', type: 'mindmap' },
    })
  ).json();
  await page.locator('.diagram-item').filter({ hasText: 'Ordinary map still works' }).click();
  await saved(page);
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toHaveCount(0);
  expect(
    (await (await request.get(`/api/v1/diagrams/${ordinary.id}`)).json()).simulation,
  ).toBeUndefined();
});

test('AT-17 UI edits semantic work and API edits update the same UI model', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Semantic UI parity');
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  await open(page, 'Semantic UI parity');
  await configure(page, work.id, '5');
  await page.getByLabel('Processing time (minutes)', { exact: true }).fill('12');
  await page.getByLabel('Work cost / hour', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Apply assumptions' }).click();
  await saved(page);
  const model = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation`)).json();
  expect(model.nodes.find((node: { id: string }) => node.id === work.id).work).toMatchObject({
    capacity: 5,
    processingSeconds: 720,
    costPerHour: 500,
  });
  const updated = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
  const response = await request.patch(
    `/api/v1/diagrams/${graph.diagram.id}/simulation/nodes/${work.id}`,
    { data: { baseVersion: updated.diagram.version, value: { work: { capacity: 8 } } } },
  );
  expect(response.ok()).toBeTruthy();
  await expect(page.locator(`[data-simulation-node="${work.id}"]`)).toContainText('Capacity 8');
  await page.getByRole('button', { name: 'Configure simulation' }).click();
  await page.getByLabel('Simulation node', { exact: true }).selectOption(work.id);
  await expect(page.getByLabel('Work capacity', { exact: true })).toHaveValue('8');
});

test('AT-04/25 actual queues are visible and pause freezes the engine and particle canvas', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Paused truthful particles', 100);
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  await open(page, 'Paused truthful particles');
  await page.getByLabel('Simulation speed').selectOption('1');
  await page.getByLabel('Simulation duration hours').fill('0.1');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  const queue = page.locator(`[data-simulation-node="${work.id}"]`);
  await expect(queue).toContainText('Queue 99');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  const runs = await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs`)
  ).json();
  const state = await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${runs[0].id}/state`)
  ).json();
  expect(state.nodes[work.id].queue.current).toBe(99);
  await expect(queue).toHaveAttribute('data-queue', '99');
  const canvas = page.getByTestId('simulation-particles');
  await expect(canvas).toHaveAttribute('data-simulated-time', String(state.timeSeconds));
  expect(Number(await canvas.getAttribute('data-rendered-particles'))).toBeGreaterThan(0);
  const time = await page.getByLabel('Simulated time', { exact: true }).textContent();
  await page.waitForTimeout(350);
  expect(await page.getByLabel('Simulated time', { exact: true }).textContent()).toBe(time);
  const paused = await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${runs[0].id}/state`)
  ).json();
  expect(paused.timeSeconds).toBe(state.timeSeconds);
  await page.screenshot({ path: '/tmp/visualnerve-process-simulator.png' });
});

test('AT-16 scenarios edit independently through normal UI and MAX produces comparable saved results', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Scenario isolation UI');
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  await open(page, 'Scenario isolation UI');
  page.once('dialog', (dialog) => dialog.accept('Scenario A'));
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await configure(page, work.id, '2');
  await page.getByRole('button', { name: 'Apply assumptions' }).click();
  await saved(page);
  page.once('dialog', (dialog) => dialog.accept('Scenario B'));
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await configure(page, work.id, '3');
  await page.getByRole('button', { name: 'Apply assumptions' }).click();
  await saved(page);
  const model = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation`)).json();
  expect(model.nodes.find((node: { id: string }) => node.id === work.id).work.capacity).toBe(1);
  expect(
    model.scenarios.find((scenario: { name: string }) => scenario.name === 'Scenario A').overrides
      .nodes[work.id].work.capacity,
  ).toBe(2);
  expect(
    model.scenarios.find((scenario: { name: string }) => scenario.name === 'Scenario B').overrides
      .nodes[work.id].work.capacity,
  ).toBe(3);
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation duration hours').fill('1');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await expect(page.locator('[data-metric="Completed"]')).toHaveText('10');
  await expect(page.locator('[data-metric="Revenue"]')).toContainText('1');
  await page.getByLabel('Simulation scenario').selectOption('');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByText(/Replay and compare runs/).click();
  const checkboxes = page.getByRole('checkbox', { name: /^Compare run / });
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole('button', { name: 'Compare selected runs' }).click();
  await expect(page.getByText(/contribution change/)).toBeVisible();
  await page.getByLabel('Replay simulated time').fill('300');
  await page.getByRole('button', { name: 'Inspect this moment' }).click();
  await expect(page.getByLabel('Simulated time', { exact: true })).toHaveText('0h 5m 0s');
});

test('AT-25/27 bounded renderer shows only active transit on valid edges and capacity expands from actual scaling', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Scale and travel visualization', 5000, 0.5);
  const model = graph.simulation!;
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type !== 'work') throw new Error('fixture');
  work.work.scaling = {
    minCapacity: 1,
    maxCapacity: 3,
    queueAbove: 20,
    increment: 1,
    cooldownSeconds: 1,
    additionalCostPerHour: 100,
  };
  model.edges.forEach((edge) => {
    edge.travelSeconds = 2;
  });
  model.retention = { particles: 1000, events: 500 };
  const updated = await request.put(`/api/v1/diagrams/${graph.diagram.id}/simulation`, {
    data: { baseVersion: graph.diagram.version, model },
  });
  expect(updated.ok()).toBeTruthy();
  await open(page, 'Scale and travel visualization');
  await page.getByLabel('Simulation speed').selectOption('10');
  await page.getByLabel('Simulation duration hours').fill('1');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator(`[data-simulation-node="${work.id}"]`)).toContainText('Capacity 3');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(
    page.locator(`[data-testid="graph-node"][data-simulation-logical-node="${work.id}"]`),
  ).toHaveCount(3);
  await expect(
    page.locator(`[data-node-id="simulation-capacity:${work.id}:2"] .node-title`),
  ).toHaveText(`${work.name} 2`);
  await expect(
    page.locator(`[data-node-id="simulation-capacity:${work.id}:3"] .node-title`),
  ).toHaveText(`${work.name} 3`);
  const canvas = page.getByTestId('simulation-particles');
  expect(Number(await canvas.getAttribute('data-rendered-particles'))).toBeLessThanOrEqual(400);
  expect(Number(await canvas.getAttribute('data-simulated-particles'))).toBe(5000);
  const run = (
    await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs`)).json()
  )[0];
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  const state = await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${run.id}/state`)
  ).json();
  const validEdges = new Set(model.edges.map((edge) => edge.id));
  for (const particle of state.particles) {
    if (particle.status === 'transit') expect(validEdges.has(particle.edgeId)).toBeTruthy();
    if (particle.status === 'processing')
      expect(particle.processingEndsAtSeconds).toBeGreaterThan(state.timeSeconds);
  }
  expect(
    state.events.some((event: { type: string }) => event.type === 'CAPACITY_SCALE_UP'),
  ).toBeTruthy();
  const persisted = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  expect(persisted.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
  expect(persisted.simulation).toEqual(model);
  expect(persisted.nodes.some((node) => node.id.startsWith('simulation-capacity:'))).toBe(false);
});

test('AT-07 actual scale-down contracts capacity after sixty simulated quiet minutes', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Visible scale down', 100, 0.5);
  const model = graph.simulation!;
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type !== 'work') throw new Error('fixture');
  work.work.scaling = {
    minCapacity: 1,
    maxCapacity: 3,
    queueAbove: 20,
    increment: 1,
    cooldownSeconds: 1,
    utilizationBelow: 0.3,
    scaleDownAfterSeconds: 3600,
    additionalCostPerHour: 100,
  };
  await request.put(`/api/v1/diagrams/${graph.diagram.id}/simulation`, {
    data: { baseVersion: graph.diagram.version, model },
  });
  await open(page, 'Visible scale down');
  await page.getByLabel('Simulation speed').selectOption('10');
  await page.getByLabel('Simulation duration hours').fill('2.1');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  const summary = page.locator(`[data-simulation-node="${work.id}"]`);
  await expect(summary).toContainText('Capacity 3');
  await page.getByLabel('Simulation speed').selectOption('max');
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await expect(summary).toContainText('Capacity 1');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(
    page.locator(`[data-testid="graph-node"][data-simulation-logical-node="${work.id}"]`),
  ).toHaveCount(1);
  await expect(summary).toContainText('Unit 1 of 1');
  const run = (
    await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs`)).json()
  )[0];
  const result = await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/simulation/runs/${run.id}/result`)
  ).json();
  const events = result.events.filter(
    (event: { type: string }) => event.type === 'CAPACITY_SCALE_DOWN',
  );
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].timeSeconds).toBeGreaterThanOrEqual(3600);
  expect(result.metrics.cost).toBeGreaterThan(0);
});

test('capacity cards preserve native style, show real occupied work, share one queue and select the logical process', async ({
  page,
  request,
}) => {
  const graph = await basic(request, 'Readable capacity cards', 100, 60);
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  if (work.type !== 'work') throw new Error('fixture');
  work.work.capacity = 3;
  let response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/simulation`, {
    data: { baseVersion: graph.diagram.version, model: graph.simulation },
  });
  expect(response.ok()).toBeTruthy();
  const semantic = (await response.json()) as Graph;
  response = await request.patch(`/api/v1/nodes/${work.id}`, {
    data: {
      version: semantic.nodes.find((node) => node.id === work.id)!.version,
      color: '#b42862',
      metadata: { visualNerve: { icon: 'finance' } },
    },
  });
  expect(response.ok()).toBeTruthy();
  const original = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  await open(page, 'Readable capacity cards');
  await page.getByLabel('Simulation speed').selectOption('1');
  await page.getByLabel('Simulation duration hours').fill('0.1');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator(`[data-simulation-node="${work.id}"]`)).toContainText('Queue 97');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('paused');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const cards = page.locator(
    `[data-testid="graph-node"][data-simulation-logical-node="${work.id}"]`,
  );
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('[data-capacity-occupied="true"]')).toHaveCount(3);
  await expect(cards.locator('.simulation-node-summary[data-queue]')).toHaveCount(1);
  await expect(page.getByTestId('simulation-particles')).toHaveAttribute(
    'data-processing-particles',
    '3',
  );
  const styles = await cards.evaluateAll((elements) =>
    elements.map((element) => ({
      color: (element as HTMLElement).style.getPropertyValue('--node-accent'),
      shape: element.className,
      icon: element.querySelector('.node-topline svg')?.outerHTML,
    })),
  );
  expect(
    styles.every((style) => style.color === '#b42862' && style.shape.includes('shape-box')),
  ).toBe(true);
  expect(new Set(styles.map((style) => style.icon)).size).toBe(1);
  await expect(cards.locator('[data-area-icon="finance"]')).toHaveCount(3);
  const extra = page.locator(`[data-node-id="simulation-capacity:${work.id}:2"]`);
  await extra.locator('.node-title').click();
  await expect(page.getByLabel('Node title', { exact: true })).toHaveValue(work.name);
  await page.locator('.react-flow__pane').click({ position: { x: 12, y: 20 } });
  await expect(page.getByLabel('Node title', { exact: true })).toHaveCount(0);
  await extra.locator('..').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Node title', { exact: true })).toHaveValue(work.name);
  await page.keyboard.press('ArrowRight');
  await saved(page);
  const persisted = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  expect(persisted.nodes).toEqual(original.nodes);
  expect(persisted.edges).toEqual(original.edges);
  expect(persisted.simulation).toEqual(original.simulation);
  await page.screenshot({ path: '/tmp/visualnerve-process-capacity-cards.png' });
});

test('AT-28 simulator model and worker execute locally while the browser is offline', async ({
  page,
  request,
  context,
}) => {
  await basic(request, 'Offline simulator');
  await open(page, 'Offline simulator');
  await page.reload();
  await saved(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  try {
    await page.reload();
    await saved(page);
    await page.getByLabel('Simulation speed').selectOption('max');
    await page.getByLabel('Simulation duration hours').fill('1');
    await page.getByRole('button', { name: 'Play simulation' }).click();
    await expect(page.locator('.simulation-run-status')).toHaveText('completed');
    await expect(page.locator('[data-metric="Completed"]')).toHaveText('10');
  } finally {
    await context.setOffline(false);
  }
});

test('simulation controls and assumptions remain readable in dark theme', async ({
  page,
  request,
}) => {
  await basic(request, 'Dark theme simulation');
  await open(page, 'Dark theme simulation');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const region = page.getByRole('region', { name: 'Process Simulator', exact: true });
  const contrast = async (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color
          .match(/\d+(?:\.\d+)?/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            const value = n / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(style.color),
        background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  expect(await contrast(region)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: 'Configure simulation' }).click();
  expect(
    await contrast(page.locator('.simulation-modal nav button[aria-pressed="true"]')),
  ).toBeGreaterThanOrEqual(4.5);
});

test('AT-13/14 scenario resource labels and bindings follow the actual run without changing baseline', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Truthful kiosk resource bindings', type: 'process-simulator' },
    })
  ).json();
  const original = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  const packageWork = original.simulation!.nodes.find((node) => node.name === 'Package pickup')!;
  await open(page, original.diagram.name);
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation scenario').selectOption('dedicated-package-counter');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const work = page.locator(`[data-simulation-node="${packageWork.id}"]`);
  await expect(work).toContainText('Capacity 2');
  await expect(work.locator('.simulation-node-resources')).toHaveAttribute(
    'title',
    /Dedicated package employees.*Dedicated package counter/,
  );
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(
    page.locator(`[data-testid="graph-node"][data-simulation-logical-node="${packageWork.id}"]`),
  ).toHaveCount(2);
  const persisted = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(persisted.simulation).toEqual(original.simulation);
  expect(persisted.edges).toEqual(original.edges);
  await page.screenshot({ path: '/tmp/visualnerve-process-kiosk.png' });
  await page.getByLabel('Simulation scenario').selectOption('baseline');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(work.locator('.simulation-node-resources')).toHaveAttribute(
    'title',
    /Shared store staff.*Shared service counter/,
  );
});
