package server

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestMCPDiscoversInfrastructureWithoutWorkspaceAccess(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	if initialized["serverInfo"].(map[string]any)["version"] != "0.11.0" {
		t.Fatal("infrastructure discovery requires the current bridge announcement")
	}
	for _, phrase := range []string{"infrastructure-resources-v1", "schemaVersion:2", "infrastructure:{schemaVersion:1}", "same two MCP tools", "stage/case RAM", "SIMULATION_INFRASTRUCTURE_INVALID", "SIMULATION_INFRASTRUCTURE_STALLED", "null removes optional", "no second clock", "bandwidth-unavailable", "activeTransfers>0 and usedMbps===0"} {
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
	for _, phrase := range []string{"supportedModelSchemaVersions:[1,2]", "requiredModelSchemaVersion:2", "grid imports do not charge", "Existing nodes, edges, resources and scenarios CRUD", "state/result.infrastructure", "bandwidth-unavailable", "activeTransfers>0 and usedMbps===0"} {
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
	bottlenecks := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs","arguments":{"document":"endpoint","path":"/diagrams/{diagramId}/simulation/runs/{runId}/bottlenecks","method":"GET"}}`)))
	if bottlenecks["isError"] != false {
		t.Fatal("actual bottleneck inspection must be discoverable before workspace access")
	}
	bottleneckDoc := bottlenecks["content"].([]any)[0].(map[string]any)["text"].(string)
	var bottleneckContract map[string]any
	if err := json.Unmarshal([]byte(bottleneckDoc), &bottleneckContract); err != nil {
		t.Fatal(err)
	}
	bottleneckSchema := bottleneckContract["components"].(map[string]any)["schemas"].(map[string]any)["SimulationBottleneck"].(map[string]any)
	methods := bottleneckSchema["properties"].(map[string]any)["methodology"].(map[string]any)["enum"]
	if !reflect.DeepEqual(methods, []any{"queue-history", "blocked-admission", "bandwidth-sharing", "bandwidth-unavailable", "energy-shortfall"}) {
		t.Fatal("scoped result documentation must preserve every supported bottleneck methodology")
	}
	for _, phrase := range []string{"activeTransfers>0 and usedMbps===0", "propagation-only"} {
		if !strings.Contains(bottleneckSchema["description"].(string), phrase) {
			t.Fatal("scoped result documentation must include the unavailable-bandwidth condition", phrase)
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("schema discovery must not require or inspect browser data")
	}
}
