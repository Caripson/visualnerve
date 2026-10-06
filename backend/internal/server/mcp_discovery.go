package server

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"unicode/utf8"
)

const (
	mcpGuideURI   = "visual-nerve://docs/guide"
	mcpOpenAPIURI = "visual-nerve://docs/openapi"
)

const mcpAPIGuide = `# Visual Nerve API guide

## Discover the contract through MCP

Start with visual_nerve_api_docs with {} (or omit arguments) for this compact guide. When detailed command fields or schemas are needed, request {"document":"openapi"} for the complete bundled OpenAPI contract or {"document":"all"} for both documents. The same content is available through resources/read at visual-nerve://docs/guide and visual-nerve://docs/openapi. Documentation discovery is read-only, requires no connected browser, and never reads workspace records. The OpenAPI document is read from this server's bundled openapi.yaml; no external fetch is performed.

Call visual_nerve_request for workspace commands only. Paths omit /api/v1, for example {"path":"/diagrams","method":"GET"}. /api/docs and /api/openapi.yaml are HTTP documentation routes, not browser graph commands; do not send them to visual_nerve_request.

## Local storage and access

The open Visual Nerve browser's IndexedDB is authoritative and is the only database. The server forwards workspace commands and stores no application records. The browser must have accepted local storage and enabled MCP access in Settings. MCP access defaults to Off. Read only permits GET, POST /export and the exact POST /sql/preview, POST /code/preview and POST /diagram-files/preview endpoints. Creating or changing diagrams, including POST /spatial-diagrams or POST /import, requires Read + write. Writes are committed in IndexedDB before the response. If multiple workspaces are connected, provide workspaceId in visual_nerve_request arguments.

All local imports use the connected browser's saved import-file-limit-mb setting: default 50 MiB, integer 50..1024 MiB (1 GiB). UI MB means MiB; UI 1 GB means 1024 MiB. GET /settings/import-file-limit-mb permits Read only and returns the effective integer limit (50 when the saved value is absent or invalid). Change it in Settings or through PUT /settings/import-file-limit-mb with {"value":100}; Read + write is required and invalid values return 422. It stays local, is excluded from backup, and is ignored during Merge/Replace so the destination retains its own limit. Only imports up to 50 MB are supported and guaranteed. Higher limits are experimental and may be slow or fail because of browser memory or format limits. Structural/count/deadline caps remain in force. JSON and WebSocket transport envelopes stay 32 MiB and are not increased by this setting. Source requests do not accept an import-limit override.

## Native 2D and requested 3D

Visual Nerve supports native 2D diagrams and 3D views of the same canonical graph. Use 2D unless the user requests 3D; discovering 3D support is not permission to switch the requested view. Diagrams use nodes for objects and edges for relationships. These can represent any subject, including mind maps, lifecycles, processes or dependencies.

For 2D, use POST /diagrams with {name,type?}, then populate the graph with the standard nodes/edges or bulk commands. For a requested 3D diagram, use visual_nerve_request with {"path":"/spatial-diagrams","method":"POST","data":{"name":"Requested 3D diagram","type":"mindmap"}}. This creates and opens a graph in 3D mode and returns its diagram, nodes and edges. Read the returned diagram.id and diagram.version before adding content.

Populate or edit that same graph through POST /diagrams/{diagramId}/bulk, node/edge commands, versioned PATCH, or PUT /diagrams/{diagramId}/graph. Bulk supports upsert with externalId, and edges can refer to nodes through sourceExternalId/targetExternalId. Consult the full OpenAPI schemas for fields and required versions. PATCH requires the entity's version; replacing a graph requires baseVersion. Use current response versions for subsequent edits.

Node metadata.spatial is {version:1,position?:{x,y,z}}. Diagram settings.spatialView is {version:1,mode:"2d"|"3d",camera?}. Keep each node's native x/y/width/height as an independent readable 2D layout for PNG/PDF. Do not replace the 2D layout with 3D coordinates. Explicit 3D changes leave that layout intact. Moving displayed 2D geometry shifts an existing explicit 3D X/Y by the corresponding movement, preserving Z and the placement offset; conversion uses the previous uniform relief scale. New explicit X/Y/Z in the same command takes precedence. Editor commands and repository API writes, including PATCH, bulk and graph replacement, share this behavior. Both views use the same nodes and relationships; switching modes does not require a second graph or schema change. Reserved fields and exchange format remain version 1. PNG/PDF export renders in the browser using the 2D layout.

Physical cards show the same native 2D capture on readable fronts and unmirrored backs. Detailed faces are bounded at 120 logical cards with shared front/back GPU resources. The UI's separate Move objects toggle drags the selection in world X/Y while retaining each object's Z; selected groups include nested descendants once. Release commits one undoable command; Escape cancels the whole gesture without partial writes. The Move, Rotate and Scale gizmo controls operate the camera.

## SQL and code analysis

POST /sql/preview with {sql,name?} analyzes SELECT/WITH or DDL locally and returns graph/counts/warnings without saving. POST /sql/diagrams with the same input saves and opens the graph and requires write access. Query diagrams retain scoped aliases, JOIN conditions, output expressions/lineage, clauses and potentially literal values. They describe logical structure; no SQL connection or execution occurs.

GET /code/languages lists 50 languages and their structural capabilities. POST /code/preview with {name?,files:[{path,content,language?}],mode?:"files"|"symbols",focus?} returns a local static dependency outline without saving. POST /code/diagrams with the same input saves and opens it and requires write access. Use files for larger projects and symbols for declarations and calls. Relations include syntax, heuristic or unresolved confidence and source file/line evidence. Focus matches path/name substrings and includes immediate related objects. Code is never executed; original source, comments and nonstructural string values are discarded after analysis, while identifiers and paths are retained. Dynamic dispatch, overloads, macros and missing dependencies can remain unresolved.

SQL uses the selected decoded UTF-8 file limit. Code applies the selected limit to both each file and the total project (50 MiB each by default). Their existing structural limits and 30-second worker deadline are unchanged.

## Draw.io and Visio file import

POST /diagram-files/preview accepts {format:"drawio"|"vsdx",data:string,name?}; name is a nonempty string of at most 500 characters. Draw.io data is XML text. Visio .vsdx data is strict padded standard base64 of ZIP bytes, without whitespace or a data-URL prefix. Preview returns {format,pages:[{id,name,graph,warnings}],warnings} without saving or opening a project. Page IDs are source strings, not graph UUIDs. Review file-level and per-page warnings.

POST /import with the same input plus pageId? saves and opens only the selected native page, returning Graph. Multipage input must specify pageId from preview; missing selection or an unknown ID returns 422 without partial writes. One-page input can omit it. Creation requires Read + write; exact preview permits Read only. Existing JSON/Markdown/CSV imports retain their contract.

Imported pages are editable native approximations of text, geometry, groups, relationships, basic colors and safe HTTP(S) links. Advanced/custom shapes, rotations and connector waypoints may be simplified with warnings. Original XML/ZIP, embedded image bytes and unselected pages remain temporary. Images, macros, scripts and external content are never fetched or executed. Legacy .vsd and macro-enabled .vsdm are unsupported. Input uses the selected file limit, default 50 MiB, with a 1 GiB hard ceiling. Expanded data is capped at min(1 GiB,max(100 MiB,2*selected file limit)), default 100 MiB. Other limits: 2,048 ZIP entries, 100 pages, 20,000 total nodes, 40,000 total edges, hierarchy depth 256, 30-second worker deadline and 45-second preview/import transport. JSON envelopes remain 32 MiB, so base64 integration files must be below roughly 24 MiB and preview results must also fit. Revocation cancels analysis and grants/acceptance are rechecked before saving.

## Use the full OpenAPI document

The bundled contract contains all supported command paths, inputs, response schemas, graph metadata, import/export formats and validation errors. Read it through visual_nerve_api_docs or resources/read instead of inferring endpoints from the UI or fetching a separate web link.
`

