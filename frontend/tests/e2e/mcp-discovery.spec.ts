import { test, expect, type APIRequestContext } from '@playwright/test';
import { acknowledge } from './fixtures';

async function rpc(request: APIRequestContext, method: string, params?: unknown) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      ...(params === undefined ? {} : { params }),
    },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.error).toBeUndefined();
  return body.result;
}

test('MCP discovers 2D and 3D commands and full schemas without a connected browser', async ({
  request,
}) => {
  expect((await (await request.get('/api/v1/health')).json()).connected).toBe(0);
  const initialized = await rpc(request, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'discovery-test', version: '1' },
  });
  expect(initialized.capabilities.resources).toEqual({});
  expect(initialized.instructions).toContain('visual_nerve_api_docs');
  expect(initialized.instructions).toContain('/spatial-diagrams');
  const tools = (await rpc(request, 'tools/list')).tools;
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
    'visual_nerve_request',
    'visual_nerve_api_docs',
  ]);
  expect(tools[1].annotations.readOnlyHint).toBe(true);
  const guide = await rpc(request, 'tools/call', { name: 'visual_nerve_api_docs', arguments: {} });
  expect(guide.isError).toBe(false);
  expect(guide.content).toHaveLength(1);
  expect(guide.content[0].text).toContain('POST /spatial-diagrams');
  expect(guide.content[0].text).toContain('native 2D');
  const openapi = await rpc(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: { document: 'openapi' },
  });
  expect(openapi.isError).toBe(false);
  const contract = JSON.parse(openapi.content[0].text);
  expect(contract.paths['/spatial-diagrams'].post).toBeDefined();
  expect(contract.paths['/diagrams/{diagramId}/bulk'].post).toBeDefined();
  const resources = (await rpc(request, 'resources/list')).resources;
  expect(resources.map((resource: { uri: string }) => resource.uri)).toEqual([
    'visual-nerve://docs/guide',
    'visual-nerve://docs/openapi',
  ]);
  const read = await rpc(request, 'resources/read', { uri: resources[1].uri });
  expect(read.contents[0].text).toBe(openapi.content[0].text);
  expect((await (await request.get('/api/v1/health')).json()).connected).toBe(0);
});

test('the discoverable 3D creation command opens a shared diagram through the browser grant', async ({
  page,
  request,
}) => {
  const guide = await rpc(request, 'tools/call', { name: 'visual_nerve_api_docs' });
  expect(guide.content[0].text).toContain('"path":"/spatial-diagrams"');
  await page.goto('/');
  await acknowledge(page);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/api/v1/health')).json()).connected)
    .toBeGreaterThan(0);
  const created = await rpc(request, 'tools/call', {
    name: 'visual_nerve_request',
    arguments: {
      path: '/spatial-diagrams',
      method: 'POST',
      data: { name: 'Discovered 3D workflow', type: 'mindmap' },
    },
  });
  expect(created.isError).toBe(false);
  expect(created.structuredContent.status).toBe(201);
  const graph = created.structuredContent.body;
  expect(graph.diagram.settings.spatialView).toEqual({ version: 1, mode: '3d' });
  expect(graph.nodes).toEqual([]);
  await expect(page.getByTestId('spatial-view')).toBeVisible();
  await expect(page.getByRole('button', { name: '2D view', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(page.locator('.canvas-shell .react-flow')).toBeVisible();
});
