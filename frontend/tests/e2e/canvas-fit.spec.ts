import { expect, test } from './fixtures';
import { createKioskModel } from '../../src/simulation/examples';
import type { Graph } from '../../src/model/types';

test.use({ viewport: { width: 1280, height: 900 } });

test('Fit keeps every kiosk card above floating controls without changing model geometry', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/v1/diagrams', {
    data: { name: 'Fit safe area', type: 'process-simulator' },
  });
  expect(response.ok()).toBe(true);
  const diagram = await response.json();
  expect(
    (
      await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
        data: { baseVersion: diagram.version, model: createKioskModel() },
      })
    ).ok(),
  ).toBe(true);
  await page.locator('.diagram-item').filter({ hasText: 'Fit safe area' }).click();
  await expect(page.locator('.project-title-button')).toHaveText('Fit safe area');
  const read = async (): Promise<Graph> =>
    (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  const before = await read();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Hide simulation metrics', exact: true }).click();

  const unobscured = async () => {
    await expect
      .poll(async () => {
        const controls = await page.locator('.canvas-tools-panel').boundingBox();
        const nodes = await page.locator('.react-flow__node').evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { bottom: rect.bottom, top: rect.top, height: rect.height };
          }),
        );
        return (
          !!controls &&
          nodes.length === 8 &&
          nodes.every((node) => node.height > 0 && node.bottom <= controls.y - 4)
        );
      })
      .toBe(true);
  };
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await unobscured();
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await unobscured();
  await page.keyboard.press('f');
  await unobscured();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const after = await read();
  expect(after.simulation).toEqual(before.simulation);
  expect(after.nodes).toEqual(before.nodes);
});
