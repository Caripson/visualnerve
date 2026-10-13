package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func startNotationForward(handler *Server, ctx context.Context, path, method, payload string) <-chan operationForwardResult {
	result := make(chan operationForwardResult, 1)
	var data json.RawMessage
	if payload != "" {
		data = json.RawMessage(payload)
	}
	go func() {
		response, err := handler.forwardOperation(ctx, operationWorkspace, path, method, data, "")
		result <- operationForwardResult{response, err}
	}()
	return result
}

func TestNotationMCPDiscoveryUsesCurrentCatalogContract(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"0.11.0", "standard-notations-v1", "/notation/collections", "dfd-yourdon", "notation:null", "/notation/validate", "whole"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) || !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("notation guidance missing", phrase)
		}
	}
	for _, test := range []struct {
		path, method string
		phrases      []string
	}{
		{"/notation/collections/{collectionId}", "GET", []string{"NotationCollectionDiscovery", "dfd-gane-sarson", "schemaVersion", "sourceDecoration"}},
		{"/diagrams/{diagramId}/nodes", "POST", []string{"NodeNotation", "timingStates", "eventSubProcess", "attachmentId", "qualifier"}},
		{"/diagrams/{diagramId}/notation/validate", "POST", []string{"NotationValidationReport", "Read only", "baseVersion", "severity"}},
	} {
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_api_docs", "arguments": map[string]any{"document": "endpoint", "path": test.path, "method": test.method}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		text := result["content"].([]any)[0].(map[string]any)["text"].(string)
		for _, phrase := range test.phrases {
			if result["isError"] != false || !strings.Contains(text, phrase) {
				t.Fatal("endpoint transitive schemas missing", test.path, phrase)
			}
		}
	}
}

func TestNotationValidationIsPureAndRejectsMalformedBodies(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	path := "/diagrams/00000000-0000-4000-8000-000000000005/notation/validate"
	for _, body := range []string{"", "{}"} {
		result := startNotationForward(handler, ctx, path, "POST", body)
		command := readOperationCommand(t, conn)
		if command.OperationID != "" || command.OperationAction != "" || command.OperationNew || command.Path != path {
			t.Fatal("pure inspection became a write", command)
		}
		if body == "" && len(command.Data) != 0 {
			t.Fatal("omitted pure input must not become explicit null", string(command.Data))
		}
		respondOperation(t, conn, command, 200, map[string]any{"diagramId": "00000000-0000-4000-8000-000000000005", "baseVersion": 1, "issues": []any{}})
		response := <-result
		if response.err != nil || response.reply.Status != 200 || response.reply.OperationID != "" || len(handler.operations) != 0 {
			t.Fatal("pure inspection allocated recovery state", response)
		}
	}
	for _, data := range []string{"null", "[]", `{"baseVersion":1}`, `{"unknown":true}`, `{"x":null}`} {
		response, err := handler.forwardOperation(ctx, operationWorkspace, path, "POST", json.RawMessage(data), "")
		if err == nil || response.Status != 422 || len(handler.operations) != 0 {
			t.Fatal("malformed inspection dispatched or reserved state", data, response, err)
		}
	}
	response, err := handler.forwardOperation(ctx, operationWorkspace, path, "POST", json.RawMessage(`{}`), "invented")
	if err != nil || response.Status != 422 {
		t.Fatal("pure inspection accepted operation identity", response, err)
	}
	for _, suffix := range []string{"/", "?save=true", "#save"} {
		if notationReadCommand(path+suffix, "POST") {
			t.Fatal("pure access must match only the exact path", suffix)
		}
	}
}

func TestNotationBridgeForwardsSymbolsNullAndStructuredBrowserFailures(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		path, method, data, body string
		status                   int
	}{
		{"/notation/collections/uml/symbols", "GET", "", `[{"collection":"uml","id":"class","geometry":"rectangle"}]`, 200},
		{"/notation/collections/uml/connectors", "GET", "", `[{"collection":"uml","id":"association","line":"solid"}]`, 200},
		{"/nodes/example", "PATCH", `{"version":1,"notation":{"collection":"uml","symbol":"class","compartments":[{"id":"fields","lines":["name: String"]}]}}`, `{"version":2,"nodeType":"generic","notation":{"collection":"uml","symbol":"class"}}`, 200},
		{"/nodes/example", "PATCH", `{"version":2,"notation":null}`, `{"version":3,"nodeType":"generic"}`, 200},
		{"/nodes/example", "PATCH", `{"version":3,"notation":{"collection":"uml","symbol":"class","properties":{"unknown":true}}}`, `{"error":"Unsupported property.","code":"INVALID_NOTATION","issues":[{"code":"INVALID_NOTATION","path":"node.notation.properties.unknown","message":"unsupported field","severity":"error"}]}`, 422},
	} {
		result := startNotationForward(handler, ctx, test.path, test.method, test.data)
		command := readOperationCommand(t, conn)
		var expected any
		if test.data != "" {
			_ = json.Unmarshal([]byte(test.data), &expected)
		}
		var actual any
		_ = json.Unmarshal(command.Data, &actual)
		if command.Path != test.path || command.Method != test.method || (test.data != "" && !reflect.DeepEqual(actual, expected)) {
			t.Fatal("bridge altered canonical notation payload", command)
		}
		respondOperation(t, conn, command, test.status, json.RawMessage(test.body))
		response := <-result
		if response.err != nil || response.reply.Status != test.status || string(response.reply.Body) != test.body {
			t.Fatal("bridge altered browser validation result", response)
		}
	}
}
