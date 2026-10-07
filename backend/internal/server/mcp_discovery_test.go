package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func callMCP(t *testing.T, handler *Server, method string, params json.RawMessage) map[string]any {
	t.Helper()
	envelope := map[string]any{"jsonrpc": "2.0", "id": 7, "method": method}
	if params != nil {
		envelope["params"] = params
	}
	request, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "http://localhost/mcp", strings.NewReader(string(request)))
	r.RemoteAddr = "127.0.0.1:23456"
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("MCP HTTP %d: %s", w.Code, w.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["jsonrpc"] != "2.0" || response["id"] != float64(7) {
		t.Fatal("invalid JSON-RPC response envelope", response)
	}
	return response
}

func resultMCP(t *testing.T, response map[string]any) map[string]any {
	t.Helper()
	result, ok := response["result"].(map[string]any)
	if !ok || response["error"] != nil {
		t.Fatal("expected MCP result", response)
	}
	return result
}

func bundledMCPServer(t *testing.T) (*Server, string) {
	t.Helper()
	// Use the complete bundled contract rather than an abbreviated test schema.
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "openapi.yaml"), data, 0600); err != nil {
		t.Fatal(err)
	}
	handler := New(Config{Bridge: true, StaticDir: directory})
	t.Cleanup(handler.Close)
	return handler, string(data)
}

func TestMCPDiscoveryWorksWithoutConnectedBrowser(t *testing.T) {
	handler, openapi := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	if initialized["protocolVersion"] != "2025-06-18" {
		t.Fatal(initialized)
	}
	capabilities := initialized["capabilities"].(map[string]any)
	if capabilities["tools"] == nil || capabilities["resources"] == nil {
		t.Fatal("tool and resource discovery must be advertised", initialized)
	}
	for _, phrase := range []string{"native 2D", "3D", "visual_nerve_api_docs", "no browser session", "/spatial-diagrams", "IndexedDB", "Read + write", "independent readable 2D", "unless the user requests 3D", "minimized", "canvas captions"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) {
			t.Fatal("missing initialize guidance", phrase, initialized)
		}
	}
	listed := resultMCP(t, callMCP(t, handler, "tools/list", nil))
	tools := map[string]map[string]any{}
	for _, item := range listed["tools"].([]any) {
		tool := item.(map[string]any)
		tools[tool["name"].(string)] = tool
	}
	if len(tools) != 2 || tools["visual_nerve_request"] == nil || tools["visual_nerve_api_docs"] == nil {
		t.Fatal("both command and discovery tools must be available", listed)
	}
	requestDescription := tools["visual_nerve_request"]["description"].(string)
	if strings.Index(requestDescription, "visual_nerve_api_docs") > strings.Index(requestDescription, "/sql/preview") || strings.Index(requestDescription, "3D") > strings.Index(requestDescription, "/sql/preview") {
		t.Fatal("discovery and 3D support must precede the SQL workflow", requestDescription)
	}
	annotations := tools["visual_nerve_api_docs"]["annotations"].(map[string]any)
	if annotations["readOnlyHint"] != true || annotations["openWorldHint"] != false {
		t.Fatal("discovery must be marked read-only and local", annotations)
	}
	for _, arguments := range []string{"", `,"arguments":{}`, `,"arguments":{"document":"guide"}`} {
		result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs"`+arguments+`}`)))
		content := result["content"].([]any)
		if result["isError"] != false || len(content) != 1 || content[0].(map[string]any)["text"] != mcpAPIGuide {
			t.Fatal("discovery must start with a compact guide without a browser", result["isError"], len(content))
		}
	}
	all := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"all"}}`)))
	content := all["content"].([]any)
	if all["isError"] != false || len(content) != 2 || content[0].(map[string]any)["text"] != mcpAPIGuide || content[1].(map[string]any)["text"] != openapi {
		t.Fatal("explicit all must return both full documents without a browser", all["isError"], len(content))
	}
	for selected, want := range map[string]string{"guide": mcpAPIGuide, "openapi": openapi} {
		result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"`+selected+`"}}`)))
		content := result["content"].([]any)
		if result["isError"] != false || len(content) != 1 || content[0].(map[string]any)["text"] != want {
			t.Fatal("document selector must return the complete selected document", selected)
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("test unexpectedly connected a browser")
	}
}

func TestMCPDocumentationResourcesMatchToolDocuments(t *testing.T) {
	handler, openapi := bundledMCPServer(t)
	listed := resultMCP(t, callMCP(t, handler, "resources/list", nil))
	resources := listed["resources"].([]any)
	if len(resources) != 2 {
		t.Fatal("both documentation resources must be listed", listed)
	}
	wanted := map[string]string{mcpGuideURI: mcpAPIGuide, mcpOpenAPIURI: openapi}
	for _, item := range resources {
		resource := item.(map[string]any)
		uri := resource["uri"].(string)
		result := resultMCP(t, callMCP(t, handler, "resources/read", json.RawMessage(`{"uri":"`+uri+`"}`)))
		contents := result["contents"].([]any)
		if len(contents) != 1 {
			t.Fatal(result)
		}
		read := contents[0].(map[string]any)
		if read["uri"] != uri || read["mimeType"] != resource["mimeType"] || read["text"] != wanted[uri] {
			t.Fatal("resource must return its complete local document", uri)
		}
		delete(wanted, uri)
	}
	if len(wanted) != 0 {
		t.Fatal("documentation resource was omitted", wanted)
	}
	templates := resultMCP(t, callMCP(t, handler, "resources/templates/list", nil))
	if len(templates["resourceTemplates"].([]any)) != 0 {
		t.Fatal("static documents have no resource templates", templates)
	}
	for _, phrase := range []string{"Use 2D unless the user requests 3D", "POST /spatial-diagrams", "x/y/width/height", "metadata.spatial", "settings.spatialView", "sourceExternalId/targetExternalId", "baseVersion", "IndexedDB", "requires no connected browser", "Read + write", "not browser graph commands"} {
		if !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("guide is missing a supported workflow", phrase)
		}
	}
	for _, phrase := range []string{`"/spatial-diagrams"`, `"SpatialDiagramInput"`, `"/diagrams/{diagramId}/bulk"`, `"/workspace/export"`} {
		if !strings.Contains(openapi, phrase) {
			t.Fatal("bundled OpenAPI must include the complete command contract", phrase)
		}
	}
}

