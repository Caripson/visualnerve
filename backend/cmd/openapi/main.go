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
			if key == "id" || strings.HasSuffix(key, "Id") {
				s["format"] = "uuid"
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
	schemas["SpatialPoint"] = object{"type": "object", "required": []string{"x", "y", "z"}, "additionalProperties": false, "properties": object{"x": object{"type": "number", "minimum": -1000000, "maximum": 1000000}, "y": object{"type": "number", "minimum": -1000000, "maximum": 1000000}, "z": object{"type": "number", "minimum": -1000000, "maximum": 1000000}}}
	schemas["SpatialCameraPoint"] = object{"type": "object", "required": []string{"x", "y", "z"}, "additionalProperties": false, "properties": object{"x": object{"type": "number", "minimum": -10000000, "maximum": 10000000}, "y": object{"type": "number", "minimum": -10000000, "maximum": 10000000}, "z": object{"type": "number", "minimum": -10000000, "maximum": 10000000}}}
	schemas["SpatialCameraUp"] = object{"type": "object", "required": []string{"x", "y", "z"}, "additionalProperties": false, "description": "Unit up vector, not parallel to position-target. Defaults to +Y when omitted. Preserves roll from the Z-axis view control.", "properties": object{"x": object{"type": "number", "minimum": -1, "maximum": 1}, "y": object{"type": "number", "minimum": -1, "maximum": 1}, "z": object{"type": "number", "minimum": -1, "maximum": 1}}}
	schemas["SpatialCamera"] = object{"type": "object", "required": []string{"position", "target"}, "additionalProperties": false, "description": "Position must differ from target. +Y is up, +Z is front and -X is left. Camera coordinates have a wider limit to frame all valid node positions. Optional up preserves view roll.", "properties": object{"position": ref("SpatialCameraPoint"), "target": ref("SpatialCameraPoint"), "up": ref("SpatialCameraUp")}}
	schemas["SpatialView"] = object{"type": "object", "required": []string{"version", "mode"}, "additionalProperties": false, "properties": object{"version": object{"type": "integer", "enum": []int{1}}, "mode": object{"type": "string", "enum": []string{"2d", "3d"}}, "camera": ref("SpatialCamera")}}
	schemas["SpatialNode"] = object{"type": "object", "required": []string{"version"}, "additionalProperties": false, "properties": object{"version": object{"type": "integer", "enum": []int{1}}, "position": ref("SpatialPoint")}}
	schemas["SpatialDiagramInput"] = object{"type": "object", "required": []string{"name"}, "additionalProperties": false, "properties": object{"name": object{"type": "string", "minLength": 1, "maxLength": 500}, "type": object{"type": "string", "enum": model.DiagramTypes}}}
	for name, v := range map[string]any{"Diagram": model.Diagram{}, "Node": model.Node{}, "Edge": model.Edge{}, "Owner": model.Owner{}} {
		s := schema(reflect.TypeOf(v))
		p := s["properties"].(object)
		if name == "Diagram" {
			p["settings"].(object)["properties"] = object{"spatialView": ref("SpatialView")}
			p["type"].(object)["enum"] = model.DiagramTypes
			s["required"] = []string{"name", "type"}
		}
		if name == "Node" {
			p["metadata"].(object)["properties"] = object{"spatial": ref("SpatialNode")}
			p["nodeType"].(object)["enum"] = model.NodeTypes
			s["required"] = []string{"title"}
		}
		if name == "Edge" {
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
	for _, name := range []string{"Node", "Edge", "Owner"} {
		s := clone(schemas[name+"Input"].(object))
		delete(s, "required")
		s["description"] = "Existing external-ID upserts accept partial fields. New nodes require title, new owners require name, and new edges require endpoints."
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
	schemas["Import"] = object{"type": "object", "required": []string{"format", "data"}, "properties": object{"format": object{"type": "string", "enum": []string{"json", "markdown", "csv"}}, "data": object{"oneOf": []any{ref("Graph"), object{"type": "string"}}}}, "additionalProperties": false}
	schemas["Export"] = object{"type": "object", "required": []string{"diagramId", "format"}, "properties": object{"diagramId": object{"type": "string", "format": "uuid"}, "format": object{"type": "string", "enum": []string{"json", "markdown"}}}, "additionalProperties": false}
	schemas["Error"] = object{"type": "object", "properties": object{"error": object{"type": "string"}}}
	schemas["Health"] = object{"type": "object", "properties": object{"status": object{"type": "string"}, "storage": object{"type": "string", "enum": []string{"indexeddb"}}, "bridge": object{"type": "boolean"}, "connected": object{"type": "integer"}, "version": object{"type": "string"}}}
	schemas["WorkspaceBackup"] = object{"type": "object", "required": []string{"format", "formatVersion", "diagrams", "nodes", "edges", "owners", "settings", "templates"}, "properties": object{"format": object{"type": "string", "enum": []string{"visual-nerve-workspace"}}, "formatVersion": object{"type": "integer", "enum": []int{1}}, "schemaVersion": object{"type": "integer", "description": "IndexedDB schema version at export; currently 6. Older backups may omit this."}, "exportedAt": object{"type": "string", "format": "date-time"}, "diagrams": object{"type": "array", "items": ref("Diagram")}, "nodes": object{"type": "array", "items": ref("Node")}, "edges": object{"type": "array", "items": ref("Edge")}, "owners": object{"type": "array", "items": ref("Owner")}, "settings": object{"type": "array", "items": object{"type": "object", "required": []string{"key", "value"}, "properties": object{"key": object{"type": "string"}, "value": object{}}}}, "templates": object{"type": "array", "items": object{"type": "object", "properties": object{"id": object{"type": "string"}, "name": object{"type": "string"}, "builtin": object{"type": "boolean"}, "graph": ref("Graph")}}}}}
	schemas["WorkspaceBackup"].(object)["properties"].(object)["datasets"] = object{"type": "array", "items": ref("CsvDataset"), "description": "Original CSV source records. Older backups may omit this."}
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
		for code, description := range map[string]string{"400": "Malformed JSON", "401": "Bearer token required if configured", "403": "Untrusted origin or host", "404": "Unknown entity", "409": "Version or identity conflict", "422": "Graph validation failed; no partial writes", "428": "Version required", "500": "Browser storage failure", "503": "No connected browser or integration disabled", "504": "Browser did not respond"} {
			responses[code] = object{"description": description, "content": object{"application/json": object{"schema": ref("Error")}}}
		}
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
	add("GET", "/diagrams", "List diagrams", "", "Diagram[]", "200")
	add("POST", "/diagrams", "Create a diagram", "DiagramInput", "Diagram", "201")
	add("POST", "/spatial-diagrams", "Create and open a 3D diagram with independent 2D layout", "SpatialDiagramInput", "Graph", "201")
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
	add("POST", "/import", "Import JSON, Markdown or CSV transactionally", "Import", "Graph", "201")
	add("POST", "/export", "Export canonical JSON or semantic Markdown", "Export", "Graph", "200")
	paths["/export"].(object)["post"].(object)["responses"].(object)["200"].(object)["content"].(object)["application/json"] = object{"schema": object{"oneOf": []any{ref("Graph"), object{"type": "string"}}}}
	add("GET", "/workspace/export", "Download a complete browser workspace snapshot", "", "WorkspaceBackup", "200")
	add("POST", "/workspace/import", "Restore a workspace atomically without overwriting projects", "WorkspaceBackup", "Graph[]", "200")
	add("DELETE", "/owners/{ownerId}", "Remove owner and assignments atomically", "", "", "204")
	add("GET", "/search", "Search diagrams, nodes, descriptions, tags, owners and metadata", "", "SearchResult[]", "200")
	paths["/search"].(object)["get"].(object)["parameters"] = []any{object{"name": "q", "in": "query", "required": true, "schema": object{"type": "string"}}}
	doc := object{"openapi": "3.0.3", "info": object{"title": "Visual Nerve local API", "version": "0.2.0", "description": "IndexedDB in the browser is authoritative and is the only database. This optional API forwards commands through a WebSocket bridge to an open browser with explicit storage acceptance and MCP access set to Read only or Read + write (default Off). Read-only access permits GET and POST /export, rejecting mutations with 403. The public static host provides no content API; endpoints target a loopback bridge only. Start the static server with --bridge. No application records are stored in the server. PATCH requires version; graph replacement requires baseVersion. Optional VISUAL_NERVE_BRIDGE_TOKEN protects all integration requests. PNG/PDF render in the browser. MCP is available at /mcp."}, "servers": []any{object{"url": "http://127.0.0.1:4317/api/v1", "description": "Optional local bridge on this computer"}}, "paths": paths, "components": object{"schemas": schemas, "securitySchemes": object{"bearerAuth": object{"type": "http", "scheme": "bearer", "description": "Optional token for all local integration requests"}}}}
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
