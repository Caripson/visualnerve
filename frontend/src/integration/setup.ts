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
    'First identify where this MCP client and the browser actually run. A loopback URL refers to the connecting computer/network environment, not the public website. WSL, Windows, containers and a remote Mac may reach different listeners at the same address. Test the intended bridge from both the client environment and the browser host; do not expose it on 0.0.0.0 or substitute a LAN address.',
    'Before workspace commands, request the exact Bridge health URL above without credentials. Require HTTP 200 with application/json containing status:"ok", storage:"indexeddb", bridge:true, a version string, and tools including visual_nerve_request and visual_nerve_api_docs. operations-v1 and endpoint-docs-v1 must appear in capabilities. An empty response, HTTP/0.9 error, connection reset, binary/protobuf payload or unrelated service is not valid bridge health. Do not retry with --http0.9 or send workspace commands/tokens to an unidentified listener. Port 4317 is also used by OpenTelemetry gRPC; a listening port alone is not proof of Visual Nerve.',
    'If health fails, stop protocol/workspace commands but continue authorized local diagnosis and setup with available terminal tools. Do not end by merely asking the user to start a process you can locate, build and start yourself. Do not guess an absolute binary/repository path or kill an unrelated process. Locate an installed visual-nerve executable or a confirmed Visual Nerve checkout on the intended host. If Go 1.26+ is available, run scripts/build-bridge.sh there to produce bin/visual-nerve and bin/bridge-docs/openapi.yaml; Node, npm, Hugo and a website build are unnecessary. If Go, repository access or execution permission is unavailable, report that specific missing prerequisite instead of claiming setup is complete. Run the located/built executable with its actual schema directory as --static (for this script: --static ./bin/bridge-docs --bridge), an explicit --addr matching the configured loopback hostname/port, and the exact --allowed-origin above. Keep the process running, then verify health and MCP discovery yourself. Human interaction is still required for browser unlock and the access grant. Use --mcp-stdio only as an adapter to an already-running bridge.',
    'The addresses above are authoritative for this existing connection; do not replace their port with a new default. New setups default to port 47417. Existing saved addresses, including 4317, stay explicit and are not silently changed. If the chosen port is occupied, identify its owner and choose an approved available port. The hosted app build and HTTP response CSP must both allow it before changing the browser connection; Settings cannot bypass CSP. Change browser WebSocket, bridge listener and client HTTP/stdio URLs together. A website update does not replace or restart the local executable.',
    'After valid bridge health, initialize the MCP connection and inspect tools/list. Both visual_nerve_request and visual_nerve_api_docs must be present. If tools or capabilities are missing from a confirmed Visual Nerve bridge, update and restart that bridge, reconnect the client and rediscover its tools. A Connected browser badge alone does not prove that the client has the current tool schemas.',
    'For infrastructure capacity use bridge/browser 0.10.0 with infrastructure-resources-v1. GET /simulation/capabilities retains schemaVersion:1 compatibility metadata, supportedModelSchemaVersions:[1,2] and infrastructure.requiredModelSchemaVersion:2. Model2 requires infrastructure:{schemaVersion:1}; legacy1 is unchanged. CPU/RAM, typed link transfers and generation/grid/battery assumptions use the same simulation CRUD, worker and state/result.infrastructure counters. Live collaboration rooms currently reject these models; share native JSON or an encrypted backup explicitly.',
    'Start by calling visual_nerve_api_docs with {"document":"guide"} for the 2D/3D command guide. For exact endpoint schemas use {"document":"endpoint","path":"/nodes/{nodeId}","method":"PATCH"}; request {"document":"openapi"} only when you need the complete contract. No separate documentation link is needed.',
    'Use visual_nerve_request for diagram commands. Paths omit /api/v1.',
    'For Classic Flowcharting (Based on the IBM GX20-8020 stencil), require ibm-flowcharting-v1 in bridge/browser capabilities (bridge 0.8.3 or newer). GET /flowchart/symbols discovers all 43 catalog entries with stable IDs and shared 2D/3D geometry. GET /flowchart/stencils lists the original GX20-8020 25 cutouts and revised GX20-8020-1/-2 26 cutouts, with historical symbolLabels for shared outlines. Reuse symbols in blank and other ordinary diagrams, including mind maps; Process Simulator and Time Series & Signal Analysis keep their specialized UI tools. To create the complete example, POST /diagrams with template:"ibm-flowcharting"; this stable template ID remains unchanged. Nodes use optional flowchartSymbol independently of diagram type; versioned PATCH preserves other fields and flowchartSymbol:null restores default appearance. The web update cannot update an older local bridge binary.',
    'All nodes support title, icon metadata and optional backgroundColor, an independent six-digit #RRGGBB fill. Omitted partial fields preserve saved values; backgroundColor:null resets an existing node to theme fill. Complete/new records reject null and invalid colors with atomic structured 422 errors. Read + write is required for edits.',
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
