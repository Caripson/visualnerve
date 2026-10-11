import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type {
  AnalyticsExtension,
  BacktestResult,
  MeasurementResult,
  ScenarioResult,
  SignalResult,
} from '../../src/analytics/types';

async function rpc(request: APIRequestContext, method: string, params: unknown) {
  const response = await request.post('/mcp', {
    data: { jsonrpc: '2.0', id: crypto.randomUUID(), method, params },
  });
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}
async function mcp<T = unknown>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
  operationId?: string,
): Promise<T> {
  const result = await rpc(request, 'tools/call', {
    name: 'visual_nerve_request',
    arguments: {
      path,
      method,
      ...(data === undefined ? {} : { data }),
      ...(operationId ? { operationId } : {}),
    },
  });
  expect(result.structuredContent.status, JSON.stringify(result.structuredContent.body)).toBe(
    status,
  );
  expect(Boolean(result.isError)).toBe(status >= 400);
  return result.structuredContent.body;
}
async function rest<T = unknown>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function exportedResult<T>(page: Page, name: string): Promise<T> {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const download = await waiting;
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8')).result;
}
const input = {
  datasetId: 'history',
  source: {
    kind: 'csv',
    name: 'Illustrative example data.csv',
    text: 'date,churn\n2025-01-01,0.01\n2025-02-01,0.02\n2025-03-01,0.021\n2025-04-01,0.025\n2025-05-01,0.027\n2025-06-01,0.019\n2025-07-01,0.02\n2025-08-01,0.03\n2025-09-01,0.031\n2025-10-01,0.035\n2025-11-01,0.038\n2025-12-01,0.019',
  },
  mapping: {
    format: 'wide',
    timeColumn: 'date',
    valueColumns: [
      {
        column: 'churn',
        seriesId: 'churn',
        name: 'Customer churn',
        unit: { kind: 'ratio', label: '%' },
        semantics: 'rate',
        aggregation: 'none',
        direction: 'lower-is-better',
        riskPopulation: 'opening-customers',
      },
    ],
    dimensions: [],
    decimal: '.',
    percent: 'ratio',
    dateFormat: 'iso',
    timezone: 'UTC',
    resolution: 'month',
    duplicatePolicy: 'reject',
    invalidRows: 'reject',
    missingValues: 'preserve',
  },
};
async function setup(request: APIRequestContext) {
  const diagram = await mcp<{ id: string; version: number }>(
    request,
    '/diagrams',
    'POST',
    { name: 'Illustrative REST MCP UI analysis', template: 'time-series-analysis', mode: 'import' },
    201,
  );
  const base = `/diagrams/${diagram.id}/analytics`;
  const current = () => mcp<{ baseVersion: number; analytics: AnalyticsExtension }>(request, base);
  const mutate = async (path: string, value: unknown, method = 'POST') =>
    mcp<{ baseVersion: number }>(
      request,
      `${base}${path}`,
      method,
      { baseVersion: (await current()).baseVersion, value },
      method === 'POST' ? 201 : 200,
    );
  const inspection = await mcp<{ rows: number; columns: string[] }>(
    request,
    `${base}/import/inspect`,
    'POST',
    { source: input.source },
  );
  expect(inspection).toMatchObject({ rows: 12, columns: ['date', 'churn'] });
  const preview = await mcp<{ valid: boolean }>(request, `${base}/import/preview`, 'POST', input);
  expect(preview.valid).toBe(true);
  await mcp(request, `${base}/import/commit`, 'POST', {
    baseVersion: (await current()).baseVersion,
    input,
    mode: 'create',
    confirmed: true,
  });
  await mutate('/charts', {
    id: 'chart',
    name: 'Customer churn',
    kind: 'line',
    seriesIds: ['churn'],
    resolution: 'observation',
    normalized: false,
  });
  await mutate('/measurements', {
    id: 'change',
    name: 'February to August',
    kind: 'point-to-point',
    seriesIds: ['churn'],
    from: '2025-02-01T00:00:00.000Z',
    to: '2025-08-01T00:00:00.000Z',
  });
  await mutate('/rules', {
    id: 'retention',
    name: 'Retention pressure',
    version: 1,
    enabled: true,
    family: 'sustained',
    seriesId: 'churn',
    severity: 'warning',
    parameters: { threshold: 0.02, comparator: '>', consecutive: 3 },
  });
  await mutate('/backtests', {
    id: 'lab',
    name: 'Chronological history',
    ruleIds: ['retention'],
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-01T00:00:00.000Z',
    trainEnd: '2025-04-01T00:00:00.000Z',
    validationEnd: '2025-08-01T00:00:00.000Z',
    holdoutStart: '2025-09-01T00:00:00.000Z',
    walkForwardPeriods: 1,
    trials: 1,
  });
  for (const [id, name, churnRate] of [
    ['baseline', 'Baseline', 0.02],
    ['stress', 'Stress scenario', 0.04],
  ] as const)
    await mutate('/scenarios', {
      id,
      name,
      version: 1,
      model: 'growth-churn',
      start: '2026-01-01T00:00:00.000Z',
      periods: 2,
      resolution: 'month',
      reviewed: true,
      assumptions: {
        openingCustomers: 1000,
        newCustomers: 30,
        reactivatedCustomers: 0,
        churnRate,
        newCustomerGrowth: 0,
        openingMrc: 100000,
        newMrc: 5000,
        expansionMrc: 1000,
        contractionMrc: 2000,
        churnedMrc: 3000,
        currency: 'SEK',
      },
    });
  return { diagram, base, current, mutate };
}
async function grant(page: Page, value: 'off' | 'read' | 'write') {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

test('AT24,35: real browser UI, REST and MCP calculate identical measurements, signals, historical validation and scenarios', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const health = await rest<{ capabilities: string[] }>(request, '/health');
  expect(health.capabilities).toContain('analytics-v1');
  const tools = await rpc(request, 'tools/list', {});
  expect(tools.tools.map((tool: { name: string }) => tool.name)).toEqual([
    'visual_nerve_request',
    'visual_nerve_api_docs',
  ]);
  const guide = await rpc(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: { document: 'guide' },
  });
  expect(guide.content[0].text).toContain('Time Series & Signal Analysis');
  const scoped = await rpc(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: {
      document: 'endpoint',
      path: '/diagrams/{diagramId}/analytics/import/commit',
      method: 'POST',
    },
  });
  expect(scoped.content[0].text).toContain('AnalyticsImportCommit');
  const f = await setup(request);
  await page
    .getByRole('button', { name: 'Illustrative REST MCP UI analysis', exact: true })
    .click();
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible();
  const discovered = await mcp<
    { id: string; analytics?: unknown; analyticsSummary: { schemaVersion: number } }[]
  >(request, '/diagrams?analytics=true');
  expect(discovered.find((diagram) => diagram.id === f.diagram.id)).toMatchObject({
    analyticsSummary: { schemaVersion: 1 },
  });
  expect(discovered[0].analytics).toBeUndefined();
  const canonical = await rest<{ analytics: AnalyticsExtension }>(request, `${f.base}?full=true`);
  expect(canonical.analytics.datasets[0].observations).toHaveLength(12);
  const measurement = await mcp<MeasurementResult>(request, `${f.base}/measure`, 'POST', {
    id: 'change',
  });
  expect(await rest(request, `${f.base}/measure`, 'POST', { id: 'change' })).toEqual(measurement);
  expect(measurement.metrics.percentagePoints.value).toBeCloseTo(1, 12);
  expect(measurement.metrics.relativeChange.value).toBeCloseTo(0.5, 12);
  const signals = await mcp<SignalResult>(request, `${f.base}/evaluate`, 'POST', {});
  expect(await rest(request, `${f.base}/evaluate`, 'POST', {})).toEqual(signals);
  expect(signals.signals[0]).toMatchObject({
    state: 'onset',
    observationTime: '2025-05-01T00:00:00.000Z',
  });
  const historical = await mcp<BacktestResult>(request, `${f.base}/validate`, 'POST', {
    id: 'lab',
  });
  expect(await rest(request, `${f.base}/validate`, 'POST', { id: 'lab' })).toEqual(historical);
  expect(
    historical.results.every(
      (result) => result.precision === undefined && result.recall === undefined,
    ),
  ).toBe(true);
  const projected = await mcp<ScenarioResult>(request, `${f.base}/project`, 'POST', {
    id: 'baseline',
  });
  expect(await rest(request, `${f.base}/project`, 'POST', { id: 'baseline' })).toEqual(projected);
  expect(projected.points[0]).toMatchObject({ closingCustomers: 1010, closingMrc: 101000 });
  const compared = await mcp<{ results: ScenarioResult[] }>(request, `${f.base}/compare`, 'POST', {
    scenarioIds: ['baseline', 'stress'],
  });
  expect(compared.results.map((result) => result.points[0].closingCustomers)).toEqual([1010, 990]);

  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await page.getByLabel('Saved measurement', { exact: true }).selectOption('change');
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(page.getByLabel('Measurement results')).toContainText('pp');
  expect(await exportedResult<MeasurementResult>(page, 'Export measurement JSON')).toEqual(
    measurement,
  );
  await page.getByRole('tab', { name: /4 · Detect/ }).click();
  await page.getByRole('button', { name: 'Evaluate saved rules', exact: true }).click();
  await expect(page.locator('.analytics-signal-item').first()).toBeVisible();
  const savedHistory = await mcp<{ items: SignalResult['signals'] }>(
    request,
    `${f.base}/signals?offset=0&limit=100`,
  );
  expect(savedHistory.items).toEqual(signals.signals);
  await page.getByRole('tab', { name: /5 · Validate/ }).click();
  await page.getByLabel('Saved validation', { exact: true }).selectOption('lab');
  await page.getByRole('button', { name: 'Run historical validation', exact: true }).click();
  await expect(page.getByText('Historical validation results', { exact: true })).toBeVisible();
  expect(await exportedResult<BacktestResult>(page, 'Export validation JSON')).toEqual(historical);
  await page.getByRole('tab', { name: /6 · Simulate/ }).click();
  await page.getByLabel('Saved scenario', { exact: true }).selectOption('baseline');
  await page.getByRole('button', { name: 'Preview scenario', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export scenario JSON', exact: true }),
  ).toBeVisible();
  expect(await exportedResult<ScenarioResult>(page, 'Export scenario JSON')).toEqual(projected);
});

