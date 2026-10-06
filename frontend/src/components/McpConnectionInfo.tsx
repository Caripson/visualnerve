import { useRef, useState } from 'react';
import { mcpServerUrl, mcpSetupNote } from '../integration/setup';

export function McpConnectionInfo({ endpoint }: { endpoint: string }) {
  const website = location.origin;
  const reference = new URL('/api/docs/', website).href;
  const preview = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  let server = '';
  let instructions = '';
  try {
    server = mcpServerUrl(endpoint);
    instructions = mcpSetupNote(website, endpoint);
  } catch {
    // A malformed saved connection must never become a copyable remote MCP destination.
  }
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(instructions);
      setMessage('Connection instructions copied. No integration token is included.');
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setMessage('Instructions selected. Copy them with your keyboard or device copy menu.');
    }
  };
  return (
    <section aria-label="MCP connection addresses">
      <label className="field">
        <span>Visual Nerve website</span>
        <input aria-label="Visual Nerve website" readOnly value={website} />
      </label>
      <p className="muted">
        This is the website your local bridge must allow.{' '}
        <a href={reference} target="_blank" rel="noopener noreferrer">
          API documentation — 2D and 3D
        </a>
      </p>
      <label className="field">
        <span>MCP server URL for Codex</span>
        <input aria-label="MCP server URL for Codex" readOnly value={server} />
      </label>
      <p className="muted">
        Codex connects to this service on your computer. The website address identifies the app;
        this local address connects the tools to it.
      </p>
      {!server && (
        <p className="muted">Save a valid local bridge address below to show the MCP server URL.</p>
      )}
      {server && (
        <details className="storage-details">
          <summary>Instructions for Codex</summary>
          <p className="muted">
            Ask Codex to call visual_nerve_api_docs first for the 2D/3D guide. The same tool
            provides the complete API contract when needed.
          </p>
          <label className="field">
            <span>Connection instructions</span>
            <textarea
              ref={preview}
              aria-label="Connection instructions"
              readOnly
              rows={7}
              value={instructions}
            />
          </label>
          <button onClick={() => void copy()}>Copy instructions for Codex</button>
          {message && <p role="status">{message}</p>}
        </details>
      )}
    </section>
  );
}
