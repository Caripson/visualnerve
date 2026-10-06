import { test, expect } from './fixtures';
import type { Graph } from '../../src/model/types';

test('rejects malformed native JSON and MCP patches without saving a broken diagram', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const diagram = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Safe native graph' } })
  ).json();
  await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, { data: { title: 'Still editable' } });
  await page.locator('.diagram-item').filter({ hasText: 'Safe native graph' }).click();
  await expect(page.locator('.canvas-shell')).toContainText('Still editable');
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
  const original: Graph = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const malformed = structuredClone(original);
  Object.assign(malformed.nodes[0], { tags: null });
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'malformed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(malformed)),
  });
  await expect(page.locator('.error-notice')).toContainText(
    'Node tags must be an array of strings',
  );
  await expect(page.locator('.canvas-shell')).toContainText('Still editable');
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(diagrams);
  expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(original);
  const patch = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: `/nodes/${original.nodes[0].id}`,
          method: 'PATCH',
          data: { version: original.nodes[0].version, description: 123 },
        },
      },
    },
  });
  const result = (await patch.json()).result;
  expect(result.isError).toBe(true);
  expect(result.structuredContent.status).toBe(422);
  expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(original);
  await page.reload();
  await expect(page.locator('.canvas-shell')).toContainText('Still editable');
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Node tags', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Node tags', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Node tags', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});

for (const outcome of ['resolve', 'reject'] as const)
  test(`a delayed clipboard ${outcome} does not paste into a different diagram`, async ({
    page,
    request,
  }) => {
    const first = await (
      await request.post('/api/v1/diagrams', { data: { name: 'Clipboard original' } })
    ).json();
    await request.post(`/api/v1/diagrams/${first.id}/nodes`, { data: { title: 'Copied source' } });
    const second = await (
      await request.post('/api/v1/diagrams', { data: { name: 'Clipboard other' } })
    ).json();
    await page.locator('.diagram-item').filter({ hasText: 'Clipboard original' }).click();
    await expect(page.locator('.canvas-shell')).toContainText('Copied source');
    await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
    const original: Graph = await (await request.get(`/api/v1/diagrams/${first.id}`)).json();
    await page.locator('.react-flow__node').first().click();
    await page.keyboard.press('Control+c');
    await page.evaluate(() => {
      const state = { requested: false, finish: (_outcome: string, _text: string) => {} };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: () =>
            new Promise<string>((resolve, reject) => {
              state.requested = true;
              state.finish = (outcome, text) =>
                outcome === 'resolve'
                  ? resolve(text)
                  : reject(new Error('Clipboard permission denied'));
            }),
        },
      });
      Object.assign(window, { clipboardAudit: state });
    });
    await page.keyboard.press('Control+v');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { clipboardAudit: { requested: boolean } }).clipboardAudit
              .requested,
        ),
      )
      .toBe(true);
    await page.locator('.diagram-item').filter({ hasText: 'Clipboard other' }).click();
    await expect(page.locator('.document-title h1')).toHaveText('Clipboard other');
    await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
    const other: Graph = await (await request.get(`/api/v1/diagrams/${second.id}`)).json();
    await page.evaluate(
      ({ outcome, clip }) => {
        (
          window as unknown as {
            clipboardAudit: { finish: (outcome: string, clip: string) => void };
          }
        ).clipboardAudit.finish(outcome, clip);
      },
      {
        outcome,
        clip: JSON.stringify({
          format: 'visual-nerve-clipboard',
          nodes: original.nodes,
          edges: original.edges,
        }),
      },
    );
    // Let the clipboard continuation and the next rendering frame finish.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    expect(await (await request.get(`/api/v1/diagrams/${second.id}`)).json()).toEqual(other);
    expect(await (await request.get(`/api/v1/diagrams/${first.id}`)).json()).toEqual(original);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

test('keeps projects and footer actions reachable in a short desktop window', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 780, height: 400 });
  const first = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Short window first' } })
  ).json();
  const second = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Short window second' } })
  ).json();
  await page.locator('.diagram-item').filter({ hasText: 'Short window first' }).click();
  await expect(page.locator('.document-title h1')).toHaveText('Short window first');
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Import file size');
  await page.getByLabel('Close dialog', { exact: true }).click();
  await page.locator('.diagram-item').filter({ hasText: 'Short window second' }).click();
  await expect(page.locator('.document-title h1')).toHaveText('Short window second');
  expect((await (await request.get(`/api/v1/diagrams/${first.id}`)).json()).nodes).toHaveLength(0);
  expect((await (await request.get(`/api/v1/diagrams/${second.id}`)).json()).nodes).toHaveLength(0);
});
