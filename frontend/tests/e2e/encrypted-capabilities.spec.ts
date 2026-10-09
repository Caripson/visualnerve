import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';
import { browserLaunchOptions } from '../../playwright.config';
import {
  installEncryptedStartupDiagnostics,
  readEncryptedStartupDiagnostics,
} from './encrypted-startup-diagnostics';
import type { CsvNodeData } from '../../src/data/types';
import type { Graph } from '../../src/model/types';
import type { SimulationResult } from '../../src/simulation/types';

const app = 'https://public-app.test:4341';
const password = 'Isolated capabilities test protected passphrase';

// Playwright's browser launch is a worker fixture, so graphics options belong at file scope.
test.use({
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

async function setup(page: Page) {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, '__encryptedAcceptanceCsp', { value: violations });
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`),
    );
  });
  const response = await page.goto(app);
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).toContain("worker-src 'self' blob:");
  expect(policy).toContain('wss://127.0.0.1:4329/bridge');
  expect(policy).not.toContain("'unsafe-eval'");
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.getByLabel('Recovery key — keep it private')).toHaveValue(/^VNREC1-/);
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
}

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function grant(page: Page, request: APIRequestContext) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByText('Local connection details', { exact: true }).click();
  await page
    .getByLabel('Local bridge address', { exact: true })
    .fill('wss://127.0.0.1:4329/bridge');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await expect
    .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
    .toBe(1);
  await expect.poll(async () => (await request.get('/api/v1/diagrams')).status()).toBe(200);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

async function unlock(page: Page, title: string) {
  await test.step('Authenticate the saved encrypted workspace', async () => {
    const dialog = page.getByRole('dialog', { name: 'Unlock your workspace', exact: true });
    await expect(dialog).toBeVisible();
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
  await test.step('Reconstruct the saved diagram and acknowledge persistence', async () => {
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await saved(page);
  });
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

async function cleanCsp(page: Page) {
  expect(await page.evaluate(() => Reflect.get(window, '__encryptedAcceptanceCsp'))).toEqual([]);
}

test('isolated CSP permits real CSV grouping and encrypted source persistence, including an offline locked reload', async ({
  page,
  context,
  playwright,
}) => {
  test.setTimeout(150000);
  const request = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    // Only the synthetic, locally generated E2E certificate is untrusted.
    ignoreHTTPSErrors: true,
  });
  const workers: string[] = [];
  const errors: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const startup: unknown[] = [];
  try {
    await page.addInitScript(installEncryptedStartupDiagnostics);
    await setup(page);
    await grant(page, request);
    const name = 'Encrypted CSV customer ledger';
    const rows = ['Company,Customer,Amount,Country'];
    for (let index = 0; index < 1000; index++)
      rows.push(
        `${index % 2 ? 'Beta' : 'Alpha'},Private customer ${index},${index % 2 ? '"2,50"' : '1.5'},Sweden`,
      );
    await page.getByLabel('Import file', { exact: true }).setInputFiles({
      name: 'protected-customer-ledger.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(rows.join('\n')),
    });
    const importing = page.getByRole('dialog', { name: 'Import CSV data', exact: true });
    await expect(importing).toContainText('1,000 rows');
    await importing.getByLabel('CSV diagram name').fill(name);
    await importing
      .getByLabel('Grouping level 1', { exact: true })
      .selectOption({ label: 'Company' });
    await importing.getByRole('button', { name: 'Add measure', exact: true }).click();
    await importing.getByLabel('Measure 2', { exact: true }).selectOption('sum');
    await importing
      .getByLabel('Measure column 2', { exact: true })
      .selectOption({ label: 'Amount' });
    await expect(importing.getByRole('button', { name: 'Create data diagram' })).toBeEnabled();
    await importing.getByRole('button', { name: 'Create data diagram' }).click();
    await expect(importing).toBeHidden();
    await saved(page);
    const diagrams = await get<{ id: string; name: string }[]>(request, '/diagrams');
    const diagram = diagrams.find((entry) => entry.name === name)!;
    expect(diagram).toBeDefined();
    const graph = await get<Graph>(request, `/diagrams/${diagram.id}`);
    const root = graph.nodes.find((node) => !node.parentId && node.metadata.csv)!;
    const data = root.metadata.csv as CsvNodeData;
    expect(data.rowCount).toBe(1000);
    expect(data.totalChildren).toBe(2);
    expect(data.measures.find((measure) => measure.operation === 'sum')?.value).toBe(2000);
    expect(
      graph.nodes
        .filter((node) => node.parentId === root.id)
        .map((node) => node.title)
        .sort(),
    ).toEqual(['Alpha', 'Beta']);
    const backup = await get<{ datasets: { rows: string[][] }[] }>(request, '/workspace/export');
    expect(backup.datasets).toHaveLength(1);
    expect(backup.datasets[0].rows).toHaveLength(1000);
    expect(backup.datasets[0].rows[0][1]).toBe('Private customer 0');
    expect(workers.some((url) => /\/editor\/assets\/worker-/.test(url))).toBe(true);
    await cleanCsp(page);

    // Initial installation precaches the complete app. An activated registration
    // alone can precede clients.claim(); do not reload into that uncontrolled gap.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const controller = navigator.serviceWorker.controller;
            return {
              installing: registration?.installing?.state ?? null,
              waiting: registration?.waiting?.state ?? null,
              active: registration?.active?.state ?? null,
              controller: controller?.state ?? null,
              controlledByActive: !!controller && controller === registration?.active,
            };
          }),
        {
          timeout: 30000,
          message: 'The complete offline app must activate and claim this page before reload.',
        },
      )
      .toMatchObject({ active: 'activated', controller: 'activated', controlledByActive: true });
    startup.push(await readEncryptedStartupDiagnostics(page, 'before-first-online-reload'));
    await page.reload();
    await unlock(page, name);
    startup.push(await readEncryptedStartupDiagnostics(page, 'after-first-online-unlock'));
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await unlock(page, name);
    startup.push(await readEncryptedStartupDiagnostics(page, 'after-offline-unlock'));
    await expect(page.locator(`.canvas-shell [data-node-id="${root.id}"]`)).toContainText('1,000');
    await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(3);
    await cleanCsp(page);
    expect(errors).toEqual([]);
    await test.info().attach('encrypted-startup-native-timings.json', {
      body: JSON.stringify({ segments: startup, pageErrors: errors }, null, 2),
      contentType: 'application/json',
    });
  } catch (error) {
    startup.push(await readEncryptedStartupDiagnostics(page, 'failure'));
    await test.info().attach('encrypted-startup-native-timings.json', {
      body: JSON.stringify({ segments: startup, pageErrors: errors }, null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await context.setOffline(false);
    await request.dispose();
  }
});

test('isolated kiosk MAX uses the actual worker and restores the same encrypted result after reload', async ({
  page,
  playwright,
}) => {
  const request = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    ignoreHTTPSErrors: true,
  });
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  try {
    await setup(page);
    await grant(page, request);
    const name = 'Encrypted kiosk capacity';
    await page
      .getByRole('button', { name: /^New diagram/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Kiosk \+ package pickup/ }).click();
    await page.getByLabel('New diagram name').fill(name);
    await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await saved(page);
    await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
    await page.getByLabel('Simulation duration hours', { exact: true }).fill('24');
    await page.getByLabel('Simulation random seed', { exact: true }).fill('12345');
    await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
    await expect(page.locator('.simulation-run-status')).toHaveText('completed', {
      timeout: 30000,
    });
    const diagrams = await get<{ id: string; name: string }[]>(request, '/diagrams');
    const diagram = diagrams.find((entry) => entry.name === name)!;
    const path = `/diagrams/${diagram.id}/simulation/runs`;
    const runs = await get<{ id: string; status: string }[]>(request, path);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    const result = await get<SimulationResult>(request, `${path}/${runs[0].id}/result`);
    expect(result.durationSeconds).toBe(86400);
    expect(result.seed).toBe(12345);
    expect(result.metrics.completed).toBeGreaterThan(290);
    expect(result.metrics.resourceCost).toBeGreaterThan(0);
    expect(result.metrics.contribution).toBeCloseTo(
      result.metrics.realizedRevenue - result.metrics.cost,
      6,
    );
    expect(result.particleTypes['core-customer'].completed).toBeGreaterThan(280);
    expect(result.particleTypes['package-customer'].completed).toBeGreaterThan(0);
    expect(result.resources['store-staff'].utilization).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === 'SIMULATION_COMPLETED')).toBe(true);
    expect(workers.some((url) => /\/editor\/assets\/worker-/.test(url))).toBe(true);
    await cleanCsp(page);
    await page.reload();
    await unlock(page, name);
    await grant(page, request);
    const reopened = await get<SimulationResult>(request, `${path}/${runs[0].id}/result`);
    expect(reopened.metrics).toEqual(result.metrics);
    expect(reopened.events).toEqual(result.events);
    expect(reopened.finalCapacities).toEqual(result.finalCapacities);
    await page.getByText(/Replay and compare runs/).click();
    await expect(page.getByRole('checkbox', { name: /^Compare run / })).toHaveCount(1);
    await cleanCsp(page);
  } finally {
    await request.dispose();
  }
});

test.describe('isolated graphics under the deployed CSP', () => {
  test.use({
    actionTimeout: 45000,
  });
  test('styled relief remains readable in 2D, exports real PNG/PDF/SVG, and lock blocks private output', async ({
    page,
    playwright,
  }, info) => {
    test.setTimeout(180000);
    const request = await playwright.request.newContext({
      baseURL: 'https://127.0.0.1:4329',
      ignoreHTTPSErrors: true,
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await setup(page);
      await grant(page, request);
      const name = 'Private styled delivery diagram';
      const created = await request.post('/api/v1/diagrams', {
        data: { name, type: 'mindmap' },
      });
      expect(created.status()).toBe(201);
      const diagram = await created.json();
      const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          nodes: [
            {
              externalId: 'plan',
              title: 'Private delivery plan',
              description: 'Confirm the responsible owner before delivery.',
              x: 0,
              y: 0,
              color: '#267044',
              status: 'done',
              metadata: { visualNerve: { icon: 'work' } },
            },
            { externalId: 'ship', title: 'Private shipment', x: 380, y: 90, color: '#a24e38' },
          ],
          edges: [
            { sourceExternalId: 'plan', targetExternalId: 'ship', label: 'Approved delivery' },
          ],
        },
      });
      expect(populated.ok(), await populated.text()).toBe(true);
      const graph = (await populated.json()) as Graph;
      await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
      await saved(page);
      const plan = graph.nodes.find((node) => node.externalId === 'plan')!;
      await expect(page.locator(`.canvas-shell [data-node-id="${plan.id}"]`)).toContainText('Done');
      await expect(
        page.locator(`.canvas-shell [data-node-id="${plan.id}"] svg.lucide-briefcase-business`),
      ).toHaveCount(1);
      await page.getByRole('button', { name: '3D view', exact: true }).click();
      await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
        timeout: 30000,
      });
      await expect(page.getByTestId('spatial-canvas')).toHaveAttribute('data-node-faces', 'relief');
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await page.getByTestId('spatial-canvas').getAttribute('data-face-projections')) ??
                '[]',
            ).length,
        )
        .toBe(2);
      await page.getByRole('button', { name: '2D view', exact: true }).click();
      await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
      await saved(page);
      const after = await get<Graph>(request, `/diagrams/${diagram.id}`);
      expect(
        after.nodes.map(({ id, color, title, status, x, y }) => ({
          id,
          color,
          title,
          status,
          x,
          y,
        })),
      ).toEqual(
        graph.nodes.map(({ id, color, title, status, x, y }) => ({
          id,
          color,
          title,
          status,
          x,
          y,
        })),
      );
      let downloads = 0;
      page.on('download', () => downloads++);
      for (const format of ['png', 'pdf', 'svg'] as const) {
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        const exporting = page.getByRole('dialog', { name: 'Export diagram', exact: true });
        await exporting.getByLabel('Export format').selectOption(format);
        await exporting.getByLabel('Export area', { exact: true }).selectOption('complete');
        if (format !== 'svg') await exporting.getByLabel('Export resolution').selectOption('1');
        const pending = page.waitForEvent('download', { timeout: 45000 });
        await exporting.getByRole('button', { name: 'Export', exact: true }).click();
        const download = await pending;
        const content = await readFile((await download.path())!);
        expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
        if (format === 'png') {
          expect(content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          expect(content.readUInt32BE(16)).toBeGreaterThan(300);
          expect(content.readUInt32BE(20)).toBeGreaterThan(100);
          const dark = await page.evaluate(async (base64) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            let dark = 0;
            for (let index = 0; index < pixels.length; index += 4)
              if (pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180) dark++;
            return dark;
          }, content.toString('base64'));
          expect(dark).toBeGreaterThan(100);
        } else if (format === 'pdf') expect(content.subarray(0, 4).toString()).toBe('%PDF');
        else {
          const vector = await page.evaluate((source) => {
            const document = new DOMParser().parseFromString(source, 'image/svg+xml');
            return {
              invalid: !!document.querySelector('parsererror'),
              text: Array.from(document.querySelectorAll('text'))
                .map((node) => node.textContent)
                .join(''),
              nodeCount: new Set(
                Array.from(document.querySelectorAll('[data-node-id]')).map((node) =>
                  node.getAttribute('data-node-id'),
                ),
              ).size,
            };
          }, content.toString());
          expect(vector.invalid).toBe(false);
          expect(vector.text).toContain('Private delivery plan');
          expect(vector.nodeCount).toBe(2);
        }
        await info.attach(`isolated-export.${format}`, {
          body: content,
          contentType:
            format === 'png' ? 'image/png' : format === 'pdf' ? 'application/pdf' : 'image/svg+xml',
        });
      }
      expect(downloads).toBe(3);
      await cleanCsp(page);
      const locked = await request.post('/api/v1/workspace/lock', { data: {} });
      expect(locked.status(), await locked.text()).toBe(200);
      await expect(
        page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
      const denied = await request.post('/api/v1/export', {
        data: { diagramId: diagram.id, format: 'svg' },
      });
      expect(denied.status()).toBe(423);
      const denial = await denied.json();
      expect(denial.code).toBe('WORKSPACE_LOCKED');
      expect(JSON.stringify(denial)).not.toContain('Private delivery plan');
      expect(downloads).toBe(3);
      expect(errors).toEqual([]);
    } finally {
      await request.dispose();
    }
  });
});

test('isolated CSP runs real local Piper WASM for English and Swedish in a module worker', async ({
  page,
}) => {
  const runtime = readdirSync(new URL('../../../hugo/static/editor/assets/', import.meta.url)).find(
    (name) => /^piper_phonemize-[\w-]+\.js$/.test(name),
  );
  expect(runtime).toBeTruthy();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await setup(page);
  const phonemes = await page.evaluate(async (file) => {
    const origin = location.origin;
    const source = `
      self.process = { versions: { node: 'fake-host-version' } };
      (async () => {
        const { default: createPhonemizer } = await import(${JSON.stringify(`${origin}/editor/assets/${file}`)});
        const [wasm, data] = await Promise.all(['wasm', 'data'].map(async extension => {
          const response = await fetch(${JSON.stringify(origin)} + '/editor/speech/piper_phonemize.' + extension);
          if (!response.ok) throw new Error('Missing local Piper ' + extension);
          return response.arrayBuffer();
        }));
        const result = [];
        for (const [language, text] of [['en-gb-x-rp', 'Understand how the project fits together.'], ['sv', 'Förstå hur projektets delar hänger ihop.']]) {
          let output;
          const module = await createPhonemizer({
            thisProgram: 'visualnerve-speech', wasmBinary: new Uint8Array(wasm),
            getPreloadedPackage: () => data, noInitialRun: true, noExitRuntime: true,
            print: line => { output = JSON.parse(line).phoneme_ids; }, printErr: () => {},
            locateFile: name => ${JSON.stringify(origin)} + '/editor/speech/' + (name.endsWith('.data') ? 'piper_phonemize.data' : 'piper_phonemize.wasm'),
          });
          const exit = module.callMain(['-l', language, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
          if (exit || !Array.isArray(output)) throw new Error('Phonemization failed: ' + language);
          result.push(output);
        }
        self.postMessage({ result });
      })().catch(error => self.postMessage({ error: error instanceof Error ? error.message : String(error) }));
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<number[][]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Isolated Piper worker stalled')), 30000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          if (data?.error) reject(new Error(data.error));
          else resolve(data.result);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Piper failed under the isolated app CSP.'));
        };
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, runtime!);
  expect(phonemes).toHaveLength(2);
  for (const result of phonemes) {
    expect(result.length).toBeGreaterThan(20);
    expect(result.every(Number.isInteger)).toBe(true);
  }
  expect(phonemes[0]).not.toEqual(phonemes[1]);
  expect(requests.some((url) => url.includes('huggingface.co'))).toBe(false);
  expect(requests.some((url) => url.includes('__vite-browser-external'))).toBe(false);
  await cleanCsp(page);
});
