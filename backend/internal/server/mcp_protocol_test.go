package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

func protocolPost(t *testing.T, handler *Server, body, version string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "http://localhost/mcp", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:23456"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if version != "" {
		request.Header.Set("MCP-Protocol-Version", version)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func protocolJSON(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("expected a standard JSON MCP response, got %d %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMCPHTTPRejectsMalformedUTF8BeforeDispatch(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	response := protocolPost(t, handler, "{\"jsonrpc\":\"2.0\",\"id\":\"invalid-\xff\",\"method\":\"ping\"}", "")
	if response.Code != http.StatusBadRequest {
		t.Fatal("invalid UTF-8 must not be replaced while decoding an MCP frame", response.Code, response.Body.String())
	}
}

func TestMCPNegotiatesStandardVersionsWithoutVendorFields(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, test := range []struct{ requested, expected string }{
		{"2025-03-26", "2025-03-26"},
		{"2025-06-18", "2025-06-18"},
		{"2025-11-25", "2025-11-25"},
		{"2024-11-05", "2025-11-25"},
		{"2030-01-01", "2025-11-25"},
	} {
		t.Run(test.requested, func(t *testing.T) {
			body := `{"jsonrpc":"2.0","id":"generic-client-1","method":"initialize","params":{"protocolVersion":"` + test.requested + `","capabilities":{"roots":{"listChanged":true},"sampling":{},"experimental":{"client-extension":{}}},"clientInfo":{"name":"generic MCP client","version":"1","title":"Generic client","websiteUrl":"https://example.com"},"_meta":{"client-extension":"ignored"}}}`
			response := protocolJSON(t, protocolPost(t, handler, body, ""))
			result := resultMCP(t, response)
			if response["id"] != "generic-client-1" || result["protocolVersion"] != test.expected {
				t.Fatalf("protocol mismatch: requested %s, got %v, expected %s", test.requested, result["protocolVersion"], test.expected)
			}
			capabilities := result["capabilities"].(map[string]any)
			if capabilities["tools"] == nil || capabilities["resources"] == nil || capabilities["prompts"] != nil || capabilities["tasks"] != nil {
				t.Fatal("advertise only implemented, vendor-neutral capabilities", result)
			}
			if response["MCP-Session-Id"] != nil {
				t.Fatal("the stateless transport must not require a vendor/session field", response)
			}
		})
	}
}

func TestMCPInitializeRequiresOnlyTheStandardContract(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, params := range []string{
		`null`, `[]`, `{}`, `{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"client","version":"1"}}`,
		`{"protocolVersion":"2025-11-25","capabilities":null,"clientInfo":{"name":"client","version":"1"}}`,
		`{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":null}`,
		`{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client"}}`,
	} {
		t.Run(params, func(t *testing.T) {
			response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":`+params+`}`, ""))
			failure, ok := response["error"].(map[string]any)
			if !ok || failure["code"] != float64(-32602) || response["result"] != nil {
				t.Fatal("malformed initialize parameters must produce invalid-params rather than false successful initialization", response)
			}
		})
	}
}

func TestMCPHTTPVersionHeadersAndNotificationLifecycle(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, version := range []string{"", "2025-03-26", "2025-06-18", "2025-11-25"} {
		t.Run("accepted-"+version, func(t *testing.T) {
			response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":0,"method":"ping"}`, version))
			if response["id"] != float64(0) || response["error"] != nil {
				t.Fatal("standard numeric zero IDs must round-trip", response)
			}
			notification := protocolPost(t, handler, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, version)
			if notification.Code != http.StatusAccepted || notification.Body.Len() != 0 {
				t.Fatal("initialized notifications require an empty202 response", notification)
			}
		})
	}
	for _, version := range []string{"2024-11-05", "not-a-version", "2030-01-01"} {
		response := protocolPost(t, handler, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, version)
		if response.Code != http.StatusBadRequest {
			t.Fatal("unsupported MCP-Protocol-Version headers must fail before dispatch", version, response.Code)
		}
		var envelope map[string]any
		if json.Unmarshal(response.Body.Bytes(), &envelope) != nil || envelope["jsonrpc"] != "2.0" || envelope["id"] != float64(1) || envelope["error"].(map[string]any)["code"] != float64(-32600) {
			t.Fatal("HTTP version rejection must remain a correlated JSON-RPC error", version)
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		request := httptest.NewRequest(method, "http://localhost/mcp", nil)
		request.RemoteAddr = "127.0.0.1:23456"
		request.Header.Set("Accept", "text/event-stream")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != "POST" {
			t.Fatal("stateless JSON transport intentionally does not offer SSE or session termination", response)
		}
	}
}

func TestMCPRejectsInvalidRequestIDsBeforeAnyCommand(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, id := range []string{`null`, `true`, `false`, `{}`, `[]`} {
		response := protocolPost(t, handler, `{"jsonrpc":"2.0","id":`+id+`,"method":"tools/list"}`, "2025-11-25")
		if response.Code != http.StatusBadRequest {
			t.Fatal("MCP RequestId is a string or number", id, response.Code)
		}
	}
}

func TestMCPStandardToolAndResourceDiscoveryWithoutVendorMetadata(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, method := range []string{"tools/list", "resources/list", "resources/templates/list"} {
		response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":"request-1","method":"`+method+`","params":{"_meta":{"progressToken":"generic-progress"}}}`, "2025-11-25"))
		if response["id"] != "request-1" || response["error"] != nil {
			t.Fatal("generic clients can discover without client-specific metadata", response)
		}
	}
	for _, uri := range []string{mcpGuideURI, mcpOpenAPIURI} {
		response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"`+uri+`"}}`, "2025-03-26"))
		contents := resultMCP(t, response)["contents"].([]any)
		if len(contents) != 1 || contents[0].(map[string]any)["uri"] != uri || contents[0].(map[string]any)["text"] == "" {
			t.Fatal("readable resource content must be available through the older negotiated protocol", response)
		}
	}
	response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"visual_nerve_api_docs"}}`, "2025-11-25"))
	if resultMCP(t, response)["isError"] != false {
		t.Fatal("documentation-tool arguments are optional", response)
	}
}

