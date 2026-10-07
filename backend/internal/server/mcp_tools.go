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
				},
				"additionalProperties": false,
			},
		},
		map[string]any{
			"name":        "visual_nerve_api_docs",
			"title":       "Visual Nerve API guide and OpenAPI",
			"description": "Read the bundled public API guide and complete OpenAPI contract directly through MCP before using visual_nerve_request. Explains Process Simulator semantic model CRUD, shared resources, seeded animated/headless runs, live metrics, events, replay and scenario comparison; native 2D, requested 3D via POST /spatial-diagrams, semantic overview, source-backed relationship questions, local version history, editable storyboards, reviewed Lovable app specifications, numbered presentations, local English/Swedish speech and browser-local 720p30 video export. Also covers independent 2D layout, IndexedDB storage, permissions, SQL/code analysis and versioned edits. No connected browser, external URL, workspace records or graph command is needed. Start with omitted document or guide for the compact guide; request openapi for the complete OpenAPI contract or all for both when needed.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"document": map[string]any{"type": "string", "enum": []string{"all", "guide", "openapi"}, "default": "guide"},
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
	arguments, err := mcpObject(data, false, "path", "method", "data", "workspaceId")
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
	if method == "" {
		method = "GET"
	}
	if method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return nil, invalidMCPParams("unsupported command method")
	}
	ctx, cancel := context.WithTimeout(ctx, commandTimeout(path))
	defer cancel()
	result, forwardError := s.forward(ctx, workspace, path, method, arguments["data"])
	if forwardError != nil {
		result.Body, _ = json.Marshal(map[string]string{"error": forwardError.Error()})
	}
	if len(result.Body) == 0 {
		result.Body = json.RawMessage(`null`)
	}
	return map[string]any{
		"isError":           forwardError != nil || result.Status >= 400,
		"content":           []any{map[string]string{"type": "text", "text": string(result.Body)}},
		"structuredContent": map[string]any{"status": result.Status, "body": result.Body},
	}, nil
}
