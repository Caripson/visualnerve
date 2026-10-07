import { expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { captureProcessGuide } from './capture-process';

async function createEmpty(page: Page, name: string) {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByRole('button', { name: /^Process Simulator/ }).click();
  await dialog.getByLabel('New diagram name').fill(name);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Set up your process' })).toBeVisible();
}

test('guided setup creates a persisted process that runs through the same semantic API model', async ({
  page,
  request,
}) => {
  await createEmpty(page, 'Guided package workflow');
  const wizard = page.getByRole('dialog', { name: 'Set up your process' });
  await wizard.getByLabel('Work item name').fill('Package');
  await wizard.getByRole('button', { name: /A fixed batch/ }).click();
  await wizard.getByLabel('Batch size (items)').fill('10');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await wizard.getByLabel('Work step name').fill('Hand over package');
  await wizard.getByLabel('Processing time (minutes/item)').fill('1');
  await wizard.getByLabel('Parallel capacity (slots)').fill('2');
  await wizard.getByLabel('Use a shared resource').check();
  await wizard.getByLabel('Shared resource name').fill('Store staff');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await wizard.getByLabel('Revenue per completed item (SEK)').fill('20');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await expect(wizard.getByLabel('Process preview')).toContainText('Hand over package');
  await expect(wizard).toContainText('5 simulated seconds per connection');
  await captureProcessGuide(wizard, 'process-setup');
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await expect(wizard).toBeHidden();
  await expect
    .poll(async () =>
      page.locator('.react-flow__node').evaluateAll((nodes) => {
        const canvas = document.querySelector('.react-flow')!.getBoundingClientRect();
        return nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.left >= canvas.left &&
            rect.right <= canvas.right &&
            rect.top >= canvas.top &&
            rect.bottom <= canvas.bottom
          );
        });
      }),
    )
    .toBe(true);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const diagram = diagrams.find(
    (entry: { name: string }) => entry.name === 'Guided package workflow',
  );
  const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(graph.simulation!.nodes).toHaveLength(4);
  expect(graph.simulation!.resources[0].name).toBe('Store staff');
  expect(graph.simulation!.nodes.find((node) => node.type === 'work')).toMatchObject({
    work: { capacity: 2, processingSeconds: 60 },
  });
  expect(graph.simulation!.edges.every((edge) => edge.travelSeconds === 5)).toBe(true);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  const runs = await (await request.get(`/api/v1/diagrams/${diagram.id}/simulation/runs`)).json();
  const result = await (
    await request.get(`/api/v1/diagrams/${diagram.id}/simulation/runs/${runs[0].id}/result`)
  ).json();
  expect(result.metrics).toMatchObject({ created: 10, completed: 10, realizedRevenue: 200 });
  expect(result.completedAtSeconds).toBe(610);
  expect(result.metrics.resourceCost).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Set up your process' })).toHaveCount(0);
  const reopened = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(reopened.simulation).toEqual(graph.simulation);
});

test('guided setup fits a phone screen and remains usable with the short landscape keyboard space', async ({
  page,
  request,
}) => {
  await createEmpty(page, 'Responsive process setup');
  await page.setViewportSize({ width: 390, height: 844 });
  const wizard = page.getByRole('dialog', { name: 'Set up your process' });
  await wizard.getByLabel('Work item name').fill('Order');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await wizard.getByLabel('Work step name').fill('Pack order');
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(wizard.getByLabel('Process preview')).toContainText('Pack order');
  expect(await wizard.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(
    390,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/visualnerve-process-wizard-mobile.png' });
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await savedForMobile(page);
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const diagram = diagrams.find(
    (entry: { name: string }) => entry.name === 'Responsive process setup',
  );
  const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  await page.locator(`.react-flow__node[data-id="${work.id}"]`).click();
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  const add = page.getByRole('button', { name: 'Insert work step', exact: true });
  await expect(add).toBeVisible();
  const bounds = await add.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await add.click();
  await savedForMobile(page);
  await page.screenshot({ path: '/tmp/visualnerve-process-built-mobile.png' });
});

async function savedForMobile(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

test('an empty simulator explains the next action and permits dismissing and reopening setup', async ({
  page,
  request,
}) => {
  await createEmpty(page, 'Reopen setup');
  await page.getByRole('button', { name: 'Set up later' }).click();
  await expect(page.getByText('Build your first process', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start guided setup', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Set up your process' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Set up your process' })).toBeVisible();
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const diagram = diagrams.find((entry: { name: string }) => entry.name === 'Reopen setup');
  const model = await (await request.get(`/api/v1/diagrams/${diagram.id}/simulation`)).json();
  expect(model.nodes).toHaveLength(0);
});