func TestMCPControlCommandsKeepOptionalDataAndStructuredStatus(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	browser := controlBrowser(t, handler, host, workspace, "control")
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		arguments, path, method, data, body string
		status                              int
	}{
		{`{"path":"/workspace/security"}`, "/workspace/security", "GET", "null", `{"type":"workspace-security","schemaVersion":1,"mode":"encrypted","state":"locked"}`, 200},
		{`{"path":"/workspace/lock","method":"POST"}`, "/workspace/lock", "POST", "", `{"type":"workspace-security","schemaVersion":1,"mode":"encrypted","state":"locked"}`, 200},
		{`{"path":"/workspace/lock","method":"POST","data":{}}`, "/workspace/lock", "POST", `{}`, `{"type":"workspace-security","schemaVersion":1,"mode":"encrypted","state":"locked"}`, 200},
		{`{"path":"/diagrams"}`, "/diagrams", "GET", "null", `{"error":"Unlock the workspace in the browser to continue.","code":"WORKSPACE_LOCKED"}`, 423},
	} {
		t.Run(test.arguments, func(t *testing.T) {
			commands := make(chan map[string]json.RawMessage, 1)
			done := make(chan error, 1)
			go func() {
				var command map[string]json.RawMessage
				if err := wsjson.Read(ctx, browser, &command); err != nil {
					done <- err
					return
				}
				commands <- command
				done <- wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)})
			}()
			response := protocolJSON(t, protocolPost(t, handler, `{"jsonrpc":"2.0","id":"control","method":"tools/call","params":{"name":"visual_nerve_request","arguments":`+test.arguments+`}}`, "2025-11-25"))
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			command := <-commands
			if string(command["path"]) != `"`+test.path+`"` || string(command["method"]) != `"`+test.method+`"` || string(command["data"]) != test.data {
				t.Fatal("optional data must not become implicit null/object", command)
			}
			result := resultMCP(t, response)
			structured := result["structuredContent"].(map[string]any)
			if structured["status"] != float64(test.status) || result["isError"] != (test.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != test.body {
				t.Fatal("all clients receive the same locked/control response", response)
			}
		})
	}
}
