import { expect, test, type APIRequestContext } from './fixtures';
import { compileRobloxGame } from '../../src/roblox/compiler';
import { runRobloxPreview } from '../../src/roblox/preview';
import type { GameDefinition } from '../../src/roblox/types';

async function rpc(request: APIRequestContext, method: string, params: unknown) {
  const response = await request.post('/mcp', {
    data: { jsonrpc: '2.0', id: crypto.randomUUID(), method, params },
  });
  expect(response.ok()).toBe(true);
  const reply = await response.json();
  expect(reply.error).toBeUndefined();
  return reply.result;
}
async function mcp<T = unknown>(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
): Promise<T> {
  const reply = await rpc(request, 'tools/call', {
    name: 'visual_nerve_request',
    arguments: { path, method, ...(data === undefined ? {} : { data }) },
  });
  expect(reply.structuredContent.status, JSON.stringify(reply.structuredContent.body)).toBe(status);
  return reply.structuredContent.body;
}
test('MCP discovers and edits the same UI game, previews canonical logic and retrieves deterministic native builds', async ({
  page,
  request,
}) => {
  const initialized = await rpc(request, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'Visual Nerve Roblox acceptance', version: '1.0.0' },
  });
  expect(initialized.protocolVersion).toBe('2025-11-25');
  const discovered = await rpc(request, 'tools/list', {});
  expect(discovered.tools.map((tool: { name: string }) => tool.name)).toEqual(
    expect.arrayContaining(['visual_nerve_api_docs', 'visual_nerve_request']),
  );
  const guide = await rpc(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: { document: 'guide' },
  });
  expect(JSON.stringify(guide)).toContain('roblox-game-builder');
  const schema = await rpc(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: {
      document: 'endpoint',
      path: '/diagrams/{diagramId}/roblox/preview',
      method: 'POST',
    },
  });
  expect(JSON.stringify(schema)).toContain('steps');
  const caps = await mcp<{ schemaVersion: number; templateId: string }>(
    request,
    '/roblox/capabilities',
  );
  expect(caps).toMatchObject({ schemaVersion: 1, templateId: 'roblox-game-builder' });
  const diagram = await mcp<{ id: string; version: number }>(
    request,
    '/diagrams',
    'POST',
    { name: 'MCP game round trip', template: 'roblox-game-builder' },
    201,
  );
  const base = `/diagrams/${diagram.id}/roblox`;
  let model = await mcp<{ baseVersion: number; game: GameDefinition }>(request, base);
  await page.getByRole('button', { name: 'MCP game round trip', exact: true }).click();
  await expect(page.getByRole('button', { name: 'World & rules', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'World & rules', exact: true }).click();
  const builder = page.getByRole('dialog', { name: /Roblox Game Builder/ });
  await builder.getByLabel('Object name', { exact: true }).fill('Start from the UI');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  model = await mcp(request, base);
  const object = model.game.entities[0];
  expect(object.name).toBe('Start from the UI');
  await mcp(request, `${base}/entities/${object.id}`, 'PATCH', {
    baseVersion: model.baseVersion,
    value: { name: 'Start from MCP', transform: { position: { x: 4 } } },
  });
  await expect(builder.getByLabel('Object name', { exact: true })).toHaveValue('Start from MCP');
  await expect(builder.getByLabel('Position (studs) X', { exact: true })).toHaveValue('4');
  model = await mcp(request, base);
  const configuration = await mcp<{ baseVersion: number; configuration: Partial<GameDefinition> }>(
    request,
    `${base}/configuration`,
  );
  expect(configuration).toMatchObject({
    baseVersion: model.baseVersion,
    configuration: { id: model.game.id, settings: model.game.settings },
  });
  expect(configuration.configuration).not.toHaveProperty('entities');
  await mcp(request, `${base}/configuration`, 'PATCH', {
    baseVersion: configuration.baseVersion,
    value: { settings: { maxPlayers: 6 } },
  });
  await builder.getByText('Game name and player settings', { exact: true }).click();
  await expect(builder.getByLabel('Maximum players', { exact: true })).toHaveValue('6');
  model = await mcp(request, base);
  const steps = [
    { kind: 'join' as const, playerId: 'one' },
    { kind: 'join' as const, playerId: 'two' },
    { kind: 'advance' as const, seconds: 1 },
  ];
  const preview = await mcp(request, `${base}/preview`, 'POST', { steps });
  expect(preview).toMatchObject({ ...runRobloxPreview(model.game, steps) });
  const rest = await request.post(`/api/v1${base}/preview`, { data: { steps } });
  expect(rest.status()).toBe(200);
  expect(await rest.json()).toEqual(preview);
  const expected = compileRobloxGame(model.game);
  const build = await mcp<{ jobId: string }>(
    request,
    `${base}/builds`,
    'POST',
    { baseVersion: model.baseVersion },
    202,
  );
  await expect
    .poll(
      async () => (await mcp<{ state: string }>(request, `${base}/builds/${build.jobId}`)).state,
    )
    .toBe('succeeded');
  const manifest = await mcp<{ artifacts: { name: string; totalBytes: number }[] }>(
    request,
    `${base}/builds/${build.jobId}/result`,
  );
  expect(manifest.artifacts[0]).toMatchObject({
    name: 'game.rbxlx',
    totalBytes: Buffer.byteLength(expected.placeXml),
  });
  const chunks: Buffer[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const chunk: { content: string; nextOffset: number | null } = await mcp(
      request,
      `${base}/builds/${build.jobId}/artifacts/game.rbxlx?offset=${offset}&limit=65536`,
    );
    chunks.push(Buffer.from(chunk.content, 'base64'));
    offset = chunk.nextOffset;
  }
  expect(Buffer.concat(chunks).toString('utf8')).toBe(expected.placeXml);
  for (const [path, method, value] of [
    [
      `${base}/variables`,
      'POST',
      { id: 'invalid-score', name: 'Score', scope: 'player', initial: 0, min: null },
    ],
    [`${base}/entities/${object.id}`, 'PATCH', { name: 'Must not save', unexpected: null }],
    [
      `${base}/rules/${model.game.rules[0].id}`,
      'PATCH',
      { actions: [{ kind: 'message', text: 'Must not save', unexpected: null }] },
    ],
  ] as const) {
    const invalid = await mcp<{ code: string }>(
      request,
      path,
      method,
      { baseVersion: model.baseVersion, value },
      422,
    );
    expect(invalid.code).toBe('ROBLOX_GAME_INVALID');
  }
  expect(await mcp(request, base)).toEqual(model);
  await mcp(
    request,
    `${base}/entities/${object.id}`,
    'PATCH',
    { baseVersion: 1, value: { name: 'Stale write' } },
    409,
  );
  const unsupported = await request.post(`/api/v1${base}/publish`, { data: {} });
  expect([404, 405]).toContain(unsupported.status());
});
