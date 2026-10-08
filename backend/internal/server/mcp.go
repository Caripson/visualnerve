package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Stateless Streamable HTTP endpoint. Workspace commands use the browser bridge;
// documentation discovery reads only the bundled public API contract.
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
	if !utf8.Valid(data) {
		failure(w, 400, "MCP JSON must be valid UTF-8")
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
	// Sessions are stateless. Missing headers use the backwards-compatible
	// 2025-03-26 subset. Reject unsupported headers before dispatch, preserving
	// a valid request's ID in a self-contained JSON-RPC transport error.
	if version := r.Header.Get("MCP-Protocol-Version"); version != "" && !supportedMCPProtocol(version) {
		response := map[string]any{"jsonrpc": "2.0", "error": &mcpError{Code: -32600, Message: "unsupported MCP-Protocol-Version"}}
		if validMCPRequestID(request.ID) {
			response["id"] = request.ID
		}
		send(w, 400, response)
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
	if !validMCPRequestID(request.ID) {
		failure(w, 400, "MCP request id must be a string or number")
		return
	}
	response := map[string]any{"jsonrpc": "2.0", "id": request.ID}
	switch request.Method {
	case "initialize":
		result, err := mcpInitialize(request.Params)
		if err != nil {
			response["error"] = err
		} else {
			response["result"] = result
		}
	case "ping":
		response["result"] = map[string]any{}
	case "tools/list":
		if err := mcpListParams(request.Params); err != nil {
			response["error"] = err
		} else {
			response["result"] = map[string]any{"tools": mcpTools()}
		}
	case "tools/call":
		result, err := s.mcpCallTool(r.Context(), request.Params)
		if err != nil {
			response["error"] = err
		} else {
			response["result"] = result
		}
	case "resources/list", "resources/templates/list":
		if err := mcpListParams(request.Params); err != nil {
			response["error"] = err
		} else if request.Method == "resources/templates/list" {
			response["result"] = map[string]any{"resourceTemplates": []any{}}
		} else {
			response["result"] = map[string]any{"resources": mcpResources()}
		}
	case "resources/read":
		result, err := s.mcpReadResource(request.Params)
		if err != nil {
			response["error"] = err
		} else {
			response["result"] = result
		}
	default:
		response["error"] = map[string]any{"code": -32601, "message": "method not found"}
	}
	send(w, 200, response)
}
