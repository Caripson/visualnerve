import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { McpSettings } from '../src/components/McpSettings';
import { McpConnectionInfo } from '../src/components/McpConnectionInfo';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';
import { bridge } from '../src/integration/bridge';

vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));
vi.mock('../src/integration/bridge', () => ({ bridge: { reconnect: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { origin: 'https://visualnerve.caripson.com' });
  sessionStorage.clear();
  useEditor.setState({
    bridgeUrl: 'wss://127.0.0.1:4317/bridge',
    bridgeStatus: 'disabled',
    mcpAccess: 'off',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('shows the website domain and a separate Codex endpoint even while content access is Off', () => {
  render(<McpSettings />);
  expect(screen.getByLabelText('Visual Nerve website')).toHaveValue(
    'https://visualnerve.caripson.com',
  );
  expect(screen.getByRole('link', { name: 'API documentation — 2D and 3D' })).toHaveAttribute(
    'href',
    'https://visualnerve.caripson.com/api/docs/',
  );
  expect(screen.getByLabelText('MCP server URL for Codex')).toHaveValue(
    'https://127.0.0.1:4317/mcp',
  );
  expect(bridge.reconnect).not.toHaveBeenCalled();
});

it('copies useful 2D/3D discovery instructions without the browser session token', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  sessionStorage.setItem('vn-token', 'PRIVATE-INTEGRATION-TOKEN');
  render(<McpSettings />);
  fireEvent.click(screen.getByText('Instructions for Codex', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy instructions for Codex' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const instructions = writeText.mock.calls[0][0] as string;
  expect(instructions).toContain('visual_nerve_api_docs');
  expect(instructions).toContain('POST /spatial-diagrams');
  expect(instructions).toContain('https://visualnerve.caripson.com/api/docs/');
  expect(instructions).not.toContain('PRIVATE-INTEGRATION-TOKEN');
});

it('only changes the Codex address after a successful save, not while editing the WebSocket draft', async () => {
  vi.mocked(workspace.setPreference).mockImplementation(async (key, value) => {
    if (key === 'bridge-url') useEditor.setState({ bridgeUrl: String(value) });
  });
  render(<McpSettings />);
  fireEvent.click(screen.getByText('Local connection details', { exact: true }));
  fireEvent.change(screen.getByLabelText('Local bridge address'), {
    target: { value: 'wss://localhost:9443/bridge' },
  });
  expect(screen.getByLabelText('MCP server URL for Codex')).toHaveValue(
    'https://127.0.0.1:4317/mcp',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() =>
    expect(screen.getByLabelText('MCP server URL for Codex')).toHaveValue(
      'https://localhost:9443/mcp',
    ),
  );
  expect(bridge.reconnect).toHaveBeenCalledOnce();
});

it('keeps the saved Codex address when saving a rejected connection', async () => {
  vi.mocked(workspace.setPreference).mockRejectedValue(
    new Error('Only local connections are allowed.'),
  );
  render(<McpSettings />);
  fireEvent.click(screen.getByText('Local connection details', { exact: true }));
  fireEvent.change(screen.getByLabelText('Local bridge address'), {
    target: { value: 'wss://visualnerve.caripson.com/bridge' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await screen.findByText('Only local connections are allowed.');
  expect(screen.getByLabelText('MCP server URL for Codex')).toHaveValue(
    'https://127.0.0.1:4317/mcp',
  );
  expect(bridge.reconnect).not.toHaveBeenCalled();
});

it('hides copyable instructions for an invalid persisted destination', () => {
  render(<McpConnectionInfo endpoint="wss://untrusted.example/bridge" />);
  expect(screen.getByLabelText('MCP server URL for Codex')).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Copy instructions for Codex' })).toBeNull();
});

it('selects the full instructions when clipboard access is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  render(<McpConnectionInfo endpoint="ws://localhost:4317/bridge" />);
  fireEvent.click(screen.getByText('Instructions for Codex', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy instructions for Codex' }));
  const preview = screen.getByLabelText('Connection instructions') as HTMLTextAreaElement;
  await waitFor(() => expect(preview).toHaveFocus());
  expect(preview.selectionStart).toBe(0);
  expect(preview.selectionEnd).toBe(preview.value.length);
});
