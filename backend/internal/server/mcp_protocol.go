package server

import (
	"bytes"
	"encoding/json"
)

const mcpLatestProtocol = "2025-11-25"
const mcpProtocolPolicy = "MCP supports protocol versions 2025-03-26, 2025-06-18 and 2025-11-25. Initialize negotiates a requested supported version or falls back to 2025-11-25. HTTP requests after initialization use MCP-Protocol-Version; a missing header assumes the backwards-compatible 2025-03-26 subset. This stateless JSON endpoint does not offer the deprecated HTTP+SSE transport, server-initiated requests or an SSE stream. Tools/resources and browser permission checks are the same for every MCP client. "

func supportedMCPProtocol(version string) bool {
	return version == "2025-03-26" || version == "2025-06-18" || version == mcpLatestProtocol
}

func mcpNestedObject(data json.RawMessage) (map[string]json.RawMessage, *mcpError) {
	data = bytes.TrimSpace(data)
	var object map[string]json.RawMessage
	if len(data) == 0 || data[0] != '{' || json.Unmarshal(data, &object) != nil {
		return nil, invalidMCPParams("capabilities and clientInfo must be JSON objects")
	}
	return object, nil
}

func mcpInitialize(data json.RawMessage) (any, *mcpError) {
	params, err := mcpObject(data, false, "protocolVersion", "capabilities", "clientInfo", "_meta")
	if err != nil {
		return nil, err
	}
	version, err := mcpString(params, "protocolVersion", true)
	if err != nil {
		return nil, err
	}
	if _, err = mcpNestedObject(params["capabilities"]); err != nil {
		return nil, err
	}
	client, err := mcpNestedObject(params["clientInfo"])
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"name", "version"} {
		if _, exists := client[key]; !exists {
			return nil, invalidMCPParams("clientInfo." + key + " is required")
		}
		if _, err = mcpString(client, key, false); err != nil {
			return nil, err
		}
	}
	if !supportedMCPProtocol(version) {
		version = mcpLatestProtocol
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities":    map[string]any{"tools": map[string]any{}, "resources": map[string]any{}},
		"serverInfo":      map[string]string{"name": "visual-nerve", "version": "0.3.0"},
		"instructions":    mcpProtocolPolicy + mcpInstructions,
	}, nil
}