func mcpResources() []any {
	return []any{
		map[string]any{"uri": mcpGuideURI, "name": "api-guide", "title": "Visual Nerve API guide: 2D, 3D and local storage", "description": "Read-only command guide covering native 2D, requested 3D, export, browser storage and permissions. No browser connection required.", "mimeType": "text/markdown"},
		map[string]any{"uri": mcpOpenAPIURI, "name": "openapi", "title": "Visual Nerve complete bundled OpenAPI contract", "description": "Full openapi.yaml shipped with this server, including all command paths and schemas. No browser connection or external fetch required.", "mimeType": "application/yaml"},
	}
}

func (s *Server) mcpDocument(uri string) (map[string]string, error) {
	switch uri {
	case mcpGuideURI:
		return map[string]string{"uri": uri, "mimeType": "text/markdown", "text": mcpAPIGuide}, nil
	case mcpOpenAPIURI:
		if s.config.StaticDir != "" {
			data, err := os.ReadFile(filepath.Join(s.config.StaticDir, "openapi.yaml"))
			if err == nil && len(data) > 0 && utf8.Valid(data) {
				return map[string]string{"uri": uri, "mimeType": "application/yaml", "text": string(data)}, nil
			}
		}
		return nil, errors.New("bundled OpenAPI documentation is unavailable: openapi.yaml must be readable UTF-8 text in the configured static directory")
	default:
		return nil, errors.New("unknown documentation resource")
	}
}

func (s *Server) mcpReadResource(data json.RawMessage) (any, *mcpError) {
	params, err := mcpObject(data, false, "uri", "_meta")
	if err != nil {
		return nil, err
	}
	uri, err := mcpString(params, "uri", true)
	if err != nil {
		return nil, err
	}
	if uri != mcpGuideURI && uri != mcpOpenAPIURI {
		return nil, &mcpError{Code: -32002, Message: "resource not found"}
	}
	document, readError := s.mcpDocument(uri)
	if readError != nil {
		return nil, &mcpError{Code: -32603, Message: readError.Error()}
	}
	return map[string]any{"contents": []any{document}}, nil
}

func (s *Server) mcpDocsTool(data json.RawMessage) (any, *mcpError) {
	arguments, err := mcpObject(data, true, "document")
	if err != nil {
		return nil, err
	}
	selected, err := mcpString(arguments, "document", false)
	if err != nil {
		return nil, err
	}
	if _, provided := arguments["document"]; !provided {
		selected = "guide"
	}
	var uris []string
	switch selected {
	case "all":
		uris = []string{mcpGuideURI, mcpOpenAPIURI}
	case "guide":
		uris = []string{mcpGuideURI}
	case "openapi":
		uris = []string{mcpOpenAPIURI}
	default:
		return nil, invalidMCPParams("document must be all, guide or openapi")
	}
	content := make([]any, 0, len(uris))
	for _, uri := range uris {
		document, readError := s.mcpDocument(uri)
		if readError != nil {
			return map[string]any{"isError": true, "content": []any{map[string]string{"type": "text", "text": readError.Error()}}}, nil
		}
		// Text blocks work even in clients that do not support resource discovery.
		// Each block contains the entire document, without truncation or a URL hop.
		content = append(content, map[string]string{"type": "text", "text": document["text"]})
	}
	return map[string]any{"isError": false, "content": content}, nil
}
