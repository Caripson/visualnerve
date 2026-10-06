import { localBridgeUrl } from './access';

/** Codex uses HTTP /mcp; the browser uses WebSocket /bridge on the same local service. */
export function mcpServerUrl(bridgeAddress: string): string {
  const url = localBridgeUrl(bridgeAddress);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/mcp';
  return url.href;
}

export function mcpSetupNote(websiteOrigin: string, bridgeAddress: string): string {
  const website = new URL(websiteOrigin).origin;
  const reference = new URL('/api/docs/', website).href;
  return [
    `Visual Nerve website: ${website}`,
    `API reference: ${reference}`,
    `Codex MCP server on this computer: ${mcpServerUrl(bridgeAddress)}`,
    `The local bridge must allow this website origin: --allowed-origin ${website}`,
    'Keep this website open and enable MCP Read only or Read + write in its Settings.',
    'Start by calling visual_nerve_api_docs with {"document":"guide"} for the 2D/3D command guide. Read the complete OpenAPI contract with {"document":"openapi"} when you need exact schemas; no separate documentation link is needed.',
    'Use visual_nerve_request for diagram commands. Paths omit /api/v1.',
    'For 2D, create with POST /diagrams. When I request 3D, create with POST /spatial-diagrams using {"name":"Diagram name","type":"mindmap"}, then populate its ordinary nodes and connections through the bulk endpoint.',
    'The same styled objects appear in 2D and 3D. Keep a readable 2D layout for switching views and PNG/PDF export. 3D is a diagram relief view, not a separate 3D model.',
    'The public website serves application files and documentation. The MCP service runs locally; diagrams remain in this browser’s IndexedDB.',
  ].join('\n');
}
