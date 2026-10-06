import { expect, test } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getCodeObject, getCodeRelation } from '../../src/code/schema';

test('REST and MCP discover languages, preview with read-only access, and create only with write access', async ({
  page,
  request,
}) => {
  const input = {
    name: 'API source outline',
    mode: 'symbols',
    files: [
      {
        path: 'main.ts',
        content:
          'import { helper as calculate } from "./util";\nexport function run() { const token="PRIVATE-SOURCE-VALUE"; return calculate(); }',
      },
      { path: 'util.ts', content: 'export function helper() { return 1; }' },
    ],
  };
  const catalog = await request.get('/api/v1/code/languages');
  expect(catalog.status()).toBe(200);
  expect(await catalog.json()).toHaveLength(50);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await (await request.get('/api/v1/diagrams')).json();
  const preview = await request.post('/api/v1/code/preview', { data: input });
  expect(preview.status()).toBe(200);
  expect(
    (await preview.json()).graph.nodes.some(
      (node: Graph['nodes'][number]) => getCodeObject(node)?.name === 'helper',
    ),
  ).toBe(true);
  const mcp = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/code/preview', method: 'POST', data: input },
      },
    },
  });
  const response = (await mcp.json()).result;
  expect(response.isError).toBe(false);
  expect(response.structuredContent.status).toBe(200);
  expect(
    response.structuredContent.body.graph.edges.some(
      (edge: Graph['edges'][number]) => getCodeRelation(edge)?.kind === 'calls',
    ),
  ).toBe(true);
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  expect((await request.post('/api/v1/code/diagrams', { data: input })).status()).toBe(403);
  expect((await request.post('/api/v1/code/preview?save=true', { data: input })).status()).toBe(
    403,
  );
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const created = await request.post('/api/v1/code/diagrams', { data: input });
  expect(created.status()).toBe(201);
  const graph = (await created.json()) as Graph;
  expect(JSON.stringify(graph)).not.toContain('PRIVATE-SOURCE-VALUE');
  expect(graph.edges.some((edge) => getCodeRelation(edge)?.kind === 'calls')).toBe(true);
  await expect(page.locator('.project-title-button')).toHaveText('API source outline');
  const stored = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
  ).json()) as Graph;
  expect(stored.nodes).toEqual(graph.nodes);
  expect(stored.edges).toEqual(graph.edges);
  // Opening the diagram can save its fitted viewport before this read completes.
  expect(stored.diagram).toMatchObject({
    ...graph.diagram,
    updatedAt: expect.any(String),
    version: expect.any(Number),
  });
  expect(stored.diagram.version).toBeGreaterThanOrEqual(graph.diagram.version);
});
