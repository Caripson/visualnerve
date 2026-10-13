import { expect, test, type APIRequestContext } from './fixtures';
import type { Diagram, Graph } from '../../src/model/types';
import type { SimulationState } from '../../src/simulation/types';

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<T>;
}

for (const width of [1024, 1440])
  test(`folding the simulator frees the canvas without restarting or changing assumptions at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const create = await request.post('/api/v1/diagrams', {
      data: {
        name: 'Compact simulator controls',
        type: 'process-simulator',
        template: 'api-compute-capacity',
      },
    });
    expect(create.status()).toBe(201);
    const diagram = (await create.json()) as Diagram;
    await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    const graph = await read<Graph>(request, `/diagrams/${diagram.id}`);
    const scenario = graph.simulation!.scenarios[0].id;
    await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
    await page.getByLabel('Simulation duration hours', { exact: true }).fill(String(60 / 3600));
    await page.getByLabel('Simulation random seed', { exact: true }).fill('1337');
    await page.getByLabel('Simulation scenario', { exact: true }).selectOption(scenario);
    const before = new Set(page.workers());
    await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
    await expect(page.locator('.simulation-run-status')).toHaveText('running');
    await expect.poll(() => page.workers().filter((worker) => !before.has(worker)).length).toBe(1);
    const worker = page.workers().find((entry) => !before.has(entry))!;
    const runs = await read<{ id: string }[]>(request, `/diagrams/${diagram.id}/simulation/runs`);
    expect(runs).toHaveLength(1);
    const statePath = `/diagrams/${diagram.id}/simulation/runs/${runs[0].id}/state`;
    await expect
      .poll(async () => (await read<SimulationState>(request, statePath)).timeSeconds)
      .toBeGreaterThan(0);

    const canvas = page.locator('.canvas-shell');
    const fullHeight = (await canvas.boundingBox())!.height;
    await page.getByRole('button', { name: 'Collapse simulation panel', exact: true }).click();
    const expand = page.getByRole('button', { name: 'Expand simulation panel', exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Simulation duration hours', { exact: true })).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'Infrastructure capacity metrics' }),
    ).toBeHidden();
    await expect
      .poll(async () => (await canvas.boundingBox())!.height)
      .toBeGreaterThan(fullHeight + 100);
    expect(page.workers()).toContain(worker);
    expect(
      (await read<{ id: string }[]>(request, `/diagrams/${diagram.id}/simulation/runs`)).map(
        (run) => run.id,
      ),
    ).toEqual(runs.map((run) => run.id));
    const observed = await read<SimulationState>(request, statePath);
    await expect
      .poll(async () => (await read<SimulationState>(request, statePath)).timeSeconds)
      .toBeGreaterThan(Math.max(observed.timeSeconds, 2));

    await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
    await expect(page.locator('.simulation-run-status')).toHaveText('paused');
    const paused = await read<SimulationState>(request, statePath);
    await expect(page.getByTestId('simulation-particles')).toHaveAttribute(
      'data-simulated-time',
      String(paused.timeSeconds),
    );
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.mouse.move(40, 20);
    await page.screenshot({
      path: `../tmp/verification/simulation-compact-${width}-light.png`,
      animations: 'disabled',
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({
      path: `../tmp/verification/simulation-compact-${width}-dark.png`,
      animations: 'disabled',
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect((await read<SimulationState>(request, statePath)).timeSeconds).toBe(paused.timeSeconds);

    await expand.click();
    await expect(
      page.getByRole('button', { name: 'Collapse simulation panel', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Simulation random seed', { exact: true })).toHaveValue('1337');
    await expect(page.getByLabel('Simulation scenario', { exact: true })).toHaveValue(scenario);
    await expect(page.getByLabel('Simulation speed', { exact: true })).toHaveValue('1');
    expect(
      Number(await page.getByLabel('Simulation duration hours', { exact: true }).inputValue()),
    ).toBeCloseTo(60 / 3600, 12);
    await page.getByRole('button', { name: 'Collapse simulation panel', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Expand simulation panel', exact: true }),
    ).toBeHidden();
    await page.getByRole('button', { name: 'Open simulation details', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Simulation details', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Simulation random seed', { exact: true })).toHaveValue('1337');
    await expect(page.getByLabel('Simulation scenario', { exact: true })).toHaveValue(scenario);
    await page.getByRole('button', { name: 'Back to diagram', exact: true }).click();
    await page.setViewportSize({ width, height: 1000 });
    await expect(expand).toBeVisible();
    expect((await read<SimulationState>(request, statePath)).timeSeconds).toBe(paused.timeSeconds);
    expect((await read<Graph>(request, `/diagrams/${diagram.id}`)).simulation).toEqual(
      graph.simulation,
    );
    await page.getByRole('button', { name: 'Stop simulation', exact: true }).click();
    await expect(page.locator('.simulation-run-status')).toHaveText('stopped');
    await expect.poll(() => page.workers().includes(worker)).toBe(false);
  });
