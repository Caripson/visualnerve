import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { blankGraph, newEdge, newNode, type Graph } from '../../src/model/types';
import { parseSql } from '../../src/sql/parser';
import type { DiagramQuestionResult } from '../../src/questions/types';
import type { HistorySnapshot } from '../../src/history/types';
import type { LovablePrompt } from '../../src/export/lovable';

async function importGraph(page: Page, graph: Graph) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'understanding-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(graph)),
  });
  await expect(page.locator('.project-title-button')).toHaveText(graph.diagram.name);
  await expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
}
async function currentGraph(request: APIRequestContext, id: string): Promise<Graph> {
  const response = await request.get(`/api/v1/diagrams/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
// Wait for the actual camera transform to be committed before checking that read-only
// requests do not advance the diagram version. Import/focus may otherwise still save it.
async function settledGraph(page: Page, request: APIRequestContext, id: string) {
  let graph!: Graph;
  await expect
    .poll(async () => {
      graph = await currentGraph(request, id);
      const saved = graph.diagram.settings.viewport;
      if (!saved) return false;
      const actual = await page
        .locator('.canvas-shell .react-flow__viewport')
        .evaluate((element) => {
          const matrix = new DOMMatrix(getComputedStyle(element).transform);
          return { x: matrix.e, y: matrix.f, zoom: matrix.a };
        });
      return (
        Math.abs(saved.x - actual.x) < 0.5 &&
        Math.abs(saved.y - actual.y) < 0.5 &&
        Math.abs(saved.zoom - actual.zoom) < 0.001 &&
        (await page.locator('.document-actions .save-status').textContent()) === 'Saved'
      );
    })
    .toBe(true);
  return graph;
}
async function understand(page: Page, tool: string, title: string) {
  await page.getByRole('button', { name: 'Understand', exact: true }).click();
  await page.getByRole('button', { name: tool, exact: true }).click();
  return page.getByRole('dialog', { name: title, exact: true });
}
async function mcp<T>(request: APIRequestContext, path: string, method: string, data?: unknown) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path, method, ...(data === undefined ? {} : { data }) },
      },
    },
  });
  expect(response.ok()).toBe(true);
  const rpc = await response.json();
  expect(rpc.error).toBeUndefined();
  return rpc.result as { isError: boolean; structuredContent: { status: number; body: T } };
}

test('asks a source/manual path, focuses original objects, saves a reviewed app specification and permits read-only MCP previews without writes', async ({
  page,
  request,
  context,
}) => {
  const externalRequests: string[] = [];
  context.on('request', (entry) => {
    if (/^lovable\.(dev|com)$/.test(new URL(entry.url()).hostname))
      externalRequests.push(entry.url());
  });
  const graph = parseSql(
    "CREATE TABLE customers(id INT PRIMARY KEY, name TEXT); CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT, FOREIGN KEY(customer_id) REFERENCES customers(id)); CREATE TABLE unrelated(id INT); INSERT INTO customers VALUES(1,'PRIVATE_SOURCE_ROW');",
    'Order understanding',
  ).graph;
  const foreignKey = graph.edges[0];
  const manual = newNode(graph.diagram.id, {
    title: 'Customer dashboard',
    nodeType: 'output',
    x: 1100,
    y: 100,
    description: 'Review customer orders.',
    metadata: { privateValue: 'PRIVATE_CUSTOM_METADATA' },
  });
  const connection = newEdge(graph.diagram.id, foreignKey.targetNodeId, manual.id, {
    label: 'Show customer summary',
    description: 'User-modeled dashboard relationship',
    direction: 'forward',
  });
  graph.nodes.push(manual);
  graph.edges.push(connection);
  await importGraph(page, graph);
  await settledGraph(page, request, graph.diagram.id);
  const question = {
    startId: foreignKey.sourceNodeId,
    kind: 'path',
    targetId: manual.id,
    maxDepth: 4,
  };
  const dialog = await understand(page, 'Ask diagram', 'Ask about this diagram');
  await dialog.getByLabel('Question start object').selectOption(question.startId);
  await dialog.getByLabel('Diagram question').selectOption('path');
  await dialog.getByLabel('Question destination').selectOption(question.targetId);
  await dialog.getByLabel('Question maximum steps').fill('4');
  await dialog.getByRole('button', { name: 'Ask diagram', exact: true }).click();
  const answers = dialog.getByRole('region', { name: 'Question answers' });
  await expect(answers.getByText('Customer dashboard', { exact: true })).toBeVisible();
  await answers.getByText('Why is this connected?', { exact: true }).click();
  await expect(answers.getByText('SQL · foreign-key · explicit', { exact: true })).toBeVisible();
  await expect(
    answers.getByText('diagram · relationship · explicit', { exact: true }),
  ).toBeVisible();
  await expect(answers.getByText(/Foreign key customer_id/)).toBeVisible();
  await expect(
    answers.getByText('User-modeled dashboard relationship', { exact: true }),
  ).toBeVisible();
  await answers.getByRole('button', { name: 'Focus this path', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Relationship focus applied');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await currentGraph(request, graph.diagram.id)).diagram.settings.relationshipExploration,
    )
    .toMatchObject({ mode: 'path', startId: question.startId, targetId: manual.id });
  const retained = await currentGraph(request, graph.diagram.id);
  expect(retained.nodes).toHaveLength(graph.nodes.length);
  expect(retained.edges).toHaveLength(graph.edges.length);
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(3);

  await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
  const brief = page.getByRole('dialog', { name: 'Build with Lovable', exact: true });
  await brief.getByLabel('Lovable scope').selectOption('diagram');
  await brief.getByText('Screens and navigation', { exact: true }).click();
  await brief
    .getByLabel('Screens and navigation requirements', { exact: true })
    .fill('Add a customer dashboard with accessible keyboard navigation.');
  await brief
    .locator('summary')
    .filter({ hasText: /^Answer open decisions/ })
    .click();
  await brief
    .getByLabel('Who will use this app, and what must each role be allowed to do?', { exact: true })
    .fill('Account managers can review; administrators can edit.');
  await expect(brief.getByLabel('Lovable build prompt')).toHaveValue(
    /Add a customer dashboard with accessible keyboard navigation\./,
  );
  await brief.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await currentGraph(request, graph.diagram.id)).diagram.settings.buildSpecification,
    )
    .toMatchObject({
      version: 1,
      sections: { screens: 'Add a customer dashboard with accessible keyboard navigation.' },
      answers: { audience: 'Account managers can review; administrators can edit.' },
    });

  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await settledGraph(page, request, graph.diagram.id);
  const result = await mcp<DiagramQuestionResult>(
    request,
    `/diagrams/${graph.diagram.id}/questions`,
    'POST',
    question,
  );
  expect(result.isError).toBe(false);
  expect(result.structuredContent.status).toBe(200);
  expect(result.structuredContent.body.answers[0].edgeIds).toEqual([foreignKey.id, connection.id]);
  expect(
    result.structuredContent.body.evidence.find((item) => item.edgeId === foreignKey.id),
  ).toMatchObject({ source: 'sql', confidence: 'explicit' });
  expect(
    result.structuredContent.body.evidence.find((item) => item.edgeId === connection.id),
  ).toMatchObject({ source: 'diagram', confidence: 'explicit' });
  const missingTarget = await mcp(request, `/diagrams/${graph.diagram.id}/questions`, 'POST', {
    ...question,
    targetId: crypto.randomUUID(),
  });
  expect(missingTarget.isError).toBe(true);
  expect(missingTarget.structuredContent.status).toBe(422);
  expect(await currentGraph(request, graph.diagram.id)).toEqual(before);
  const build = await mcp<LovablePrompt>(
    request,
    `/diagrams/${graph.diagram.id}/build-brief`,
    'POST',
    { scope: 'diagram' },
  );
  expect(build.isError).toBe(false);
  expect(build.structuredContent.status).toBe(200);
  expect(build.structuredContent.body.text).toContain(
    'Add a customer dashboard with accessible keyboard navigation.',
  );
  expect(build.structuredContent.body.text).toContain(
    'Account managers can review; administrators can edit.',
  );
  expect(build.structuredContent.body.text).not.toContain('PRIVATE_SOURCE_ROW');
  expect(build.structuredContent.body.text).not.toContain('PRIVATE_CUSTOM_METADATA');
  const denied = await mcp(request, `/diagrams/${graph.diagram.id}/build-specification`, 'PUT', {
    baseVersion: before.diagram.version,
    specification: { version: 1, sections: { screens: 'Forbidden overwrite' }, answers: {} },
  });
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent.status).toBe(403);
  const snapshotDenied = await mcp(request, `/diagrams/${graph.diagram.id}/history`, 'POST', {
    baseVersion: before.diagram.version,
    name: 'Denied snapshot',
  });
  expect(snapshotDenied.isError).toBe(true);
  expect(snapshotDenied.structuredContent.status).toBe(403);
  expect(await currentGraph(request, graph.diagram.id)).toEqual(before);
  expect(await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/history`)).json()).toEqual(
    [],
  );
  expect(externalRequests).toEqual([]);
});

