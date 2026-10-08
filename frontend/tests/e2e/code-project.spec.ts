import { zipSync, strToU8 } from 'fflate';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import type { Graph } from '../../src/model/types';
import type { CodeImportResult } from '../../src/code/types';
import {
  getCodeAnalysis,
  getCodeObject,
  getCodeRelation,
  getProjectDirectory,
} from '../../src/code/schema';

const project = zipSync({
  'service/src/main.ts': strToU8(
    'import { helper } from "./utils/helper"; export function run() { const token="PRIVATE-PROJECT-LITERAL"; return helper(); }',
  ),
  'service/src/utils/helper.ts': strToU8('export function helper() { return 1; }'),
  'service/README.md': strToU8('# Service\n[Usage](docs/usage.md)\nPRIVATE-DOCUMENT-PARAGRAPH'),
  'service/docs/usage.md': strToU8('# Usage\n[Home](../README.md#service)'),
  'service/.env': strToU8('PRIVATE-EXCLUDED-KEY'),
  'service/node_modules/dep/index.js': strToU8('PRIVATE-EXCLUDED-DEPENDENCY'),
  'service/dist/generated.js': strToU8('PRIVATE-EXCLUDED-BUILD'),
});
const encoded = Buffer.from(project).toString('base64');
function semantic(graph: Graph) {
  const key = new Map(
    graph.nodes.map((node) => [
      node.id,
      getProjectDirectory(node)?.path ??
        `${getCodeObject(node)?.path}:${getCodeObject(node)?.name}`,
    ]),
  );
  return {
    analysis: getCodeAnalysis(graph),
    nodes: graph.nodes.map((node) => ({
      directory: getProjectDirectory(node),
      object: getCodeObject(node),
    })),
    edges: graph.edges.map((edge) => ({
      from: key.get(edge.sourceNodeId),
      to: key.get(edge.targetNodeId),
      relation: getCodeRelation(edge),
    })),
  };
}
async function capture(page: import('@playwright/test').Page) {
  if (process.env.VN_CAPTURE_PROJECT !== '1') return;
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 1400 });
  const output = resolve('../hugo/static/help/images');
  await mkdir(output, { recursive: true });
  const png = resolve(output, 'code-project-zip.png');
  await writeFile(
    png,
    await page
      .getByRole('dialog', { name: 'Visualize code', exact: true })
      .screenshot({ animations: 'disabled' }),
  );
  execFileSync('cwebp', [
    '-lossless',
    '-m',
    '6',
    '-quiet',
    png,
    '-o',
    resolve(output, 'code-project-zip.webp'),
  ]);
  await unlink(png);
  await page.setViewportSize(viewport);
}

test('ZIP folder preview, UI creation and MCP/REST share source-free topology and persist editable directory cards', async ({
  page,
  request,
}) => {
  await page
    .locator('.welcome-actions')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load ZIP project', { exact: true }).setInputFiles({
    name: 'service.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(project),
  });
  await expect(dialog.getByLabel('Project scan summary')).toContainText(
    '3 archive entries excluded',
  );
  await expect(dialog.getByLabel('Language for README.md')).toHaveValue('markdown');
  await expect(dialog.getByLabel('Language for src/main.ts')).toHaveValue('typescript');
  await dialog.getByLabel('Code diagram detail').selectOption('folders');
  await capture(page);
  const before = await (await request.get('/api/v1/diagrams')).json();
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByLabel('Code preview')).toContainText('4');
  await expect(dialog.getByLabel('Code preview')).toContainText('Folders');
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find((diagram: { name: string }) => diagram.name === 'service').id;
  const graph = (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  const previewResponse = await request.post('/api/v1/code/project/preview', {
    data: { data: encoded, name: 'service', mode: 'folders' },
  });
  expect(previewResponse.status()).toBe(200);
  const preview = (await previewResponse.json()) as CodeImportResult;
  expect(semantic(graph)).toEqual(semantic(preview.graph));
  const mcp = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 71,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: '/code/project/preview',
          method: 'POST',
          data: { data: encoded, name: 'service', mode: 'folders' },
        },
      },
    },
  });
  const rpc = (await mcp.json()).result;
  expect(rpc.isError).toBe(false);
  expect(rpc.structuredContent.status).toBe(200);
  expect(semantic(rpc.structuredContent.body.graph)).toEqual(semantic(graph));
  expect(JSON.stringify(graph)).not.toMatch(
    /PRIVATE-PROJECT-LITERAL|PRIVATE-DOCUMENT-PARAGRAPH|PRIVATE-EXCLUDED/,
  );
  const folder = graph.nodes.find((node) => getProjectDirectory(node)?.path === 'src')!;
  const source = await (
    await request.get(`/api/v1/diagrams/${id}/evidence?nodeId=${folder.id}`)
  ).json();
  expect(source.projectDirectory).toEqual(getProjectDirectory(folder));
  expect(source.codeAnalysis).toEqual(getCodeAnalysis(graph));
  await page.locator(`.canvas-shell [data-node-id="${folder.id}"] .node-title`).click();
  await expect(page.getByLabel('Project folder details')).toContainText('TypeScript');
  await expect(page.getByLabel('Project folder details')).toContainText('2');
  await page.getByLabel('Node title', { exact: true }).fill('Application sources');
  await page.getByLabel('Node title', { exact: true }).blur();
  await page.getByLabel('Node status', { exact: true }).selectOption('done');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('.project-title-button')).toHaveText('service');
  const restored = (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  expect(restored.nodes.find((node) => node.id === folder.id)).toMatchObject({
    title: 'Application sources',
    status: 'done',
    metadata: { projectDirectory: { path: 'src', fileCount: 2 } },
  });
  const exported = await request.post('/api/v1/export', {
    data: { diagramId: id, format: 'json' },
  });
  expect(exported.status()).toBe(200);
  expect(semantic(await exported.json())).toEqual(semantic(restored));
});

