import { useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { McpAccess } from '../integration/access';
import { McpConnectionInfo } from './McpConnectionInfo';

export function McpSettings() {
  const access = useEditor((state) => state.mcpAccess);
  const state = useEditor((state) => state.bridgeStatus);
  const endpoint = useEditor((state) => state.bridgeUrl);
  const [address, setAddress] = useState(endpoint);
  const [token, setToken] = useState(sessionStorage.getItem('vn-token') ?? '');
  const [message, setMessage] = useState('');
  return (
    <section aria-label="MCP and API integration">
      <div className="property-section">MCP / API integration</div>
      <p className="muted">
        Optionally let an MCP client such as Codex, Cursor, Claude or Gemini CLI read or edit
        diagrams in your active browser session. Your work stays in this browser; connected tools
        receive the content you authorize and may use their own hosted services.
      </p>
      <label className="field">
        <span>Access</span>
        <select
          aria-label="MCP access"
          value={access}
          onChange={(event) => {
            void workspace
              .setPreference('mcp-access', event.target.value as McpAccess)
              .catch((error) => setMessage(error.message));
          }}
        >
          <option value="off">Off</option>
          <option value="read">Read only</option>
          <option value="write">Read + write</option>
        </select>
      </label>
      <p className="mcp-state" role="status">
        MCP connection:{' '}
        {state === 'connected'
          ? 'Connected'
          : state === 'disabled'
            ? 'Disabled'
            : state === 'error'
              ? 'Error'
              : 'Waiting'}
      </p>
      <p className="muted">Visual Nerve must stay open for MCP access to work.</p>
      <McpConnectionInfo endpoint={endpoint} />
      {state === 'error' && (
        <p className="muted">
          Cannot reach the local bridge. Start it, allow this website's origin, and check the local
          address. Your browser may require local network permission or a secure local connection.
        </p>
      )}
      <details className="storage-details">
        <summary>Local connection details</summary>
        <p className="muted">
          This WebSocket connects the browser to the local service. Your MCP client uses the server
          URL shown above. The website domain is configured as an allowed origin when starting the
          bridge.
        </p>
        <label className="field">
          <span>Local bridge address</span>
          <input
            aria-label="Local bridge address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Integration token</span>
          <input
            type="password"
            aria-label="Integration token"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="If required by your local bridge"
          />
        </label>
        <button
          onClick={async () => {
            try {
              await workspace.setPreference('bridge-url', address);
              sessionStorage.setItem('vn-token', token);
              const { bridge } = await import('../integration/bridge');
              bridge.reconnect();
              setMessage('Local connection updated. The token lasts for this browser session.');
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          Save connection
        </button>
        <p className="muted">
          Connections are restricted to this computer. A publicly hosted app needs its exact address
          allowed by your local bridge.{' '}
          <a href="/help/api-mcp/" target="_blank" rel="noopener noreferrer">
            Setup guide
          </a>
        </p>
      </details>
      {message && <p className="settings-message">{message}</p>}
    </section>
  );
}
