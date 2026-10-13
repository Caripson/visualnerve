import { StorageError } from '../model/validation';
export type McpAccess = 'off' | 'read' | 'write';
export function mcpAccess(value: unknown): McpAccess {
  return value === 'read' || value === 'write' ? value : 'off';
}
export function assertMcpAccess(access: McpAccess, path: string, method: string) {
  if (access === 'off') throw new StorageError(403, 'MCP access is off in this browser.');
  const exactPath = path.replace(/^\/api\/v1/, '');
  const endpoint = new URL(path, 'http://browser.local').pathname.replace(/^\/api\/v1/, '');
  const reading =
    method === 'GET' ||
    (method === 'POST' &&
      /^\/diagrams\/[\da-f-]{36}\/roblox\/(validate|preview|builds)$/i.test(endpoint)) ||
    (method === 'DELETE' &&
      /^\/diagrams\/[\da-f-]{36}\/roblox\/builds\/[\da-f-]{36}$/i.test(endpoint)) ||
    (method === 'POST' && /^\/diagrams\/[\da-f-]{36}\/notation\/validate$/i.test(exactPath)) ||
    (method === 'POST' &&
      /^\/diagrams\/[\da-f-]{36}\/analytics\/(query|measure|indicator|waterfall|evaluate|validate|project|compare|export|import\/(preview|inspect)|jobs)$/i.test(
        endpoint,
      )) ||
    (method === 'DELETE' &&
      /^\/diagrams\/[\da-f-]{36}\/analytics\/jobs\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        endpoint,
      )) ||
    (method === 'POST' && /^\/diagrams\/[\da-f-]{36}\/(questions|build-brief)$/i.test(exactPath)) ||
    (method === 'POST' && /^\/diagrams\/[\da-f-]{36}\/simulation\/compare$/i.test(exactPath)) ||
    (method === 'POST' &&
      [
        '/export',
        '/exports/svg',
        '/exports/diagrams',
        '/sql/preview',
        '/code/preview',
        '/code/project/preview',
        '/diagram-files/preview',
      ].includes(exactPath)) ||
    (method === 'DELETE' &&
      /^\/exports\/(svg|diagrams)\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        exactPath,
      ));
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
