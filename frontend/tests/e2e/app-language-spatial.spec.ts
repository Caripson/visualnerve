import { expect, test } from './fixtures';
import { browserLaunchOptions } from '../../playwright.config';
import { APP_LOCALES } from '../../src/i18n/types';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';

test.use({
  // The same bounded cold shader-compilation allowance as the existing 3D acceptance suite.
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

test('language changes refresh real 3D card faces without replacing the canvas, camera or saved model', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Untranslated diagram in relief', type: 'process' },
    })
  ).json();
  const created = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'work',
          title: 'Settings is authored content',
          x: 100,
          y: 100,
          width: 280,
          height: 120,
          nodeType: 'process',
          status: 'done',
        },
        {
          externalId: 'outcome',
          title: 'Continue remains my title',
          x: 500,
          y: 240,
          width: 260,
          height: 100,
          nodeType: 'output',
        },
      ],
      edges: [
        {
          sourceExternalId: 'work',
          targetExternalId: 'outcome',
          label: 'Do not translate my connection',
        },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  await page.locator('.diagram-item').filter({ hasText: diagram.name }).click();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  const canvas = page.getByTestId('spatial-canvas');
  await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
  await expect(canvas).toHaveAttribute('data-face-captures', '2');
  await page.getByRole('button', { name: 'Tilt diagram right 10 degrees', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const camera = await canvas.getAttribute('data-camera-position');
  const target = await canvas.getAttribute('data-camera-target');
  const originalCanvas = await canvas.elementHandle();
  const before = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const selector = page.getByTestId('app-language');
  const catalogs = new LocaleCatalogLoader();
  for (const { id } of APP_LOCALES) {
    const catalog = await catalogs.load(id);
    await selector.selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    await expect(canvas).toHaveAttribute('aria-label', catalog['spatial.canvasDescription']);
    await expect(canvas).toHaveAttribute('data-face-source', '2d-node', { timeout: 30000 });
    await expect(canvas).toHaveAttribute('data-face-captures', '2');
    expect(
      await canvas.evaluate((element, original) => element === original, originalCanvas!),
    ).toBe(true);
    expect(await canvas.getAttribute('data-camera-position')).toBe(camera);
    expect(await canvas.getAttribute('data-camera-target')).toBe(target);
    expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
  }
  expect(errors).toEqual([]);
});
