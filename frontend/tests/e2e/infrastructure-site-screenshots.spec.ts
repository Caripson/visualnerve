import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Graph } from '../../src/model/types';
import type { SimulationState } from '../../src/simulation/types';
import { captureAppearancePair } from './capture-appearance';

test.skip(
  process.env.VN_CAPTURE_INFRASTRUCTURE_SITE !== '1',
  'Opt in to publish actual simulator screen captures.',
);
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

const images = resolve('../hugo/static/site/images');
const evidence = resolve('../tmp/verification/infrastructure-site');
const cases = [
  {
    family: 'api',
    template: 'api-compute-capacity',
    title: 'API & Compute Capacity',
    time: 20,
    pool: 'cpu-pool',
  },
  {
    family: 'network',
    template: 'network-multi-site-capacity',
    title: 'Network & Multi-Site Capacity',
    time: 60,
    pool: 'backbone-pool',
  },
  {
    family: 'energy',
    template: 'energy-power-capacity',
    title: 'Energy & Power Capacity',
    time: 3900,
    pool: 'power-pool',
  },
  {
    family: 'datacenter',
    template: 'datacenter-capacity',
    title: 'Datacenter Capacity',
    time: 20,
    pool: 'wan-pool',
  },
] as const;

async function response<T>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: object,
  status = 200,
): Promise<T> {
  const result = await request.fetch(`/api/v1${path}`, { method, ...(data ? { data } : {}) });
  expect(result.status(), await result.text()).toBe(status);
  return result.json() as Promise<T>;
}

