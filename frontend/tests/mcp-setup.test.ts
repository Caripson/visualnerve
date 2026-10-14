import { expect, it } from 'vitest';
import { mcpServerUrl, mcpSetupNote } from '../src/integration/setup';

it.each([
  ['ws://127.0.0.1:47417/bridge', 'http://127.0.0.1:47417/mcp'],
  ['ws://127.0.0.1:4317/bridge', 'http://127.0.0.1:4317/mcp'],
  ['wss://localhost:9443/bridge', 'https://localhost:9443/mcp'],
  ['wss://[::1]:4329/bridge', 'https://[::1]:4329/mcp'],
])('derives the MCP endpoint from the validated local browser connection %s', (bridge, server) => {
  expect(mcpServerUrl(bridge)).toBe(server);
});

it('keeps staging roles exact and discovers features through the MCP guide instead of copying a feature catalog', () => {
  const note = mcpSetupNote('https://visualnerve.caripson.com', 'wss://localhost:9443/bridge');
  expect(note).toContain('Browser workspace: https://visualnerve.caripson.com/app/');
  expect(note).toContain('Keep this workspace open');
  expect(note).toContain('API reference: https://visualnerve.caripson.com/api/docs/');
  expect(note).toContain('MCP server on this computer: https://localhost:9443/mcp');
  expect(note).toContain('--allowed-origin https://visualnerve.caripson.com');
  expect(note).toContain('First call visual_nerve_api_docs with {"document":"guide"}');
  expect(note).toContain('"document":"endpoint"');
  expect(note).toContain('document:"openapi"');
  expect(note).toContain('Discover features there');
  expect(note).toContain('POST /spatial-diagrams');
  expect(note).toContain('type:"process-simulator"');
  expect(note).toContain('paths omit /api/v1');
  expect(note).toContain('OPERATION_OUTCOME_UNKNOWN');
  expect(note).toContain('never blindly retry with a new ID');
  expect(note).not.toContain('Counter 1/2/3');
});

it.each([
  'https://app.visualnerve.com',
  'https://www.visualnerve.com/app/',
  'https://visualnerve.com',
])('uses the sole production app root and its exact allowed origin for %s', (origin) => {
  const note = mcpSetupNote(origin, 'ws://127.0.0.1:4317/bridge');
  expect(note).toContain('Browser workspace: https://app.visualnerve.com/\n');
  expect(note).toContain('API reference: https://app.visualnerve.com/api/docs/');
  expect(note).toContain('--allowed-origin https://app.visualnerve.com\n');
  expect(note).not.toContain('visualnerve.com/app/');
});

it('uses the root of an encrypted preview surface without inventing an /app alias', () => {
  const note = mcpSetupNote(
    'https://app-preview.visualnerve.example',
    'ws://127.0.0.1:4317/bridge',
    true,
  );
  expect(note).toContain('Browser workspace: https://app-preview.visualnerve.example/\n');
  expect(note).toContain('--allowed-origin https://app-preview.visualnerve.example\n');
  expect(note).toContain(
    'https://app-preview.visualnerve.example/downloads/visual-nerve-bridge-setup.sh',
  );
});

it.each([
  'wss://visualnerve.caripson.com/bridge',
  'ws://user:password@localhost:4317/bridge',
  'ws://localhost:4317/bridge?token=secret',
  'http://localhost:4317/mcp',
  'ws://localhost:4317/other',
])('never turns an invalid saved connection into copyable instructions: %s', (bridge) => {
  expect(() => mcpServerUrl(bridge)).toThrow();
  expect(() => mcpSetupNote('https://visualnerve.caripson.com', bridge)).toThrow();
});

