import { localBridgeUrl } from './access';

/** MCP clients use HTTP /mcp; the browser uses WebSocket /bridge on the same local service. */
export function mcpServerUrl(bridgeAddress: string): string {
  const url = localBridgeUrl(bridgeAddress);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/mcp';
  return url.href;
}

export function mcpSetupNote(websiteOrigin: string, bridgeAddress: string): string {
  const website = new URL(websiteOrigin).origin;
  const workspace = new URL('/app/', website).href;
  const reference = new URL('/api/docs/', website).href;
  return [
    `Visual Nerve website: ${website}`,
    `Browser workspace: ${workspace}`,
    `API reference: ${reference}`,
    `MCP server on this computer: ${mcpServerUrl(bridgeAddress)}`,
    `The local bridge must allow this website origin: --allowed-origin ${website}`,
    'Keep this workspace open and enable MCP Read only or Read + write in its Settings.',
    'This is a standard MCP service, independent of the client vendor. The browser /bridge WebSocket is not the MCP endpoint.',
    'For an encrypted workspace, unlock locally in the browser and explicitly grant tool access. GET /workspace/security exposes safe state; connected locked content requests return 423 WORKSPACE_LOCKED. Never submit a password or recovery key through MCP. Unlocking requires a fresh human grant before a tool can read content again.',
    'Start by calling visual_nerve_api_docs with {"document":"guide"} for the 2D/3D command guide. Read the complete OpenAPI contract with {"document":"openapi"} when you need exact schemas; no separate documentation link is needed.',
    'Use visual_nerve_request for diagram commands. Paths omit /api/v1.',
    'Process Simulator is a first-class process-simulator document with a separately typed simulation model. Discover GET /simulation/capabilities, then use /diagrams/{id}/simulation for semantic CRUD, scenarios, seeded worker runs, metrics, queues, resources, events and comparison. Headless/MAX needs no animation or selected diagram, but this browser must remain connected. UI and MCP use the same engine and authoritative IndexedDB model.',
    'Hierarchical subprocesses use model.processes with optional parentId and nodes[].processId. Read /diagrams/{id}/simulation/hierarchy for roots, children and direct/recursive member node IDs. Processes have the same versioned CRUD; /diagrams/{id}/simulation/runs/{runId}/processes/{processId} exposes real scoped queues, throughput, utilization, bottlenecks and economics. Parent and child rollups overlap: do not sum them or node quantiles. Shared-resource pools remain global; only occupied resource cost is allocated to scopes, while idle/scaling/investment pool overhead remains in whole-system metrics.',
    'In live 2D, capacity uses full native cards such as Counter 1/2/3. visualCapacity discovery describes read-only anonymous units, one shared logical Work/Resource ID and bounded aggregate presentation. Read and change semantic capacity/metrics; the visual cards are not separate persistent process nodes. 3D retains the logical model.',
    'For 2D, create with POST /diagrams. When I request 3D, create with POST /spatial-diagrams using {"name":"Diagram name","type":"mindmap"}, then populate its ordinary nodes and connections through the bulk endpoint.',
    'The same styled objects appear in 2D and 3D. Keep a readable 2D layout for switching views and PNG/PDF export. 3D is a diagram relief view, not a separate 3D model.',
    'The guide also covers semantic overview, source-backed relationship questions, named local version history, editable storyboard scenes and reviewed Lovable app specifications. Exact POST /diagrams/{id}/questions and /build-brief previews work with Read only; saving versions/scenes or controlling playback requires Read + write.',
    'The public website serves application files and documentation. The MCP service runs locally; diagrams remain in this browser’s IndexedDB.',
  ].join('\n');
}
