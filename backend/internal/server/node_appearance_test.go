package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNodeBackgroundColorMCPDiscoveryIncludesStrictAndResetSchemas(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"backgroundColor", "#RRGGBB", "backgroundColor:null", "INVALID_NODE_BACKGROUND_COLOR"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) || !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("fill policy absent from initialization or guide", phrase)
		}
	}
	for _, path := range []string{"/nodes/{nodeId}", "/diagrams/{diagramId}/bulk"} {
		method := "PATCH"
		if strings.HasSuffix(path, "/bulk") {
			method = "POST"
		}
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_api_docs", "arguments": map[string]any{"document": "endpoint", "path": path, "method": method}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		text := result["content"].([]any)[0].(map[string]any)["text"].(string)
		for _, phrase := range []string{"backgroundColor", "NodeBackgroundColorPatch", "nullable", "^#[0-9a-fA-F]{6}$"} {
			if result["isError"] != false || !strings.Contains(text, phrase) {
				t.Fatal("endpoint docs must retain fill schema closure", path, phrase)
			}
		}
	}
}