it('normalizes a workspace URL to its website origin without changing MCP authorization', () => {
  const note = mcpSetupNote(
    'https://visualnerve.caripson.com/app/?example=1',
    'ws://127.0.0.1:4317/bridge',
  );
  expect(note).toContain('Browser workspace: https://visualnerve.caripson.com/app/');
  expect(note).toContain('Visual Nerve website: https://visualnerve.caripson.com\n');
  expect(note).toContain('--allowed-origin https://visualnerve.caripson.com\n');
  expect(note).not.toContain('--allowed-origin https://visualnerve.caripson.com/app');
});

it.each([47417, 4317])(
  'preserves selected port %i through hosted bootstrap and credential-free discovery',
  (port) => {
    const note = mcpSetupNote('https://app.visualnerve.com', `ws://127.0.0.1:${port}/bridge`);
    expect(note).toContain(
      `Bridge health on this computer: http://127.0.0.1:${port}/api/v1/health`,
    );
    expect(note).toContain(`MCP server on this computer: http://127.0.0.1:${port}/mcp`);
    expect(note).toContain(
      'Download https://app.visualnerve.com/downloads/visual-nerve-bridge-setup.sh',
    );
    expect(note).toContain('ensure curl, wget or Python is available');
    expect(note).toContain('Inspect the script, then run:');
    expect(note).toContain(
      `bash ./visual-nerve-bridge-setup.sh --origin 'https://app.visualnerve.com' --addr '127.0.0.1:${port}'`,
    );
    expect(note).toContain('--status, --stop and --install-dir');
    expect(note).toContain('--install-system-deps only for missing prerequisites');
    for (const phrase of [
      'HTTP 200 application/json',
      'status:"ok"',
      'storage:"indexeddb"',
      'bridge:true',
      'without credentials',
      'HTTP/0.9',
      'unidentified listener',
      'operations-v1/endpoint-docs-v1',
      'tools/list',
      'visual_nerve_api_docs',
      'visual_nerve_request',
      'Windows, WSL',
      'both reach the same bridge',
      'Settings cannot bypass CSP',
      'Human unlock',
      'fresh Read only or Read + write grant',
    ])
      expect(note).toContain(phrase);
    expect(note).not.toContain('scripts/build-bridge.sh');
    expect(note).not.toContain('/bin/visual-nerve');
    expect(note.indexOf('Check health without credentials')).toBeLessThan(
      note.indexOf('After valid health, initialize MCP'),
    );
    expect(note.trim().split(/\s+/).length).toBeLessThanOrEqual(350);
  },
);

it.each(['wss://127.0.0.1:4317/bridge', 'wss://localhost:9443/bridge'])(
  'does not downgrade a trusted TLS connection %s to the HTTP-only installer',
  (address) => {
    const note = mcpSetupNote('https://app.visualnerve.com', address);
    expect(note).toContain(`Preserve ${mcpServerUrl(address)}`);
    expect(note).toContain(
      'initial installer starts HTTP only and cannot configure this connection',
    );
    expect(note).toContain('Never downgrade HTTPS or change Settings automatically');
    expect(note).toContain('https://app.visualnerve.com/help/api-mcp/');
    expect(note).not.toContain('bash ./visual-nerve-bridge-setup.sh');
    expect(note).not.toContain('http://127.0.0.1:47417');
    expect(note.trim().split(/\s+/).length).toBeLessThanOrEqual(350);
  },
);

it('downloads over HTTPS for local development while preserving the actual allowed origin and IPv6 host', () => {
  const note = mcpSetupNote('http://localhost:5173', 'ws://[::1]:47417/bridge');
  expect(note).toContain('https://www.visualnerve.com/downloads/visual-nerve-bridge-setup.sh');
  expect(note).toContain("--origin 'http://localhost:5173' --addr '[::1]:47417'");
  expect(note).toContain('--allowed-origin http://localhost:5173\n');
});

it('quotes an unusual preview hostname as one shell argument', () => {
  const note = mcpSetupNote("https://preview'example.test", 'ws://localhost:4317/bridge');
  expect(note).toContain("--origin 'https://preview'\\''example.test' --addr 'localhost:4317'");
});
