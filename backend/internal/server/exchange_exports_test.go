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

func TestMCPDiagramExchangeDiscoveryWorksWithoutWorkspaceAndIncludesTransitiveSchemas(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"exchange-export-v1", "/exports/diagrams", "Decode every", "drawio", "Save as .drawio"} {
		if !strings.Contains(initialized["instructions"].(string)+mcpAPIGuide, phrase) {
			t.Fatal("exchange workflow missing from discovery", phrase)
		}
	}
	for _, removed := range []string{"vsdx", "visio", "requiresMicrosoftVisioVerification"} {
		if strings.Contains(strings.ToLower(mcpDiagramExportPolicy), strings.ToLower(removed)) {
			t.Fatal("MCP editable export policy advertises a removed format", removed)
		}
	}
	result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/exports/diagrams/{jobId}/result","method":"GET"}}`)))
	if result["isError"] != false {
		t.Fatal("offline exchange endpoint discovery failed", result)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(result["content"].([]any)[0].(map[string]any)["text"].(string)), &document); err != nil {
		t.Fatal(err)
	}
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"DiagramExportResultChunk", "DiagramExportWarning", "Error"} {
		if schemas[name] == nil {
			t.Fatal("scoped export docs omit transitive schema", name)
		}
	}
	format := schemas["DiagramExportResultChunk"].(map[string]any)["properties"].(map[string]any)["format"].(map[string]any)["enum"].([]any)
	if len(format) != 1 || format[0] != "drawio" {
		t.Fatal("MCP endpoint discovery must expose only the supported draw.io result", format)
	}
	if len(handler.peers) != 0 {
		t.Fatal("static discovery must not open or read a browser workspace")
	}
}

func TestMCPDiagramExchangePreservesBrowserStatusBinaryIdentityAndStructuredRejection(t *testing.T) {
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
		path, method, data, body string
		status                   int
	}{
		{"/exports/diagrams", "POST", `{"diagramId":"00000000-0000-4000-8000-000000000002","format":"drawio"}`, `{"jobId":"00000000-0000-4000-8000-000000000003","format":"drawio","state":"queued","warnings":[]}`, 201},
		{"/exports/diagrams/00000000-0000-4000-8000-000000000003/result?offset=1&limit=2", "GET", `{}`, `{"jobId":"00000000-0000-4000-8000-000000000003","format":"drawio","mimeType":"application/vnd.jgraph.mxfile","encoding":"base64","offset":1,"nextOffset":3,"totalBytes":3,"data":"AP8=","complete":true,"warnings":[]}`, 200},
		{"/exports/diagrams", "POST", `{"diagramId":"00000000-0000-4000-8000-000000000002","format":"vsdx"}`, `{"error":"Unsupported format","code":"EXCHANGE_FORMAT_INVALID"}`, 422},
		{"/exports/diagrams/00000000-0000-4000-8000-000000000003", "DELETE", `{}`, `{"jobId":"00000000-0000-4000-8000-000000000003","state":"cancelled","warnings":[]}`, 200},
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
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": fixture.path, "method": fixture.method, "data": json.RawMessage(fixture.data), "workspaceId": workspace}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if err := <-done; err != nil {
			t.Fatal("browser exchange route changed", err)
		}
		structured := result["structuredContent"].(map[string]any)
		if structured["status"] != float64(fixture.status) || result["isError"] != (fixture.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != fixture.body {
			t.Fatal("MCP altered binary chunk identity or structured browser response", result)
		}
	}
}