test('saves a named snapshot, reviews an API edit and restores stable IDs with a safety copy of current work', async ({
  page,
  request,
}) => {
  const graph = blankGraph('Truck version review', 'flowchart');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build truck', x: 100, y: 140 }),
    newNode(graph.diagram.id, { title: 'Drive truck', x: 440, y: 140 }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'Ready to drive' }),
  ];
  await importGraph(page, graph);
  await settledGraph(page, request, graph.diagram.id);
  const dialog = await understand(page, 'Version history', 'Diagram history');
  await dialog.getByLabel('Snapshot name', { exact: true }).fill('Before design review');
  await dialog.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Named snapshot saved locally.');
  const snapshots = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/history`)
  ).json()) as HistorySnapshot[];
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].name).toBe('Before design review');
  const before = await currentGraph(request, graph.diagram.id),
    node = before.nodes[0];
  const changed = await request.patch(`/api/v1/nodes/${node.id}`, {
    data: {
      version: node.version,
      title: 'Approved production plan',
      status: 'done',
      description: 'Preserve this current work in a safety copy.',
    },
  });
  expect(changed.status()).toBe(200);
  await dialog
    .getByRole('combobox', { name: 'Snapshot', exact: true })
    .selectOption(snapshots[0].id);
  await dialog.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(dialog.getByText('1 meaningful change', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Approved production plan', { exact: true })).toBeVisible();
  const restore = dialog.getByRole('button', { name: 'Restore reviewed snapshot', exact: true });
  await expect(restore).toBeDisabled();
  await dialog
    .getByLabel('I reviewed the changes and want to restore this snapshot.', { exact: true })
    .check();
  await restore.click();
  await expect(dialog.getByRole('status')).toContainText('Your previous work is preserved');
  const restored = await currentGraph(request, graph.diagram.id);
  expect(restored.nodes.map((item) => item.id)).toEqual(graph.nodes.map((item) => item.id));
  expect(restored.edges.map((item) => item.id)).toEqual(graph.edges.map((item) => item.id));
  expect(restored.nodes[0]).toMatchObject({ title: 'Build truck', x: 100, y: 140 });
  expect(restored.nodes[0].status).not.toBe('done');
  const versions = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/history`)
  ).json()) as HistorySnapshot[];
  expect(versions).toHaveLength(2);
  const safety = versions.find((item) => item.kind === 'pre-restore')!;
  const archived = (await (
    await request.get(`/api/v1/diagrams/${graph.diagram.id}/history/${safety.id}`)
  ).json()) as { graph: Graph };
  expect(archived.graph.nodes[0]).toMatchObject({
    id: node.id,
    title: 'Approved production plan',
    status: 'done',
    description: 'Preserve this current work in a safety copy.',
  });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.locator('.diagram-item').filter({ hasText: graph.diagram.name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(graph.diagram.name);
  expect((await currentGraph(request, graph.diagram.id)).nodes[0].title).toBe('Build truck');
  expect(
    await (await request.get(`/api/v1/diagrams/${graph.diagram.id}/history`)).json(),
  ).toHaveLength(2);
});
