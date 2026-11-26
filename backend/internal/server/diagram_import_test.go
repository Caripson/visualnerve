package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiagramFileContractIsSharedByBrowserTransports(t *testing.T) {
	server := New(Config{Bridge: true})
	defer server.Close()
	for _, test := range []struct {
		path, body string
		status     int
	}{
		{"/diagram-files/preview", `{"format":"drawio","data":"<mxfile/>"}`, 503},
		{"/diagram-files/preview", `{"format":"drawio","data":"xml","pageId":"p"}`, 422},
		{"/diagram-files/preview", `{"format":"vsdx","data":"ordinary text"}`, 422},
		{"/import", `{"format":"drawio","data":"xml","pageId":"p"}`, 503},
		{"/import", `{"format":"drawio","data":"xml","pageId":1}`, 422},
		// Existing import formats are forwarded to the browser unchanged.
		{"/import", `{"format":"json","data":{"nodes":[]},"existingOption":true}`, 503},
		{"/import", `{"format":"markdown","data":"# Root"}`, 503},
		{"/import", `{"format":"csv","data":"title\nRoot"}`, 503},
	} {
		response, _ := server.forward(context.Background(), "", test.path, "POST", json.RawMessage(test.body))
		if response.Status != test.status {
			t.Fatalf("%s %s: got %d, want %d", test.path, test.body, response.Status, test.status)
		}
	}
}

func TestImportAcknowledgmentsThroughRESTAndMCP(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)

	const graph = `{"diagram":{"id":"imported"},"nodes":[],"edges":[]}`
	for _, test := range []struct {
		path, payload, body string
		status              int
	}{
		{"/workspace/import", `{"format":"visual-nerve-workspace","formatVersion":1,"diagrams":[],"nodes":[],"edges":[],"owners":[],"settings":[],"templates":[]}`, `[]`, http.StatusOK},
		{"/import", `{"format":"markdown","data":"# Imported"}`, graph, http.StatusCreated},
	} {
		for _, transport := range []string{"REST", "MCP"} {
			t.Run(transport+test.path, func(t *testing.T) {
				path, data := "/api/v1"+test.path, test.payload
				if transport == "MCP" {
					path = "/mcp"
					data = fmt.Sprintf(`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":%q,"method":"POST","data":%s}}}`, test.path, test.payload)
				}
				request := httptest.NewRequest(http.MethodPost, "http://localhost"+path, strings.NewReader(data))
				request.RemoteAddr = "127.0.0.1:23456"
				request.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				done := make(chan struct{})
				go func() {
					handler.ServeHTTP(response, request)
					close(done)
				}()
				command := readOperationCommand(t, conn)
				respondOperation(t, conn, command, test.status, json.RawMessage(test.body))
				<-done
				if command.Path != test.path || command.Method != http.MethodPost || command.OperationID == "" || command.OperationAction != "execute" {
					t.Fatalf("expected a recoverable browser write, got %+v", command)
				}
				if transport == "REST" {
					if response.Code != test.status || strings.TrimSpace(response.Body.String()) != test.body || response.Header().Get("X-Visual-Nerve-Operation-Id") != command.OperationID {
						t.Fatalf("REST changed the browser acknowledgment: %d %s", response.Code, response.Body.String())
					}
					return
				}
				var envelope struct {
					Result struct {
						IsError           bool
						StructuredContent struct {
							Status      int
							Body        json.RawMessage
							OperationID string
						}
					}
				}
				if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
					t.Fatal(err)
				}
				result := envelope.Result.StructuredContent
				if response.Code != http.StatusOK || envelope.Result.IsError || result.Status != test.status || string(result.Body) != test.body || result.OperationID != command.OperationID {
					t.Fatalf("MCP changed the browser acknowledgment: %d %s", response.Code, response.Body.String())
				}
			})
		}
	}
}
