package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// Stateless Streamable HTTP endpoint. Tool execution always passes through the browser bridge.
func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	if !s.config.Bridge {
		failure(w, 404, "local integration is disabled")
		return
	}
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		failure(w, 405, "use MCP Streamable HTTP POST")
		return
	}
	data, err := readJSON(w, r)
	if err != nil {
		failure(w, 400, err.Error())
		return
	}
	var request struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if json.Unmarshal(data, &request) != nil || request.JSONRPC != "2.0" || request.Method == "" {
		failure(w, 400, "invalid JSON-RPC request")
		return
	}
	if len(request.ID) == 0 {
		if strings.HasPrefix(request.Method, "notifications/") {
			w.WriteHeader(202)
		} else {
			failure(w, 400, "request id is required")
		}
		return
	}
	response := map[string]any{"jsonrpc": "2.0", "id": request.ID}
	switch request.Method {
	case "initialize":
		response["result"] = map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]string{"name": "visual-nerve", "version": "0.2.0"}, "instructions": "Commands require an open Visual Nerve browser with local integration enabled. IndexedDB in the browser is the only database."}
	case "ping":
		response["result"] = map[string]any{}
	case "tools/list":
		response["result"] = map[string]any{"tools": []any{map[string]any{"name": "visual_nerve_request", "description": mcpToolDescription, "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string"}, "method": map[string]any{"type": "string", "enum": []string{"GET", "POST", "PUT", "PATCH", "DELETE"}}, "data": map[string]any{}, "workspaceId": map[string]string{"type": "string"}}, "additionalProperties": false}}}}
	case "tools/call":
		var params struct {
			Name      string `json:"name"`
			Arguments struct {
				Path        string          `json:"path"`
				Method      string          `json:"method"`
				Data        json.RawMessage `json:"data"`
				WorkspaceID string          `json:"workspaceId"`
			} `json:"arguments"`
		}
		if json.Unmarshal(request.Params, &params) != nil || params.Name != "visual_nerve_request" {
			response["error"] = map[string]any{"code": -32602, "message": "unknown tool or invalid arguments"}
			break
		}
		if params.Arguments.Method == "" {
			params.Arguments.Method = "GET"
		}
		ctx, cancel := context.WithTimeout(r.Context(), commandTimeout(params.Arguments.Path))
		result, err := s.forward(ctx, params.Arguments.WorkspaceID, params.Arguments.Path, params.Arguments.Method, params.Arguments.Data)
		cancel()
		if err != nil {
			result.Body, _ = json.Marshal(map[string]string{"error": err.Error()})
		}
		if len(result.Body) == 0 {
			result.Body = json.RawMessage(`null`)
		}
		response["result"] = map[string]any{"isError": err != nil || result.Status >= 400, "content": []any{map[string]string{"type": "text", "text": string(result.Body)}}, "structuredContent": map[string]any{"status": result.Status, "body": result.Body}}
	default:
		response["error"] = map[string]any{"code": -32601, "message": "method not found"}
	}
	send(w, 200, response)
}
