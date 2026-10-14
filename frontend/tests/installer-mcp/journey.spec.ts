import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mcpDockerTarget } from '../../../scripts/mcp-docker/config.mjs';
import { acknowledge } from '../e2e/fixtures';

const execute = promisify(execFile);
const evidencePath = resolve('../tmp/verification/bridge-installer-linux/result.json');
const artifacts = resolve('../tmp/verification/bridge-installer-chrome');
const target = mcpDockerTarget();
const password = 'Disposable installer browser workspace password';

// This test deliberately consumes a successful fresh-install harness result.
// It never builds, copies or substitutes a precompiled bridge executable.
test('freshly installed Linux bridge connects to Chrome and controls the human-granted workspace', async ({
  page,
  context,
  browser,
  request,
}) => {
  const installation = JSON.parse(await readFile(evidencePath, 'utf8'));
  expect(installation.passed).toBe(true);
  const retained = installation.retained;
  if (!retained?.container || !retained?.installDir)
    throw new Error('Run scripts/bridge-installer-tests/run.sh with VN_INSTALL_TEST_KEEP=1 first.');
  const docker = async (...args: string[]) =>
    (await execute('docker', ['exec', retained.container, ...args], { maxBuffer: 2 * 1024 * 1024 }))
      .stdout;
  const before = JSON.parse(await docker('cat', `${retained.installDir}/state.json`));
  expect(before.sourceSha256).toBe(installation.sourceSha256);
  await mkdir(artifacts, { recursive: true });
  const evidence: Record<string, unknown> = {
    status: 'running',
    startedAt: new Date().toISOString(),
    chrome: browser.version(),
    installationEvidence: evidencePath,
    sourceSha256: before.sourceSha256,
    bridgeExecutable: before.executable,
    target,
    checks: [] as string[],
    limitations: ['Docker Linux amd64 and host Chrome; not a Windows/WSL networking test.'],
  };
  const checked = (text: string) => (evidence.checks as string[]).push(text);
  let id = 0;
  const rpc = async (method: string, params?: unknown) => {
    // Requests originate in the freshly provisioned Linux container as they do in WSL.
    const raw = await docker(
      'wget',
      '--quiet',
      '--output-document=-',
      '--header=Content-Type: application/json',
      '--header=Accept: application/json, text/event-stream',
      `--post-data=${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}`,
      'http://127.0.0.1:47417/mcp',
    );
    const response = JSON.parse(raw);
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const command = (path: string, method = 'GET', data?: unknown, operationId?: string) =>
    rpc('tools/call', {
      name: 'visual_nerve_request',
      arguments: {
        path,
        method,
        ...(data === undefined ? {} : { data }),
        ...(operationId ? { operationId } : {}),
      },
    });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const hostHealth = await request.get('http://127.0.0.1:47417/api/v1/health');
    expect(hostHealth.ok()).toBe(true);
    const linuxHealth = JSON.parse(
      await docker(
        'wget',
        '--quiet',
        '--output-document=-',
        'http://127.0.0.1:47417/api/v1/health',
      ),
    );
    expect(await hostHealth.json()).toEqual(linuxHealth);
    expect(linuxHealth).toMatchObject({
      status: 'ok',
      storage: 'indexeddb',
      bridge: true,
      connected: 0,
    });
    checked(
      'Installed native binary has matching health from Linux client and host Chrome network',
    );
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fresh-installer-chrome', version: '1' },
    });
    evidence.bridge = initialized.serverInfo;
    expect((await rpc('tools/list')).tools.map((tool: { name: string }) => tool.name)).toEqual([
      'visual_nerve_request',
      'visual_nerve_api_docs',
    ]);
    const guide = await rpc('tools/call', {
      name: 'visual_nerve_api_docs',
      arguments: { document: 'guide' },
    });
    expect(guide.isError).toBe(false);
    expect(guide.content[0].text).toContain('/downloads/visual-nerve-bridge-setup.sh');
    const endpoint = await rpc('tools/call', {
      name: 'visual_nerve_api_docs',
      arguments: { document: 'endpoint', path: '/nodes/{nodeId}', method: 'PATCH' },
    });
    expect(endpoint.isError).toBe(false);
    checked('MCP initialization, tool discovery, bundled guide and generated endpoint contract');
    expect((await command('/diagrams')).structuredContent.status).toBe(503);
    await docker(
      'bash',
      '/tmp/visual-nerve-bridge-setup.sh',
      '--install-dir',
      retained.installDir,
      '--stop',
    );
    if (target.hosted)
      await context.grantPermissions(
        ['clipboard-read', 'clipboard-write', 'local-network-access'],
        { origin: target.origin },
      );
    const entry = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/editor/app.js',
    );
    await page.goto(target.appUrl);
    evidence.entrySha256 = createHash('sha256')
      .update(await (await entry).body())
      .digest('hex');
    const encrypted = await page.evaluate(
      () =>
        document
          .querySelector('meta[name="visualnerve-vault-required"]')
          ?.getAttribute('content') === 'true',
    );
    if (encrypted) {
      await page.getByLabel('New workspace password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
      await page.getByLabel('I have saved my recovery key in a protected location.').check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await acknowledge(page);
    const settings = () =>
      page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
    await settings();
    const access = page.getByLabel('MCP access', { exact: true });
    await expect(access).toHaveValue('off');
    await page.getByText('Instructions for your MCP client', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy MCP instructions', exact: true }).click();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('/downloads/visual-nerve-bridge-setup.sh');
    expect(prompt).toContain(`--origin '${target.origin}'`);
    expect(prompt).not.toContain(password);
    await writeFile(resolve(artifacts, 'copied-instructions.txt'), prompt);
    checked(
      'Human UI onboarding and actual clipboard prompt contain installer and exact selected origin',
    );
    await access.selectOption('read');
    await expect(access).toHaveValue('read');
    // Start after the browser's human grant, as when the user pastes Settings
    // instructions into an agent while no bridge is running. No reload follows.
    await docker(
      'bash',
      '/tmp/visual-nerve-bridge-setup.sh',
      '--install-dir',
      retained.installDir,
      '--origin',
      target.origin,
      '--addr',
      '127.0.0.1:47417',
    );
    await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
    await expect.poll(async () => (await command('/diagrams')).structuredContent.status).toBe(200);
    expect(
      (await command('/diagrams', 'POST', { name: 'Denied fixture', type: 'flowchart' }))
        .structuredContent.status,
    ).toBe(403);
    await access.selectOption('write');
    await expect
      .poll(async () => (await command('/settings/mcp-access')).structuredContent.body)
      .toBe('write');
    await page.getByText('Instructions for your MCP client', { exact: true }).click();
    await page.screenshot({ path: resolve(artifacts, 'settings-connected.png') });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const operation = (await command('/operations', 'POST', {})).structuredContent.body.operationId;
    const input = { name: 'Installed from scratch', type: 'flowchart' };
    const created = await command('/diagrams', 'POST', input, operation);
    expect(created.structuredContent.status).toBe(201);
    expect((await command('/diagrams', 'POST', input, operation)).structuredContent.body.id).toBe(
      created.structuredContent.body.id,
    );
    const diagramId = created.structuredContent.body.id;
    const node = await command(`/diagrams/${diagramId}/nodes`, 'POST', {
      title: 'Linux to Chrome',
      nodeType: 'process',
      x: 100,
      y: 100,
    });
    expect(node.structuredContent.status).toBe(201);
    await page.locator('.diagram-item').filter({ hasText: input.name }).click();
    await expect(
      page.locator(`[data-node-id="${node.structuredContent.body.id}"] .node-title`),
    ).toHaveText('Linux to Chrome');
    await page.screenshot({ path: resolve(artifacts, 'mcp-created-diagram.png') });
    checked(
      'Installer starts after human grant without reload; read/write grants, read-only rejection, MCP diagram/node visible in UI, idempotent operation receipt',
    );
    await settings();
    await access.selectOption('off');
    await expect.poll(async () => (await command('/diagrams')).structuredContent.status).toBe(503);
    expect(errors).toEqual([]);
    checked('Explicit Off disconnects content access without page reload; no page errors');
    evidence.status = 'passed';
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.pageErrors = errors;
    await writeFile(resolve(artifacts, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
