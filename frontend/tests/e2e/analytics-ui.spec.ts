import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import { captureAppearancePair } from './capture-appearance';
import type { Graph } from '../../src/model/types';
import { blankAnalytics } from '../../src/analytics/validation';

async function createAnalysis(page: Page, name: string, mode: 'example' | 'import' = 'example') {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByRole('button', { name: /^Time Series & Signal Analysis/ }).click();
  await dialog
    .getByLabel(mode === 'example' ? 'Use example data' : 'Import your data', { exact: true })
    .check();
  await dialog.getByLabel('New diagram name').fill(name);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60000 });
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible();
}

async function savedGraph(
  request: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<Graph> {
  const list = await (await request.get('/api/v1/diagrams')).json();
  const diagram = list.find((entry: { name: string }) => entry.name === name);
  expect(diagram).toBeTruthy();
  return (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
}

async function capture(
  page: Page,
  name:
    | 'time-series-explore'
    | 'time-series-import'
    | 'time-series-measure'
    | 'time-series-signals'
    | 'time-series-lab'
    | 'time-series-scenarios'
    | 'time-series-mobile',
) {
  if (process.env.VN_CAPTURE_ANALYTICS !== '1') return;
  if (process.env.VN_CAPTURE_ANALYTICS_SCENARIOS_ONLY === '1' && name !== 'time-series-scenarios')
    return;
  const dialog = page.getByRole('dialog', { name: 'Import time-series data' });
  const panel = page.locator('[role=tabpanel] > .analytics-panel').first();
  const target =
    name === 'time-series-import'
      ? dialog
      : name === 'time-series-measure'
        ? page.locator('.analytics-panel[aria-labelledby="analytics-measure-heading"]')
        : name === 'time-series-signals'
          ? page.locator('.analytics-signal-layout')
          : name === 'time-series-scenarios'
            ? page.locator('.analytics-scenario-comparison')
            : name === 'time-series-explore' || name === 'time-series-mobile'
              ? page.locator('.analytics-chart-shell').first()
              : panel;
  const originalViewport = page.viewportSize();
  try {
    if (name !== 'time-series-mobile' && originalViewport) {
      const height = await target.evaluate((element) =>
        element.matches('[role="dialog"]')
          ? element.scrollHeight / 0.9
          : element.getBoundingClientRect().height,
      );
      await page.setViewportSize({
        width: originalViewport.width,
        height: Math.max(originalViewport.height, Math.min(3000, Math.ceil(height) + 350)),
      });
    }
    if (name === 'time-series-import') {
      await target.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(dialog.getByRole('heading', { name: 'Import time-series data' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Confirm and commit import' })).toBeVisible();
      expect(
        await dialog.evaluate((element) => element.scrollHeight - element.clientHeight),
      ).toBeLessThanOrEqual(2);
    } else await target.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(target).toBeVisible();
    await captureAppearancePair(
      name === 'time-series-mobile' ? page : target,
      resolve('../hugo/static/help/images'),
      name,
    );
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}

test('real template supports measure, detect, validate and reviewed scenario comparison with persisted semantics', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const name = 'Analytics complete workflow';
  await createAnalysis(page, name);
  await expect(
    page.getByRole('heading', {
      level: 3,
      name: 'New customers · Lost customers · Net customer growth (customers)',
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, 'time-series-explore');
  await page.getByLabel('Saved chart', { exact: true }).selectOption({ label: 'Customer churn' });
  await expect(
    page.getByRole('heading', { level: 3, name: 'Customer churn (customer churn)', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Illustrative example data', { exact: true })).toBeVisible();
  const chart = page.getByRole('img', { name: /^Customer churn\. customer churn\./ });
  await expect(chart).toBeVisible();
  await chart.press('ArrowRight');
  await expect(page.locator('.analytics-chart-readout')).toContainText('Customer churn');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Show full history', exact: true }).click();

  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await page
    .getByLabel('Saved measurement', { exact: true })
    .selectOption({ label: 'Retention shift' });
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(page.getByLabel('Measurement results')).toContainText('Percentage points');
  await expect(page.getByLabel('Measurement results')).toContainText('pp');
  await capture(page, 'time-series-measure');

  await page.getByRole('button', { name: 'Save definition and result' }).click();
  await expect(page.getByText('Saved in your encrypted workspace.', { exact: true })).toBeVisible();
  const afterMeasurement = await savedGraph(request, name);
  const measurement = afterMeasurement.diagram.analytics!.measurements.find(
    (entry) => entry.name === 'Retention shift',
  )!;
  const archived = afterMeasurement.diagram.analytics!.results.find(
    (entry) => entry.id === measurement.resultId,
  )!;
  expect(archived.content.kind).toBe('measurement');
  expect(archived.inputSnapshot.datasets[0].observations.length).toBeGreaterThan(2000);
  await page.getByLabel('Measurement tool', { exact: true }).selectOption('regression');
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(
    page.getByText('Regression fit · descriptive selected interval', { exact: true }),
  ).toBeVisible();
  const fitDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export chart SVG', exact: true }).click();
  const fitSvg = await fitDownload;
  const fitSvgPath = await fitSvg.path();
  expect(fitSvgPath).toBeTruthy();
  expect(await readFile(fitSvgPath!, 'utf8')).toContain('Regression fit');

  await page.getByRole('tab', { name: /4 · Detect/ }).click();
  await page
    .getByLabel('Saved rule', { exact: true })
    .selectOption({ label: 'Retention pressure · v1' });
  await expect(page.getByLabel('Rule logic', { exact: true })).toHaveValue('and');
  await page.getByRole('button', { name: 'Evaluate saved rules' }).click();
  await expect(
    page.getByRole('button', { name: 'Evaluate saved rules', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/total signal events in/)).toBeVisible();
  await expect(page.locator('.analytics-signal-item').first()).toBeVisible();
  await capture(page, 'time-series-signals');
  await page
    .getByLabel('Saved rule', { exact: true })
    .selectOption({ label: 'Retention pressure · v1' });
  const beforeRepeat = await savedGraph(request, name);
  await page.getByRole('button', { name: 'Evaluate saved rules' }).click();
  await expect(page.getByRole('button', { name: 'Evaluate saved rules' })).toBeEnabled();
  const afterRepeat = await savedGraph(request, name);
  expect(afterRepeat.diagram.analytics!.signals.map((signal) => signal.id)).toEqual(
    beforeRepeat.diagram.analytics!.signals.map((signal) => signal.id),
  );

  await page.getByRole('tab', { name: /5 · Validate/ }).click();
  await page.getByRole('button', { name: 'Run historical validation' }).click();
  await expect(page.getByText('Historical validation results', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-table')).toContainText('holdout');
  await expect(page.getByRole('columnheader', { name: 'Precision', exact: true })).toHaveCount(0);
  await capture(page, 'time-series-lab');

  await page.getByRole('tab', { name: /6 · Simulate/ }).click();
  await page.getByRole('button', { name: 'Compare saved scenarios' }).click();
  await expect(page.getByText('Same-horizon scenario comparison')).toBeVisible();
  const customerHistoryId = afterMeasurement.diagram.analytics!.series.find(
    (series) => series.name === 'Closing customers',
  )!.id;
  const mrcHistoryId = afterMeasurement.diagram.analytics!.series.find(
    (series) => series.name === 'Closing MRC',
  )!.id;
  await page
    .getByLabel('Historical customer balance', { exact: true })
    .selectOption(customerHistoryId);
  await page.getByLabel('Historical MRC balance', { exact: true }).selectOption(mrcHistoryId);
  await page.getByRole('button', { name: 'Save comparison view', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save comparison view', exact: true }),
  ).toBeEnabled();
  const customerProjection = page.getByRole('img', {
    name: /^Customer balance: history and scenarios\./,
  });
  const mrcProjection = page.getByRole('img', { name: /^MRC balance: history and scenarios\./ });
  await expect(customerProjection).toBeVisible();
  await expect(mrcProjection).toBeVisible();
  await expect(customerProjection.locator('[data-projection-boundary]')).toHaveAttribute(
    'data-projection-boundary',
    '2025-01-01T00:00:00.000Z',
  );
  await expect(mrcProjection.locator('[data-projection-boundary]')).toHaveAttribute(
    'data-projection-boundary',
    '2025-01-01T00:00:00.000Z',
  );
  await expect(page.getByText(/not a (?:statistical )?confidence interval/).first()).toBeVisible();
  const savedView = await savedGraph(request, name);
  expect(savedView.diagram.analytics!.scenarioView).toEqual({
    customerHistorySeriesId: customerHistoryId,
    mrcHistorySeriesId: mrcHistoryId,
  });
  expect(savedView.diagram.analytics!.datasets).toEqual(
    afterMeasurement.diagram.analytics!.datasets,
  );
  expect(savedView.diagram.analytics!.scenarios).toEqual(
    afterMeasurement.diagram.analytics!.scenarios,
  );
  const scenarioDownload = page.waitForEvent('download');
  await page
    .locator('.analytics-chart-shell')
    .filter({ has: customerProjection })
    .getByRole('button', { name: 'Export chart SVG', exact: true })
    .click();
  const scenarioSvgPath = await (await scenarioDownload).path();
  const scenarioSvg = await readFile(scenarioSvgPath!, 'utf8');
  expect(scenarioSvg).toContain('Closing customers (observed)');
  expect(scenarioSvg).toContain('data-projection-boundary="2025-01-01T00:00:00.000Z"');
  const baselineId = savedView.diagram.analytics!.scenarios.find(
    (scenario) => scenario.name === 'Baseline',
  )!.id;
  const apiSvgResponse = await request.post(
    `/api/v1/diagrams/${savedView.diagram.id}/analytics/export`,
    {
      data: { scope: 'scenario', id: baselineId, format: 'svg' },
    },
  );
  expect(apiSvgResponse.ok()).toBe(true);
  const apiSvg = await apiSvgResponse.json();
  expect(apiSvg.data).toContain('Closing customers (observed)');
  expect(apiSvg.data).toContain('Closing MRC (observed)');
  expect(apiSvg.data).toContain('data-projection-boundary="2025-01-01T00:00:00.000Z"');
  await capture(page, 'time-series-scenarios');
  await page.getByLabel('Saved scenario', { exact: true }).selectOption({ label: 'Current trend' });
  await page.getByLabel('Customer churn (fraction of opening base)', { exact: true }).fill('0.04');
  await expect(page.getByRole('button', { name: 'Save scenario and result' })).toBeDisabled();
  await page.getByLabel('Reviewed scenario assumptions').check();
  await page.getByRole('button', { name: 'Save scenario and result' }).click();
  await expect(page.getByRole('button', { name: 'Save scenario and result' })).toBeEnabled();
  const saved = await savedGraph(request, name);
  expect(
    saved.diagram.analytics!.scenarios.find((scenario) => scenario.name === 'Current trend')!
      .assumptions.churnRate,
  ).toBe(0.04);
  expect(
    saved.diagram.analytics!.scenarios.find((scenario) => scenario.name === 'Baseline')!.assumptions
      .churnRate,
  ).toBe(0.018);
  expect(saved.diagram.analytics!.datasets).toEqual(afterMeasurement.diagram.analytics!.datasets);
  await page.reload();
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible();
  const reloaded = await savedGraph(request, name);
  expect(reloaded.diagram.analytics).toEqual(saved.diagram.analytics);
  await page.getByRole('tab', { name: /6 · Simulate/ }).click();
  await expect(page.getByLabel('Historical customer balance', { exact: true })).toHaveValue(
    customerHistoryId,
  );
  await expect(page.getByLabel('Historical MRC balance', { exact: true })).toHaveValue(
    mrcHistoryId,
  );
});

test('import preview has real mapping and no observations are committed before confirmation', async ({
  page,
  request,
}) => {
  const name = 'Analytics imported history';
  await createAnalysis(page, name, 'import');
  await page.getByRole('button', { name: /Import your data/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Import time-series data' });
  await dialog.getByLabel('Time-series file', { exact: true }).setInputFiles({
    name: 'customer-history.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'date,customers\n2025-01-01,100\n2025-01-02,110\n2025-01-03,95\n2025-01-04,105',
    ),
  });
  await expect(dialog.getByText(/Source preview/)).toBeVisible();
  await dialog.getByLabel('Observation date / time', { exact: true }).selectOption('date');
  await dialog.getByLabel('Native time resolution', { exact: true }).selectOption('day');
  await dialog.getByLabel('Import column customers', { exact: true }).check();
  const customersColumn = dialog.locator('details').filter({
    has: page.getByRole('checkbox', { name: 'Import column customers', exact: true }),
  });
  if (!(await customersColumn.evaluate((element) => (element as HTMLDetailsElement).open)))
    await customersColumn.locator('summary').click();
  await dialog.getByRole('combobox', { name: 'Unit type', exact: true }).selectOption('count');
  await dialog.getByRole('button', { name: 'Validate import preview' }).click();
  await expect(dialog.getByLabel('Import validation report')).toContainText('4 observations');
  await expect(dialog.getByLabel('Import validation report')).toContainText(
    'No validation issues.',
  );
  expect((await savedGraph(request, name)).diagram.analytics!.datasets).toHaveLength(0);
  await capture(page, 'time-series-import');
  await dialog.getByRole('button', { name: 'Confirm and commit import' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.analytics-chart')).toBeVisible();
  const saved = await savedGraph(request, name);
  expect(saved.diagram.analytics!.datasets[0].observations.map((point) => point.value)).toEqual([
    100, 110, 95, 105,
  ]);
  await page.getByLabel('Time aggregation', { exact: true }).selectOption('month');
  await page.getByLabel('Chart type', { exact: true }).selectOption('candlestick');
  await expect(page.locator('.analytics-chart-readout')).toBeVisible();
  await expect(page.getByText(/without invented wicks/)).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export chart SVG', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
});

for (const width of [390, 768, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`analysis UI remains usable at ${width}px in ${theme}`, async ({ page, request }) => {
      await createAnalysis(page, `Responsive analytics ${width} ${theme}`);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 980 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page
        .getByLabel('Saved chart', { exact: true })
        .selectOption({ label: 'Customer churn' });
      await expect(page.locator('.analytics-chart')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await expect(
        page.getByRole('heading', {
          level: 3,
          name: 'Customer churn (customer churn)',
          exact: true,
        }),
      ).toBeVisible();
      const zoomButton = page.getByRole('button', { name: 'Zoom in', exact: true });
      await expect
        .poll(async () => (await zoomButton.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      await page.getByLabel('Chart interaction', { exact: true }).selectOption('range');
      await page.locator('.analytics-chart').scrollIntoViewIfNeeded();
      const chartSurface = page.getByRole('img', { name: /^Customer churn\./ });
      await expect(chartSurface).toBeVisible();
      await expect
        .poll(async () => (await chartSurface.boundingBox())?.width ?? 0)
        .toBeGreaterThan(100);
      const labelsFit = await chartSurface.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll('[data-axis]')].every((label) => {
          const box = label.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        });
      });
      expect(labelsFit, 'Axis labels must remain within the actual SVG at every viewport').toBe(
        true,
      );
      const bounds = (await chartSurface.boundingBox())!;
      if (width === 390) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height * 0.5, id: 1 },
          ],
        });
        for (let step = 1; step <= 8; step++)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: bounds.x + bounds.width * (0.25 + (0.4 * step) / 8),
                y: bounds.y + bounds.height * 0.5,
                id: 1,
              },
            ],
          });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5, {
          steps: 8,
        });
        await page.mouse.up();
      }
      await page.getByRole('tab', { name: /3 · Measure/ }).click();
      await page
        .getByLabel('Measurement series', { exact: true })
        .selectOption({ label: 'Customer churn · customer churn' });
      await page.getByLabel('Measurement tool', { exact: true }).selectOption('trend-line');
      await page.getByLabel('Anchor 1 value', { exact: true }).fill('0.02');
      await page.getByLabel('Anchor 2 value', { exact: true }).fill('0.03');
      if (width === 1440) {
        const anchor = page.getByRole('button', { name: /^Trend anchor 1/ });
        await expect(anchor).toBeVisible();
        const before = await page.getByLabel('Anchor 1 value', { exact: true }).inputValue();
        await anchor.focus();
        await page.keyboard.press('ArrowUp');
        await expect(page.getByLabel('Anchor 1 value', { exact: true })).not.toHaveValue(before);
        await page.getByLabel('Anchor 1 value', { exact: true }).fill('0.02');
      }
      await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
      await expect(page.getByLabel('Measurement results')).toContainText('ratio units / day');
      await page.getByRole('tab', { name: /4 · Detect/ }).click();
      await page.getByLabel('Signal family', { exact: true }).selectOption('custom');
      await page.getByLabel('Rule logic', { exact: true }).selectOption('and');
      await page.getByLabel('Rule 1 logic', { exact: true }).selectOption('not');
      await expect(page.getByLabel('Rule 1 not logic', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width === 390 && theme === 'light') {
        await page.getByRole('tab', { name: /2 · Explore/ }).click();
        await page
          .getByLabel('Saved chart', { exact: true })
          .selectOption({ label: 'Customer churn' });
        await expect(
          page.getByRole('heading', {
            level: 3,
            name: 'Customer churn (customer churn)',
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
        await capture(page, 'time-series-mobile');
      }
      await page.getByRole('tab', { name: /6 · Simulate/ }).click();
      await page.getByRole('button', { name: 'Compare saved scenarios' }).click();
      const comparison = page.getByRole('region', { name: 'Historical and scenario comparison' });
      const customerComparison = comparison.getByRole('img', {
        name: /^Customer balance: history and scenarios\./,
      });
      const mrcComparison = comparison.getByRole('img', {
        name: /^MRC balance: history and scenarios\./,
      });
      await expect(customerComparison).toBeVisible();
      await expect(mrcComparison).toBeVisible();
      await expect(comparison.locator('[data-projection-boundary]')).toHaveCount(2);
      const saved = await savedGraph(request, `Responsive analytics ${width} ${theme}`);
      await expect(
        comparison.getByLabel('Historical customer balance', { exact: true }),
      ).toHaveValue(saved.diagram.analytics!.scenarioView!.customerHistorySeriesId!);
      await expect(comparison.getByLabel('Historical MRC balance', { exact: true })).toHaveValue(
        saved.diagram.analytics!.scenarioView!.mrcHistorySeriesId!,
      );
      await customerComparison.scrollIntoViewIfNeeded();
      await customerComparison.press('ArrowRight');
      await expect(comparison.locator('.analytics-chart-readout').first()).toContainText(
        'Closing customers (observed)',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }

test('large worker analysis allows interaction and responsive cancellation without saving a late result', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await createAnalysis(page, 'Large analytics responsiveness', 'import');
  const graph = await savedGraph(request, 'Large analytics responsiveness');
  const model = blankAnalytics();
  model.series = Array.from({ length: 10 }, (_, index) => ({
    id: `series-${index}`,
    name: `Metric ${index + 1}`,
    datasetId: 'large',
    dimensions: {},
    unit: { kind: 'number' as const, label: 'units' },
    semantics: 'snapshot' as const,
    provenance: 'observed' as const,
    resolution: 'observation' as const,
    timezone: 'UTC',
    periodBoundary: 'start' as const,
    aggregation: 'last' as const,
    direction: 'neutral' as const,
    definition: 'Synthetic responsiveness fixture.',
  }));
  model.datasets = [
    {
      id: 'large',
      name: 'Synthetic large history',
      version: 1,
      source: { kind: 'example', name: '100,000 synthetic observations', illustrative: true },
      observations: Array.from({ length: 100000 }, (_, index) => ({
        id: `observation-${index}`,
        seriesId: `series-${index % 10}`,
        time: new Date(Date.UTC(2020, 0, 1) + Math.floor(index / 10) * 86400000).toISOString(),
        value: Math.sin(index / 10) * 10 + 100,
        dimensions: {},
        quality: 'valid' as const,
      })),
      transformations: [],
      importedAt: '2025-01-01T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  model.rules = Array.from({ length: 100 }, (_, index) => ({
    id: `rule-${index}`,
    version: 1,
    name: `Threshold ${index + 1}`,
    enabled: true,
    family: 'threshold' as const,
    seriesId: `series-${index % 10}`,
    severity: 'info' as const,
    parameters: { comparator: '>' as const, threshold: 200, consecutive: 1 },
  }));
  model.charts = [
    {
      id: 'large-chart',
      name: 'Large series display',
      kind: 'line',
      seriesIds: ['series-0'],
      resolution: 'observation',
      normalized: false,
    },
  ];
  const response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/analytics`, {
    data: { baseVersion: graph.diagram.version, value: model },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('tab', { name: /2 · Explore/ }).click();
  await expect(page.locator('.analytics-chart')).toBeVisible({ timeout: 60000 });
  const rendered = await page
    .locator('.analytics-chart path')
    .evaluateAll((paths) =>
      paths.reduce(
        (count, path) => count + (path.getAttribute('d')?.match(/[ML]/g)?.length ?? 0),
        0,
      ),
    );
  expect(rendered).toBeLessThan(2000);
  await page.getByRole('tab', { name: /4 · Detect/ }).click();
  const started = Date.now();
  await page.getByRole('button', { name: 'Evaluate saved rules' }).click();
  await expect(page.getByRole('button', { name: 'Cancel analysis', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'History filter', exact: true }).selectOption('active');
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  await expect(page.getByText('Analysis cancelled. Nothing was saved.')).toBeVisible();
  const cancellationMs = Date.now() - started;
  expect(cancellationMs).toBeLessThan(15000);
  await expect(page.getByRole('button', { name: 'Evaluate saved rules' })).toBeEnabled();
  const afterResponse = await request.get(`/api/v1/diagrams/${graph.diagram.id}/analytics`);
  expect(afterResponse.ok()).toBe(true);
  const after = await afterResponse.json();
  expect(after.analytics.results).toHaveLength(0);
  expect(after.analytics.signals.count).toBe(0);
  await page.evaluate(() => {
    const probe = { frames: 0, maxFrameGap: 0, last: performance.now(), active: true };
    (window as unknown as { analyticsProbe: typeof probe }).analyticsProbe = probe;
    const step = (now: number) => {
      if (!probe.active) return;
      probe.frames++;
      probe.maxFrameGap = Math.max(probe.maxFrameGap, now - probe.last);
      probe.last = now;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const completeStart = Date.now();
  await page.getByRole('button', { name: 'Evaluate saved rules' }).click();
  await expect(page.getByRole('button', { name: 'Evaluate saved rules' })).toBeEnabled({
    timeout: 120000,
  });
  const measured = await page.evaluate(() => {
    const probe = (
      window as unknown as {
        analyticsProbe: { frames: number; maxFrameGap: number; active: boolean };
      }
    ).analyticsProbe;
    probe.active = false;
    return {
      frames: probe.frames,
      maxFrameGapMs: probe.maxFrameGap,
      jsHeapBytes:
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
      userAgent: navigator.userAgent,
    };
  });
  const completeMs = Date.now() - completeStart;
  expect(measured.frames).toBeGreaterThan(5);
  const completedResponse = await request.get(`/api/v1/diagrams/${graph.diagram.id}/analytics`);
  expect(completedResponse.ok()).toBe(true);
  const completed = await completedResponse.json();
  const resultId = completed.analytics.results.at(-1)?.id;
  expect(resultId).toBeTruthy();
  const contentResponse = await request.get(
    `/api/v1/diagrams/${graph.diagram.id}/analytics/results/${resultId}/content`,
  );
  expect(contentResponse.ok()).toBe(true);
  const result = await contentResponse.json();
  expect(result.kind).toBe('signals');
  expect(result.summary.evaluated).toBe(1000000);
  expect(result.summary.totalEvents).toBe(0);
  await mkdir(resolve('../tmp'), { recursive: true });
  await writeFile(
    resolve('../tmp/analytics-browser-benchmark.json'),
    JSON.stringify(
      {
        observations: 100000,
        series: 10,
        rules: 100,
        renderedPoints: rendered,
        completeMs,
        cancellationMs,
        ...measured,
      },
      null,
      2,
    ),
  );
  // Full save preparation is part of usability, not just time spent in the numerical worker.
  expect(measured.maxFrameGapMs).toBeLessThan(1000);
});

test('reviewed analysis-to-process mapping uses local semantic selectors and leaves the process untouched', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await dialog.getByRole('button', { name: /Kiosk \+ package pickup/ }).click();
  await dialog.getByLabel('New diagram name').fill('Process target for analysis');
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  const original = await savedGraph(request, 'Process target for analysis');
  await createAnalysis(page, 'Reviewed cross-document source');
  await page.getByRole('tab', { name: /6 · Simulate/ }).click();
  await page.getByLabel('Scenario name', { exact: true }).fill('Linked growth assumptions');
  await page.getByText('Link to a Process Simulator scenario', { exact: true }).click();
  await page
    .getByLabel('Linked process diagram', { exact: true })
    .selectOption({ label: 'Process target for analysis' });
  const source = page.getByLabel('Process link source series', { exact: true });
  await source.selectOption(
    (await source
      .locator('option')
      .filter({ hasText: /^New customers ·/ })
      .getAttribute('value')) ?? '',
  );
  await page
    .getByLabel('Process link node', { exact: true })
    .selectOption({ label: 'Store customers · source' });
  await page
    .getByLabel('Process link target scenario', { exact: true })
    .selectOption({ label: 'Baseline' });
  await page.getByLabel('Process link parameter', { exact: true }).selectOption('source.maxCount');
  await page.getByLabel('Reviewed process link', { exact: true }).check();
  await page.getByLabel('Reviewed scenario assumptions', { exact: true }).check();
  await page.getByRole('button', { name: 'Save scenario and result', exact: true }).click();
  await expect(page.getByText('Saved in your encrypted workspace.', { exact: true })).toBeVisible();
  const sourceGraph = await savedGraph(request, 'Reviewed cross-document source');
  expect(
    sourceGraph.diagram.analytics!.scenarios.find(
      (item) => item.name === 'Linked growth assumptions',
    )?.processLink,
  ).toMatchObject({ diagramId: original.diagram.id, parameter: 'source.maxCount', reviewed: true });
  const untouched = await savedGraph(request, 'Process target for analysis');
  expect(untouched.diagram.version).toBe(original.diagram.version);
  expect(untouched.simulation).toEqual(original.simulation);
});

test('API edits refresh clean forms and cannot overwrite preserved dirty UI assumptions', async ({
  page,
  request,
}) => {
  await createAnalysis(page, 'Concurrent analytics definition');
  await page.getByRole('tab', { name: /6 · Simulate/ }).click();
  await page.getByLabel('Saved scenario', { exact: true }).selectOption({ label: 'Baseline' });
  let graph = await savedGraph(request, 'Concurrent analytics definition');
  let value = structuredClone(graph.diagram.analytics!);
  const id = value.scenarios.find((item) => item.name === 'Baseline')!.id;
  value.scenarios.find((item) => item.id === id)!.assumptions.churnRate = 0.025;
  expect(
    (
      await request.put(`/api/v1/diagrams/${graph.diagram.id}/analytics`, {
        data: { baseVersion: graph.diagram.version, value },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByLabel('Customer churn (fraction of opening base)', { exact: true }),
  ).toHaveValue('0.025');
  await page.getByLabel('Scenario name', { exact: true }).fill('Unsaved local scenario title');
  graph = await savedGraph(request, 'Concurrent analytics definition');
  value = structuredClone(graph.diagram.analytics!);
  const remote = value.scenarios.find((item) => item.id === id)!;
  remote.name = 'API-edited baseline';
  remote.assumptions.churnRate = 0.04;
  expect(
    (
      await request.put(`/api/v1/diagrams/${graph.diagram.id}/analytics`, {
        data: { baseVersion: graph.diagram.version, value },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.getByText(/Your unsaved edits are preserved/)).toBeVisible();
  await expect(page.getByLabel('Scenario name', { exact: true })).toHaveValue(
    'Unsaved local scenario title',
  );
  await expect(
    page.getByRole('button', { name: 'Save scenario and result', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Reload saved scenario', exact: true }).click();
  await expect(page.getByLabel('Scenario name', { exact: true })).toHaveValue(
    'API-edited baseline',
  );
  await expect(
    page.getByLabel('Customer churn (fraction of opening base)', { exact: true }),
  ).toHaveValue('0.04');
  await expect(
    page.getByRole('button', { name: 'Save scenario and result', exact: true }),
  ).toBeEnabled();
});
