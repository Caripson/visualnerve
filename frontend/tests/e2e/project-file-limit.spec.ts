import { strToU8, zipSync } from 'fflate';
import { resolve } from 'node:path';
import { captureAppearancePair } from './capture-appearance';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getCodeAnalysis, getProjectDirectory } from '../../src/code/schema';

const archive = zipSync(
  Object.fromEntries(
    Array.from({ length: 501 }, (_, index) => [`project/src/file${index}.py`, strToU8('pass')]),
  ),
);
const input = {
  name: 'Many sources',
  data: Buffer.from(archive).toString('base64'),
  mode: 'folders',
};

async function settings(page: Page) {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}
async function mcp(request: APIRequestContext, method: 'GET' | 'PUT', value?: number) {
  const response = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 501,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: '/settings/project-source-file-limit',
          method,
          ...(value === undefined ? {} : { data: { value } }),
        },
      },
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).result;
}

test('a 501-file ZIP fails by default, uses the saved UI/API/MCP count, and retains larger saved metadata after reset', async ({
  page,
  request,
}) => {
  const capabilities = await (await request.get('/api/v1/code/capabilities')).json();
  expect(capabilities).toMatchObject({
    sourceFiles: { maximum: 500 },
    zipProjects: {
      maximumEntries: 10000,
      sourceFileLimit: { default: 500, minimum: 500, maximum: 10000 },
    },
    byteLimit: { default: 50 * 1024 * 1024 },
    analysis: { maximumNodes: 5000 },
  });
  expect(await (await request.get('/api/v1/settings/project-source-file-limit')).json()).toBe(500);
  await page
    .locator('.welcome-actions')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  let dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load ZIP project', { exact: true }).setInputFiles({
    name: 'many-sources.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  });
  await expect(dialog.getByRole('alert')).toContainText('more than 500 analyzable files');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  const rejected = await request.post('/api/v1/code/project/preview', { data: input });
  expect(rejected.status()).toBe(422);
  expect(JSON.stringify(await rejected.json())).toContain('more than 500 analyzable files');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  const preferences = await settings(page);
  const field = preferences.getByRole('spinbutton', {
    name: 'Maximum analyzed source files in a ZIP project',
    exact: true,
  });
  await expect(field).toHaveValue('500');
  await field.fill('1000');
  await expect(preferences.getByTestId('project-file-limit-warning')).toContainText('experimental');
  await preferences.getByRole('button', { name: 'Save ZIP file limit', exact: true }).click();
  await expect(
    preferences.getByTestId('project-file-limit-settings').getByRole('status'),
  ).toContainText('saved for this browser');
  expect(await (await request.get('/api/v1/settings/project-source-file-limit')).json()).toBe(1000);
  const current = await mcp(request, 'GET');
  expect(current.isError).toBe(false);
  expect(current.structuredContent).toMatchObject({ status: 200, body: 1000 });
  if (process.env.VN_CAPTURE_PROJECT === '1') {
    await preferences.getByTestId('project-file-limit-settings').scrollIntoViewIfNeeded();
    await captureAppearancePair(
      preferences,
      resolve('../hugo/static/help/images'),
      'project-file-limit',
    );
  }
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();

  await page
    .locator('.welcome-actions')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load ZIP project', { exact: true }).setInputFiles({
    name: 'many-sources.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  });
  await expect(dialog.getByLabel('Project scan summary')).toContainText(
    'Captured ZIP project source-file limit: 1,000 files',
  );
  await expect(dialog.getByTestId('project-import-file-warning')).toContainText('experimental');
  await dialog.getByLabel('Code diagram name').fill(input.name);
  await dialog.getByLabel('Code diagram detail').selectOption('folders');
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  await expect(dialog.getByLabel('Code preview')).toContainText('501');
  await expect(dialog.getByTestId('project-import-file-warning')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find((entry: { name: string }) => entry.name === input.name).id;
  const saved = (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  expect(getCodeAnalysis(saved)).toMatchObject({
    fileCount: 501,
    mode: 'folders',
    project: { sourceFileLimit: 1000 },
  });
  expect(saved.nodes).toHaveLength(2);
  expect(saved.nodes.map(getProjectDirectory).map((directory) => directory?.fileCount)).toEqual([
    501, 501,
  ]);

  const reset = await settings(page);
  await reset
    .getByLabel('Maximum analyzed source files in a ZIP project', { exact: true })
    .fill('500');
  await reset.getByRole('button', { name: 'Save ZIP file limit', exact: true }).click();
  await expect(reset.getByTestId('project-file-limit-warning')).toHaveCount(0);
  await reset.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('.project-title-button')).toHaveText(input.name);
  expect(await (await request.get('/api/v1/settings/project-source-file-limit')).json()).toBe(500);
  const reloaded = (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  expect(getCodeAnalysis(reloaded)).toEqual(getCodeAnalysis(saved));
  expect(reloaded.nodes.map(getProjectDirectory)).toEqual(saved.nodes.map(getProjectDirectory));

  const reopenedSettings = await settings(page);
  expect((await mcp(request, 'PUT', 1000)).isError).toBe(false);
  await expect(
    reopenedSettings.getByLabel('Maximum analyzed source files in a ZIP project', { exact: true }),
  ).toHaveValue('1000');
  await expect(reopenedSettings.getByTestId('project-file-limit-warning')).toBeVisible();
  expect((await mcp(request, 'PUT', 500)).isError).toBe(false);
  await expect(
    reopenedSettings.getByLabel('Maximum analyzed source files in a ZIP project', { exact: true }),
  ).toHaveValue('500');
});
