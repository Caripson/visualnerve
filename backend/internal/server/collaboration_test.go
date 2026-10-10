package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

func TestMCPCollaborationDiscoveryIsOfflineAndDoesNotExposeAdmission(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"collaboration-v1", "/collaboration/capabilities", "/collaboration/sessions", "human-only", "not independently audited", "fresh device", "Read + write"} {
		if !strings.Contains(initialized["instructions"].(string)+mcpAPIGuide, phrase) {
			t.Fatal("missing collaboration boundary in discovery", phrase)
		}
	}
	result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/diagrams/{diagramId}/collaboration","method":"GET"}}`)))
	if result["isError"] != false {
		t.Fatal("offline endpoint discovery failed", result)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(result["content"].([]any)[0].(map[string]any)["text"].(string)), &document); err != nil {
		t.Fatal(err)
	}
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"CollaborationSession", "CollaborationParticipant", "CollaborationScope", "Error", "WorkspaceLockedError"} {
		if schemas[name] == nil {
			t.Fatal("scoped docs lack required transitive contract", name)
		}
	}
	for _, name := range []string{"CollaborationSession", "CollaborationParticipant"} {
		props := schemas[name].(map[string]any)["properties"].(map[string]any)
		for _, secret := range []string{"invitation", "ownerCredentialId", "credentialId", "privateState", "relayUrl", "error"} {
			if props[secret] != nil {
				t.Fatal("semantic inspection exposes a private field", name, secret)
			}
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("documentation discovery must not open workspace connections")
	}
}

func TestMCPCollaborationUsesExistingAuthoritativeBrowserCommands(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	conn := attach(t, handler, host, workspace)
	defer conn.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, fixture := range []struct {
		path, method, body string
		status             int
	}{
		{"/collaboration/capabilities", "GET", `{"configured":false,"controls":{"create":false,"join":false}}`, 200},
		{"/diagrams/00000000-0000-4000-8000-000000000002/collaboration", "GET", `{"diagramId":"00000000-0000-4000-8000-000000000002","status":"live","role":"viewer","participants":[]}`, 200},
		{"/diagrams/00000000-0000-4000-8000-000000000002/collaboration/disconnect", "POST", `{"error":"Read-only access cannot disconnect this session"}`, 403},
	} {
		done := make(chan error, 1)
		go func() {
			var command map[string]any
			if err := wsjson.Read(ctx, conn, &command); err != nil {
				done <- err
				return
			}
			if command["path"] != fixture.path || command["method"] != fixture.method {
				done <- context.Canceled
				return
			}
			done <- wsjson.Write(ctx, conn, map[string]any{"id": command["id"], "status": fixture.status, "body": json.RawMessage(fixture.body)})
		}()
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": fixture.path, "method": fixture.method, "data": map[string]any{}, "workspaceId": workspace}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if err := <-done; err != nil {
			t.Fatal("browser semantic route altered", err)
		}
		if result["structuredContent"].(map[string]any)["status"] != float64(fixture.status) || result["isError"] != (fixture.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != fixture.body {
			t.Fatal("MCP must preserve browser authorization/status and semantic body", result)
		}
	}
}
