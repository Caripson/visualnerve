import { expect, test } from './fixtures';
import { APP_LOCALES } from '../../src/i18n/types';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';
import { MessageFormatter } from '../../src/i18n/message-formatter';
import { createBasicModel } from '../../src/simulation/examples';
import type { Graph } from '../../src/model/types';

test.use({ locale: 'sv-SE' });

test('all eight UI languages preserve the authoritative API/MCP graph, node selection and narrator', async ({
  page,
  request,
}) => {
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Settings is authored content', type: 'flowchart' },
    })
  ).json();
  await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
    data: {
      title: 'Cancel <script> is authored content',
      description: 'Do not translate this description.',
      x: 200,
      y: 150,
    },
  });
  await page.locator('.diagram-item').filter({ hasText: diagram.name }).click();
  // Opening a document fits and saves its actual canvas viewport. Establish the
  // baseline after that transaction, so strict equality measures language-only
  // changes rather than an unrelated initial camera save.
  await expect
    .poll(async () => {
      const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
      const saved = graph.diagram.settings.viewport;
      if (!saved) return false;
      const actual = await page
        .locator('.canvas-shell .react-flow__viewport')
        .evaluate((element) => {
          const matrix = new DOMMatrix(getComputedStyle(element).transform);
          return { x: matrix.e, y: matrix.f, zoom: matrix.a };
        });
      return (
        Math.abs(saved.x - actual.x) < 0.001 &&
        Math.abs(saved.y - actual.y) < 0.001 &&
        Math.abs(saved.zoom - actual.zoom) < 0.001 &&
        (await page.locator('.document-actions .save-status').textContent()) === 'Saved'
      );
    })
    .toBe(true);
  const before = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  const node = before.nodes[0];
  await page.locator(`.canvas-shell [data-node-id="${node.id}"]`).click();
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const selector = page.getByTestId('app-language');
  await expect(selector.locator('option')).toHaveCount(8);
  const catalogs = new LocaleCatalogLoader();
  for (const { id } of APP_LOCALES) {
    const catalog = await catalogs.load(id);
    await selector.selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    await expect(dialog).toHaveAttribute('aria-label', catalog['app.settings']);
    await expect(selector).toHaveAttribute('aria-label', catalog['settings.appLanguage']);
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"]`)).toHaveAttribute(
      'aria-label',
      new MessageFormatter(id, catalog).t('editor.canvas.accessibility.objectLabel', {
        title: node.title,
        kind: catalog['editor.nodes.typeLabel.generic'],
      }),
    );
    await expect(
      dialog.getByLabel(catalog['voice.narrationVoiceField'], { exact: true }),
    ).toHaveValue('en_GB-alan-medium');
    expect(await page.evaluate(() => localStorage.getItem('visualnerve-app-language'))).toBe(id);
    expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: id,
        method: 'tools/call',
        params: {
          name: 'visual_nerve_request',
          arguments: { path: `/diagrams/${diagram.id}`, method: 'GET' },
        },
      },
    });
    const result = (await response.json()).result.structuredContent;
    expect(result.status).toBe(200);
    expect(result.body).toEqual(before);
    const privateSettings = (await (await request.get('/api/v1/settings')).json()) as {
      key: string;
    }[];
    expect(privateSettings.some((setting) => setting.key === 'visualnerve-app-language')).toBe(
      false,
    );
  }
  await selector.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await dialog.locator('.modal-heading button').click();
  await expect(page.locator(`.react-flow__node.selected[data-id="${node.id}"]`)).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: diagram.name, exact: true }),
  ).toBeVisible();
});

test('scenario creation prompts use every app language while authored names and the simulation model remain canonical', async ({
  page,
  request,
}) => {
  const model = createBasicModel();
  const created = await request.post('/api/v1/diagrams', {
    data: { name: 'Scenario authoring', type: 'process-simulator' },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const configured = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(configured.ok()).toBe(true);
  const baselineModel = ((await configured.json()) as Graph).simulation!;
  await page.locator('.diagram-item').filter({ hasText: diagram.name }).click();
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const catalogs = new LocaleCatalogLoader();
  let active = await catalogs.load('en');
  const names: string[] = [];
  for (const { id } of APP_LOCALES) {
    await page.getByRole('button', { name: active['privacy.localBadge.accessibleName'] }).click();
    active = await catalogs.load(id);
    await page.getByTestId('app-language').selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    await page.getByRole('dialog').locator('.modal-heading button').click();
    const prompted = page.waitForEvent('dialog');
    const click = page.getByRole('button', { name: active['simulator.run.newScenario'] }).click();
    const prompt = await prompted;
    expect(prompt.type()).toBe('prompt');
    expect(prompt.message()).toBe(active['simulator.scenario.scenarioName']);
    expect(prompt.defaultValue()).toBe(`Scenario ${String.fromCharCode(65 + names.length)}`);
    const name = `Authored ${id} — customer scenario`;
    names.push(name);
    await prompt.accept(name);
    await click;
    await expect
      .poll(async () => {
        const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
        return graph.simulation!.scenarios.map((scenario) => scenario.name);
      })
      .toEqual(names);
    const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
    const { scenarios: _scenarios, ...actual } = graph.simulation!;
    const { scenarios: _baselineScenarios, ...baseline } = baselineModel;
    expect(actual).toEqual(baseline);
  }
  const canceled = page.waitForEvent('dialog');
  const click = page.getByRole('button', { name: active['simulator.run.newScenario'] }).click();
  await (await canceled).dismiss();
  await click;
  const graph = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(graph.simulation!.scenarios.map((scenario) => scenario.name)).toEqual(names);
});

test('all languages fit mobile Settings in light, dark, narrow portrait and short landscape', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const selector = page.getByTestId('app-language');
  for (const { id } of APP_LOCALES) {
    await selector.selectOption(id);
    await expect(page.locator('html')).toHaveAttribute('lang', id);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await selector.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(
          await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeLessThanOrEqual(1);
        const panel = (await dialog.boundingBox())!,
          field = (await selector.boundingBox())!;
        expect(field.x - panel.x).toBeGreaterThanOrEqual(12);
        expect(panel.x + panel.width - field.x - field.width).toBeGreaterThanOrEqual(12);
        await selector.focus();
        await expect(selector).toBeFocused();
        await expect(dialog.locator('.modal-heading button')).toBeVisible();
      }
    }
  }
  // Local API connectivity must survive all language-only changes; it is the same browser.
  expect((await request.get('/api/v1/settings')).status()).toBe(200);
});
