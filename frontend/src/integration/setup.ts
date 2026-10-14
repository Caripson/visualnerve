import { localBridgeUrl } from './access';

/** MCP clients use HTTP /mcp; the browser uses WebSocket /bridge on the same local service. */
export function mcpServerUrl(bridgeAddress: string): string {
  const url = localBridgeUrl(bridgeAddress);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/mcp';
  return url.href;
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function mcpSetupNote(
  websiteOrigin: string,
  bridgeAddress: string,
  encryptedSurface = false,
): string {
  const requested = new URL(websiteOrigin);
  const production = ['app.visualnerve.com', 'www.visualnerve.com', 'visualnerve.com'].includes(
    requested.hostname,
  );
  const website = production ? 'https://app.visualnerve.com' : requested.origin;
  const workspace = new URL(production || encryptedSurface ? '/' : '/app/', website).href;
  const reference = new URL('/api/docs/', website).href;
  const bridge = localBridgeUrl(bridgeAddress);
  const mcp = mcpServerUrl(bridgeAddress);
  const health = new URL(mcp);
  health.pathname = '/api/v1/health';
  const download = new URL(
    '/downloads/visual-nerve-bridge-setup.sh',
    new URL(website).protocol === 'https:' ? website : 'https://www.visualnerve.com',
  ).href;
  const address = `${bridge.hostname}:${bridge.port || (bridge.protocol === 'wss:' ? '443' : '80')}`;
  const bootstrap =
    bridge.protocol === 'wss:'
      ? `This saved connection requires trusted TLS. Preserve ${mcp}; the initial installer starts HTTP only and cannot configure this connection. Follow ${new URL('/help/api-mcp/', website).href} to reuse/configure a trusted TLS bridge. Never downgrade HTTPS or change Settings automatically.`
      : [
          'If health is unavailable, ensure curl, wget or Python is available; install a downloader through the OS package manager with required privilege approval if missing.',
          `Download ${download} as visual-nerve-bridge-setup.sh using that downloader. Inspect the script, then run:`,
          `bash ./visual-nerve-bridge-setup.sh --origin ${shellArgument(website)} --addr ${shellArgument(address)}`,
          'It starts by default; --status, --stop and --install-dir are available. Use --install-system-deps only for missing prerequisites. Report specific blockers; do not guess binary paths or kill unrelated processes.',
        ].join('\n');
  return [
    'Connect this workspace through standard MCP.',
    `Visual Nerve website: ${website}`,
    `Browser workspace: ${workspace}`,
    `API reference: ${reference}`,
    `MCP server on this computer: ${mcp}`,
    `Bridge health on this computer: ${health.href}`,
    `Required bridge origin: --allowed-origin ${website}`,
    'Keep this workspace open. Human unlock and a fresh Read only or Read + write grant in Settings are required; never request a password/recovery key.',
    'Identify the client/browser environments: Windows, WSL and containers may have different loopbacks. Verify both reach the same bridge; never expose it on 0.0.0.0.',
    'Check health without credentials: require HTTP 200 application/json with status:"ok", storage:"indexeddb", bridge:true, version, both MCP tools below, and capabilities operations-v1/endpoint-docs-v1. Never bypass HTTP/0.9 errors or send tokens to an unidentified listener.',
    bootstrap,
    'Preserve the selected address, including legacy ports; Settings cannot bypass CSP. Website updates do not update local binaries.',
    'After valid health, initialize MCP and inspect tools/list for visual_nerve_api_docs and visual_nerve_request. Update/reconnect an old bridge before proceeding.',
    'First call visual_nerve_api_docs with {"document":"guide"}; then {"document":"endpoint","path":"/nodes/{nodeId}","method":"PATCH"} for exact schemas, or document:"openapi" for the full contract. Discover features there.',
    'Use visual_nerve_request; paths omit /api/v1. For requested 3D use POST /spatial-diagrams; preserve type:"process-simulator" for simulations.',
    'Read current IDs/versions before writes. Reserve operationId first; after OPERATION_OUTCOME_UNKNOWN inspect its receipt and saved state, never blindly retry with a new ID.',
  ].join('\n');
}
