import { StorageError } from '../model/validation';
export type McpAccess = 'off' | 'read' | 'write';
export function mcpAccess(value: unknown): McpAccess {
  return value === 'read' || value === 'write' ? value : 'off';
}
export function assertMcpAccess(access: McpAccess, path: string, method: string) {
  if (access === 'off') throw new StorageError(403, 'MCP access is off in this browser.');
  const reading =
    method === 'GET' ||
    (method === 'POST' && new URL(path, 'http://local.invalid').pathname === '/export');
  if (access === 'read' && !reading)
    throw new StorageError(
      403,
      'MCP has read-only access. Enable Read + write to change diagrams.',
    );
}
export function localBridgeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageError(422, 'Enter a local WebSocket address.');
  }
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/bridge'
  ) {
    throw new StorageError(422, 'MCP can connect only to localhost, 127.0.0.1 or ::1 at /bridge.');
  }
  return url;
}
export function defaultBridgeUrl() {
  if (import.meta.env.DEV) return 'ws://127.0.0.1:4317/bridge';
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge`
    : 'ws://127.0.0.1:4317/bridge';
}
