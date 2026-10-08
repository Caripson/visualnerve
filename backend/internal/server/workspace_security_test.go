package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

func TestWorkspaceSecurityStatusAndLockedErrorsUseExistingRESTAndMCPTransport(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	browser := attach(t, handler, host, workspace)
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		name, path, method, body string
		status                   int
	}{
		{"safe discovery", "/workspace/security", "GET", `{"type":"workspace-security","schemaVersion":1,"mode":"encrypted","state":"locked","storage":"indexeddb","logicalSchemaVersion":8,"vaultSchemaVersion":1,"cipher":"AES-256-GCM","requiresHumanUnlock":true,"programmaticUnlock":false,"requestsRenewIdleTimeout":false,"contentRequiresUnlock":true}`, 200},
		{"explicit lock", "/workspace/lock", "POST", `{"type":"workspace-security","schemaVersion":1,"mode":"encrypted","state":"locked","programmaticLock":true}`, 200},
		{"locked content", "/diagrams", "GET", `{"error":"Unlock the workspace in the browser to continue.","code":"WORKSPACE_LOCKED"}`, 423},
	} {
		for _, transport := range []string{"REST", "MCP"} {
			t.Run(test.name+" "+transport, func(t *testing.T) {
				done := make(chan error, 1)
				command := make(chan map[string]any, 1)
				go func() {
					var request map[string]any
					if err := wsjson.Read(ctx, browser, &request); err != nil {
						done <- err
						return
					}
					command <- request
					done <- wsjson.Write(ctx, browser, map[string]any{"id": request["id"], "status": test.status, "body": json.RawMessage(test.body)})
				}()
				if transport == "REST" {
					request, err := http.NewRequest(test.method, host.URL+"/api/v1"+test.path, strings.NewReader(`{}`))
					if err != nil {
						t.Fatal(err)
					}
					request.Header.Set("Content-Type", "application/json")
					response, err := http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					data, err := io.ReadAll(response.Body)
					response.Body.Close()
					if err != nil || response.StatusCode != test.status || string(bytes.TrimSpace(data)) != test.body {
						t.Fatal("REST changed browser security result", response.StatusCode, string(data), err)
					}
				} else {
					params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": test.path, "method": test.method, "data": map[string]any{}}})
					result := resultMCP(t, callMCP(t, handler, "tools/call", params))
					structured := result["structuredContent"].(map[string]any)
					if structured["status"] != float64(test.status) || result["isError"] != (test.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != test.body {
						t.Fatal("MCP changed browser security result", result)
					}
					if test.status == 423 && structured["body"].(map[string]any)["code"] != "WORKSPACE_LOCKED" {
						t.Fatal("MCP lost the structured lock code", result)
					}
				}
				if err := <-done; err != nil {
					t.Fatal(err)
				}
				if request := <-command; request["path"] != test.path || request["method"] != test.method {
					t.Fatal("browser semantic discovery must use the existing command", request)
				}
			})
		}
	}
}

func TestWorkspaceSecurityIsUnavailableWithoutBrowserButDocsRemainDiscoverable(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, path := range []string{"/workspace/security", "/diagrams"} {
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": path}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if result["isError"] != true || result["structuredContent"].(map[string]any)["status"] != float64(503) {
			t.Fatal("unavailable browser must remain 503, not a simulated lock status", result)
		}
	}
	for _, document := range []string{"guide", "openapi"} {
		result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"`+document+`"}}`)))
		text := result["content"].([]any)[0].(map[string]any)["text"].(string)
		if result["isError"] != false {
			t.Fatal("public documentation discovery must not require unlock", result)
		}
		for _, phrase := range []string{"/workspace/security", "WORKSPACE_LOCKED", "requestsRenewIdleTimeout", "AES-256-GCM", "legacy", "/workspace/lock"} {
			if !strings.Contains(text, phrase) {
				t.Fatal("bundled security discovery missing", document, phrase)
			}
		}
	}
	for _, text := range []string{mcpInstructions, mcpToolDescription} {
		for _, phrase := range []string{"/workspace/security", "423", "WORKSPACE_LOCKED", "503", "programmaticUnlock:false", "requestsRenewIdleTimeout:false", "Do not ask an agent", "same authoritative UI/API/MCP"} {
			if !strings.Contains(text, phrase) {
				t.Fatal("MCP security instructions missing", phrase)
			}
		}
	}
}
