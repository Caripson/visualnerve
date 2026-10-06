import { describe, expect, it } from 'vitest';
import { assertMcpAccess, localBridgeUrl, mcpAccess } from '../src/integration/access';
describe('local browser MCP capability', () => {
  it('defaults invalid and absent grants to Off', () => {
    for (const value of [undefined, null, true, 'readwrite', 'off'])
      expect(mcpAccess(value)).toBe('off');
  });
  it('allows reads, diagram export and exact analysis previews with a read-only grant', () => {
    assertMcpAccess('read', '/diagrams', 'GET');
    assertMcpAccess('read', '/export', 'POST');
    assertMcpAccess('read', '/sql/preview', 'POST');
    assertMcpAccess('read', '/api/v1/sql/preview', 'POST');
    assertMcpAccess('read', '/code/languages', 'GET');
    assertMcpAccess('read', '/code/preview', 'POST');
    assertMcpAccess('read', '/api/v1/code/preview', 'POST');
    assertMcpAccess('read', '/diagram-files/preview', 'POST');
    assertMcpAccess('read', '/api/v1/diagram-files/preview', 'POST');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(() => assertMcpAccess('read', '/nodes/test', method)).toThrow(/read-only/);
  });
  it('does not allow export-like paths to bypass mutation restrictions', () => {
    for (const path of [
      '/exports',
      '/workspace/import',
      '/export/../diagrams',
      '/settings/mcp-access',
      '/sql/diagrams',
      '/sql/preview/../diagrams',
      '/sql/preview?save=true',
      '/sql/preview/extra',
      '/sql/preview#save',
      '/code/diagrams',
      '/code/preview/../diagrams',
      '/code/preview?save=true',
      '/code/preview/extra',
      '/code/preview#save',
      '/import',
      '/diagram-files/preview/../import',
      '/diagram-files/preview?save=true',
      '/diagram-files/preview/extra',
      '/diagram-files/preview#save',
    ])
      expect(() => assertMcpAccess('read', path, 'POST')).toThrow();
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect(() => assertMcpAccess('read', '/diagram-files/preview', method)).toThrow();
  });
  it('accepts only literal loopback bridge destinations', () => {
    for (const url of [
      'ws://127.0.0.1:4317/bridge',
      'wss://localhost:4317/bridge',
      'wss://[::1]:4317/bridge',
    ])
      expect(localBridgeUrl(url).pathname).toBe('/bridge');
    for (const url of [
      'wss://visualnerve.example.com/bridge',
      'ws://192.168.1.2/bridge',
      'ws://localhost.attacker.example/bridge',
      'ws://127.0.0.1:4317/other',
      'ws://localhost/bridge?token=secret',
      'https://localhost/bridge',
      'ws://user:pass@localhost/bridge',
    ])
      expect(() => localBridgeUrl(url)).toThrow();
  });
});