func TestMCPCodeDiscoveryExplainsAutomaticAndExplicitDetailLevels(t *testing.T) {
	for surface, text := range map[string]string{
		"initialize": mcpInstructions,
		"request":    mcpToolDescription,
		"guide":      mcpAPIGuide,
	} {
		for _, phrase := range []string{"mode uses symbols for one file and files for multiple files", "Explicit files or symbols choices are preserved", "diagram.metadata.codeAnalysis.mode", "COBOL paragraphs", "saved diagrams retain their detail level"} {
			if !strings.Contains(text, phrase) {
				t.Fatalf("%s must make code detail behavior discoverable: %q", surface, phrase)
			}
		}
	}
}

func TestMCPInvalidToolAndResourceArguments(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	tests := []struct {
		method string
		params string
		code   int
	}{
		{"tools/call", `{}`, -32602},
		{"tools/call", `{"name":"unknown","arguments":{}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":null}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":[]}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":{"document":null}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":{"document":2}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":{"document":""}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":{"document":"other"}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_api_docs","arguments":{"path":"/api/docs"}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request"}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":null}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":1}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"HEAD"}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":null}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":"/diagrams","workspaceId":1}}`, -32602},
		{"tools/call", `{"name":"visual_nerve_request","arguments":{"path":"/diagrams","extra":true}}`, -32602},
		{"resources/read", `{}`, -32602},
		{"resources/read", `null`, -32602},
		{"resources/read", `[]`, -32602},
		{"resources/read", `{"uri":null}`, -32602},
		{"resources/read", `{"uri":123}`, -32602},
		{"resources/read", `{"uri":"visual-nerve://docs/guide","path":"/private"}`, -32602},
		{"resources/read", `{"uri":"visual-nerve://docs/unknown"}`, -32002},
		{"resources/read", `{"uri":"visual-nerve://docs/openapi?path=/private"}`, -32002},
		{"resources/read", `{"uri":"file:///private/token"}`, -32002},
		{"resources/read", `{"uri":"https://example.com/openapi.yaml"}`, -32002},
		{"resources/list", `{"cursor":"unknown"}`, -32602},
		{"tools/list", `{"cursor":42}`, -32602},
	}
	for _, test := range tests {
		t.Run(test.method+"/"+test.params, func(t *testing.T) {
			response := callMCP(t, handler, test.method, json.RawMessage(test.params))
			err, ok := response["error"].(map[string]any)
			if !ok || err["code"] != float64(test.code) || response["result"] != nil {
				t.Fatal("expected JSON-RPC error", test.code, response)
			}
		})
	}
}

func TestMCPMissingBundledOpenAPIFailsClearly(t *testing.T) {
	for _, directory := range []string{"", t.TempDir()} {
		handler := New(Config{Bridge: true, StaticDir: directory})
		response := callMCP(t, handler, "resources/read", json.RawMessage(`{"uri":"visual-nerve://docs/openapi"}`))
		err, ok := response["error"].(map[string]any)
		if !ok || err["code"] != float64(-32603) || !strings.Contains(err["message"].(string), "openapi.yaml") {
			t.Fatal("missing bundled contract must be an explicit resource error", response)
		}
		for _, document := range []string{"all", "openapi"} {
			result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"`+document+`"}}`)))
			if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "openapi.yaml") {
				t.Fatal("missing bundled contract must be an explicit tool error", result)
			}
		}
		guide := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"guide"}}`)))
		if guide["isError"] != false {
			t.Fatal("built-in guide must remain available", guide)
		}
		handler.Close()
	}
}

func TestMCPDiscoveryStillUsesIntegrationAccessChecks(t *testing.T) {
	handler := New(Config{Bridge: true, StaticDir: t.TempDir(), Token: "private-token"})
	defer handler.Close()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"visual_nerve_api_docs","arguments":{"document":"guide"}}}`
	for _, test := range []struct {
		token, origin, remote string
		want                  int
	}{
		{"", "", "127.0.0.1:23456", 401},
		{"Bearer private-token", "https://untrusted.example", "127.0.0.1:23456", 403},
		{"Bearer private-token", "", "192.0.2.1:23456", 403},
		{"Bearer private-token", "http://localhost", "127.0.0.1:23456", 200},
	} {
		r := httptest.NewRequest(http.MethodPost, "http://localhost/mcp", strings.NewReader(body))
		r.RemoteAddr = test.remote
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", test.token)
		r.Header.Set("Origin", test.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.want {
			t.Fatal("discovery must preserve integration policy", test, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "private-token") {
			t.Fatal("guide or errors must not expose the configured token")
		}
	}
}
