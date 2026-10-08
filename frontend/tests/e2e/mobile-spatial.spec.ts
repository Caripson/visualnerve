import { expect, test } from './fixtures';
import type { Graph } from '../../src/model/types';
import { browserLaunchOptions } from '../../playwright.config';
import {
  containedDialog,
  graph,
  noHorizontalOverflow,
  open,
  saved,
  screenshot,
  usableCanvas,
} from './mobile-fixtures';

// Worker-scoped software WebGL options are confined to the actual relief checks.
test.use({
  hasTouch: true,
  isMobile: true,
  actionTimeout: 45000,
  launchOptions: {
    ...browserLaunchOptions,
    args: [
      ...browserLaunchOptions.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});

test.describe('mobile relief view', () => {
  test('mobile 360×740: 2D and 3D controls return to the same editable document', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const model = await graph(request, 'Mobile relief');
    await open(page, model.diagram.name);
    await usableCanvas(page);
    await page.getByRole('button', { name: '3D view', exact: true }).tap();
    const spatial = page.getByTestId('spatial-view');
    await expect(spatial).toHaveAttribute('data-renderer', 'ready', { timeout: 30000 });
    await expect(page.getByTestId('spatial-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: '3D view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#spatial-help')).toBeHidden();
    await page.getByRole('button', { name: 'Show 3D handles', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Hide 3D handles', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Hide 3D handles', exact: true }).tap();
    await page.getByRole('button', { name: '3D tools', exact: true }).tap();
    const tools = await containedDialog(page, '3D tools menu');
    await tools.getByRole('button', { name: 'Front view', exact: true }).tap();
    await expect(tools).toBeHidden();
    await page.getByRole('button', { name: '3D help', exact: true }).tap();
    await expect(page.locator('#spatial-help')).toBeVisible();
    await page.getByRole('button', { name: 'Hide 3D help', exact: true }).tap();
    await expect(page.locator('#spatial-help')).toBeHidden();
    await usableCanvas(page);
    await screenshot(page, 'relief-360-740');
    await page.getByRole('button', { name: '2D view', exact: true }).tap();
    await expect(spatial).toBeHidden();
    await expect(page.getByRole('button', { name: '2D view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await saved(page);
    const returned = (await (
      await request.get(`/api/v1/diagrams/${model.diagram.id}`)
    ).json()) as Graph;
    expect(returned.nodes).toEqual(model.nodes);
    expect(returned.edges).toEqual(model.edges);
    await usableCanvas(page);
  });
});
