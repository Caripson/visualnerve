package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPDiscoversInfrastructureWithoutWorkspaceAccess(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	if initialized["serverInfo"].(map[string]any)["version"] != "0.10.0" {
		t.Fatal("infrastructure discovery requires the current bridge announcement")
	}
	for _, phrase := range []string{"infrastructure-resources-v1", "schemaVersion:2", "infrastructure:{schemaVersion:1}", "same two MCP tools", "stage/case RAM", "SIMULATION_INFRASTRUCTURE_INVALID", "SIMULATION_INFRASTRUCTURE_STALLED", "null removes optional", "no second clock"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) {
			t.Fatal("missing infrastructure execution/compatibility guidance", phrase)
		}
	}
	found := false
	for _, capability := range bridgeCapabilities {
		found = found || capability == "infrastructure-resources-v1"
	}
	if !found || len(bridgeToolNames) != 2 {
		t.Fatal("feature discovery must preserve the existing MCP tools")
	}
	guide := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"guide"}}`)))
	text := guide["content"].([]any)[0].(map[string]any)["text"].(string)
	for _, phrase := range []string{"supportedModelSchemaVersions:[1,2]", "requiredModelSchemaVersion:2", "grid imports do not charge", "Existing nodes, edges, resources and scenarios CRUD", "state/result.infrastructure"} {
		if !strings.Contains(text, phrase) {
			t.Fatal("compact guide lacks semantic model details", phrase)
		}
	}
	endpoint := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/diagrams/{diagramId}/simulation","method":"PUT"}}`)))
	if endpoint["isError"] != false {
		t.Fatal("complete model contract must be discoverable before content access")
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(endpoint["content"].([]any)[0].(map[string]any)["text"].(string)), &document); err != nil {
		t.Fatal(err)
	}
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"SimulationInfrastructureProfile", "SimulationInfrastructureCPUActivity", "SimulationInfrastructureMemoryLease", "SimulationInfrastructureTransfer", "SimulationInfrastructureBattery", "SimulationInfrastructureResourcePartial", "SimulationInfrastructureWorkPartial"} {
		if schemas[name] == nil {
			t.Fatal("scoped model documentation dropped an infrastructure dependency", name)
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("schema discovery must not require or inspect browser data")
	}
}
