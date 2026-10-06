import { acknowledge, expect, test, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getCodeObject, getCodeRelation } from '../../src/code/schema';

async function stored(page: Page, name: string): Promise<Graph> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visual-nerve-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await Promise.all(
        ['diagrams', 'nodes', 'edges'].map(
          (table) =>
            new Promise<any[]>((resolve, reject) => {
              const request = database.transaction(table).objectStore(table).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      const diagram = records[0].find((item) => item.name === name);
      return {
        format: 'visual-nerve' as const,
        formatVersion: 1 as const,
        diagram,
        nodes: records[1].filter((item) => item.diagramId === diagram?.id),
        edges: records[2].filter((item) => item.diagramId === diagram?.id),
        owners: [],
      };
    } finally {
      database.close();
    }
  }, name);
}
async function saved(page: Page) {
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}

test('previews a multi-file source project then saves connected native objects without original source', async ({
  page,
}) => {
  await page.goto('/');
  await acknowledge(page);
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load source files', { exact: true }).setInputFiles([
    {
      name: 'main.py',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'from library import calculate\n\ndef run():\n    token = "source-literal-not-retained"\n    return calculate()\n',
      ),
    },
    {
      name: 'library.py',
      mimeType: 'text/plain',
      buffer: Buffer.from('def calculate():\n    return 42\n'),
    },
  ]);
  await expect(dialog.getByLabel('Language for main.py')).toHaveValue('python');
  await expect(dialog.getByLabel('Language for library.py')).toHaveValue('python');
  await dialog.getByLabel('Code diagram name').fill('Project dependencies');
  await dialog.getByLabel('Code diagram detail').selectOption('symbols');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'Code preview', exact: true });
  await expect(preview).toContainText('main.py');
  await expect(preview).toContainText('calculate');
  expect((await stored(page, 'Project dependencies')).diagram).toBeUndefined();
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  let graph = await stored(page, 'Project dependencies');
  const calculate = graph.nodes.find((node) => getCodeObject(node)?.name === 'calculate')!;
  expect(calculate).toBeTruthy();
  expect(
    graph.edges.some(
      (edge) => getCodeRelation(edge)?.kind === 'calls' && edge.targetNodeId === calculate.id,
    ),
  ).toBe(true);
  expect(JSON.stringify(graph)).not.toContain('source-literal-not-retained');
  await page.locator(`.canvas-shell [data-node-id="${calculate.id}"] .node-title`).click();
  const details = page.getByRole('region', { name: 'Code object details' });
  await expect(details).toContainText('library.py');
  await page.getByLabel('Node status', { exact: true }).selectOption('done');
  await saved(page);
  await page.reload();
  await saved(page);
  graph = await stored(page, 'Project dependencies');
  expect(graph.nodes.find((node) => node.id === calculate.id)?.status).toBe('done');
  expect(graph.edges.some((edge) => getCodeRelation(edge)?.kind === 'calls')).toBe(true);
});

test('offers all languages and focuses a pasted diagram on a narrow phone without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');
  await acknowledge(page);
  await page
    .locator('.welcome-actions')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await expect(dialog.getByLabel('Source language').locator('option')).toHaveCount(50);
  await dialog.getByLabel('Code diagram name').fill('Focused functions');
  await dialog.getByLabel('Source language').selectOption('typescript');
  await dialog
    .getByLabel('Source code', { exact: true })
    .fill(
      'function calculate() { return 42; }\nfunction run() { return calculate(); }\nfunction unrelated() { return 0; }',
    );
  await dialog.getByLabel('Code diagram detail').selectOption('symbols');
  await dialog.getByLabel('Code focus', { exact: true }).fill('calculate');
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Code preview', exact: true })).toContainText(
    'calculate',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  const graph = await stored(page, 'Focused functions');
  expect(graph.nodes.some((node) => getCodeObject(node)?.name === 'calculate')).toBe(true);
  expect(graph.nodes.some((node) => getCodeObject(node)?.name === 'run')).toBe(true);
  expect(graph.nodes.some((node) => getCodeObject(node)?.name === 'unrelated')).toBe(false);
});

test('routes dropped source files to a preview and cancel leaves storage unchanged', async ({
  page,
}) => {
  await page.goto('/');
  await acknowledge(page);
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(['function start() { return 1; }'], 'start.js', { type: 'text/javascript' }),
    );
    dataTransfer.items.add(
      new File(['function finish() { return 2; }'], 'finish.js', { type: 'text/javascript' }),
    );
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  });
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await expect(dialog.getByLabel('Language for start.js')).toHaveValue('javascript');
  await expect(dialog.getByLabel('Language for finish.js')).toHaveValue('javascript');
  await dialog.getByLabel('Code diagram name').fill('Cancelled source');
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Code preview', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await stored(page, 'Cancelled source')).diagram).toBeUndefined();
  await expect(page.locator('.welcome')).toBeVisible();
});