test('AT26–29: real MCP preview permissions, stale versions, recoverable writes and originating grant retention', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const f = await setup(request);
  const saved = await f.current();
  const stalePayload = { baseVersion: 1, value: { name: 'Must reject stale' } };
  const staleRest = await rest<{ code: string }>(
    request,
    `${f.base}/measurements/change`,
    'PATCH',
    stalePayload,
    409,
  );
  expect(await mcp(request, `${f.base}/measurements/change`, 'PATCH', stalePayload, 409)).toEqual(
    staleRest,
  );
  expect(staleRest.code).toBe('VERSION_CONFLICT');
  const reservation = await mcp<{ operationId: string }>(request, '/operations', 'POST', {}, 201);
  const payload = {
    baseVersion: saved.baseVersion,
    value: {
      id: 'new-measure',
      name: 'Recoverable measure',
      kind: 'range-statistics',
      seriesIds: ['churn'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-12-01T00:00:00.000Z',
    },
  };
  const written = await mcp(
    request,
    `${f.base}/measurements`,
    'POST',
    payload,
    201,
    reservation.operationId,
  );
  const retry = await request.post(`/api/v1${f.base}/measurements`, {
    data: payload,
    headers: { 'X-Visual-Nerve-Operation-Id': reservation.operationId },
  });
  expect(retry.status()).toBe(201);
  expect(await retry.json()).toEqual(written);
  expect(
    (await f.current()).analytics.measurements.filter((entry) => entry.id === 'new-measure'),
  ).toHaveLength(1);
  const job = await mcp<{ jobId: string }>(
    request,
    `${f.base}/jobs`,
    'POST',
    { kind: 'signals', input: {} },
    201,
  );
  await expect
    .poll(async () => (await mcp<{ state: string }>(request, `${f.base}/jobs/${job.jobId}`)).state)
    .toBe('succeeded');
  const result = await mcp<{ summary: unknown; items: unknown[] }>(
    request,
    `${f.base}/jobs/${job.jobId}/result?offset=0&limit=2`,
  );
  expect(result.items).toHaveLength(2);
  await mcp(request, `${f.base}/jobs/${job.jobId}/archive`, 'POST', {
    baseVersion: (await f.current()).baseVersion,
  });
  const archives = await mcp<{ items: { id: string }[] }>(request, `${f.base}/results`);
  const archive = archives.items.at(-1)!;
  expect(
    await mcp(request, `${f.base}/results/${archive.id}/input?datasetId=history&limit=1`),
  ).toMatchObject({ total: 12, items: [{ value: 0.01 }] });
  await grant(page, 'read');
  expect(await mcp(request, `${f.base}/measure`, 'POST', { id: 'change' })).toEqual(
    await rest(request, `${f.base}/measure`, 'POST', { id: 'change' }),
  );
  await mcp(
    request,
    `${f.base}/rules`,
    'POST',
    { baseVersion: (await f.current()).baseVersion, value: {} },
    403,
  );
  await mcp(
    request,
    `${f.base}/import/commit`,
    'POST',
    { baseVersion: (await f.current()).baseVersion, input, mode: 'replace', confirmed: true },
    403,
  );
  const readPage = await mcp<{ total: number; items: { value: number }[] }>(
    request,
    `${f.base}/query?offset=1&limit=1`,
    'POST',
    { seriesId: 'churn' },
  );
  expect(readPage).toMatchObject({ total: 12, items: [{ value: 0.02 }] });
  expect(
    await rest(request, `${f.base}/query?offset=1&limit=1`, 'POST', { seriesId: 'churn' }),
  ).toEqual(readPage);
  const svg = await mcp<{ data: string; renderedPoints: number }>(
    request,
    `${f.base}/export`,
    'POST',
    {
      scope: 'chart',
      id: 'chart',
      format: 'svg',
      options: { width: 900, height: 410, appearance: 'dark' },
    },
  );
  expect(svg.renderedPoints).toBe(12);
  expect(svg.data).toContain('Customer churn');
  expect(
    await rest(request, `${f.base}/export`, 'POST', {
      scope: 'chart',
      id: 'chart',
      format: 'svg',
      options: { width: 900, height: 410, appearance: 'dark' },
    }),
  ).toEqual(svg);
  await mcp(request, `${f.base}/query/commit`, 'POST', {}, 403);
  const transient = await mcp<{ jobId: string }>(
    request,
    `${f.base}/jobs`,
    'POST',
    { kind: 'query', input: { seriesId: 'churn' } },
    201,
  );
  await expect
    .poll(
      async () =>
        (await mcp<{ state: string }>(request, `${f.base}/jobs/${transient.jobId}`)).state,
    )
    .toBe('succeeded');
  expect(await mcp(request, `${f.base}/jobs/${transient.jobId}`, 'DELETE')).toMatchObject({
    state: 'cancelled',
  });
  await mcp(request, `${f.base}/jobs/${transient.jobId}`, 'GET', undefined, 404);
  const revoked = await mcp<{ jobId: string }>(
    request,
    `${f.base}/jobs`,
    'POST',
    { kind: 'signals', input: {} },
    201,
  );
  await grant(page, 'write');
  await mcp(request, `${f.base}/jobs/${revoked.jobId}`, 'GET', undefined, 404);
  expect((await f.current()).analytics.results).toHaveLength(1);
});

test('AT24,35: documented REST and MCP scripts execute the complete synthetic workflow against the real browser', async ({
  request,
}) => {
  test.setTimeout(180000);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VISUAL_NERVE_BRIDGE_ORIGIN: 'http://127.0.0.1:4327',
    VISUAL_NERVE_BRIDGE_TOKEN: '',
    VISUAL_NERVE_WORKSPACE_ID: '',
  };
  delete childEnv.FORCE_COLOR;
  for (const args of [[], ['--mcp']]) {
    const result = await promisify(execFile)(
      process.execPath,
      [resolve(process.cwd(), '../scripts/examples/analytics.mjs'), ...args],
      {
        timeout: 80000,
        env: childEnv,
      },
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('1010');
    expect(result.stdout).toContain('990');
  }
  const diagrams = await mcp<unknown[]>(request, '/diagrams?analytics=true');
  expect(diagrams).toHaveLength(2);
});
