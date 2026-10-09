package server

import (
	"context"
	"encoding/json"
)

func mcpTools() []any {
	return []any{
		map[string]any{
			"name":        "visual_nerve_request",
			"description": mcpToolDescription,
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"path"},
				"properties": map[string]any{
					"path":        map[string]string{"type": "string", "description": "Browser command path without /api/v1. Read the contract with visual_nerve_api_docs."},
					"method":      map[string]any{"type": "string", "enum": []string{"GET", "POST", "PUT", "PATCH", "DELETE"}},
					"data":        map[string]any{},
					"workspaceId": map[string]string{"type": "string"},
					"operationId": map[string]any{"type": "string", "minLength": 1, "description": "Bridge-issued write operation ID from POST /operations or an earlier write. Retry only with the same ID and exact method/path/data; inspect GET /operations/{operationId} after an unknown outcome."},
				},
				"additionalProperties": false,
			},
		},
		map[string]any{
			"name":        "visual_nerve_api_docs",
			"title":       "Visual Nerve API guide and OpenAPI",
			"description": "Read the bundled public API guide and complete OpenAPI contract directly through MCP before using visual_nerve_request. Explains Process Simulator semantic model CRUD, hierarchical subprocesses and process drilldown with actual scoped queues/bottlenecks/economics, shared resources, seeded animated/headless runs, live metrics, events, replay and scenario comparison; native 2D, requested 3D via POST /spatial-diagrams, semantic overview, source-backed relationship questions, local version history, editable storyboards, reviewed Lovable app specifications, numbered presentations with independently minimized controls and canvas captions, local multilingual Piper speech with full-walkthrough preloading and browser-local 720p30 video export. Also covers safe encrypted-workspace discovery, human-only unlock and structured WORKSPACE_LOCKED errors, independent 2D layout, IndexedDB storage, permissions, SQL/code analysis and versioned edits. No connected browser, external URL, workspace records or graph command is needed. Start with omitted document or guide for the compact guide; request endpoint with an exact path template and uppercase method for one operation and all transitive schema/security dependencies, openapi for the complete contract or all for both full documents. Endpoint discovery never truncates schemas.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"document": map[string]any{"type": "string", "enum": []string{"all", "guide", "openapi", "endpoint"}, "default": "guide"},
					"path":     map[string]any{"type": "string", "description": "Required for document endpoint only: exact OpenAPI path template, for example /diagrams/{diagramId}/bulk. No /api/v1 prefix, actual IDs or query parameters."},
					"method":   map[string]any{"type": "string", "enum": []string{"GET", "POST", "PUT", "PATCH", "DELETE"}, "description": "Required for document endpoint only."},
				},
				"allOf": []any{
					map[string]any{"oneOf": []any{
						map[string]any{"required": []string{"document", "path", "method"}, "properties": map[string]any{"document": map[string]any{"enum": []string{"endpoint"}}}},
						map[string]any{"not": map[string]any{"anyOf": []any{
							map[string]any{"required": []string{"path"}},
							map[string]any{"required": []string{"method"}},
							map[string]any{"required": []string{"document"}, "properties": map[string]any{"document": map[string]any{"enum": []string{"endpoint"}}}},
						}}},
					}},
				},
				"additionalProperties": false,
			},
			"annotations": map[string]bool{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false},
		},
	}
}

func (s *Server) mcpCallTool(ctx context.Context, data json.RawMessage) (any, *mcpError) {
	params, err := mcpObject(data, false, "name", "arguments", "_meta")
	if err != nil {
		return nil, err
	}
	name, err := mcpString(params, "name", true)
	if err != nil {
		return nil, err
	}
	switch name {
	case "visual_nerve_request":
		return s.mcpRequestTool(ctx, params["arguments"])
	case "visual_nerve_api_docs":
		return s.mcpDocsTool(params["arguments"])
	default:
		return nil, invalidMCPParams("unknown tool: " + name)
	}
}

func (s *Server) mcpRequestTool(ctx context.Context, data json.RawMessage) (any, *mcpError) {
	arguments, err := mcpObject(data, false, "path", "method", "data", "workspaceId", "operationId")
	if err != nil {
		return nil, err
	}
	path, err := mcpString(arguments, "path", true)
	if err != nil {
		return nil, err
	}
	method, err := mcpString(arguments, "method", false)
	if err != nil {
		return nil, err
	}
	workspace, err := mcpString(arguments, "workspaceId", false)
	if err != nil {
		return nil, err
	}
	operationID, err := mcpString(arguments, "operationId", false)
	if err != nil {
		return nil, err
	}
	if _, present := arguments["operationId"]; present && operationID == "" {
		return nil, invalidMCPParams("operationId must not be empty")
	}
	if method == "" {
		method = "GET"
	}
	if method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return nil, invalidMCPParams("unsupported command method")
	}
	ctx, cancel := context.WithTimeout(ctx, commandTimeout(path))
	defer cancel()
	result, forwardError := s.forwardOperation(ctx, workspace, path, method, arguments["data"], operationID)
	if forwardError != nil && len(result.Body) == 0 {
		result.Body, _ = json.Marshal(map[string]string{"error": forwardError.Error()})
	}
	if len(result.Body) == 0 {
		result.Body = json.RawMessage(`null`)
	}
	structured := map[string]any{"status": result.Status, "body": result.Body}
	if result.OperationID != "" {
		structured["operationId"] = result.OperationID
	}
	return map[string]any{
		"isError":           forwardError != nil || result.Status >= 400,
		"content":           []any{map[string]string{"type": "text", "text": string(result.Body)}},
		"structuredContent": structured,
	}, nil
}
