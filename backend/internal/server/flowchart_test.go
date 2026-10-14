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

func TestFlowchartMCPDiscoveryDocumentsNativeAppearance(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"ibm-flowcharting-v1", "/flowchart/symbols", "/flowchart/stencils", "flowchartSymbol", "26 physical cutouts", "43", "revisions", "nodeType", "flowchartSymbol:null"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) || !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("catalog absent from MCP guidance", phrase)
		}
	}
	found := false
	for _, capability := range bridgeCapabilities {
		found = found || capability == "ibm-flowcharting-v1"
	}
	if !found || bridgeVersion != "0.11.1" {
		t.Fatal("catalog absent from transport software discovery")
	}
	result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/flowchart/symbols","method":"GET"}}`)))
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	for _, phrase := range []string{"FlowchartSymbolRecord", "ibm-predefined-process", "construction", "physicalCutout", "detailPaths"} {
		if result["isError"] != false || !strings.Contains(text, phrase) {
			t.Fatal("endpoint discovery must include its complete enum and geometry", phrase)
		}
	}
	stencilResult := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/flowchart/stencils","method":"GET"}}`)))
	stencilText := stencilResult["content"].([]any)[0].(map[string]any)["text"].(string)
	for _, phrase := range []string{"FlowchartStencilRecord", "physicalCutoutSymbolIds", "ibm-program-modification", "GX20-8020"} {
		if stencilResult["isError"] != false || !strings.Contains(stencilText, phrase) {
			t.Fatal("stencil discovery must include its complete revision and symbol enum", phrase)
		}
	}
}

func TestFlowchartMCPForwardsCatalogAppearanceAndBrowserValidation(t *testing.T) {
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
		path, method, data, body string
		status                   int
	}{
		{"/flowchart/symbols", "GET", "", `[{"id":"ibm-predefined-process","physicalCutout":false,"construction":"composite"}]`, 200},
		{"/flowchart/stencils", "GET", "", `[{"revision":"GX20-8020","label":"Original","physicalCutoutSymbolIds":["ibm-merge"],"symbolLabels":{"ibm-merge":"Offline Storage File"}}]`, 200},
		{"/nodes/example", "PATCH", `{"version":2,"flowchartSymbol":"ibm-sort"}`, `{"id":"example","version":3,"nodeType":"process","flowchartSymbol":"ibm-sort"}`, 200},
		{"/nodes/example", "PATCH", `{"version":3,"flowchartSymbol":null}`, `{"id":"example","version":4,"nodeType":"process"}`, 200},
		{"/nodes/example", "PATCH", `{"version":4,"flowchartSymbol":"unknown"}`, `{"error":"Unsupported flowchart symbol."}`, 422},
		{"/nodes/example", "PATCH", `{"version":4,"backgroundColor":"#aB12Ef"}`, `{"id":"example","version":5,"backgroundColor":"#aB12Ef","color":"#123456"}`, 200},
		{"/nodes/example", "PATCH", `{"version":5,"backgroundColor":null}`, `{"id":"example","version":6,"color":"#123456"}`, 200},
		{"/nodes/example", "PATCH", `{"version":6,"backgroundColor":"red"}`, `{"error":"Node backgroundColor must be a six-digit hex color (#RRGGBB).","code":"INVALID_NODE_BACKGROUND_COLOR","issues":[{"path":"nodes.0.backgroundColor","code":"INVALID_NODE_BACKGROUND_COLOR"}]}`, 422},
	} {
		done := make(chan error, 1)
		go func() {
			var command map[string]any
			if err := wsjson.Read(ctx, browser, &command); err != nil {
				done <- err
				return
			}
			if command["path"] != test.path || command["method"] != test.method {
				done <- context.Canceled
				return
			}
			if test.data != "" {
				actual, _ := json.Marshal(command["data"])
				if string(actual) != test.data && test.method == "PATCH" {
					var expected any
					_ = json.Unmarshal([]byte(test.data), &expected)
					normalized, _ := json.Marshal(expected)
					if string(actual) != string(normalized) {
						done <- context.Canceled
						return
					}
				}
			}
			done <- wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)})
		}()
		arguments := map[string]any{"path": test.path, "method": test.method, "workspaceId": workspace}
		if test.data != "" {
			arguments["data"] = json.RawMessage(test.data)
		}
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": arguments})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if result["content"].([]any)[0].(map[string]any)["text"] != test.body || result["structuredContent"].(map[string]any)["status"] != float64(test.status) || result["isError"] != (test.status >= 400) {
			t.Fatal("browser catalog/validation contract changed", result)
		}
	}
}
