import { test, expect } from '@playwright/test';
import { acknowledge } from './fixtures';

test('encrypted browser operations preserve saved work and revoke receipts at the real human lock boundary', async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    ignoreHTTPSErrors: true,
  });
  try {
    const password = 'Disposable encrypted operation acceptance passphrase';
    await page.goto('https://public-app.test:4341/');
    await page.getByLabel('New workspace password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
    await page.getByLabel('I have saved my recovery key in a protected location.').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await acknowledge(page);
    const settings = async () =>
      page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
    await settings();
    await page.getByText('Local connection details', { exact: true }).click();
    await page
      .getByLabel('Local bridge address', { exact: true })
      .fill('wss://127.0.0.1:4329/bridge');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(
      page.getByText('Local connection updated. The token lasts for this browser session.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await expect
      .poll(async () => (await (await api.get('/api/v1/health')).json()).connected)
      .toBe(1);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const reservation = await (await api.post('/api/v1/operations', { data: {} })).json();
    const operationId = reservation.operationId;
    expect(reservation.state).toBe('reserved');
    const input = { name: 'Encrypted operation proof', type: 'mindmap' };
    const created = await api.post('/api/v1/spatial-diagrams', {
      data: input,
      headers: { 'X-Visual-Nerve-Operation-Id': operationId },
    });
    expect(created.status()).toBe(201);
    const graph = await created.json();
    const title = 'Private encrypted operation canary';
    expect(
      (await api.post(`/api/v1/diagrams/${graph.diagram.id}/nodes`, { data: { title } })).status(),
    ).toBe(201);
    expect(await (await api.get(`/api/v1/operations/${operationId}`)).json()).toMatchObject({
      state: 'succeeded',
      resultAvailable: true,
    });
    const locked = await api.post('/api/v1/workspace/lock', { data: {} });
    expect(locked.status()).toBe(200);
    expect(await locked.json()).toMatchObject({ state: 'locked', cipher: 'AES-256-GCM' });
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    expect((await api.get('/api/v1/diagrams')).status()).toBe(423);
    const oldReceipt = await api.get(`/api/v1/operations/${operationId}`);
    expect(oldReceipt.status()).toBe(409);
    expect(await oldReceipt.text()).not.toContain(input.name);
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: input.name, exact: true, level: 1 }),
    ).toBeVisible();
    const diagramPath = `/api/v1/diagrams/${graph.diagram.id}`;
    const freshGrantError = 'Choose a fresh MCP access grant in browser Settings.';
    const beforeFreshGrant = await api.get(diagramPath);
    expect(beforeFreshGrant.status()).toBe(403);
    expect(await beforeFreshGrant.json()).toEqual({ error: freshGrantError });
    await settings();
    await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
    await page.getByLabel('MCP access', { exact: true }).selectOption('write');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // Transport health also counts the retained control-only socket. Wait for
    // content authority after the encrypted grant commits, using only safe reads.
    await expect
      .poll(async () => {
        const response = await api.get(diagramPath);
        const body = await response.json();
        if (response.status() === 403) {
          expect(body).toEqual({ error: freshGrantError });
        } else if (response.status() === 503) {
          expect([
            'browser disconnected',
            'No active Visual Nerve browser session. Open https://app.visualnerve.com/, unlock the workspace and enable MCP access in Settings.',
          ]).toContain(body.error);
          expect(body).toEqual({ error: body.error });
        } else {
          expect(response.status(), JSON.stringify(body)).toBe(200);
        }
        return response.status();
      })
      .toBe(200);
    const restoredResponse = await api.get(diagramPath);
    expect(restoredResponse.status(), await restoredResponse.text()).toBe(200);
    const restored = await restoredResponse.json();
    expect(restored.nodes).toHaveLength(1);
    expect(restored.nodes[0].title).toBe(title);
    const stale = await api.post('/api/v1/spatial-diagrams', {
      data: input,
      headers: { 'X-Visual-Nerve-Operation-Id': operationId },
    });
    expect(stale.status()).toBe(409);
    expect(await (await api.get('/api/v1/diagrams')).json()).toHaveLength(1);
  } finally {
    await api.dispose();
  }
});
