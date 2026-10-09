import { localBridgeUrl } from './access';

/** MCP clients use HTTP /mcp; the browser uses WebSocket /bridge on the same local service. */
export function mcpServerUrl(bridgeAddress: string): string {
  const url = localBridgeUrl(bridgeAddress);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/mcp';
  return url.href;
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
  const health = new URL(mcpServerUrl(bridgeAddress));
  health.pathname = '/api/v1/health';
  return [
    `Visual Nerve website: ${website}`,
    `Browser workspace: ${workspace}`,
    `API reference: ${reference}`,
    `MCP server on this computer: ${mcpServerUrl(bridgeAddress)}`,
    `Bridge health on this computer: ${health.href}`,
    `The local bridge must allow this website origin: --allowed-origin ${website}`,
    'Keep this workspace open and enable MCP Read only or Read + write in its Settings.',
    'This is a standard MCP service, independent of the client vendor. The browser /bridge WebSocket is not the MCP endpoint.',
    'For an encrypted workspace, unlock locally in the browser and explicitly grant tool access. GET /workspace/security exposes safe state; connected locked content requests return 423 WORKSPACE_LOCKED. Never submit a password or recovery key through MCP. Unlocking requires a fresh human grant before a tool can read content again.',
    'Before workspace commands, verify bridge health, initialize the MCP connection and inspect tools/list. Both visual_nerve_request and visual_nerve_api_docs must be present; operations-v1 and endpoint-docs-v1 should appear in health capabilities. If missing, update and restart the local bridge, reconnect the client and rediscover its tools. A Connected browser badge alone does not prove that the client has the current tool schemas.',
    'Start by calling visual_nerve_api_docs with {"document":"guide"} for the 2D/3D command guide. For exact endpoint schemas use {"document":"endpoint","path":"/nodes/{nodeId}","method":"PATCH"}; request {"document":"openapi"} only when you need the complete contract. No separate documentation link is needed.',
    'Use visual_nerve_request for diagram commands. Paths omit /api/v1.',
    'Process Simulator is a first-class process-simulator document with a separately typed simulation model. Discover GET /simulation/capabilities, then use /diagrams/{id}/simulation for semantic CRUD, scenarios, seeded worker runs, metrics, queues, resources, events and comparison. Headless/MAX needs no animation or selected diagram, but this browser must remain connected. UI and MCP use the same engine and authoritative IndexedDB model.',
    'Hierarchical subprocesses use model.processes with optional parentId and nodes[].processId. Read /diagrams/{id}/simulation/hierarchy for roots, children and direct/recursive member node IDs. Processes have the same versioned CRUD; /diagrams/{id}/simulation/runs/{runId}/processes/{processId} exposes real scoped queues, throughput, utilization, bottlenecks and economics. Parent and child rollups overlap: do not sum them or node quantiles. Shared-resource pools remain global; only occupied resource cost is allocated to scopes, while idle/scaling/investment pool overhead remains in whole-system metrics.',
    'In live 2D, capacity uses full native cards such as Counter 1/2/3. visualCapacity discovery describes read-only anonymous units, one shared logical Work/Resource ID and bounded aggregate presentation. Read and change semantic capacity/metrics; the visual cards are not separate persistent process nodes. 3D retains the logical model.',
    'For 2D, create with POST /diagrams. When I request 3D, create with POST /spatial-diagrams using the appropriate document type, then populate its ordinary nodes and connections through the bulk endpoint. For runnable simulations use type:"process-simulator" and preserve that type when requesting 3D; a mindmap does not become a runnable simulation simply by containing process-like nodes.',
    'Read current versions and canonical IDs before updates. Use version or baseVersion as required by the contract. Partial bulk upserts identify existing objects by stable externalId. Use PATCH for individual ID-based field updates; omitted fields must remain unchanged. Existing canonical-ID collisions in bulk creation are rejected.',
    'For retry-safe writes, first reserve an operationId with POST /operations and data:{}, then pass it as the visual_nerve_request operationId argument when writing. After a 504 OPERATION_OUTCOME_UNKNOWN, inspect GET /operations/{operationId} and read saved state before retrying. Retry only the identical command with the same operationId. Expired IDs, another browser/grant or a restarted bridge cannot prove the outcome; reconcile saved data before issuing a new operation. Never assume a timeout means rollback.',
    'The same styled objects appear in 2D and 3D. Keep a readable 2D layout for switching views and PNG/PDF export. 3D is a diagram relief view, not a separate 3D model.',
    'The guide also covers semantic overview, source-backed relationship questions, named local version history, editable storyboard scenes and reviewed Lovable app specifications. Exact POST /diagrams/{id}/questions and /build-brief previews work with Read only; saving versions/scenes or controlling playback requires Read + write.',
    'The public website serves application files and documentation. The MCP service runs locally; diagrams remain in this browser’s IndexedDB.',
  ].join('\n');
}