test('a Markdown-only ZIP drops into the code importer on a narrow phone and shows actual internal links', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const zip = zipSync({
    'handbook/README.md': strToU8('[Delivery](operations/delivery.md)'),
    'handbook/operations/delivery.md': strToU8(
      '[Checklist](checklist.md#before-start)\n![Image](illustration.png)\n[External](https://example.com)',
    ),
    'handbook/operations/checklist.md': strToU8('# Before start\n[Home](../README.md)'),
  });
  await page.evaluate((encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'handbook.zip', { type: 'application/zip' }));
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, Buffer.from(zip).toString('base64'));
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await expect(dialog.getByLabel('Language for README.md')).toHaveValue('markdown');
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByLabel('Code preview')).toContainText('operations/delivery.md');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const region = await dialog.boundingBox();
  expect(region!.x).toBeGreaterThanOrEqual(0);
  expect(region!.width).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const graph = (await (
    await request.get(
      `/api/v1/diagrams/${diagrams.find((value: { name: string }) => value.name === 'handbook').id}`,
    )
  ).json()) as Graph;
  expect(graph.nodes).toHaveLength(3);
  expect(graph.edges).toHaveLength(3);
  expect(graph.nodes.every((node) => getCodeObject(node)?.language === 'markdown')).toBe(true);
  expect(graph.nodes.some((node) => getCodeObject(node)?.external)).toBe(false);
  expect(graph.edges.every((edge) => getCodeRelation(edge)?.kind === 'references')).toBe(true);
});

test('project preview respects read-only grants and MCP can resolve ambiguous header languages before saving', async ({
  page,
  request,
}) => {
  const input = {
    data: Buffer.from(
      zipSync({ 'project/include/types.h': strToU8('int process(int value);') }),
    ).toString('base64'),
    name: 'Header project',
    mode: 'files',
  };
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await request.post('/api/v1/code/project/preview', { data: input })).status()).toBe(422);
  const corrected = { ...input, languages: { 'include/types.h': 'c' } };
  const rpc = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 72,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/code/project/preview', method: 'POST', data: corrected },
      },
    },
  });
  expect((await rpc.json()).result.structuredContent.body.languages).toEqual(['c']);
  expect((await request.post('/api/v1/code/project/diagrams', { data: corrected })).status()).toBe(
    403,
  );
  expect(
    (await request.post('/api/v1/code/project/preview?save=true', { data: corrected })).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const created = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 73,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: { path: '/code/project/diagrams', method: 'POST', data: corrected },
      },
    },
  });
  const result = (await created.json()).result;
  expect(result.isError).toBe(false);
  expect(result.structuredContent.status).toBe(201);
  await expect(page.locator('.project-title-button')).toHaveText('Header project');
  expect(getCodeAnalysis(result.structuredContent.body)?.languages).toEqual(['c']);
});

test('an unsafe project ZIP produces a structured error and leaves the browser workspace unchanged', async ({
  request,
}) => {
  const before = await (await request.get('/api/v1/diagrams')).json();
  const data = Buffer.from(
    zipSync({ '../escape.ts': strToU8('export function escape() {}') }),
  ).toString('base64');
  const response = await request.post('/api/v1/code/project/preview', { data: { data } });
  expect(response.status()).toBe(422);
  expect((await response.json()).error).toMatch(/ZIP archive/i);
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
});

test('the 500-file project boundary stays complete while file selectors and folder visualization remain bounded', async ({
  page,
  request,
}) => {
  const files: Record<string, Uint8Array> = {};
  const imports: string[] = [];
  for (let index = 0; index < 499; index++) {
    files[`project/pkg${index % 20}/file${index}.ts`] = strToU8(
      'export function run() { return 1; }',
    );
    imports.push(`import { run as run${index} } from "./pkg${index % 20}/file${index}";`);
  }
  files['project/index.ts'] = strToU8(
    imports.join('\n') + '\nexport function entry() { return run0(); }',
  );
  const bytes = zipSync(files);
  await page
    .locator('.welcome-actions')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load ZIP project', { exact: true }).setInputFiles({
    name: 'large-project.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(bytes),
  });
  await expect(dialog.getByLabel('Loaded source files')).toContainText('500 source files');
  await expect(dialog.locator('.code-file-language')).toHaveCount(25);
  await dialog.getByLabel('Code diagram detail').selectOption('folders');
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByLabel('Code preview')).toContainText('Folders');
  const response = await request.post('/api/v1/code/project/preview', {
    data: { data: Buffer.from(bytes).toString('base64'), mode: 'folders' },
  });
  expect(response.status()).toBe(200);
  const result = (await response.json()) as CodeImportResult;
  expect(result.fileCount).toBe(500);
  expect(result.directoryCount).toBe(21);
  expect(result.unresolvedCount).toBe(0);
  expect(result.graph.nodes).toHaveLength(21);
  const root = result.graph.nodes.find((node) => getProjectDirectory(node)?.path === '.')!;
  expect(getProjectDirectory(root)?.fileCount).toBe(500);
  const importsEdges = result.graph.edges
    .map(getCodeRelation)
    .filter((edge) => edge?.kind === 'imports');
  expect(importsEdges).toHaveLength(20);
  expect(importsEdges.reduce((count, edge) => count + edge!.occurrences!, 0)).toBe(499);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find((value: { name: string }) => value.name === 'large-project').id;
  const graph = (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  expect(getCodeAnalysis(graph)?.fileCount).toBe(500);
  expect(graph.nodes).toHaveLength(21);
});
