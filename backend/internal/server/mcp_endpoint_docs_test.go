package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func decodeEndpointDocument(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func requireResolvedEndpointReferences(t *testing.T, document map[string]any) {
	t.Helper()
	pending := []any{document}
	for len(pending) > 0 {
		last := len(pending) - 1
		value := pending[last]
		pending = pending[:last]
		switch value := value.(type) {
		case map[string]any:
			if reference, exists := value["$ref"]; exists {
				tokens, err := componentPointer(reference.(string))
				if err != nil {
					t.Fatal(err)
				}
				if _, err := resolveJSONPointer(document, tokens); err != nil {
					t.Fatal("endpoint document has a dangling reference", reference, err)
				}
			}
			for _, child := range value {
				pending = append(pending, child)
			}
		case []any:
			pending = append(pending, value...)
		}
	}
}

func TestEndpointOpenAPIClosesTransitiveReferencesAndPreservesPathParameters(t *testing.T) {
	data := []byte(`{
	  "openapi":"3.0.3","info":{"title":"Fixture","version":"1"},
	  "servers":[{"url":"http://127.0.0.1/api/v1"}],"security":[{"globalAuth":[]}],
	  "paths":{"/work/{id}":{
	    "parameters":[{"$ref":"#/components/parameters/Id"}],"description":"Path description",
	    "post":{"security":[{"localAuth":[]}],"requestBody":{"$ref":"#/components/requestBodies/Input"},"responses":{"200":{"$ref":"#/components/responses/Output"}}},
	    "get":{"responses":{"200":{"$ref":"#/components/responses/Unused"}}}
	  },"/unrelated":{"get":{"responses":{}}}},
	  "components":{
	    "parameters":{"Id":{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}},
	    "requestBodies":{"Input":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/A"}}}}},
	    "responses":{"Output":{"description":"ok","content":{"application/json":{"schema":{"$ref":"#/components/schemas/A"}}}},"Unused":{"description":"omit"}},
	    "schemas":{"A":{"type":"object","properties":{"b":{"$ref":"#/components/schemas/B"}}},"B":{"allOf":[{"$ref":"#/components/schemas/A"},{"$ref":"#/components/schemas/Node~1with~0escape/properties/leaf"}]},"Node/with~escape":{"properties":{"leaf":{"type":"string"}}},"Unused":{"type":"string"}},
	    "securitySchemes":{"globalAuth":{"type":"http","scheme":"bearer"},"localAuth":{"type":"http","scheme":"basic"},"unusedAuth":{"type":"http","scheme":"basic"}}
	  }
	}`)
	original := decodeEndpointDocument(t, data)
	output, err := endpointOpenAPI(data, "/work/{id}", "POST")
	if err != nil {
		t.Fatal(err)
	}
	document := decodeEndpointDocument(t, output)
	paths := document["paths"].(map[string]any)
	item := paths["/work/{id}"].(map[string]any)
	if len(paths) != 1 || item["get"] != nil || !reflect.DeepEqual(item["parameters"], original["paths"].(map[string]any)["/work/{id}"].(map[string]any)["parameters"]) {
		t.Fatal("only the selected operation and its shared path parameters should be returned", paths)
	}
	for _, name := range []string{"openapi", "info", "servers", "security"} {
		if !reflect.DeepEqual(document[name], original[name]) {
			t.Fatal("shared OpenAPI metadata changed", name)
		}
	}
	components := document["components"].(map[string]any)
	for section, count := range map[string]int{"schemas": 3, "parameters": 1, "requestBodies": 1, "responses": 1, "securitySchemes": 2} {
		if len(components[section].(map[string]any)) != count {
			t.Fatal("reference closure omitted a dependency or included unrelated components", section, components[section])
		}
		for name, value := range components[section].(map[string]any) {
			if !reflect.DeepEqual(value, original["components"].(map[string]any)[section].(map[string]any)[name]) {
				t.Fatal("scoped discovery must not simplify a dependency", section, name)
			}
		}
	}
	requireResolvedEndpointReferences(t, document)
	// Sorting during JSON encoding also makes repeated discovery deterministic.
	again, err := endpointOpenAPI(data, "/work/{id}", "POST")
	if err != nil || string(again) != string(output) {
		t.Fatal("endpoint contract should be deterministic", err)
	}
}

func TestEndpointOpenAPIRejectsUnknownOperationsAndUnresolvableReferences(t *testing.T) {
	for name, input := range map[string]string{
		"malformed bundle":        `not JSON`,
		"missing component":       `{"paths":{"/work":{"post":{"responses":{"200":{"$ref":"#/components/responses/Missing"}}}}}}`,
		"external reference":      `{"paths":{"/work":{"post":{"requestBody":{"$ref":"https://example.com/schema.json"}}}}}`,
		"file reference":          `{"paths":{"/work":{"post":{"requestBody":{"$ref":"file:///etc/passwd"}}}}}`,
		"non-component reference": `{"paths":{"/work":{"post":{"requestBody":{"$ref":"#/info"}}}}}`,
		"invalid pointer escape":  `{"paths":{"/work":{"post":{"requestBody":{"$ref":"#/components/schemas/A~2"}}}}}`,
		"missing nested property": `{"paths":{"/work":{"post":{"requestBody":{"$ref":"#/components/schemas/A/properties/missing"}}}},"components":{"schemas":{"A":{"type":"object","properties":{}}}}}`,
		"invalid reference type":  `{"paths":{"/work":{"post":{"requestBody":{"$ref":false}}}}}`,
		"missing security scheme": `{"paths":{"/work":{"post":{"security":[{"Missing":[]}]}}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if output, err := endpointOpenAPI([]byte(input), "/work", "POST"); err == nil || output != nil {
				t.Fatal("invalid contract must produce an explicit error, never a partial document", string(output), err)
			}
		})
	}
	for _, path := range []string{"/missing", "/api/v1/work", "/work?limit=1", "https://example.com/work"} {
		if _, err := endpointOpenAPI([]byte(`{"paths":{"/work":{"post":{}}}}`), path, "POST"); err == nil {
			t.Fatal("only exact documented paths are accepted", path)
		}
	}
	if _, err := endpointOpenAPI([]byte(`{"paths":{"/work":{"post":{}}}}`), "/work", "GET"); err == nil {
		t.Fatal("an undocumented method must be rejected")
	}
}

func TestMCPEndpointDocsUseTheBundledContractWithoutABrowser(t *testing.T) {
	handler, full := bundledMCPServer(t)
	original := decodeEndpointDocument(t, []byte(full))
	for _, endpoint := range []struct{ path, method string }{
		{"/diagrams/{diagramId}/bulk", "POST"},
		{"/nodes/{nodeId}", "PATCH"},
		{"/diagrams/{diagramId}/simulation", "PUT"},
		{"/presentation/video", "POST"},
	} {
		t.Run(endpoint.method+" "+endpoint.path, func(t *testing.T) {
			params, _ := json.Marshal(map[string]any{"name": "visual_nerve_api_docs", "arguments": map[string]any{"document": "endpoint", "path": endpoint.path, "method": endpoint.method}})
			result := resultMCP(t, callMCP(t, handler, "tools/call", params))
			if result["isError"] != false || len(result["content"].([]any)) != 1 {
				t.Fatal(result)
			}
			text := result["content"].([]any)[0].(map[string]any)["text"].(string)
			if len(text) >= len(full) {
				t.Fatal("endpoint discovery should omit unrelated operations")
			}
			document := decodeEndpointDocument(t, []byte(text))
			paths := document["paths"].(map[string]any)
			operation := paths[endpoint.path].(map[string]any)[strings.ToLower(endpoint.method)]
			if len(paths) != 1 || !reflect.DeepEqual(operation, original["paths"].(map[string]any)[endpoint.path].(map[string]any)[strings.ToLower(endpoint.method)]) {
				t.Fatal("scoped operation differs from full authoritative contract")
			}
			requireResolvedEndpointReferences(t, document)
			if endpoint.path == "/diagrams/{diagramId}/bulk" {
				components := document["components"].(map[string]any)["schemas"].(map[string]any)
				external := components["BulkNode"].(map[string]any)["properties"].(map[string]any)["externalId"].(map[string]any)
				if external["type"] != "string" || external["format"] != nil {
					t.Fatal("MCP must expose integration string identity without UUID constraint", external)
				}
			}
		})
	}
	if len(handler.peers) != 0 {
		t.Fatal("endpoint discovery must not require a browser")
	}
}

func TestMCPEndpointDocsValidateSelectorsAndReportUnavailableContracts(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	for _, arguments := range []string{
		`{"document":"endpoint"}`, `{"document":"endpoint","path":"/health"}`,
		`{"document":"endpoint","path":"/health","method":"get"}`,
		`{"document":"endpoint","path":null,"method":"GET"}`,
		`{"document":"endpoint","path":"/health","method":"HEAD"}`,
		`{"document":"endpoint","path":"/health","method":"GET","data":{}}`,
		`{"path":"/health","method":"GET"}`, `{"document":"openapi","path":"/health"}`,
		`{"document":"guide","method":"GET"}`,
	} {
		response := callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":`+arguments+`}`))
		if response["error"] == nil || response["error"].(map[string]any)["code"] != float64(-32602) {
			t.Fatal("invalid selector must return structured invalid params", arguments, response)
		}
	}
	for _, arguments := range []string{
		`{"document":"endpoint","path":"/unknown","method":"GET"}`,
		`{"document":"endpoint","path":"/health","method":"DELETE"}`,
	} {
		result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":`+arguments+`}`)))
		if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "no bundled OpenAPI operation") {
			t.Fatal("unknown operation must fail explicitly", result)
		}
	}
	if err := os.Remove(filepath.Join(handler.config.StaticDir, "openapi.yaml")); err != nil {
		t.Fatal(err)
	}
	result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/health","method":"GET"}}`)))
	if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "openapi.yaml") {
		t.Fatal("missing bundle must not return a fabricated endpoint contract", result)
	}
}
