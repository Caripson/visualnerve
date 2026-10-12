package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPCollaborationDocumentDiscoveryIsOfflineAndComplete(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	instructions := initialized["instructions"].(string) + mcpAPIGuide
	if initialized["serverInfo"].(map[string]any)["version"] != "0.9.0" || !strings.HasPrefix(mcpCollaborationDocumentPolicy, "Bridge 0.9.0 ") {
		t.Fatal("document discovery must describe the current bridge release")
	}
	for _, phrase := range []string{"collaboration-document-v1", "/collaboration/document", "/collaboration/actions", "unverified", "informational", "approved editors", "not a signed or immutable", "baseVersion"} {
		if !strings.Contains(instructions, phrase) {
			t.Fatal("missing document workflow/trust boundary", phrase)
		}
	}
	for _, command := range []struct {
		path, method string
		schemas      []string
	}{
		{"/diagrams/{diagramId}/collaboration/document", "GET", []string{"CollaborationDocumentSnapshot", "CollaborationDocument", "ParticipantProfile", "CommentThread", "CommentMessage", "CollaborationTask", "CollaborationActivity"}},
		{"/diagrams/{diagramId}/collaboration/actions", "POST", []string{"CollaborationActionInput", "CollaborationAction", "ProfileCreateInput", "ProfileUpdateInput", "CollaborationTaskCreateInput", "CollaborationTaskUpdateInput", "Graph", "Diagram", "CollaborationDocument"}},
	} {
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_api_docs", "arguments": map[string]any{"document": "endpoint", "path": command.path, "method": command.method}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if result["isError"] != false {
			t.Fatal("offline scoped document discovery failed", result)
		}
		var document map[string]any
		if err := json.Unmarshal([]byte(result["content"].([]any)[0].(map[string]any)["text"].(string)), &document); err != nil {
			t.Fatal(err)
		}
		schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
		for _, schema := range command.schemas {
			if schemas[schema] == nil {
				t.Fatal("missing transitive document schema", schema)
			}
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("documentation discovery must not require a browser connection")
	}
}
