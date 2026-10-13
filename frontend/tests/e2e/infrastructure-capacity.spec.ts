import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph, Diagram } from '../../src/model/types';
import type { SimulationResult, SimulationComparison } from '../../src/simulation/types';
import { createEmptySimulationModel } from '../../src/simulation/starter';

async function rpc(request: APIRequestContext, name: string, argumentsValue: object) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    },
  });
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}
async function mcp<T>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
): Promise<T> {
  const response = await rpc(request, 'visual_nerve_request', {
    path,
    method,
    ...(data === undefined ? {} : { data }),
  });
  expect(response.structuredContent.status, JSON.stringify(response.structuredContent.body)).toBe(
    status,
  );
  return response.structuredContent.body as T;
}
async function open(page: Page, id: string) {
  const sidebar = page.locator(`button[data-diagram-id="${id}"]`);
  const projects = page.getByRole('button', { name: 'Open projects', exact: true });
  if (await projects.isVisible()) await projects.click();
  await expect(sidebar).toBeVisible();
  await sidebar.click();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function runResult(request: APIRequestContext, diagramId: string, options: object) {
  const run = await mcp<{ id: string }>(
    request,
    `/diagrams/${diagramId}/simulation/runs`,
    'POST',
    options,
    201,
  );
  await expect
    .poll(
      async () =>
        (await mcp<{ status: string }>(request, `/diagrams/${diagramId}/simulation/runs/${run.id}`))
          .status,
    )
    .toBe('completed');
  return mcp<SimulationResult>(request, `/diagrams/${diagramId}/simulation/runs/${run.id}/result`);
}
const numerical = (result: SimulationResult) => ({
  metrics: result.metrics,
  infrastructure: result.infrastructure,
  finalCapacities: result.finalCapacities,
  nodes: result.nodes,
  resources: result.resources,
  particleTypes: result.particleTypes,
});

test('capacity templates are discoverable and UI/REST/MCP edits and seeded runs share one model', async ({
  page,
  request,
}) => {
  const guide = await rpc(request, 'visual_nerve_api_docs', { document: 'guide' });
  expect(guide.content[0].text).toContain('infrastructure-resources-v1');
  const capabilities = await mcp<{ supportedModelSchemaVersions: number[] }>(
    request,
    '/simulation/capabilities',
  );
  expect(capabilities.supportedModelSchemaVersions).toEqual([1, 2]);
  await page.getByRole('button', { name: /^New diagram/ }).click();
  for (const name of [
    'API & Compute Capacity',
    'Network & Multi-Site Capacity',
    'Energy & Power Capacity',
    'Datacenter Capacity',
  ])
    await expect(
      page.getByRole('button', { name: new RegExp(name.replaceAll('&', '&')) }),
    ).toBeVisible();
  await page.getByRole('button', { name: 'API & Compute Capacity', exact: false }).click();
  await page.getByLabel('New diagram name').fill('Infrastructure parity');
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const diagrams = await mcp<Diagram[]>(request, '/diagrams?type=process-simulator');
  const diagram = diagrams.find((value) => value.name === 'Infrastructure parity')!;
  await page.getByRole('button', { name: 'Assumptions: configure simulation' }).click();
  await page.getByRole('button', { name: /^resources$/i }).click();
  await page.getByLabel('API CPU pool capacity', { exact: true }).fill('4');
  await page.getByLabel('API CPU pool capacity', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Apply assumptions' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const graph = await mcp<Graph>(request, `/diagrams/${diagram.id}`);
  expect(graph.simulation!.schemaVersion).toBe(2);
  expect(graph.simulation!.resources.find((resource) => resource.id === 'cpu')!.capacity).toBe(4);
  expect(graph.simulation!.resources.find((resource) => resource.id === 'db')).toMatchObject({
    capacity: 8,
    unit: 'connections',
    costPerHour: 0.05,
  });
  const execute = graph.simulation!.nodes.find((node) => node.name === 'Execute API request');
  expect(execute?.type === 'work' && execute.work.resourceRequirements).toEqual([
    { resourceId: 'db', units: 1 },
  ]);
  const patched = await mcp<Graph>(
    request,
    `/diagrams/${diagram.id}/simulation/resources/ram`,
    'PATCH',
    { baseVersion: graph.diagram.version, value: { capacity: 1024 } },
  );
  await page.getByRole('button', { name: 'Assumptions: configure simulation' }).click();
  await page.getByRole('button', { name: /^resources$/i }).click();
  await expect(page.getByLabel('Request RAM capacity', { exact: true })).toHaveValue('1024');
  await page.getByRole('button', { name: 'Apply assumptions' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByLabel('Simulation duration hours').fill(String(6 / 3600));
  await page.getByLabel('Simulation random seed').fill('42');
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const runs = await mcp<{ id: string }[]>(request, `/diagrams/${diagram.id}/simulation/runs`);
  const ui = await mcp<SimulationResult>(
    request,
    `/diagrams/${diagram.id}/simulation/runs/${runs[0].id}/result`,
  );
  const external = await runResult(request, diagram.id, {
    durationSeconds: 6,
    seed: 42,
    animated: false,
    untilComplete: false,
  });
  expect(numerical(external)).toEqual(numerical(ui));
  expect(external.infrastructure!.memory.ram.peakUsedMiB).toBeGreaterThan(0);
  expect(patched.simulation!.resources.find((resource) => resource.id === 'ram')!.capacity).toBe(
    1024,
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Process Simulator', exact: true })).toBeVisible();
  expect((await mcp<Graph>(request, `/diagrams/${diagram.id}`)).simulation!.schemaVersion).toBe(2);
});

for (const width of [390, 768, 1440])
  test(`guided infrastructure setup, invalid drafts and domain metrics work at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const diagram = await mcp<Diagram>(
      request,
      '/diagrams',
      'POST',
      { name: `Capacity setup ${width}`, type: 'process-simulator' },
      201,
    );
    await mcp<Graph>(request, `/diagrams/${diagram.id}/simulation`, 'PUT', {
      baseVersion: diagram.version,
      model: createEmptySimulationModel(),
    });
    await open(page, diagram.id);
    await page
      .getByLabel('Capacity model domain', { exact: true })
      .selectOption('network-multi-site-capacity');
    await expect(
      page.getByRole('dialog', { name: 'Set up Network & Multi-Site Capacity', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Run duration', { exact: true }).fill('10');
    await page.getByLabel('Run duration', { exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const quantity = page.getByLabel('Shared backbone capacity', { exact: true });
    await quantity.fill('-1');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await quantity.fill('100');
    await quantity.press('Tab');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review capacity model' })).toBeFocused();
    await page
      .getByLabel('Model assumptions text')
      .fill(
        'Illustrative two-site uploads share a 100 Mbps backbone. Site A sends 12 requests/minute with 16 MiB payloads; Site B sends 10 requests/minute with 32 MiB payloads. Propagation is 30/80 ms after serialization. The acknowledgement link has 10 Mbps capacity. This 10-second observation models fluid payload movement, not TCP or physical distance.',
      );
    if (width !== 768) {
      await page.screenshot({
        path: `../tmp/verification/infrastructure-setup-${width}-light.png`,
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({
        path: `../tmp/verification/infrastructure-setup-${width}-dark.png`,
      });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await page.getByRole('button', { name: 'Create capacity model', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    const graph = await mcp<Graph>(request, `/diagrams/${diagram.id}`);
    expect(
      graph.simulation!.resources.find((resource) => resource.id === 'backbone')!.capacity,
    ).toBe(100);
    expect(graph.simulation!.edges.filter((edge) => edge.infrastructure)).toHaveLength(3);
    expect(graph.simulation!.description).toContain('100 Mbps backbone');
    const details = page.getByRole('button', { name: 'Open simulation details', exact: true });
    const compact = await details.isVisible();
    if (compact) await details.click();
    await page.getByLabel('Simulation speed').selectOption('max');
    await page
      .getByRole('button', { name: compact ? 'Run simulation' : 'Play simulation', exact: true })
      .click();
    await expect(page.locator('.simulation-run-status')).toHaveText('completed');
    if (compact) {
      await details.click();
      await page.getByLabel('Simulation panel', { exact: true }).selectOption('metrics');
    }
    const metrics = page.getByRole('region', { name: 'Infrastructure capacity metrics' });
    await expect(metrics).toBeVisible();
    await expect(
      metrics.locator('[data-infrastructure-metric="backbone:Transferred payload"]'),
    ).not.toHaveText('0 MiB');
    await metrics.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `../tmp/verification/infrastructure-${width}-light.png`,
      fullPage: false,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: `../tmp/verification/infrastructure-${width}-dark.png`,
      fullPage: false,
    });
  });

test('API and MCP create every domain example and expose bandwidth and energy results without an active canvas', async ({
  page,
  request,
}) => {
  await rpc(request, 'visual_nerve_api_docs', { document: 'guide' });
  const results: SimulationResult[] = [];
  for (const template of [
    'api-compute-capacity',
    'network-multi-site-capacity',
    'energy-power-capacity',
    'datacenter-capacity',
  ]) {
    const diagram = await mcp<Diagram>(
      request,
      '/diagrams',
      'POST',
      {
        name: {
          'api-compute-capacity': 'API & Compute Capacity',
          'network-multi-site-capacity': 'Network & Multi-Site Capacity',
          'energy-power-capacity': 'Energy & Power Capacity',
          'datacenter-capacity': 'Datacenter Capacity',
        }[template],
        type: 'process-simulator',
        template,
      },
      201,
    );
    const graph = await mcp<Graph>(request, `/diagrams/${diagram.id}`);
    expect(graph.simulation!.schemaVersion).toBe(2);
    await expect(page.locator(`button[data-diagram-id="${diagram.id}"]`)).toBeVisible();
    results.push(
      await runResult(request, diagram.id, {
        durationSeconds: template === 'energy-power-capacity' ? 1800 : 20,
        seed: 42,
        animated: false,
        untilComplete: false,
      }),
    );
    if (template === 'api-compute-capacity') {
      const databaseLimited = await runResult(request, diagram.id, {
        durationSeconds: 20,
        seed: 42,
        scenarioId: 'database-limit',
        animated: false,
        untilComplete: false,
      });
      expect(databaseLimited.metrics.completed).toBeLessThan(results.at(-1)!.metrics.completed);
      expect(databaseLimited.bottlenecks.some((value) => value.id === 'db')).toBe(true);
      expect(databaseLimited.resources.db.blockedNodeIds?.length).toBeGreaterThan(0);
      const comparison = await mcp<{ comparisons: SimulationComparison[] }>(
        request,
        `/diagrams/${diagram.id}/simulation/compare`,
        'POST',
        { runIds: [results.at(-1)!.runId, databaseLimited.runId] },
      );
      expect(comparison.comparisons[0].delta.completed).toBeLessThan(0);
      expect(comparison.comparisons[0].infrastructure!.baseline.cpu.cpu).toEqual(
        results.at(-1)!.infrastructure!.cpu.cpu,
      );
      // The screenshot below represents the unmodified baseline, not the stress run.
      await runResult(request, diagram.id, {
        durationSeconds: 20,
        seed: 42,
        animated: false,
        untilComplete: false,
      });
    }
    await open(page, diagram.id);
    await page
      .getByLabel('Simulation duration hours')
      .fill(String((template === 'energy-power-capacity' ? 1800 : 20) / 3600));
    const domainMetrics = page.getByRole('region', { name: 'Infrastructure capacity metrics' });
    await expect(domainMetrics).toBeVisible();
    await domainMetrics.scrollIntoViewIfNeeded();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({
      path: `../tmp/verification/infrastructure-${template}-metrics-light.png`,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: `../tmp/verification/infrastructure-${template}-metrics-dark.png`,
    });
    const allSteps = page.getByRole('button', { name: 'Show all steps', exact: true });
    if (await allSteps.isVisible()) await allSteps.click();
    await page.getByRole('button', { name: 'Hide simulation metrics', exact: true }).click();
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: `../tmp/verification/infrastructure-${template}-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `../tmp/verification/infrastructure-${template}-dark.png` });
  }
  expect(results[0].infrastructure!.cpu.cpu.completedWorkCoreSeconds).toBeGreaterThan(0);
  expect(results[1].infrastructure!.bandwidth.backbone.transferredBytes).toBeGreaterThan(0);
  expect(results[2].infrastructure!.energy.power.deliveredKWh).toBeGreaterThan(0);
  expect(results[3].infrastructure!.memory.ram.peakUsedMiB).toBeGreaterThan(0);
  const read = await request.get('/api/v1/simulation/capabilities');
  expect(read.ok()).toBe(true);
  expect((await read.json()).supportedModelSchemaVersions).toEqual([1, 2]);
});