async function frame(page: Page, graph: Graph, pool: string) {
  await page.locator(`button[data-diagram-id="${graph.diagram.id}"]`).click();
  await expect(
    page.getByRole('heading', { name: graph.diagram.name, exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse simulation panel', exact: true }).click();
  if (graph.simulation!.processes?.length)
    await page.getByRole('button', { name: 'Process overview', exact: true }).click();
  const hide = page.getByRole('button', { name: 'Hide simulation metrics', exact: true });
  if (await hide.isVisible()) await hide.click();
  if (await page.locator('.react-flow__minimap').isVisible())
    await page.getByRole('button', { name: 'Toggle minimap', exact: true }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const selected = graph.nodes.find((node) => node.externalId === pool);
  expect(selected).toBeDefined();
  const node = page.locator(`.canvas-shell [data-node-id="${selected!.id}"]`);
  await expect(node).toBeInViewport();
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 20 } });
  await page.mouse.move(50, 20);
  await expect(page.locator('.context-toolbar')).toBeHidden();
  await expect(page.locator('.node-quick-add-anchor:visible')).toHaveCount(0);
  if (pool === 'cpu-pool' || pool === 'wan-pool') {
    const canvas = await page.locator('.canvas-shell .react-flow').boundingBox();
    const overview = await page.getByTestId('overview-controls').boundingBox();
    expect(canvas).not.toBeNull();
    expect(overview).not.toBeNull();
    const poolIds = graph
      .simulation!.nodes.filter((value) => value.type === 'resource')
      .map((value) => value.id);
    const cards = poolIds.map((id) => page.locator(`.canvas-shell [data-node-id="${id}"]`));
    const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
    const clearance = 16;
    const requiredPan = Math.ceil(
      Math.max(
        0,
        ...boxes.map((box) =>
          box && box.y < overview!.y + overview!.height && box.y + box.height > overview!.y
            ? box.x + box.width - overview!.x + clearance
            : 0,
        ),
      ),
    );
    if (requiredPan > 0) {
      const leftmost = await page
        .locator('.canvas-shell .react-flow__node:visible')
        .evaluateAll((nodes) =>
          Math.min(...nodes.map((node) => node.getBoundingClientRect().left)),
        );
      expect(leftmost - requiredPan).toBeGreaterThan(canvas!.x + 12);
      // A native middle-button drag changes only the viewport. Keep the original
      // model and exact paused worker state; native controls remain visible.
      const start = { x: canvas!.x + requiredPan + 50, y: canvas!.y + 20 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(start.x - requiredPan, start.y, { steps: 8 });
      await page.mouse.up({ button: 'middle' });
    }
    for (const card of cards) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      const overlap =
        box!.x < overview!.x + overview!.width &&
        box!.x + box!.width > overview!.x &&
        box!.y < overview!.y + overview!.height &&
        box!.y + box!.height > overview!.y;
      expect(overlap).toBe(false);
    }
    const bounds = await page
      .locator('.canvas-shell .react-flow__node:visible')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      );
    expect(bounds.length).toBeGreaterThan(0);
    for (const box of bounds) {
      expect(box.left).toBeGreaterThanOrEqual(canvas!.x);
      expect(box.right).toBeLessThanOrEqual(canvas!.x + canvas!.width);
      expect(box.top).toBeGreaterThanOrEqual(canvas!.y);
      expect(box.bottom).toBeLessThanOrEqual(canvas!.y + canvas!.height);
    }
  }
  await page.mouse.move(50, 20);
  await expect(page.getByRole('button', { name: 'Rerun simulation', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

function derivatives(name: string) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'visual-nerve-infrastructure-site-'));
  try {
    for (const suffix of ['', '-dark']) {
      const png = resolve(temporary, `${name}${suffix}.png`);
      execFileSync('dwebp', [resolve(images, `${name}${suffix}.webp`), '-o', png]);
      for (const width of [480, 960])
        execFileSync('cwebp', [
          '-resize',
          String(width),
          '0',
          '-q',
          '85',
          '-m',
          '6',
          '-quiet',
          png,
          '-o',
          resolve(images, `${name}-${width}${suffix}.webp`),
        ]);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

for (const scene of cases)
  test(`capture actual ${scene.family} simulation state in matching light and dark monitor screens`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    const diagram = await response<{ id: string }>(
      request,
      '/diagrams',
      'POST',
      {
        name: scene.title,
        type: 'process-simulator',
        template: scene.template,
      },
      201,
    );
    const graph = await response<Graph>(request, `/diagrams/${diagram.id}`);
    expect(graph.simulation!.schemaVersion).toBe(2);
    await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
    await expect(
      page.getByRole('region', { name: 'Process Simulator', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
    const run = await response<{ id: string }>(
      request,
      `/diagrams/${diagram.id}/simulation/runs`,
      'POST',
      {
        seed: 42,
        durationSeconds: graph.simulation!.defaults.durationSeconds,
        speed: 1,
        animated: true,
        untilComplete: false,
      },
      201,
    );
    const route = `/diagrams/${diagram.id}/simulation/runs/${run.id}`;
    await response(request, `${route}/pause`, 'POST', {});
    await expect
      .poll(async () => (await response<{ status: string }>(request, route)).status)
      .toBe('paused');
    // Replay executes the real seeded engine to this exact time. Pausing the observed
    // midpoint keeps particles and measured pressure identical between the two themes.
    const state = await response<SimulationState>(request, `${route}/seek`, 'POST', {
      timeSeconds: scene.time,
    });
    expect(state.timeSeconds).toBe(scene.time);
    expect(state.infrastructure).toBeDefined();
    expect(state.metrics.created).toBeGreaterThan(0);
    expect(state.metrics.inSystem).toBeGreaterThan(0);
    if (scene.family === 'api') {
      expect(state.infrastructure!.memory.ram.usedMiB).toBeGreaterThan(0);
      expect(state.infrastructure!.cpu.cpu.completedWorkCoreSeconds).toBeGreaterThan(0);
      expect(state.bottlenecks.some((value) => value.methodology === 'blocked-admission')).toBe(
        true,
      );
    } else if (scene.family === 'network') {
      expect(state.infrastructure!.bandwidth.backbone.activeTransfers).toBeGreaterThan(1);
      expect(state.infrastructure!.bandwidth.backbone.transferredBytes).toBeGreaterThan(0);
    } else if (scene.family === 'energy') {
      expect(state.infrastructure!.energy.power.deliveredKWh).toBeGreaterThan(0);
      expect(state.infrastructure!.energy.power.unmetKW).toBeGreaterThan(0);
    } else {
      expect(state.infrastructure!.bandwidth.wan.activeTransfers).toBeGreaterThan(1);
      expect(state.infrastructure!.energy.power.generatedKWh).toBeGreaterThan(0);
      expect(state.infrastructure!.cpu.cpu.completedWorkCoreSeconds).toBeGreaterThan(0);
    }
    await frame(page, graph, scene.pool);
    await expect(page.locator('.simulation-run-status')).toHaveText('paused');
    const particles = page.getByTestId('simulation-particles');
    await expect(particles).toHaveAttribute('data-simulated-time', String(scene.time));
    expect(Number(await particles.getAttribute('data-rendered-particles'))).toBeGreaterThan(0);
    await captureAppearancePair(page, images, `infrastructure-${scene.family}`);
    derivatives(`infrastructure-${scene.family}`);
    expect(await response<SimulationState>(request, `${route}/state`)).toEqual(state);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      resolve(evidence, `${scene.family}.json`),
      JSON.stringify(
        {
          template: scene.template,
          seed: 42,
          observedSeconds: scene.time,
          presentation: 'paused real engine replay; process overview where available',
          viewport: { width: 1440, height: 900 },
          renderedParticles: Number(await particles.getAttribute('data-rendered-particles')),
          metrics: state.metrics,
          infrastructure: state.infrastructure,
          bottlenecks: state.bottlenecks,
        },
        null,
        2,
      ),
    );
    await response(request, `${route}/stop`, 'POST', {});
  });
