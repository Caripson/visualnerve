import { expect, it } from 'vitest';
import { mcpServerUrl, mcpSetupNote } from '../src/integration/setup';

it.each([
  ['ws://127.0.0.1:4317/bridge', 'http://127.0.0.1:4317/mcp'],
  ['wss://localhost:9443/bridge', 'https://localhost:9443/mcp'],
  ['wss://[::1]:4329/bridge', 'https://[::1]:4329/mcp'],
])('derives the MCP endpoint from the validated local browser connection %s', (bridge, server) => {
  expect(mcpServerUrl(bridge)).toBe(server);
});

it('keeps the explicit staging/development domain in website/docs/origin roles and exposes 3D via MCP discovery', () => {
  const note = mcpSetupNote('https://visualnerve.caripson.com', 'wss://localhost:9443/bridge');
  expect(note).toContain('Browser workspace: https://visualnerve.caripson.com/app/');
  expect(note).toContain('Keep this workspace open');
  expect(note).toContain('API reference: https://visualnerve.caripson.com/api/docs/');
  expect(note).toContain('MCP server on this computer: https://localhost:9443/mcp');
  expect(note).toContain('--allowed-origin https://visualnerve.caripson.com');
  expect(note).toContain('visual_nerve_api_docs');
  expect(note).toContain('POST /spatial-diagrams');
  expect(note).toContain('readable 2D layout');
  expect(note).toContain('visualCapacity');
  expect(note).toContain('Counter 1/2/3');
  expect(note).toContain('not separate persistent process nodes');
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

it('uses the root of a separately reviewed encrypted preview surface without inventing an /app alias', () => {
  const note = mcpSetupNote(
    'https://app-preview.visualnerve.example',
    'ws://127.0.0.1:4317/bridge',
    true,
  );
  expect(note).toContain('Browser workspace: https://app-preview.visualnerve.example/\n');
  expect(note).toContain('--allowed-origin https://app-preview.visualnerve.example\n');
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
