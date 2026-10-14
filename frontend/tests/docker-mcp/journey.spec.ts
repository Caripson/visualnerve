import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mcpDockerTarget } from '../../../scripts/mcp-docker/config.mjs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acknowledge } from '../e2e/fixtures';

const container = process.env.VN_MCP_TEST_CONTAINER;
const token = 'docker-chrome-fixture-token-47417';
const password = 'Disposable Docker Chrome test workspace password';
const target = mcpDockerTarget();
const artifacts = resolve(`../tmp/verification/docker-mcp${target.hosted ? '-staging' : ''}`);

function docker(
  args: string[],
  input: string | string[] = '',
  waitForLine = false,
): Promise<string> {
  if (!container) throw new Error('Set VN_MCP_TEST_CONTAINER to the isolated harness container.');
  return new Promise((resolve, reject) => {
    const process = spawn('docker', ['exec', '-i', container, ...args]);
    let output = '',
      error = '';
    const pending = Array.isArray(input) ? [...input] : [input];
    let received = 0;
    const timeout = setTimeout(() => process.kill(), 45000);
    process.stdout.on('data', (chunk) => {
      output += chunk;
      if (waitForLine) {
        const lines = output.split('\n').length - 1;
        while (received < lines) {
          received++;
          const next = pending.shift();
          if (next === undefined) process.stdin.end();
          else process.stdin.write(next);
        }
      }
    });
    process.stderr.on('data', (chunk) => {
      error += chunk;
    });
    process.on('error', reject);
    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Docker test command exited ${code}: ${error}`));
      else resolve(output);
    });
    if (waitForLine) process.stdin.write(pending.shift());
    else process.stdin.end(pending.join(''));
  });
}

async function client(input?: unknown, args: string[] = []) {
  return JSON.parse(
    await docker(
      ['python', '/harness/client.py', ...args],
      input === undefined ? '' : JSON.stringify(input),
    ),
  );
}

async function rpc(method: string, params?: unknown, port = 47417) {
  const response = await client({ method, params }, ['--port', String(port)]);
  expect(response.status, JSON.stringify(response)).toBe(200);
  expect(response.body.error).toBeUndefined();
  return response.body.result;
}

async function command(
  path: string,
  method = 'GET',
  data?: unknown,
  operationId?: string,
  port = 47417,
) {
  return rpc(
    'tools/call',
    {
      name: 'visual_nerve_request',
      arguments: {
        path,
        method,
        ...(data === undefined ? {} : { data }),
        ...(operationId ? { operationId } : {}),
      },
    },
    port,
  );
}

test('a Linux MCP client and real Chrome share one workspace across bridge upgrades', async ({
  page,
  context,
  browser,
  request,
}) => {
  await mkdir(artifacts, { recursive: true });
  for (const file of [
    'result.json',
    'copied-instructions.txt',
    'chrome-settings-connected.png',
    'chrome-settings-upgraded.png',
    'chrome-mcp-diagram.png',
  ])
    await rm(resolve(artifacts, file), { force: true });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    container,
    status: 'running',
    target,
    chrome: browser.version(),
    checks: [] as string[],
  };
  const checked = (name: string) => (evidence.checks as string[]).push(name);
  const pageErrors: string[] = [];
  const violations: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (/violates.*Content Security Policy|Refused to connect/i.test(message.text()))
      violations.push(message.text());
  });

  let vaultRequired = false;
  let completed = false;
  try {
    await test.step('Verify the served build, onboard through the actual UI, and copy Settings instructions', async () => {
      await docker(['python', '/harness/control.py', 'stop']);
      expect((await client(undefined, ['--health'])).status).toBe(0);
      const entry = await request.get(
        new URL('/editor/app.js', target.hosted ? target.origin : 'https://127.0.0.1:4342').href,
      );
      expect(entry.ok()).toBe(true);
      const entrySha256 = createHash('sha256')
        .update(await entry.body())
        .digest('hex');
      evidence.entrySha256 = entrySha256;
      if (target.expectedEntrySha256) expect(entrySha256).toBe(target.expectedEntrySha256);
      // The revision is supplied from the reviewed deployment workflow; the
      // actual entry hash, not an invented page commit field, pins served code.
      evidence.revisionSource = target.expectedRevision
        ? 'caller-supplied reviewed workflow'
        : null;
      if (target.hosted) {
        // Chromium's origin-specific grant shadows the initial wildcard grant.
        // Include clipboard access so the real Settings copy action stays testable.
        await context.grantPermissions(
          ['clipboard-read', 'clipboard-write', 'local-network-access'],
          { origin: target.origin },
        );
        evidence.localNetworkPermission =
          'granted to the exact staging origin by the isolated test context';
      }
      const browserEntryResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/editor/app.js',
      );
      const response = await page.goto(target.appUrl);
      expect(response?.ok()).toBe(true);
      const browserEntry = await browserEntryResponse;
      expect(browserEntry.ok()).toBe(true);
      const browserEntrySha256 = createHash('sha256')
        .update(await browserEntry.body())
        .digest('hex');
      expect(browserEntrySha256).toBe(entrySha256);
      evidence.browserEntrySha256 = browserEntrySha256;
      const headerPolicy = response!.headers()['content-security-policy'] ?? null;
      const metaPolicy = await page.evaluate(
        () =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') ?? null,
      );
      evidence.csp = { header: headerPolicy, meta: metaPolicy };
      if (!target.hosted) expect(headerPolicy).toContain('ws://127.0.0.1:47417');
      for (const policy of [headerPolicy, metaPolicy])
        if (policy) {
          expect(policy).toContain('ws://127.0.0.1:47417');
          expect(policy).toContain('ws://127.0.0.1:4317');
        }
      vaultRequired = await page.evaluate(
        () =>
          document
            .querySelector('meta[name="visualnerve-vault-required"]')
            ?.getAttribute('content') === 'true',
      );
      evidence.storageSurface = vaultRequired
        ? 'isolated encrypted workspace'
        : 'legacy staging local-storage consent';
      if (!target.hosted) expect(vaultRequired).toBe(true);
      if (vaultRequired) {
        await page.getByLabel('New workspace password', { exact: true }).fill(password);
        await page.getByLabel('Confirm new password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
        await page.getByLabel('I have saved my recovery key in a protected location.').check();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await acknowledge(page);
      await page
        .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
        .click();
      await expect(page.getByLabel('MCP access', { exact: true })).toHaveValue('off');
      await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
        'http://127.0.0.1:47417/mcp',
      );
      await page.getByText('Instructions for your MCP client', { exact: true }).click();
      const rendered = await page
        .getByLabel('Connection instructions', { exact: true })
        .inputValue();
      await page.getByRole('button', { name: 'Copy MCP instructions', exact: true }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(rendered);
      expect(copied).toContain(`--allowed-origin ${target.origin}`);
      expect(copied).toContain('http://127.0.0.1:47417/api/v1/health');
      expect(copied).toContain('/downloads/visual-nerve-bridge-setup.sh');
      expect(copied).toContain('bash ./visual-nerve-bridge-setup.sh');
      expect(copied).not.toContain(password);
      expect(copied).not.toContain(token);
      await writeFile(resolve(artifacts, 'copied-instructions.txt'), copied);
      checked(
        'Actual UI onboarding, default47417, exact origin, real credential-free clipboard instructions',
      );
    });

    await test.step('Start native Linux bridge, validate both network sides, and discover MCP documentation', async () => {
      await docker(['python', '/harness/control.py', 'start']);
      await expect.poll(async () => (await client(undefined, ['--health'])).status).toBe(200);
      const linuxHealth = await client(undefined, ['--health']);
      expect(linuxHealth.body).toMatchObject({
        status: 'ok',
        storage: 'indexeddb',
        bridge: true,
        connected: 0,
      });
      expect(linuxHealth.body.capabilities).toEqual(
        expect.arrayContaining(['operations-v1', 'endpoint-docs-v1']),
      );
      const hostHealth = await request.get('http://127.0.0.1:47417/api/v1/health');
      expect(hostHealth.status()).toBe(200);
      expect(await hostHealth.json()).toEqual(linuxHealth.body);
      const legacyLinuxHealth = await client(undefined, ['--health', '--port', '4317']);
      const legacyHostHealth = await request.get('http://127.0.0.1:4317/api/v1/health');
      expect(legacyLinuxHealth).toEqual(linuxHealth);
      expect(legacyHostHealth.status()).toBe(200);
      expect(await legacyHostHealth.json()).toEqual(linuxHealth.body);
      const initialized = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'docker-chrome-user-journey', version: '1.0' },
      });
      evidence.bridge = initialized.serverInfo;
      expect(initialized.instructions).toContain('visual_nerve_api_docs');
      expect(await client({ method: 'notifications/initialized' })).toEqual({
        status: 202,
        body: null,
      });
      const tools = (await rpc('tools/list')).tools.map((tool: { name: string }) => tool.name);
      expect(tools).toEqual(['visual_nerve_request', 'visual_nerve_api_docs']);
      const guide = await rpc('tools/call', {
        name: 'visual_nerve_api_docs',
        arguments: { document: 'guide' },
      });
      expect(guide.isError).toBe(false);
      expect(guide.content[0].text).toContain('/spatial-diagrams');
      const endpoint = await rpc('tools/call', {
        name: 'visual_nerve_api_docs',
        arguments: { document: 'endpoint', path: '/nodes/{nodeId}', method: 'PATCH' },
      });
      expect(endpoint.isError).toBe(false);
      expect(endpoint.content[0].text).toContain('version');
      // Native stdio clients use the same documented adapter and HTTP service.
      const stdio = await docker(
        ['env', `VISUAL_NERVE_BRIDGE_TOKEN=${token}`, '/bridge/visual-nerve', '--mcp-stdio'],
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'stdio-fixture', version: '1' },
          },
        }) + '\n',
        true,
      );
      expect(JSON.parse(stdio.trim()).result.serverInfo).toEqual(initialized.serverInfo);
      expect((await command('/diagrams')).structuredContent.status).toBe(503);
      expect((await client({ method: 'tools/list' }, ['--no-token'])).status).toBe(401);
      expect(
        (await client({ method: 'tools/list' }, ['--token', 'wrong-fixture-token'])).status,
      ).toBe(401);
      expect(
        (await client({ method: 'tools/list' }, ['--origin', 'https://untrusted.invalid'])).status,
      ).toBe(403);
      checked(
        'Linux and host health, HTTP+stdio MCP, tools/guide/endpoint discovery, token and origin enforcement, Off503',
      );
    });

    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    const access = page.getByLabel('MCP access', { exact: true });
    const live = async (value: 'read' | 'write') => {
      await expect(access).toHaveValue(value);
      await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const result = await command('/settings/mcp-access');
          return { status: result.structuredContent.status, value: result.structuredContent.body };
        })
        .toEqual({ status: 200, value });
    };
    const settings = () =>
      page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
    const done = () => page.getByRole('button', { name: 'Done', exact: true }).click();
    let diagramId = '',
      nodeId = '';

    await test.step('Grant read access and then write access in Settings without reloading', async () => {
      await page.getByText('Local connection details', { exact: true }).click();
      await expect(page.getByLabel('Local bridge address', { exact: true })).toHaveValue(
        'ws://127.0.0.1:47417/bridge',
      );
      // Save an older browser connection through Settings, never by injecting storage.
      await page
        .getByLabel('Local bridge address', { exact: true })
        .fill('ws://127.0.0.1:4317/bridge');
      await page.getByLabel('Integration token', { exact: true }).fill(token);
      await page.getByRole('button', { name: 'Save connection', exact: true }).click();
      await expect(
        page.getByText(
          'Connection saved with MCP Off. Check the bridge token if required, choose Read only or Read + write, and copy the updated MCP instructions.',
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
        'http://127.0.0.1:4317/mcp',
      );
      await access.selectOption('read');
      await live('read');
      expect((await command('/diagrams')).structuredContent.body).toEqual([]);
      expect(
        (await command('/diagrams', 'GET', undefined, undefined, 4317)).structuredContent.body,
      ).toEqual([]);
      expect(
        (await command('/diagrams', 'POST', { name: 'Must be denied', type: 'flowchart' }))
          .structuredContent.status,
      ).toBe(403);
      await access.selectOption('write');
      await live('write');
      await page.getByRole('button', { name: 'Copy MCP instructions', exact: true }).click();
      const configuredInstructions = await page.evaluate(() => navigator.clipboard.readText());
      expect(configuredInstructions).not.toContain(token);
      expect(configuredInstructions).not.toContain(password);
      // Keep screenshots free of the optional synthetic token field.
      await page.getByText('Local connection details', { exact: true }).click();
      await page.getByText('Instructions for your MCP client', { exact: true }).click();
      await page.screenshot({ path: resolve(artifacts, 'chrome-settings-connected.png') });
      await done();
      checked(
        'Saved browser4317 and client47417 share grants, Off→Read→Write without reload, read-only write403',
      );
    });

    await test.step('Create via MCP, recover the same operation, and edit both ways', async () => {
      const reservation = await command('/operations', 'POST', {});
      const operationId = reservation.structuredContent.body.operationId;
      const input = { name: 'Docker + Chrome workflow', type: 'flowchart' };
      const created = await command('/diagrams', 'POST', input, operationId);
      expect(created.structuredContent.status).toBe(201);
      diagramId = created.structuredContent.body.id;
      const retry = await command('/diagrams', 'POST', input, operationId, 4317);
      expect(retry.structuredContent.body.id).toBe(diagramId);
      expect((await command('/diagrams')).structuredContent.body).toHaveLength(1);
      const bulk = await command(`/diagrams/${diagramId}/bulk`, 'POST', {
        nodes: [
          {
            externalId: 'input',
            title: 'Request received',
            nodeType: 'process',
            flowchartSymbol: 'ibm-process',
            backgroundColor: '#DBEDE5',
            x: 100,
            y: 180,
          },
          {
            externalId: 'review',
            title: 'Review request',
            nodeType: 'process',
            flowchartSymbol: 'ibm-decision',
            backgroundColor: '#F3E4C7',
            x: 480,
            y: 180,
          },
        ],
        edges: [
          {
            sourceExternalId: 'input',
            targetExternalId: 'review',
            edgeType: 'flow',
            label: 'Ready to review',
          },
        ],
      });
      expect(bulk.structuredContent.status).toBe(200);
      expect(bulk.structuredContent.body.edges).toHaveLength(1);
      const node = bulk.structuredContent.body.nodes.find(
        (value: { externalId: string }) => value.externalId === 'input',
      );
      nodeId = node.id;
      await page.locator('.diagram-item').filter({ hasText: input.name }).click();
      await expect(page.locator(`[data-node-id="${nodeId}"] .node-title`)).toHaveText(node.title);
      const patch = await command(`/nodes/${nodeId}`, 'PATCH', {
        version: node.version,
        title: 'Created by Linux MCP client',
      });
      expect(patch.structuredContent.status).toBe(200);
      await expect(page.locator(`[data-node-id="${nodeId}"] .node-title`)).toHaveText(
        'Created by Linux MCP client',
      );
      expect(
        (
          await command(`/nodes/${nodeId}`, 'PATCH', {
            version: node.version,
            title: 'Stale must fail',
          })
        ).structuredContent.status,
      ).toBe(409);
      // Keep the adapter's stdin open and wait for each response before sending
      // another frame. EOF correctly cancels unfinished native adapter requests.
      const stdioFrames = [
        {
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'stdio-upgrade-fixture', version: '1' },
          },
        },
        {
          method: 'tools/call',
          params: {
            name: 'visual_nerve_request',
            arguments: { path: `/nodes/${nodeId}`, method: 'GET' },
          },
        },
        {
          method: 'tools/call',
          params: {
            name: 'visual_nerve_request',
            arguments: {
              path: `/nodes/${nodeId}`,
              method: 'PATCH',
              data: {
                version: patch.structuredContent.body.version,
                title: 'Edited through native stdio',
              },
            },
          },
        },
      ].map((frame, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...frame }) + '\n');
      stdioFrames[1] =
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
        '\n' +
        stdioFrames[1];
      const stdioReplies = (
        await docker(
          ['env', `VISUAL_NERVE_BRIDGE_TOKEN=${token}`, '/bridge/visual-nerve', '--mcp-stdio'],
          stdioFrames,
          true,
        )
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(stdioReplies).toHaveLength(3);
      expect(stdioReplies[1].result.structuredContent.body.title).toBe(
        'Created by Linux MCP client',
      );
      expect(stdioReplies[2].result.structuredContent.status).toBe(200);
      await expect(page.locator(`[data-node-id="${nodeId}"] .node-title`)).toHaveText(
        'Edited through native stdio',
      );
      await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
      await page.locator(`[data-node-id="${nodeId}"] .node-title`).dblclick();
      await page.locator('.node-title-input').fill('Reviewed in Chrome');
      await page.locator('.node-title-input').press('Enter');
      await expect
        .poll(async () => (await command(`/nodes/${nodeId}`)).structuredContent.body.title)
        .toBe('Reviewed in Chrome');
      await page.locator('.react-flow__pane').click({ position: { x: 24, y: 100 } });
      await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
      await page.screenshot({ path: resolve(artifacts, 'chrome-mcp-diagram.png') });
      checked(
        'MCP graph and edge creation, cross-port operation retry creates1document, version conflict409, UI↔MCP edits',
      );
    });

    await test.step('Explicitly upgrade the saved port with fresh human authorization', async () => {
      await settings();
      await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
        'http://127.0.0.1:4317/mcp',
      );
      await page.getByRole('button', { name: 'Use port 47417', exact: true }).click();
      await expect(access).toHaveValue('off');
      await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
        'http://127.0.0.1:47417/mcp',
      );
      await expect
        .poll(async () => (await command('/diagrams')).structuredContent.status)
        .toBe(503);
      await page.getByText('Local connection details', { exact: true }).click();
      await expect(page.getByLabel('Integration token', { exact: true })).toHaveValue('');
      await expect(page.getByLabel('Local bridge address', { exact: true })).toHaveValue(
        'ws://127.0.0.1:47417/bridge',
      );
      await page.getByLabel('Integration token', { exact: true }).fill(token);
      await page.getByRole('button', { name: 'Save connection', exact: true }).click();
      await access.selectOption('write');
      await live('write');
      expect(
        (await command(`/nodes/${nodeId}`, 'GET', undefined, undefined, 4317)).structuredContent
          .body.title,
      ).toBe('Reviewed in Chrome');
      await page.getByText('Local connection details', { exact: true }).click();
      await page.getByLabel('MCP server URL', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(artifacts, 'chrome-settings-upgraded.png') });
      await done();
      expect(navigations).toBe(0);
      checked(
        'Explicit4317→47417 resets Off and token, fresh grant reconnects without reload, same graph through both aliases',
      );
    });

    await test.step('Restart the owned bridge and recover without page reload', async () => {
      await settings();
      await docker(['python', '/harness/control.py', 'stop']);
      await expect(page.getByText('MCP connection: Connected', { exact: true })).toBeHidden();
      await docker(['python', '/harness/control.py', 'start']);
      await live('write');
      expect((await command(`/nodes/${nodeId}`)).structuredContent.body.title).toBe(
        'Reviewed in Chrome',
      );
      await access.selectOption('read');
      await live('read');
      expect(
        (
          await command(`/diagrams/${diagramId}/nodes`, 'POST', {
            title: 'Forbidden after downgrade',
          })
        ).structuredContent.status,
      ).toBe(403);
      await access.selectOption('off');
      await expect
        .poll(async () => (await command('/diagrams')).structuredContent.status)
        .toBe(503);
      await access.selectOption('write');
      await live('write');
      await done();
      expect(navigations).toBe(0);
      checked(
        'Real bridge restart reconnects without navigation, immediate downgrade403 and Off503',
      );
    });

    if (vaultRequired)
      await test.step('A human lock revokes content, and unlock requires a fresh grant', async () => {
        await settings();
        await page.getByRole('button', { name: 'Lock now', exact: true }).click();
        await expect(
          page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
        ).toBeVisible();
        expect((await command('/diagrams')).structuredContent.status).toBe(423);
        await page.getByLabel('Workspace password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Unlock', exact: true }).click();
        expect((await command(`/nodes/${nodeId}`)).structuredContent.status).toBe(403);
        await settings();
        await expect(access).toHaveValue('off');
        await access.selectOption('read');
        await live('read');
        expect((await command(`/nodes/${nodeId}`)).structuredContent.body.title).toBe(
          'Reviewed in Chrome',
        );
        await done();
        evidence.lockVerification = 'passed: human lock423 and fresh grant after unlock';
        checked(
          'Human UI lock423, unlock remains revoked403, fresh human grant restores saved data',
        );
      });

    await test.step('Reload preserves work and the selected port on the actual storage surface', async () => {
      if (!vaultRequired) {
        // Legacy staging does not promise the isolated vault's session semantics.
        // Persist an explicit Off choice before reloading and verify it remains Off.
        await settings();
        await access.selectOption('off');
        await expect
          .poll(async () => (await command('/diagrams')).structuredContent.status)
          .toBe(503);
        await done();
        evidence.lockVerification =
          'not applicable: served legacy staging surface has no vault gate';
      }
      await page.reload();
      if (vaultRequired) {
        await expect(
          page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
        ).toBeVisible();
        await page.getByLabel('Workspace password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Unlock', exact: true }).click();
      }
      await expect(page.locator(`[data-node-id="${nodeId}"] .node-title`)).toHaveText(
        'Reviewed in Chrome',
      );
      await settings();
      await expect(access).toHaveValue('off');
      await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveValue(
        'http://127.0.0.1:47417/mcp',
      );
      await access.selectOption('read');
      await live('read');
      expect((await command(`/diagrams/${diagramId}`)).structuredContent.body.nodes).toHaveLength(
        2,
      );
      await done();
      expect(pageErrors).toEqual([]);
      expect(violations).toEqual([]);
      checked('Reload preserves graph and pinned port, explicit Off retained, no page/CSP errors');
      await context.close();
      await expect
        .poll(async () => (await command('/diagrams')).structuredContent.status)
        .toBe(503);
      checked('Closed browser503: no shadow server workspace');
    });
    completed = true;
  } finally {
    evidence.status = completed ? 'passed' : 'failed';
    evidence.finishedAt = new Date().toISOString();
    evidence.diagnostics = { pageErrors: pageErrors.length, cspViolations: violations.length };
    await context.close();
    evidence.browserContextClosed = true;
    await writeFile(resolve(artifacts, 'result.json'), JSON.stringify(evidence, null, 2));
  }
});
