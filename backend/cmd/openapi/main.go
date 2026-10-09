// Generate the OpenAPI contract from canonical Go model fields plus HTTP operations.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"visualnerve/internal/model"
)

type object = map[string]any

const absoluteImportByteLimit = 1 << 30
const importLimitPolicyDescription = "The connected browser applies its saved local import file size limit: default 50 MiB, configurable from 50 to 1024 MiB (1 GiB) in Settings. UI MB means MiB and UI 1 GB means 1024 MiB. Only imports up to 50 MB are supported and guaranteed; higher limits are experimental and may be slow or fail because of browser memory or format limits. The HTTP/JSON and WebSocket transport envelopes remain 32 MiB and are not increased by this setting."

func importLimitSettingValueSchema() object {
	return object{"type": "integer", "minimum": 50, "maximum": 1024, "default": 50}
}

func importLimitSettingSchema() object {
	return object{
		"type": "object", "additionalProperties": false, "required": []string{"value"},
		"properties":  object{"value": importLimitSettingValueSchema()},
		"description": "Browser-local setting import-file-limit-mb. Invalid values return 422. Excluded from backups and ignored when restoring; the destination retains its own limit. " + importLimitPolicyDescription,
	}
}

func ref(name string) object { return object{"$ref": "#/components/schemas/" + name} }
func schema(t reflect.Type) object {
	switch t.Kind() {
	case reflect.String:
		return object{"type": "string"}
	case reflect.Bool:
		return object{"type": "boolean"}
	case reflect.Int, reflect.Int64:
		return object{"type": "integer"}
	case reflect.Float64:
		return object{"type": "number"}
	case reflect.Map:
		return object{"type": "object", "additionalProperties": true}
	case reflect.Slice:
		return object{"type": "array", "items": schema(t.Elem())}
	case reflect.Struct:
		p := object{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if f.Anonymous {
				for k, v := range schema(f.Type)["properties"].(object) {
					p[k] = v
				}
				continue
			}
			key := strings.Split(f.Tag.Get("json"), ",")[0]
			if key == "" || key == "-" {
				continue
			}
			s := schema(f.Type)
			if key != "externalId" && (key == "id" || strings.HasSuffix(key, "Id")) {
				s["format"] = "uuid"
			}
			if key == "externalId" {
				s["description"] = "Optional stable client-defined integration identity, such as engineering or truck. This is an ordinary string, not a canonical UUID."
			}
			if strings.HasSuffix(key, "Date") {
				s["format"] = "date"
			}
			if key == "createdAt" || key == "updatedAt" {
				s["format"] = "date-time"
				s["readOnly"] = true
			}
			p[key] = s
		}
		return object{"type": "object", "properties": p, "additionalProperties": false}
	}
	return object{}
}
func clone(m object) object {
	b, _ := json.Marshal(m)
	var v object
	_ = json.Unmarshal(b, &v)
	return v
}
func main() {
	schemas := object{}
	addCodeSchemas(schemas)
	addSpatialSchemas(schemas)
	addSqlSchemas(schemas)
	addDiagramImportSchemas(schemas)
	addPresentationSchemas(schemas)
	addUnderstandingSchemas(schemas)
	addSimulationSchemas(schemas)
	addWorkspaceSecuritySchemas(schemas)
	addOperationSchemas(schemas)
	schemas["ImportLimitSettingInput"] = importLimitSettingSchema()
	schemas["ProjectFileLimitSettingInput"] = projectFileLimitSettingSchema()
	schemas["ProjectFileLimitSettingValue"] = projectFileLimitValueSchema()
	schemas["CodeCapabilities"] = codeCapabilitiesSchema()
	schemas["ImportLimitSettingValue"] = importLimitSettingValueSchema()
	schemas["ImportLimitSettingValue"].(object)["description"] = "Effective browser-local import limit in MiB (UI MB). An absent or invalid saved value returns the default 50."
	for name, v := range map[string]any{"Diagram": model.Diagram{}, "Node": model.Node{}, "Edge": model.Edge{}, "Owner": model.Owner{}} {
		s := schema(reflect.TypeOf(v))
		p := s["properties"].(object)
		if name == "Diagram" {
			p["metadata"].(object)["properties"] = object{"codeAnalysis": ref("CodeAnalysis")}
			p["settings"].(object)["properties"] = object{"spatialView": ref("SpatialView"), "presentation": ref("PresentationDefinition"), "storyboard": ref("StoryboardDefinition"), "overview": ref("OverviewConfig"), "buildSpecification": ref("BuildSpecificationDraft")}
			p["type"].(object)["enum"] = model.DiagramTypes
			s["required"] = []string{"name", "type"}
		}
		if name == "Node" {
			p["metadata"].(object)["properties"] = object{"spatial": ref("SpatialNode"), "sqlQuerySource": ref("SqlQuerySource"), "sqlQueryResult": ref("SqlQueryResult"), "codeObject": ref("CodeObject"), "projectDirectory": ref("ProjectDirectory")}
			p["nodeType"].(object)["enum"] = model.NodeTypes
			s["required"] = []string{"title"}
		}
		if name == "Edge" {
			p["metadata"].(object)["properties"] = object{"sqlQueryRelationship": ref("SqlQueryRelationship"), "codeRelation": ref("CodeRelation")}
			s["required"] = []string{"sourceNodeId", "targetNodeId"}
			p["direction"].(object)["enum"] = []string{"forward", "backward", "both", "none"}
			p["style"].(object)["enum"] = []string{"solid", "dashed", "dotted"}
		}
		if name == "Owner" {
			s["required"] = []string{"name"}
			p["kind"].(object)["enum"] = []string{"person", "team", "department", "system", "organization", "external"}
		}
		schemas[name] = s
		create := clone(s)
		cp := create["properties"].(map[string]any)
		for _, key := range []string{"version", "updatedAt", "createdAt", "diagramId"} {
			delete(cp, key)
		}
		if name == "Diagram" {
			create["required"] = []string{"name"}
		}
		schemas[name+"Input"] = create
		patch := clone(s)
		pp := patch["properties"].(map[string]any)
		for _, key := range []string{"id", "diagramId", "updatedAt", "createdAt"} {
			delete(pp, key)
		}
		patch["required"] = []string{"version"}
		schemas[name+"Patch"] = patch
	}
	schemas["Graph"] = object{"type": "object", "required": []string{"format", "formatVersion", "diagram", "nodes", "edges", "owners"}, "properties": object{"format": object{"type": "string", "enum": []string{"visual-nerve"}}, "formatVersion": object{"type": "integer", "enum": []int{1}}, "diagram": ref("Diagram"), "nodes": object{"type": "array", "items": ref("Node")}, "edges": object{"type": "array", "items": ref("Edge")}, "owners": object{"type": "array", "items": ref("Owner")}}, "additionalProperties": false}
	schemas["TemplateRecord"] = strictObject([]string{"id", "name", "builtin", "graph"}, object{
		"id":   object{"type": "string", "minLength": 1, "description": "Stable template key, such as process-simulator-blank (guided empty setup) or process-simulator (kiosk example); template keys are not graph UUIDs."},
		"name": object{"type": "string"}, "builtin": object{"type": "boolean"}, "graph": ref("Graph"),
	})
	schemas["TemplateRecord"].(object)["description"] = "Browser-local built-in or user template with its complete reusable native graph. A Process Simulator template includes graph.simulation. Discovery requires an accepted, connected browser and at least Read only access; records are not stored by the server."
	// CSV source records are validated in the browser and forwarded losslessly by the bridge.
	schemas["CsvDataset"] = object{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"id", "version", "createdAt", "updatedAt", "formatVersion", "diagramId", "name", "fileName", "columns", "rows"},
		"properties": object{
			"id":            object{"type": "string", "format": "uuid"},
			"version":       object{"type": "integer", "minimum": 1},
			"createdAt":     object{"type": "string", "format": "date-time"},
			"updatedAt":     object{"type": "string", "format": "date-time"},
			"formatVersion": object{"type": "integer", "enum": []int{1}},
			"diagramId":     object{"type": "string", "format": "uuid"},
			"name":          object{"type": "string"},
			"fileName":      object{"type": "string"},
			"columns": object{"type": "array", "items": object{
				"type": "object", "required": []string{"id", "label"},
				"properties": object{"id": object{"type": "string"}, "label": object{"type": "string"}},
			}},
			"rows": object{"type": "array", "items": object{"type": "array", "items": object{"type": "string"}}},
		},
	}
	schemas["Graph"].(object)["properties"].(object)["dataset"] = ref("CsvDataset")
	schemas["Graph"].(object)["properties"].(object)["datasets"] = object{"type": "array", "items": ref("CsvDataset"), "description": "Additional diagram-owned CSV sources; the primary source remains in dataset. Analysis settings and saved views share these source records."}
	schemas["Graph"].(object)["properties"].(object)["simulation"] = ref("SimulationModel")
	for _, name := range []string{"Node", "Edge", "Owner"} {
		s := clone(schemas[name+"Input"].(object))
		delete(s, "required")
		s["description"] = "Existing external-ID upserts accept partial fields and preserve the canonical UUID. Use versioned PATCH to update an existing entity by its UUID; bulk matches externalId only. If both id and externalId are supplied, they must identify the same entity. Duplicate explicit IDs or a conflicting existing ID reject the entire batch. New nodes require title, new owners require name, and new edges require endpoints."
		props := s["properties"].(map[string]any)
		keys := []string{"ownerExternalId", "parentExternalId"}
		if name == "Owner" {
			keys = nil
		}
		if name == "Edge" {
			keys = []string{"sourceExternalId", "targetExternalId"}
		}
		for _, k := range keys {
			props[k] = object{"type": "string"}
		}
		props["version"] = object{"type": "integer", "description": "Optional expected version for existing external-ID upserts"}
		schemas["Bulk"+name] = s
	}
	schemas["Bulk"] = object{"type": "object", "properties": object{"upsert": object{"type": "boolean", "default": false}, "baseVersion": object{"type": "integer"}, "nodes": object{"type": "array", "items": ref("BulkNode")}, "edges": object{"type": "array", "items": ref("BulkEdge")}, "owners": object{"type": "array", "items": ref("BulkOwner")}}, "additionalProperties": false}
	schemas["Replacement"] = object{"type": "object", "required": []string{"baseVersion", "graph"}, "properties": object{"baseVersion": object{"type": "integer"}, "graph": ref("Graph")}, "additionalProperties": false}
	schemas["Import"] = object{"oneOf": []any{
		object{"type": "object", "required": []string{"format", "data"}, "properties": object{"format": object{"type": "string", "enum": []string{"json", "markdown", "csv"}}, "data": object{"oneOf": []any{ref("Graph"), object{"type": "string", "maxLength": absoluteImportByteLimit}}}}, "additionalProperties": false},
		ref("DiagramFileImportInput"),
	}}
	schemas["Import"].(object)["description"] = importLimitPolicyDescription
	schemas["Export"] = exportSchema()
	schemas["Error"] = object{"type": "object", "properties": object{"error": object{"type": "string"}, "code": object{"type": "string"}, "issues": object{"type": "array", "items": strictObject([]string{"path", "code", "message"}, object{"path": object{"type": "string"}, "code": object{"type": "string"}, "message": object{"type": "string"}})}}}
	schemas["Health"] = object{"type": "object", "properties": object{"status": object{"type": "string"}, "storage": object{"type": "string", "enum": []string{"indexeddb"}}, "bridge": object{"type": "boolean"}, "connected": object{"type": "integer"}, "version": object{"type": "string"}}}
	schemas["Health"].(object)["properties"].(object)["workspaceSecurity"] = ref("WorkspaceSecurityStatus")
	schemas["Health"].(object)["description"] = "Direct HTTP GET /api/v1/health (/health relative to the REST base) reports static bridge transport/software connectivity, version, tools and capabilities, without reading browser security state or records. visual_nerve_request with path:/health instead reports semantic health of the connected browser/IndexedDB workspace and may include workspaceSecurity; it does not expose bridge-only tools/capabilities. Their absence in the MCP browser response does not indicate an outdated bridge. Use GET /workspace/security for authoritative safe browser security metadata."
	schemas["WorkspaceBackup"] = object{"type": "object", "required": []string{"format", "formatVersion", "diagrams", "nodes", "edges", "owners", "settings", "templates"}, "properties": object{"format": object{"type": "string", "enum": []string{"visual-nerve-workspace"}}, "formatVersion": object{"type": "integer", "enum": []int{1}}, "schemaVersion": object{"type": "integer", "description": "IndexedDB schema version at export; currently 6. Older backups may omit this."}, "exportedAt": object{"type": "string", "format": "date-time"}, "diagrams": object{"type": "array", "items": ref("Diagram")}, "nodes": object{"type": "array", "items": ref("Node")}, "edges": object{"type": "array", "items": ref("Edge")}, "owners": object{"type": "array", "items": ref("Owner")}, "settings": object{"type": "array", "items": object{"type": "object", "required": []string{"key", "value"}, "properties": object{"key": object{"type": "string"}, "value": object{}}}}, "templates": object{"type": "array", "items": object{"type": "object", "properties": object{"id": object{"type": "string"}, "name": object{"type": "string"}, "builtin": object{"type": "boolean"}, "graph": ref("Graph")}}}}}
	schemas["WorkspaceBackup"].(object)["properties"].(object)["datasets"] = object{"type": "array", "items": ref("CsvDataset"), "description": "Original CSV source records. Older backups may omit this."}
	schemas["WorkspaceBackup"].(object)["description"] = "Portable local workspace data. The device-specific import-file-limit-mb and project-source-file-limit settings are excluded from export and ignored during Merge/Replace; the destination's selected limits are retained."
	schemas["WorkspaceBackup"].(object)["properties"].(object)["history"] = ref("HistoryBackup")
	schemas["WorkspaceBackup"].(object)["properties"].(object)["schemaVersion"].(object)["description"] = "IndexedDB schema version at export; currently 8. Older backups may omit this. History and simulation model/run/checkpoint archives are optional and included in complete workspace backups."
	schemas["WorkspaceBackup"].(object)["properties"].(object)["simulationModels"] = simArray("SimulationModelRecord")
	schemas["WorkspaceBackup"].(object)["properties"].(object)["simulationRuns"] = simArray("SimulationRunInfo")
	schemas["WorkspaceBackup"].(object)["properties"].(object)["simulationCheckpoints"] = simArray("SimulationCheckpointRecord")
	schemas["SearchResult"] = object{"type": "object", "properties": object{"kind": object{"type": "string", "enum": []string{"diagram", "node"}}, "diagramId": object{"type": "string", "format": "uuid"}, "nodeId": object{"type": "string", "format": "uuid"}, "title": object{"type": "string"}}}
	paths := object{}
	add := func(method, path, summary, input, output, status string) {
		responses := object{status: object{"description": "Success"}}
		if output != "" {
			out := ref(output)
			if strings.HasSuffix(output, "[]") {
				out = object{"type": "array", "items": ref(strings.TrimSuffix(output, "[]"))}
			}
			responses[status].(object)["content"] = object{"application/json": object{"schema": out}}
		}
		for code, description := range map[string]string{"400": "Malformed JSON or 32 MiB transport envelope exceeded", "401": "Bearer token required if configured", "403": "Untrusted origin/host, storage not accepted or read-only mutation denied", "404": "Unknown entity", "409": "Version or identity conflict", "422": "Input or graph validation failed; no partial writes", "428": "Version required", "500": "Browser storage failure", "503": "No connected browser or integration disabled", "504": "Browser did not respond"} {
			responses[code] = object{"description": description, "content": object{"application/json": object{"schema": ref("Error")}}}
		}
		responses["423"] = object{"description": "Connected encrypted workspace is locked or the request's originating session was revoked; human unlock in the browser is required", "content": object{"application/json": object{"schema": ref("WorkspaceLockedError")}}}
		op := object{"summary": summary, "operationId": strings.ToLower(method) + strings.NewReplacer("/", "_", "{", "", "}", "").Replace(path), "responses": responses}
		if input != "" {
			op["requestBody"] = object{"required": true, "content": object{"application/json": object{"schema": ref(input)}}}
		}
		if path != "/health" {
			op["security"] = []any{object{"bearerAuth": []string{}}, object{}}
		}
		if strings.Contains(path, "{") {
			params := []any{}
			for _, part := range strings.Split(path, "/") {
				if strings.HasPrefix(part, "{") {
					params = append(params, object{"name": strings.Trim(part, "{}"), "in": "path", "required": true, "schema": object{"type": "string", "format": "uuid"}})
				}
			}
			op["parameters"] = params
		}
		if paths[path] == nil {
			paths[path] = object{}
		}
		paths[path].(object)[strings.ToLower(method)] = op
	}
	add("GET", "/health", "Check static server and optional bridge; storage is in the browser", "", "Health", "200")
	add("GET", "/workspace/security", "Inspect safe versioned browser security status without unlocking or reading workspace records", "", "WorkspaceSecurityStatus", "200")
	paths["/workspace/security"].(object)["get"].(object)["description"] = workspaceSecurityPolicyDescription + workspaceSecurityReauthorizationDescription
	add("POST", "/workspace/lock", "Explicitly lock the encrypted browser workspace; never unlock or accept credentials", "WorkspaceLockInput", "WorkspaceSecurityStatus", "200")
	lockOperation := paths["/workspace/lock"].(object)["post"].(object)
	lockOperation["description"] = workspaceSecurityPolicyDescription + workspaceSecurityReauthorizationDescription
	lockOperation["requestBody"].(object)["required"] = false
	add("GET", "/templates", "Discover browser-local templates and complete graphs, including guided Process Simulator and kiosk example", "", "TemplateRecord[]", "200")
	add("GET", "/templates/{templateId}", "Read one browser-local template by its stable string key", "", "TemplateRecord", "200")
	paths["/templates/{templateId}"].(object)["get"].(object)["parameters"] = []any{object{"name": "templateId", "in": "path", "required": true, "schema": object{"type": "string", "minLength": 1}}}
	addPresentationPaths(add)
	addUnderstandingPaths(add, paths)
	addSimulationPaths(add, paths)
	add("GET", "/diagrams", "List diagrams", "", "Diagram[]", "200")
	addQuery(paths, "/diagrams", "type", object{"type": "string", "enum": model.DiagramTypes}, false)
	add("POST", "/diagrams", "Create a diagram", "DiagramInput", "Diagram", "201")
	add("POST", "/spatial-diagrams", "Create and open a 3D diagram with independent 2D layout", "SpatialDiagramInput", "Graph", "201")
	add("POST", "/sql/preview", "Preview a SELECT/WITH query or DDL without saving; allowed with read-only access", "SqlInput", "SqlImportResult", "200")
	add("POST", "/sql/diagrams", "Analyze SQL locally, then save and open its diagram transactionally; write access required", "SqlInput", "Graph", "201")
	add("GET", "/code/languages", "Discover 50 code language identifiers plus Markdown and structural analysis capabilities", "", "CodeLanguageDefinition[]", "200")
	add("GET", "/code/capabilities", "Discover code/ZIP source-file budgets and independent byte, entry, graph and time ceilings", "", "CodeCapabilities", "200")
	add("POST", "/code/preview", "Preview a local structural code outline without saving; read-only access allowed", "CodeInput", "CodeImportResult", "200")
	add("POST", "/code/project/preview", "Preview ZIP code or Markdown project locally without saving; read-only access allowed", "CodeProjectInput", "CodeImportResult", "200")
	add("POST", "/code/project/diagrams", "Save and open a ZIP project relationship diagram; write access required", "CodeProjectInput", "Graph", "201")
	add("POST", "/code/diagrams", "Save and open a locally analyzed code diagram; write access required", "CodeInput", "Graph", "201")
	add("POST", "/diagram-files/preview", "Preview draw.io or Visio pages locally without saving; exact endpoint permits read-only access", "DiagramFileInput", "DiagramImportResult", "200")
	add("GET", "/settings/import-file-limit-mb", "Read the effective browser-local import limit; absent or invalid saved values return 50; read-only access allowed", "", "ImportLimitSettingValue", "200")
	add("PUT", "/settings/import-file-limit-mb", "Set this browser's local import limit from 50 to 1024 MiB; write access required", "ImportLimitSettingInput", "", "200")
	add("GET", "/settings/project-source-file-limit", "Read the effective local ZIP source-file limit; missing/invalid saved values return 500; read-only access allowed", "", "ProjectFileLimitSettingValue", "200")
	add("PUT", "/settings/project-source-file-limit", "Set this browser's ZIP source-file limit from 500 to 10000; write access required", "ProjectFileLimitSettingInput", "", "200")
	add("GET", "/diagrams/{diagramId}", "Get complete canonical graph", "", "Graph", "200")
	add("PATCH", "/diagrams/{diagramId}", "Update diagram using its version", "DiagramPatch", "Diagram", "200")
	add("DELETE", "/diagrams/{diagramId}", "Delete diagram and graph; retain owners", "", "", "204")
	add("PUT", "/diagrams/{diagramId}/graph", "Replace graph transactionally at baseVersion", "Replacement", "Graph", "200")
	add("POST", "/diagrams/{diagramId}/bulk", "Populate or upsert nodes, edges and owners atomically", "Bulk", "Graph", "200")
	add("GET", "/diagrams/{diagramId}/nodes", "List nodes", "", "Node[]", "200")
	add("POST", "/diagrams/{diagramId}/nodes", "Create a node with sensible default position", "NodeInput", "Node", "201")
	add("GET", "/nodes/{nodeId}", "Get a node", "", "Node", "200")
	add("PATCH", "/nodes/{nodeId}", "Update node; append metadata keys; require version", "NodePatch", "Node", "200")
	add("DELETE", "/nodes/{nodeId}", "Delete node and incident edges; detach children", "", "", "204")
	add("POST", "/nodes/{nodeId}/children", "Create child and hierarchy relationship", "NodeInput", "Node", "201")
	add("GET", "/diagrams/{diagramId}/edges", "List relationships", "", "Edge[]", "200")
	add("POST", "/diagrams/{diagramId}/edges", "Create relationship", "EdgeInput", "Edge", "201")
	add("PATCH", "/edges/{edgeId}", "Update or reconnect relationship using version", "EdgePatch", "Edge", "200")
	add("DELETE", "/edges/{edgeId}", "Delete relationship", "", "", "204")
	add("GET", "/owners", "List global owners", "", "Owner[]", "200")
	add("POST", "/owners", "Create owner", "OwnerInput", "Owner", "201")
	add("PATCH", "/owners/{ownerId}", "Update owner and invalidate referencing diagrams", "OwnerPatch", "Owner", "200")
	add("POST", "/import", "Import JSON, Markdown, CSV or one selected draw.io/Visio page transactionally; write access required", "Import", "Graph", "201")
	add("POST", "/export", "Export canonical JSON, semantic Markdown or native vector SVG; read-only access allowed", "Export", "Graph", "200")
	paths["/export"].(object)["post"].(object)["responses"].(object)["200"].(object)["content"].(object)["application/json"] = object{"schema": object{"oneOf": []any{ref("Graph"), object{"type": "string"}}}}
	add("GET", "/workspace/export", "Download a complete browser workspace snapshot", "", "WorkspaceBackup", "200")
	add("POST", "/workspace/import", "Restore a workspace atomically without overwriting projects", "WorkspaceBackup", "Graph[]", "200")
	add("DELETE", "/owners/{ownerId}", "Remove owner and assignments atomically", "", "", "204")
	add("GET", "/search", "Search diagrams, nodes, descriptions, tags, owners and metadata", "", "SearchResult[]", "200")
	paths["/search"].(object)["get"].(object)["parameters"] = []any{object{"name": "q", "in": "query", "required": true, "schema": object{"type": "string"}}}
	addOperationPaths(add, paths, schemas)
	doc := object{"openapi": "3.0.3", "info": object{"title": "Visual Nerve local API", "version": "0.4.0", "description": "IndexedDB in the browser is authoritative and is the only database. This optional API forwards commands through a WebSocket bridge to an open browser with explicit storage acceptance and MCP access set to Read only or Read + write (default Off). Read-only access permits GET, POST /export, exact POST /sql/preview, /code/preview, /code/project/preview or /diagram-files/preview and exact diagram questions/build-brief previews, rejecting mutations with 403. Semantic overview, evidence-backed multi-level questions, local version history, editable storyboard scenes and reviewed app specifications share the same canonical graph and browser-local persistence. Draw.io XML and base64 Visio .vsdx ZIP files are analyzed locally without executing or fetching embedded content; POST /import saves only a selected native page and requires write access. Multipage imports require pageId from preview. Original XML/ZIP is transient. SQL SELECT/WITH visualization retains scoped aliases, expressions, joins and clauses locally; it never executes SQL or connects to a database. POST /sql/diagrams and POST /code/diagrams save and open validated graphs and require write access. GET /code/languages discovers 50 code languages plus Markdown. POST /code/project/preview and /code/project/diagrams accept strict base64 ZIP projects and files/symbols/folders modes, using the same local analysis engine. Project preview permits read-only access; saving requires write access. Code diagrams retain identifiers, paths, source lines and confidence; original source and nonstructural string values are discarded. The public static host provides no content API; endpoints target a loopback bridge only. Start the static server with --bridge. No application records are stored in the server. PATCH requires version; graph replacement requires baseVersion. Optional VISUAL_NERVE_BRIDGE_TOKEN protects all integration requests. PNG/PDF render in the browser. MCP is available at /mcp. Its initialize instructions advertise Process Simulator, native 2D and opt-in 3D. Process Simulator is a first-class local document with separately typed schemaVersion 1 semantics and the same deterministic worker engine for UI, API and MCP. Seeded runs return asynchronous IDs; headless execution needs no active canvas or animation but still requires a connected browser. Shared resources, queues, scaling, economics, replay and scenario results are semantically inspectable.  visual_nerve_api_docs provides a compact guide by default and the full bundled OpenAPI with document=openapi; the same documents are MCP resources. Documentation discovery requires no connected browser. The production browser workspace is at https://app.visualnerve.com/; https://www.visualnerve.com/ is the public product website. Former public /app paths redirect to the app root, while /app on the app origin returns 404. Browser records remain bound to their original origin and are never automatically moved or deleted. Local source-development builds may retain a development-only /app fixture. The exact app origin https://app.visualnerve.com without a path is the allowed production browser origin; Settings shows a separate local MCP HTTP URL for Codex and WebSocket URL for the browser. Public GET /mcp/ is setup documentation; local MCP POST /mcp and REST /api/v1 endpoints remain unchanged."}, "servers": []any{object{"url": "http://127.0.0.1:4317/api/v1", "description": "Optional local bridge on this computer"}}, "paths": paths, "components": object{"schemas": schemas, "responses": bridgeResponses(), "securitySchemes": object{"bearerAuth": object{"type": "http", "scheme": "bearer", "description": "Optional token for all local integration requests"}}}}
	doc["info"].(object)["description"] = doc["info"].(object)["description"].(string) + " " + workspaceSecurityPolicyDescription + workspaceSecurityReauthorizationDescription + " The app interface supports en, da, nb, sv, fi, de, es and fr, selected in browser Settings; English is the default. This display-only technical preference does not change canonical API/MCP field names, enum values, errors, schemas, source data or deterministic results. It is not a private workspace setting, is excluded from backups, and does not change narration voice. Help and API documentation remain in English."
	doc["info"].(object)["description"] = doc["info"].(object)["description"].(string) + " visual_nerve_api_docs also supports document:endpoint with an exact documented path template and uppercase method, returning that operation with shared path parameters and its complete transitive component/security dependencies. No browser, external fetch or schema truncation is involved. Canonical IDs are UUIDs; externalId is an optional client-defined integration string. Bulk updates match externalId only; use versioned PATCH to edit by canonical UUID."
	doc["info"].(object)["description"] = doc["info"].(object)["description"].(string) + " " + operationPolicyDescription
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		panic(err)
	}
	path := "../docs/openapi.yaml"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		panic(err)
	}
	if err = os.WriteFile(path, append(raw, '\n'), 0644); err != nil {
		panic(err)
	}
	fmt.Println(path)
}
