import { test, expect } from './fixtures';

test('MCP reservation, REST retry, status and canonical-ID bulk rejection share one browser model', async ({
  page,
  request,
}) => {
  const call = async (arguments_: Record<string, unknown>) => {
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name: 'visual_nerve_request', arguments: arguments_ },
      },
    });
    const body = await response.json();
    expect(body.error).toBeUndefined();
    return body.result;
  };
  const health = await (await request.get('/api/v1/health')).json();
  expect(health.version).toBe('0.4.0');
  expect(health.capabilities).toEqual(
    expect.arrayContaining(['operations-v1', 'endpoint-docs-v1']),
  );
  const reserved = await call({ path: '/operations', method: 'POST', data: {} });
  expect(reserved.isError).toBe(false);
  const operationId = reserved.structuredContent.body.operationId;
  const data = { name: 'Safe MCP process', type: 'process-simulator' };
  const created = await call({ path: '/spatial-diagrams', method: 'POST', data, operationId });
  expect(created.isError).toBe(false);
  expect(created.structuredContent.operationId).toBe(operationId);
  const graph = created.structuredContent.body;
  expect(graph.diagram.type).toBe('process-simulator');
  const retry = await request.post('/api/v1/spatial-diagrams', {
    data,
    headers: { 'X-Visual-Nerve-Operation-Id': operationId },
  });
  expect(retry.status()).toBe(201);
  expect((await retry.json()).diagram.id).toBe(graph.diagram.id);
  const status = await call({ path: `/operations/${operationId}` });
  expect(status.structuredContent.body).toMatchObject({
    state: 'succeeded',
    status: 201,
    resultAvailable: true,
  });
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  expect(diagrams.filter((diagram: { name: string }) => diagram.name === data.name)).toHaveLength(
    1,
  );
  await expect(page.getByRole('heading', { name: data.name, exact: true, level: 1 })).toBeVisible();
  // The content-loss report used an existing canonical ID in a partial bulk item.
  const node = await (
    await request.post(`/api/v1/diagrams/${graph.diagram.id}/nodes`, {
      data: { title: 'Preserve this title', externalId: 'stable-work' },
    })
  ).json();
  const rejected = await request.post(`/api/v1/diagrams/${graph.diagram.id}/bulk`, {
    data: { upsert: true, nodes: [{ id: node.id, x: 420 }] },
  });
  expect(rejected.status()).toBe(409);
  expect((await (await request.get(`/api/v1/nodes/${node.id}`)).json()).title).toBe(
    'Preserve this title',
  );
  const updated = await call({
    path: `/diagrams/${graph.diagram.id}/bulk`,
    method: 'POST',
    data: { upsert: true, nodes: [{ externalId: 'stable-work', x: 420 }] },
  });
  expect(updated.isError).toBe(false);
  expect(
    updated.structuredContent.body.nodes.find((value: { id: string }) => value.id === node.id),
  ).toMatchObject({ title: 'Preserve this title', x: 420 });
});

test('a real browser write can commit after its acknowledgement is lost; timeout and retry do not duplicate it', async ({
  page,
  request,
}) => {
  const reserved = await (await request.post('/api/v1/operations', { data: {} })).json();
  const operationId = reserved.operationId;
  const name = 'Lost acknowledgement proof';
  await page.evaluate((name) => {
    const original = WebSocket.prototype.send;
    let held: { socket: WebSocket; data: string } | undefined;
    const testWindow = window as unknown as { heldReply: boolean; deliverHeld: () => void };
    testWindow.heldReply = false;
    testWindow.deliverHeld = () => {
      if (held) {
        original.call(held.socket, held.data);
        held = undefined;
      }
    };
    WebSocket.prototype.send = function (data) {
      if (typeof data === 'string') {
        const value = JSON.parse(data);
        if (!testWindow.heldReply && value.body?.name === name) {
          held = { socket: this, data };
          testWindow.heldReply = true;
          return;
        }
      }
      original.call(this, data);
    };
  }, name);
  const data = { name, type: 'mindmap' };
  const pending = request.post('/mcp', {
    timeout: 40000,
    data: {
      jsonrpc: '2.0',
      id: 'uncertain-write',
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/diagrams', method: 'POST', data, operationId },
      },
    },
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heldReply: boolean }).heldReply))
    .toBe(true);
  // This status comes from the browser's real completed command, not an animation counter.
  const completed = await (await request.get(`/api/v1/operations/${operationId}`)).json();
  expect(completed).toMatchObject({ state: 'succeeded', status: 201, resultAvailable: true });
  const timedOut = (await (await pending).json()).result;
  expect(timedOut).toMatchObject({
    isError: true,
    structuredContent: {
      status: 504,
      operationId,
      body: { code: 'OPERATION_OUTCOME_UNKNOWN', state: 'unknown', operationId },
    },
  });
  await page.evaluate(() => (window as unknown as { deliverHeld: () => void }).deliverHeld());
  const retry = await request.post('/api/v1/diagrams', {
    data,
    headers: { 'X-Visual-Nerve-Operation-Id': operationId },
  });
  expect(retry.status()).toBe(201);
  expect((await retry.json()).id).toBe(completed.result.id);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  expect(diagrams.filter((diagram: { name: string }) => diagram.name === name)).toHaveLength(1);
});

test('a newer grant cannot recover or redispatch an operation from the previous grant', async ({
  page,
  request,
}) => {
  const operationId = (await (await request.post('/api/v1/operations', { data: {} })).json())
    .operationId;
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('off');
  await expect
    .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
    .toBe(0);
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const response = await request.post('/api/v1/diagrams', {
    data: { name: 'Must not be created', type: 'mindmap' },
    headers: { 'X-Visual-Nerve-Operation-Id': operationId },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'OPERATION_OUTCOME_UNKNOWN' });
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  expect(diagrams).toHaveLength(0);
});
